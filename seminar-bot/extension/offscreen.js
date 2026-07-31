// Offscreen document: the long-lived context that owns the MediaRecorder.
// It captures the meeting tab via getDisplayMedia() — the picker is resolved
// automatically by Chromium's --auto-select-tab-capture-source-by-title flag,
// and the permission prompt is suppressed by --use-fake-ui-for-media-stream.
// On stop it POSTs the recorded webm to the orchestrator's /upload endpoint.
const ORCH_PORT = 8787;

let recorder = null;
let chunks = [];
let current = null; // { meetingId }

function log(...args) {
  console.log("[offscreen]", ...args);
}

function report(status, detail) {
  chrome.runtime.sendMessage({
    from: "offscreen",
    status,
    meetingId: current && current.meetingId,
    detail: detail ? String(detail) : undefined,
  });
}

async function startRecording(msg) {
  if (recorder && recorder.state !== "inactive") {
    log("already recording; ignoring start");
    return;
  }
  current = { meetingId: msg.meetingId || "unknown" };
  chunks = [];
  try {
    // Capture audio + video by default. The orchestrator may pass audio:false
    // for environments with no working audio backend (e.g. a headless CI box
    // with no PulseAudio, where display-audio capture throws NotReadableError).
    // A real desktop (the user's Windows PC) captures both.
    const wantAudio = msg.audio !== false;
    let stream;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: wantAudio,
      });
    } catch (captureErr) {
      // msg.selftest is set ONLY by the Phase 0 spike on a headless box that
      // cannot produce real capture frames. It swaps in a synthetic canvas
      // stream so the encode->upload->save path is still exercised. Never set
      // in production, so real usage fails loudly instead of recording nothing.
      if (!msg.selftest) throw captureErr;
      log("real display capture unavailable; using synthetic self-test stream:", String(captureErr));
      current.selftest = true;
      stream = makeSelfTestStream(wantAudio);
    }
    current.audioCaptured = stream.getAudioTracks().length > 0;

    const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9,opus")
      ? "video/webm;codecs=vp9,opus"
      : "video/webm";

    recorder = new MediaRecorder(stream, { mimeType });
    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunks.push(e.data);
    };
    recorder.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      const blob = new Blob(chunks, { type: "video/webm" });
      log("recorded bytes:", blob.size);
      try {
        const res = await fetch(
          `http://127.0.0.1:${ORCH_PORT}/upload?meetingId=${encodeURIComponent(
            current.meetingId
          )}`,
          { method: "POST", headers: { "Content-Type": "video/webm" }, body: blob }
        );
        report(
          res.ok ? "uploaded" : "upload_failed",
          `http ${res.status}, ${blob.size} bytes, audio=${current.audioCaptured}`
        );
      } catch (e) {
        report("upload_failed", e);
      }
      recorder = null;
      chunks = [];
    };
    // Flush a chunk every 2s so a crash never loses the whole recording.
    recorder.start(2000);
    report("recording");
    log("recording started as", current.meetingId);
  } catch (e) {
    log("getDisplayMedia failed:", String(e));
    report("start_failed", e);
  }
}

function stopRecording() {
  if (recorder && recorder.state !== "inactive") {
    recorder.stop();
    log("stop requested");
  }
}

// Synthetic stream for the Phase 0 spike only (see startRecording). A hidden
// document doesn't fire requestAnimationFrame, so drive the canvas with a
// timer; captureStream() picks up the pixel changes.
function makeSelfTestStream(wantAudio) {
  const canvas = document.createElement("canvas");
  canvas.width = 320;
  canvas.height = 240;
  const ctx = canvas.getContext("2d");
  let n = 0;
  setInterval(() => {
    n++;
    ctx.fillStyle = "#202830";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#3ddc97";
    ctx.fillRect((n * 6) % canvas.width, 90, 60, 60);
    ctx.fillStyle = "#fff";
    ctx.font = "20px monospace";
    ctx.fillText("selftest " + n, 12, 30);
  }, 66);
  const stream = canvas.captureStream(15);
  if (wantAudio) {
    try {
      const ac = new AudioContext();
      const osc = ac.createOscillator();
      const dest = ac.createMediaStreamDestination();
      osc.frequency.value = 440;
      osc.connect(dest);
      osc.start();
      dest.stream.getAudioTracks().forEach((t) => stream.addTrack(t));
    } catch (e) {
      log("selftest audio track unavailable:", String(e));
    }
  }
  return stream;
}

chrome.runtime.onMessage.addListener((msg) => {
  if (!msg || msg.target !== "offscreen") return;
  if (msg.cmd === "start") startRecording(msg);
  else if (msg.cmd === "stop") stopRecording();
});
