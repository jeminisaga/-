// STT プロバイダ共通インタフェース
//
//   { start(), pushPcm(int16Frame), stop(), onTranscript(cb), onError(cb) }
//
//   onTranscript(cb): cb({ text, final }) を呼ぶ
//     final=false … 未確定（直近セグメントを置き換える）
//     final=true  … 確定（コミット）

export class BaseSTT {
  constructor() {
    this._onTranscript = () => {};
    this._onError = () => {};
  }

  onTranscript(cb) {
    this._onTranscript = cb;
  }

  onError(cb) {
    this._onError = cb;
  }

  // 以下はサブクラスで実装
  async start() {}
  pushPcm(_int16Frame) {}
  async stop() {}
}

// キー未設定・無効時のダミー実装（何も送らない＝アプリは落ちない）
export class NoopSTT extends BaseSTT {
  async start() {}
  pushPcm() {}
  async stop() {}
}
