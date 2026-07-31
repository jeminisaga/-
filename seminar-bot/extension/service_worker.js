// Service worker: bridges the local orchestrator (WebSocket) to the offscreen
// recorder. On load it connects to ws://127.0.0.1:<PORT> and relays start/stop
// commands to the offscreen document, creating the offscreen document on demand.
//
// The port is fixed so the orchestrator and the extension agree without any
// runtime handshake. Keep it in sync with spike/spike.mjs (ORCH_PORT).
const ORCH_PORT = 8787;
const WS_URL = `ws://127.0.0.1:${ORCH_PORT}/ext`;

let socket = null;
let reconnectTimer = null;

function log(...args) {
  console.log("[sw]", ...args);
}

async function ensureOffscreen() {
  const exists = await chrome.offscreen.hasDocument();
  if (!exists) {
    await chrome.offscreen.createDocument({
      url: "offscreen.html",
      reasons: ["DISPLAY_MEDIA"],
      justification: "Record the meeting tab (audio + video) for the seminar bot.",
    });
    log("offscreen document created");
  }
}

async function handleCommand(msg) {
  if (msg.cmd === "start") {
    await ensureOffscreen();
    chrome.runtime.sendMessage({ target: "offscreen", ...msg });
    log("relayed start", msg.meetingId);
  } else if (msg.cmd === "stop") {
    chrome.runtime.sendMessage({ target: "offscreen", cmd: "stop" });
    log("relayed stop");
  }
}

function connect() {
  clearTimeout(reconnectTimer);
  try {
    socket = new WebSocket(WS_URL);
  } catch (e) {
    scheduleReconnect();
    return;
  }
  socket.onopen = () => log("connected to orchestrator");
  socket.onmessage = (ev) => {
    let msg;
    try {
      msg = JSON.parse(ev.data);
    } catch {
      return;
    }
    handleCommand(msg).catch((e) => log("command error", String(e)));
  };
  socket.onclose = () => scheduleReconnect();
  socket.onerror = () => {
    try {
      socket.close();
    } catch {}
  };
}

function scheduleReconnect() {
  clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(connect, 1000);
}

// The offscreen recorder reports back over runtime messaging; forward the
// status to the orchestrator so it knows the upload succeeded.
chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.from === "offscreen" && socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ status: msg.status, meetingId: msg.meetingId, detail: msg.detail }));
  }
});

connect();
