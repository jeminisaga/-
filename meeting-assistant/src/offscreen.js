// offscreen document: タブ音声を取得 → 16kHz PCM 化 → STT へ流す。
// service worker は DOM/getUserMedia を持てないため、この層が音声処理を担う。

import { MSG } from "./lib/constants.js";
import { createSTTClient } from "./lib/stt/index.js";

let audioCtx = null;
let mediaStream = null;
let workletNode = null;
let sourceNode = null;
let stt = null;

chrome.runtime.onMessage.addListener((msg) => {
  if (!msg) return;
  if (msg.type === MSG.OFFSCREEN_START) {
    start(msg.streamId, msg.settings).catch((err) => reportError(err));
  } else if (msg.type === MSG.OFFSCREEN_STOP) {
    stop().catch((err) => reportError(err));
  }
});

async function start(streamId, settings) {
  await stop(); // 念のため既存をクリーンアップ

  mediaStream = await navigator.mediaDevices.getUserMedia({
    audio: {
      mandatory: {
        chromeMediaSource: "tab",
        chromeMediaSourceId: streamId,
      },
    },
    video: false,
  });

  audioCtx = new AudioContext();
  sourceNode = audioCtx.createMediaStreamSource(mediaStream);

  // tabCapture は取得すると既定でタブが無音化するため、destination に再接続して
  // ユーザーにも通話音声が聞こえ続けるようにする。
  sourceNode.connect(audioCtx.destination);

  await audioCtx.audioWorklet.addModule(
    chrome.runtime.getURL("src/audio/pcm-worklet.js")
  );
  workletNode = new AudioWorkletNode(audioCtx, "pcm-worklet");

  // STT クライアント
  stt = createSTTClient(settings);
  stt.onTranscript(({ text, final }) => {
    chrome.runtime.sendMessage({
      type: MSG.TRANSCRIPT_SEGMENT,
      text,
      final,
      ts: Date.now(),
    });
  });
  stt.onError((err) => reportError(err));
  await stt.start();

  workletNode.port.onmessage = (ev) => {
    if (stt) stt.pushPcm(ev.data); // Int16Array
  };

  // source を worklet に接続し、worklet を destination に接続する。
  // AudioWorkletNode は destination まで経路が無いとレンダリングされず
  // process() が呼ばれないため、必ず destination まで繋ぐ。
  // worklet は出力バッファに何も書かない＝無音なので音声は二重にならない。
  sourceNode.connect(workletNode);
  workletNode.connect(audioCtx.destination);
}

async function stop() {
  try {
    if (workletNode) {
      workletNode.port.onmessage = null;
      workletNode.disconnect();
    }
  } catch {
    /* noop */
  }
  workletNode = null;

  try {
    if (stt) await stt.stop();
  } catch {
    /* noop */
  }
  stt = null;

  try {
    if (sourceNode) sourceNode.disconnect();
  } catch {
    /* noop */
  }
  sourceNode = null;

  if (mediaStream) {
    for (const t of mediaStream.getTracks()) t.stop();
    mediaStream = null;
  }

  if (audioCtx) {
    try {
      await audioCtx.close();
    } catch {
      /* noop */
    }
    audioCtx = null;
  }
}

function reportError(err) {
  console.error("[MA offscreen]", err);
  chrome.runtime.sendMessage({
    type: MSG.OFFSCREEN_ERROR,
    message: String((err && err.message) || err),
  });
}
