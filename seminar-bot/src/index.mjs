// Main entrypoint: poll Google Calendar, and for each upcoming seminar join it,
// record it, leave when it ends, and transcribe the recording.
import fs from "node:fs";
import path from "node:path";
import { loadConfig } from "./config.mjs";
import { makeLogger } from "./logger.mjs";
import { getAuthClient } from "./calendar/auth.mjs";
import { fetchMeetings } from "./calendar/poll.mjs";
import { Scheduler, windowFor } from "./scheduler/scheduler.mjs";
import { RecorderServer } from "./recording/recorderServer.mjs";
import { launchBrowser } from "./browser/launch.mjs";
import { joinMeet, leaveMeet } from "./browser/joinMeet.mjs";
import { joinZoom } from "./browser/joinZoom.mjs";
import { waitForEnd } from "./browser/endDetection.mjs";
import { transcribe } from "./transcription/transcribe.mjs";
import { makeNotifier } from "./notify/notify.mjs";

const log = makeLogger("main");

function safeId(meeting) {
  const t = (meeting.title || "meeting").replace(/[^a-z0-9_-]/gi, "_").substring(0, 40);
  const d = new Date(meeting.start).toISOString().replace(/[:.]/g, "-").substring(0, 16);
  return `${t}-${d}`;
}

async function handleMeeting(meeting, cfg, recorder, notifier) {
  const recId = safeId(meeting);
  const mlog = makeLogger(recId);
  let context;
  const meta = { ...meeting, recId, joinedAt: null, leftAt: null, status: "started", endReason: null };

  try {
    context = await launchBrowser("SEMINAR_REC_TAB");
    await recorder.waitForExtension();

    const joiner = meeting.platform === "zoom" ? joinZoom : joinMeet;
    const { tabTitle } = await joiner(context, meeting, cfg, mlog);
    meta.joinedAt = new Date().toISOString();

    recorder.startRecording(recId, tabTitle);
    mlog.info("recording started");

    const w = windowFor(meeting, cfg);
    meta.endReason = await waitForEnd(context.pages().slice(-1)[0], w, cfg, mlog);
    mlog.info(`meeting end detected: ${meta.endReason}`);

    // Stop recording (wait for upload) BEFORE closing the browser.
    let savedPath = null;
    try {
      savedPath = await recorder.stopRecording(recId);
    } catch (e) {
      mlog.error("recording upload failed:", String(e));
    }

    // Leave politely, then close.
    try {
      if (meeting.platform === "meet") await leaveMeet(context.pages().slice(-1)[0], mlog);
    } catch {}
    meta.leftAt = new Date().toISOString();
    await context.close().catch(() => {});
    context = null;

    if (savedPath) {
      meta.recording = savedPath;
      try {
        const t = await transcribe(savedPath, cfg, mlog);
        if (t) meta.transcript = t.txt;
        meta.status = "done";
      } catch (e) {
        mlog.error("transcription failed:", String(e));
        meta.status = "recorded_no_transcript";
      }
    } else {
      meta.status = "no_recording";
    }
  } catch (e) {
    const msg = String(e);
    meta.status = "failed";
    meta.error = msg;
    mlog.error("meeting failed:", msg);
    if (msg.includes("zoom_blocked")) {
      notifier.notify(`Zoom に入れませんでした: ${meeting.title}`, "CAPTCHA/規約の壁の可能性。手動参加を検討してください。");
      if (e.screenshot) {
        const p = path.join(cfg.outputDir, `${recId}-zoom-blocked.png`);
        fs.writeFileSync(p, e.screenshot);
      }
    } else if (msg.includes("not admitted")) {
      notifier.notify(`入室が承認されませんでした: ${meeting.title}`, "待機室のままタイムアウトしました。");
    }
  } finally {
    if (context) await context.close().catch(() => {});
    const metaDir = path.join(cfg.outputDir, "meta");
    fs.mkdirSync(metaDir, { recursive: true });
    fs.writeFileSync(path.join(metaDir, `${recId}.json`), JSON.stringify(meta, null, 2));
    log.info(`meeting "${meeting.title}" finished with status: ${meta.status}`);
  }
}

async function main() {
  const cfg = loadConfig();
  fs.mkdirSync(cfg.outputDir, { recursive: true });
  log.info(`seminar-bot starting (tz=${cfg.timezone}, meet=${cfg.platforms.meet}, zoom=${cfg.platforms.zoom})`);

  const auth = getAuthClient(); // throws with instructions if not authorized
  const recorder = new RecorderServer(cfg, makeLogger("recorder"));
  await recorder.start();
  const notifier = makeNotifier(cfg, log);

  const scheduler = new Scheduler(cfg, (m) => handleMeeting(m, cfg, recorder, notifier), makeLogger("sched"));

  async function poll() {
    try {
      const meetings = await fetchMeetings(auth, cfg, log);
      scheduler.sync(meetings);
    } catch (e) {
      log.error("poll failed:", String(e));
    }
  }

  await poll();
  setInterval(poll, cfg.pollIntervalMinutes * 60 * 1000);
  log.info(`polling every ${cfg.pollIntervalMinutes} min. Leave this process running.`);
}

main().catch((e) => {
  log.error("fatal:", String(e));
  process.exit(1);
});
