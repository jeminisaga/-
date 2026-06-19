// Deepgram ストリーミング文字起こし（WebSocket, linear16 16kHz）。
// interim/final 結果を共通の { text, final } に正規化する。

import { BaseSTT } from "./base.js";

const SAMPLE_RATE = 16000;

export class DeepgramSTT extends BaseSTT {
  constructor(settings) {
    super();
    this.apiKey = settings.sttApiKey;
    this.model = settings.sttModel || "nova-2";
    this.language = settings.language || "ja";
    this._ws = null;
    this._ready = false;
    this._pending = []; // 接続確立前の PCM
  }

  async start() {
    const params = new URLSearchParams({
      model: this.model,
      language: this.language,
      encoding: "linear16",
      sample_rate: String(SAMPLE_RATE),
      channels: "1",
      interim_results: "true",
      punctuate: "true",
    });
    // ブラウザ WebSocket は任意ヘッダを付けられないため、subprotocol でトークンを渡す
    const url = `wss://api.deepgram.com/v1/listen?${params.toString()}`;
    const ws = new WebSocket(url, ["token", this.apiKey]);
    ws.binaryType = "arraybuffer";
    this._ws = ws;

    ws.onopen = () => {
      this._ready = true;
      for (const frame of this._pending) ws.send(frame);
      this._pending = [];
    };
    ws.onmessage = (ev) => this._handleMessage(ev.data);
    ws.onerror = () => this._onError(new Error("Deepgram WebSocket error"));
    ws.onclose = (ev) => {
      this._ready = false;
      if (ev.code !== 1000 && ev.code !== 1005) {
        this._onError(new Error(`Deepgram closed: ${ev.code} ${ev.reason}`));
      }
    };
  }

  pushPcm(int16Frame) {
    // Int16Array のバッキング ArrayBuffer をそのまま送る
    const buf = int16Frame.buffer.slice(
      int16Frame.byteOffset,
      int16Frame.byteOffset + int16Frame.byteLength
    );
    if (this._ready && this._ws) {
      this._ws.send(buf);
    } else {
      this._pending.push(buf);
    }
  }

  async stop() {
    if (this._ws) {
      try {
        if (this._ready) this._ws.send(JSON.stringify({ type: "CloseStream" }));
        this._ws.close(1000);
      } catch {
        /* noop */
      }
      this._ws = null;
    }
    this._ready = false;
  }

  _handleMessage(data) {
    let msg;
    try {
      msg = JSON.parse(data);
    } catch {
      return;
    }
    if (msg.type && msg.type !== "Results") return;
    const alt = msg.channel && msg.channel.alternatives && msg.channel.alternatives[0];
    const text = alt && alt.transcript ? alt.transcript.trim() : "";
    if (!text) return;
    this._onTranscript({ text, final: !!msg.is_final });
  }
}
