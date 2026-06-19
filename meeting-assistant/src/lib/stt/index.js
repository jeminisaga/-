// STT プロバイダのファクトリ（唯一の切替点）。
// 新プロバイダ追加 = 1ファイル + ここに 1 case。

import { NoopSTT } from "./base.js";
import { OpenAISTT } from "./openai.js";
import { DeepgramSTT } from "./deepgram.js";

export function createSTTClient(settings) {
  // キー未設定なら Noop（アプリは落ちず、文字起こしが出ないだけ）
  if (!settings.sttApiKey || settings.sttProvider === "none") {
    return new NoopSTT();
  }
  switch (settings.sttProvider) {
    case "openai":
      return new OpenAISTT(settings);
    case "deepgram":
      return new DeepgramSTT(settings);
    default:
      return new NoopSTT();
  }
}
