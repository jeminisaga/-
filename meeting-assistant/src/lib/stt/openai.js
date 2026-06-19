// OpenAI 文字起こし。
// チャンク POST モード（~3秒の音声を WAV にして /v1/audio/transcriptions に送る）。
// 低コストだが 2-4 秒の遅延があり、結果は final セグメントとして返す。

import { BaseSTT } from "./base.js";

const SAMPLE_RATE = 16000;
const CHUNK_SECONDS = 3;
const SAMPLES_PER_CHUNK = SAMPLE_RATE * CHUNK_SECONDS;
// 単純な無音判定（このRMS未満のチャンクはAPIに送らない）
const SILENCE_RMS = 0.008;

export class OpenAISTT extends BaseSTT {
  constructor(settings) {
    super();
    this.apiKey = settings.sttApiKey;
    this.model = settings.sttModel || "whisper-1";
    this.language = settings.language || "ja";
    this._buf = []; // Int16Array フレームの蓄積
    this._bufLen = 0;
    this._stopped = false;
  }

  async start() {
    this._stopped = false;
  }

  pushPcm(int16Frame) {
    if (this._stopped) return;
    this._buf.push(int16Frame);
    this._bufLen += int16Frame.length;
    if (this._bufLen >= SAMPLES_PER_CHUNK) {
      this._flush();
    }
  }

  async stop() {
    this._stopped = true;
    if (this._bufLen > 0) this._flush();
  }

  _flush() {
    const pcm = mergeInt16(this._buf, this._bufLen);
    this._buf = [];
    this._bufLen = 0;
    if (isSilent(pcm)) return;
    this._transcribe(pcm).catch((err) => this._onError(err));
  }

  async _transcribe(pcm) {
    const wav = encodeWav(pcm, SAMPLE_RATE);
    const form = new FormData();
    form.append("file", new Blob([wav], { type: "audio/wav" }), "audio.wav");
    form.append("model", this.model);
    if (this.language) form.append("language", this.language);
    form.append("response_format", "json");

    const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}` },
      body: form,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`OpenAI STT ${res.status}: ${body.slice(0, 200)}`);
    }
    const data = await res.json();
    const text = (data.text || "").trim();
    if (text) this._onTranscript({ text, final: true });
  }
}

function mergeInt16(frames, totalLen) {
  const out = new Int16Array(totalLen);
  let off = 0;
  for (const f of frames) {
    out.set(f, off);
    off += f.length;
  }
  return out;
}

function isSilent(int16) {
  let sum = 0;
  for (let i = 0; i < int16.length; i++) {
    const v = int16[i] / 32768;
    sum += v * v;
  }
  const rms = Math.sqrt(sum / int16.length);
  return rms < SILENCE_RMS;
}

// 16bit PCM mono を WAV(RIFF) にエンコード
function encodeWav(int16, sampleRate) {
  const dataSize = int16.length * 2;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  writeStr(view, 0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeStr(view, 8, "WAVE");
  writeStr(view, 12, "fmt ");
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeStr(view, 36, "data");
  view.setUint32(40, dataSize, true);

  let off = 44;
  for (let i = 0; i < int16.length; i++, off += 2) {
    view.setInt16(off, int16[i], true);
  }
  return buffer;
}

function writeStr(view, offset, str) {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}
