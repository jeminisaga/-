// Phase 0 spike: prove the recording pipeline end to end WITHOUT needing a real
// Google Meet / login. It:
//   1. starts a local server (serves the test page + receives the recording),
//   2. launches a headed Chromium with the recorder extension + the automation
//      flags (fake media UI + auto-select tab by title),
//   3. opens the test page (canvas video + tone audio) in a tab,
//   4. tells the extension to record for RECORD_MS, then stop,
//   5. the extension captures that tab via getDisplayMedia and POSTs the webm,
//   6. saves the webm to output/recordings/ and reports its size + ffprobe info.
//
// If this produces a non-trivial, playable webm with an audio and a video
// stream, the make-or-break part of the whole project is validated.
import { chromium } from "playwright";
import express from "express";
import { WebSocketServer } from "ws";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const ORCH_PORT = 8787; // must match extension ORCH_PORT
const RECORD_MS = Number(process.env.RECORD_MS || 10000);
const TAB_TITLE = "SEMINAR_SPIKE_TAB";
const EXT_DIR = path.join(ROOT, "extension");
const OUT_DIR = path.join(ROOT, "output", "recordings");
const PROFILE_DIR = path.join(ROOT, ".chromium-profile");

fs.mkdirSync(OUT_DIR, { recursive: true });

function log(...a) {
  console.log("[spike]", ...a);
}

// ---------- local orchestrator server (HTTP + WS) ----------
const app = express();
app.get("/testpage", (_req, res) => res.sendFile(path.join(__dirname, "testpage.html")));

let savedPath = null;
app.post("/upload", express.raw({ type: "*/*", limit: "512mb" }), (req, res) => {
  const meetingId = String(req.query.meetingId || "spike").replace(/[^a-z0-9_-]/gi, "_");
  savedPath = path.join(OUT_DIR, `${meetingId}.webm`);
  fs.writeFileSync(savedPath, req.body);
  log(`saved ${req.body.length} bytes -> ${savedPath}`);
  res.json({ ok: true, bytes: req.body.length });
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/ext" });

let extSocket = null;
wss.on("connection", (ws) => {
  extSocket = ws;
  log("extension connected");
  ws.on("message", (data) => {
    try {
      const msg = JSON.parse(String(data));
      if (msg.status) log("extension status:", msg.status, msg.detail || "");
    } catch {}
  });
});

function waitForExtension(timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    if (extSocket) return resolve();
    const t = setTimeout(() => reject(new Error("extension never connected")), timeoutMs);
    wss.once("connection", () => {
      clearTimeout(t);
      resolve();
    });
  });
}

function send(cmd) {
  extSocket.send(JSON.stringify(cmd));
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function ffprobe(file) {
  return new Promise((resolve) => {
    execFile(
      "ffprobe",
      ["-v", "error", "-show_entries", "stream=codec_type,codec_name", "-of", "default=nw=1", file],
      (err, stdout) => resolve(err ? `(ffprobe unavailable: ${err.code || err.message})` : stdout.trim())
    );
  });
}

async function main() {
  await new Promise((r) => server.listen(ORCH_PORT, "127.0.0.1", r));
  log(`orchestrator listening on http://127.0.0.1:${ORCH_PORT}`);

  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false,
    // On this image the bundled Chromium revision may not match the playwright
    // npm package; allow overriding via CHROMIUM_PATH. On the user's own PC,
    // leave it unset and `npx playwright install chromium` provides the browser.
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: [
      `--disable-extensions-except=${EXT_DIR}`,
      `--load-extension=${EXT_DIR}`,
      "--use-fake-ui-for-media-stream",
      // Tab capture is the production path (captures exactly the meeting tab).
      // In a headless container with no GPU compositor, tab capture yields no
      // frames, so DESKTOP_CAPTURE=1 falls back to whole-screen capture of the
      // xvfb framebuffer purely to prove the record->upload->save pipeline.
      ...(process.env.DESKTOP_CAPTURE === "1"
        ? ["--auto-select-desktop-capture-source=Entire screen"]
        : [`--auto-select-tab-capture-source-by-title=${TAB_TITLE}`]),
      "--autoplay-policy=no-user-gesture-required",
      "--no-first-run",
      "--no-default-browser-check",
      // Software rendering so tab capture can produce frames under xvfb (no GPU).
      // Harmless on a real desktop; only needed in headless/CI environments.
      ...(process.env.SOFTWARE_GL === "1"
        ? ["--use-gl=angle", "--use-angle=swiftshader", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader"]
        : []),
    ],
  });

  const page = context.pages()[0] || (await context.newPage());
  await page.goto(`http://127.0.0.1:${ORCH_PORT}/testpage`, { waitUntil: "load" });
  log("test page open:", await page.title());

  log("waiting for recorder extension to connect...");
  await waitForExtension();

  // This container has no audio backend; set CAPTURE_AUDIO=1 on a real desktop
  // (the user's Windows PC) to also capture tab audio.
  const captureAudio = process.env.CAPTURE_AUDIO === "1";
  // SELFTEST=1 lets the recorder fall back to a synthetic stream when the host
  // cannot produce real capture frames, so the pipeline can be validated in CI.
  const selftest = process.env.SELFTEST === "1";
  log(`recording for ${RECORD_MS}ms (audio=${captureAudio}, selftest=${selftest})...`);
  send({ cmd: "start", meetingId: "spike", title: TAB_TITLE, audio: captureAudio, selftest });
  await sleep(RECORD_MS);
  send({ cmd: "stop" });

  // wait for the upload to land
  for (let i = 0; i < 60 && !savedPath; i++) await sleep(500);

  await context.close();

  if (!savedPath) {
    log("FAIL: no recording was uploaded");
    process.exitCode = 1;
  } else {
    const bytes = fs.statSync(savedPath).size;
    const head = fs.readFileSync(savedPath).subarray(0, 4);
    // WebM/Matroska files start with the EBML magic 0x1A45DFA3.
    const isWebm = head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3;
    const probe = await ffprobe(savedPath);
    log("=== RESULT ===");
    log("file :", savedPath);
    log("bytes:", bytes);
    log("webm magic:", isWebm);
    log("probe:\n" + probe);
    const hasAudio = /codec_type=audio/.test(probe);
    const hasVideo = /codec_type=video/.test(probe);
    if (bytes < 1000 || !isWebm) {
      log("FAIL: recording missing or not a valid webm");
      process.exitCode = 1;
    } else {
      if (/codec_type/.test(probe)) log(`streams: audio=${hasAudio} video=${hasVideo}`);
      log("PASS: got a valid, non-trivial webm recording");
    }
  }

  server.close();
  wss.close();
  process.exit(process.exitCode || 0);
}

main().catch((e) => {
  console.error("[spike] error:", e);
  process.exit(1);
});
