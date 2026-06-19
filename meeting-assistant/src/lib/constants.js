// 設定・定数の単一の真実（既存 src/lib/constants.js のスタイルを踏襲）

export const DEFAULT_SETTINGS = {
  enabled: false,

  // 音声認識（STT）
  sttProvider: "openai", // "openai" | "deepgram" | "none"
  sttApiKey: "",
  sttModel: "whisper-1",

  // 回答生成（LLM）
  llmProvider: "claude",
  llmApiKey: "",
  llmModel: "claude-opus-4-8",

  // 言語・用途
  language: "ja",
  industry: "",
  suggestionCount: 3,

  // 営業ノウハウ・方針（ユーザーが追記。空でも組み込みメソッドで動く）
  playbook: "",

  // 呼び出し制御
  debounceMs: 1200, // 相手の発言確定後、この無音が続いたら LLM 呼び出し
  contextTurns: 12, // LLM に渡す直近の相手発言数

  // オーバーレイUI状態
  overlayCollapsed: false,
  overlayPos: { x: 24, y: 24 },
};

export const STT_PROVIDERS = {
  openai: "OpenAI (Whisper)",
  deepgram: "Deepgram",
  none: "なし（無効）",
};

export const LLM_PROVIDERS = {
  claude: "Claude (Anthropic)",
};

// 文字起こしの保持上限（相手発言セグメント数）
export const MAX_TRANSCRIPT_SEGMENTS = 200;

export const OFFSCREEN_PATH = "src/offscreen.html";

// コンポーネント間メッセージ種別（タイポ防止のため凍結）
export const MSG = Object.freeze({
  // popup/content → background
  START_CAPTURE: "START_CAPTURE",
  STOP_CAPTURE: "STOP_CAPTURE",
  STATUS: "STATUS",
  SETTINGS_UPDATED: "SETTINGS_UPDATED",

  // background → offscreen
  OFFSCREEN_START: "OFFSCREEN_START",
  OFFSCREEN_STOP: "OFFSCREEN_STOP",

  // offscreen → background
  TRANSCRIPT_SEGMENT: "TRANSCRIPT_SEGMENT",
  OFFSCREEN_ERROR: "OFFSCREEN_ERROR",

  // background → content/popup
  SESSION_STARTED: "SESSION_STARTED",
  SESSION_STOPPED: "SESSION_STOPPED",
  OVERLAY_TRANSCRIPT: "OVERLAY_TRANSCRIPT",
  SUGGESTION_DELTA: "SUGGESTION_DELTA",
  SUGGESTIONS: "SUGGESTIONS",
  SUGGESTIONS_NEEDS_KEY: "SUGGESTIONS_NEEDS_KEY",
});
