// service worker: オーケストレーション・文字起こし蓄積・Claude 呼び出し・ルーティング。

import { MSG, OFFSCREEN_PATH } from "./lib/constants.js";
import {
  getSettings,
  appendTranscript,
  clearTranscript,
  getTranscript,
  getSessionState,
  setSessionState,
} from "./lib/storage.js";
import { sendToTab } from "./lib/messaging.js";
import { createLLMClient } from "./lib/llm/index.js";

// SW のメモリ上状態（失効したら storage から復元する）
let debounceTimer = null;
let inFlight = null; // AbortController

// ---------- メッセージ受信 ----------
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg) return false;
  switch (msg.type) {
    case MSG.START_CAPTURE:
      startCapture(msg.tabId, msg.streamId)
        .then(() => sendResponse({ ok: true }))
        .catch((err) => sendResponse({ ok: false, error: String(err.message) }));
      return true;
    case MSG.STOP_CAPTURE:
      stopCapture()
        .then(() => sendResponse({ ok: true }))
        .catch((err) => sendResponse({ ok: false, error: String(err.message) }));
      return true;
    case MSG.STATUS:
      getSessionState().then((s) =>
        sendResponse({ ok: true, capturing: !!s, tabId: s ? s.tabId : null })
      );
      return true;
    case MSG.TRANSCRIPT_SEGMENT:
      onTranscriptSegment(msg).then(() => sendResponse({ ok: true }));
      return true;
    case MSG.OFFSCREEN_ERROR:
      getSessionState().then((s) => {
        if (s) sendToTab(s.tabId, MSG.OFFSCREEN_ERROR, { message: msg.message });
      });
      return false;
    case MSG.SETTINGS_UPDATED:
      // 反映は次回の取得時に行われる
      return false;
    case "OPEN_OPTIONS":
      chrome.runtime.openOptionsPage();
      return false;
    default:
      return false;
  }
});

// ---------- キャプチャ開始/停止 ----------
async function startCapture(tabId, streamId) {
  if (!tabId) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    tabId = tab && tab.id;
  }
  if (!tabId) throw new Error("対象タブが見つかりません");

  // streamId は popup 側（ユーザー操作の文脈）で取得済みが基本。
  // 無ければ SW 側でフォールバック取得（content からの開始など）。
  if (!streamId) {
    streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId });
  }
  if (!streamId) throw new Error("音声の取得に失敗しました（タブをリロードして再試行）");

  await ensureOffscreen();
  const settings = await getSettings();

  await clearTranscript();
  chrome.runtime.sendMessage({
    type: MSG.OFFSCREEN_START,
    streamId,
    settings,
  });

  await setSessionState({ tabId, startedAt: Date.now() });
  await sendToTab(tabId, MSG.SESSION_STARTED, { tabId });
}

async function stopCapture() {
  const session = await getSessionState();
  chrome.runtime.sendMessage({ type: MSG.OFFSCREEN_STOP });
  await closeOffscreen();
  await setSessionState(null);
  if (inFlight) {
    inFlight.abort();
    inFlight = null;
  }
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  if (session) await sendToTab(session.tabId, MSG.SESSION_STOPPED, {});
}

// ---------- offscreen 管理 ----------
async function ensureOffscreen() {
  const has = await chrome.offscreen.hasDocument();
  if (has) return;
  try {
    await chrome.offscreen.createDocument({
      url: OFFSCREEN_PATH,
      reasons: ["USER_MEDIA"],
      justification: "タブ音声をリアルタイム文字起こしするため",
    });
  } catch (err) {
    // 作成レース（既に存在）は無視
    if (!String(err.message).includes("single offscreen")) throw err;
  }
}

async function closeOffscreen() {
  try {
    if (await chrome.offscreen.hasDocument()) {
      await chrome.offscreen.closeDocument();
    }
  } catch {
    /* noop */
  }
}

// ---------- 文字起こし → 提案 ----------
async function onTranscriptSegment(msg) {
  const segment = { text: msg.text, final: msg.final, ts: msg.ts };
  await appendTranscript(segment);

  const session = await getSessionState();
  if (session) {
    await sendToTab(session.tabId, MSG.OVERLAY_TRANSCRIPT, segment);
  }

  await maybeRequestSuggestions(segment);
}

async function maybeRequestSuggestions(segment) {
  const settings = await getSettings();
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  const fire = () => {
    debounceTimer = null;
    requestSuggestions().catch((err) => console.error("[MA] suggest", err));
  };
  if (segment.final) {
    // 確定したら短い猶予の後に呼び出し（連続 final を合体させる）
    debounceTimer = setTimeout(fire, Math.min(400, settings.debounceMs));
  } else {
    // 未確定は無音待ち
    debounceTimer = setTimeout(fire, settings.debounceMs);
  }
}

async function requestSuggestions() {
  const settings = await getSettings();
  const session = await getSessionState();
  if (!session) return;

  const llm = createLLMClient(settings);
  if (!llm.hasKey || !llm.hasKey()) {
    await sendToTab(session.tabId, MSG.SUGGESTIONS_NEEDS_KEY, {});
    return;
  }

  const all = await getTranscript();
  const recent = all.slice(-settings.contextTurns);
  if (recent.length === 0) return;

  // 進行中の呼び出しをキャンセル
  if (inFlight) inFlight.abort();
  inFlight = new AbortController();
  const signal = inFlight.signal;

  try {
    const result = await llm.suggest({
      transcript: recent,
      signal,
      onDelta: (partial) => {
        sendToTab(session.tabId, MSG.SUGGESTION_DELTA, { partial });
      },
    });
    if (!signal.aborted) {
      await sendToTab(session.tabId, MSG.SUGGESTIONS, {
        cards: result.suggestions || [],
      });
    }
  } catch (err) {
    if (err && err.name === "AbortError") return;
    await sendToTab(session.tabId, MSG.OFFSCREEN_ERROR, {
      message: String(err.message),
    });
  } finally {
    if (inFlight && inFlight.signal === signal) inFlight = null;
  }
}

// ---------- ライフサイクル ----------
chrome.tabs.onRemoved.addListener(async (tabId) => {
  const session = await getSessionState();
  if (session && session.tabId === tabId) await stopCapture();
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  if (!changeInfo.url) return;
  const session = await getSessionState();
  if (session && session.tabId === tabId) await stopCapture();
});
