// AudioWorkletProcessor: 入力(通常48kHz float)を 16kHz mono Int16 PCM に変換し、
// ~50ms フレームで transferable として port に送る。依存なし。

const TARGET_RATE = 16000;
const FRAME_MS = 50;
const FRAME_SAMPLES = (TARGET_RATE * FRAME_MS) / 1000; // 800 サンプル

class PCMWorklet extends AudioWorkletProcessor {
  constructor() {
    super();
    this._acc = []; // 出力 Int16 を貯める
    this._inRate = sampleRate; // グローバル: 入力サンプルレート
    this._ratio = this._inRate / TARGET_RATE;
    this._pos = 0; // リサンプル用の小数位置（バッファ跨ぎ）
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0) return true;
    const ch = input[0]; // 1ch 目のみ使用
    if (!ch || ch.length === 0) return true;

    // 線形補間ダウンサンプル
    let pos = this._pos;
    while (pos < ch.length) {
      const i = Math.floor(pos);
      const frac = pos - i;
      const s0 = ch[i];
      const s1 = i + 1 < ch.length ? ch[i + 1] : s0;
      const sample = s0 + (s1 - s0) * frac;
      // Float32 [-1,1] → Int16
      let v = sample * 32768;
      if (v > 32767) v = 32767;
      else if (v < -32768) v = -32768;
      this._acc.push(v | 0);
      pos += this._ratio;
    }
    // 次バッファのために小数分のオフセットを繰り越し
    this._pos = pos - ch.length;

    // フレーム長たまったら送出
    while (this._acc.length >= FRAME_SAMPLES) {
      const frame = Int16Array.from(this._acc.splice(0, FRAME_SAMPLES));
      this.port.postMessage(frame, [frame.buffer]);
    }
    return true;
  }
}

registerProcessor("pcm-worklet", PCMWorklet);
