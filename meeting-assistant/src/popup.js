import { MSG } from "./lib/constants.js";
import { getSettings, updateSettings } from "./lib/storage.js";

const statusEl = document.getElementById("status");
const toggleBtn = document.getElementById("toggle");
const sttInd = document.getElementById("stt-ind");
const llmInd = document.getElementById("llm-ind");
const langSel = document.getElementById("language");
const industryInp = document.getElementById("industry");

let capturing = false;

init();

async function init() {
  const settings = await getSettings();
  langSel.value = settings.language || "ja";
  industryInp.value = settings.industry || "";
  setInd(sttInd, !!settings.sttApiKey && settings.sttProvider !== "none");
  setInd(llmInd, !!settings.llmApiKey);

  chrome.runtime.sendMessage({ type: MSG.STATUS }, (res) => {
    if (chrome.runtime.lastError) return;
    setCapturing(res && res.capturing);
  });

  toggleBtn.addEventListener("click", onToggle);
  document
    .getElementById("open-options")
    .addEventListener("click", () => chrome.runtime.openOptionsPage());

  langSel.addEventListener("change", () =>
    saveAndNotify({ language: langSel.value })
  );
  industryInp.addEventListener("change", () =>
    saveAndNotify({ industry: industryInp.value.trim() })
  );
}

function onToggle() {
  if (capturing) {
    chrome.runtime.sendMessage({ type: MSG.STOP_CAPTURE }, () => window.close());
  } else {
    // popup クリックは確実なユーザー操作。getMediaStreamId は SW へ渡すと
    // ジェスチャ/activeTab を失いやすいので、ここ（popup）で取得して streamId を渡す。
    chrome.tabs.query({ active: true, currentWindow: true }, async ([tab]) => {
      let streamId = null;
      try {
        streamId = await chrome.tabCapture.getMediaStreamId({
          targetTabId: tab && tab.id,
        });
      } catch (err) {
        // 取得失敗時は background 側のフォールバックに委ねる
        console.warn("[MA popup] getMediaStreamId failed", err);
      }
      chrome.runtime.sendMessage(
        { type: MSG.START_CAPTURE, tabId: tab && tab.id, streamId },
        (res) => {
          if (chrome.runtime.lastError || (res && !res.ok)) {
            statusEl.textContent =
              "開始失敗: " +
              (res?.error || chrome.runtime.lastError?.message || "");
            return;
          }
          window.close();
        }
      );
    });
  }
}

function setCapturing(on) {
  capturing = on;
  toggleBtn.textContent = on ? "停止" : "開始";
  statusEl.textContent = on ? "● 認識中" : "停止中";
  statusEl.classList.toggle("on", on);
}

function setInd(el, ok) {
  el.textContent = ok ? "設定済み" : "未設定";
  el.classList.toggle("ok", ok);
  el.classList.toggle("ng", !ok);
}

async function saveAndNotify(patch) {
  await updateSettings(patch);
  chrome.runtime.sendMessage({ type: MSG.SETTINGS_UPDATED });
}
