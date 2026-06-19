// chrome.storage.local ラッパ（既存 src/lib/storage.js のパターンを踏襲）

import { DEFAULT_SETTINGS, MAX_TRANSCRIPT_SEGMENTS } from "./constants.js";

const KEYS = {
  settings: "settings",
  transcript: "transcript",
  session: "session",
};

export async function getSettings() {
  const { [KEYS.settings]: s } = await chrome.storage.local.get(KEYS.settings);
  return { ...DEFAULT_SETTINGS, ...(s || {}) };
}

export async function updateSettings(patch) {
  const current = await getSettings();
  const next = { ...current, ...patch };
  await chrome.storage.local.set({ [KEYS.settings]: next });
  return next;
}

// 相手発言の文字起こし（{ text, final, ts } の配列）
export async function getTranscript() {
  const { [KEYS.transcript]: t } = await chrome.storage.local.get(
    KEYS.transcript
  );
  return t || [];
}

export async function appendTranscript(segment) {
  const transcript = await getTranscript();

  // 直近が未確定(partial)なら置き換え、確定なら追記
  const last = transcript[transcript.length - 1];
  if (last && !last.final) {
    transcript[transcript.length - 1] = segment;
  } else {
    transcript.push(segment);
  }

  // 上限超過分を先頭から捨てる
  const trimmed =
    transcript.length > MAX_TRANSCRIPT_SEGMENTS
      ? transcript.slice(transcript.length - MAX_TRANSCRIPT_SEGMENTS)
      : transcript;

  await chrome.storage.local.set({ [KEYS.transcript]: trimmed });
  return trimmed;
}

export async function clearTranscript() {
  await chrome.storage.local.remove(KEYS.transcript);
}

// セッション状態（SW 再起動に耐えるため storage にミラー）
export async function getSessionState() {
  const { [KEYS.session]: s } = await chrome.storage.local.get(KEYS.session);
  return s || null;
}

export async function setSessionState(state) {
  if (state === null) {
    await chrome.storage.local.remove(KEYS.session);
  } else {
    await chrome.storage.local.set({ [KEYS.session]: state });
  }
}
