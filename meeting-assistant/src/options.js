import { MSG } from "./lib/constants.js";
import { getSettings, updateSettings } from "./lib/storage.js";
import { createClaudeClient } from "./lib/llm/claude.js";

const FIELDS = [
  "sttProvider",
  "sttApiKey",
  "sttModel",
  "llmProvider",
  "llmApiKey",
  "llmModel",
  "language",
  "industry",
  "playbook",
  "suggestionCount",
  "debounceMs",
  "contextTurns",
];
const NUMERIC = new Set(["suggestionCount", "debounceMs", "contextTurns"]);

init();

async function init() {
  const s = await getSettings();
  for (const f of FIELDS) {
    const el = document.getElementById(f);
    if (el != null && s[f] != null) el.value = s[f];
  }
  document.getElementById("save").addEventListener("click", onSave);
  document.getElementById("test-llm").addEventListener("click", testLlm);
  document.getElementById("test-stt").addEventListener("click", testStt);
}

function collect() {
  const patch = {};
  for (const f of FIELDS) {
    const el = document.getElementById(f);
    if (!el) continue;
    patch[f] = NUMERIC.has(f) ? Number(el.value) : el.value;
  }
  return patch;
}

async function onSave() {
  await updateSettings(collect());
  chrome.runtime.sendMessage({ type: MSG.SETTINGS_UPDATED });
  flash("saved", "保存しました ✓", true);
}

async function testLlm() {
  const result = document.getElementById("llm-result");
  result.textContent = "確認中…";
  result.className = "result";
  try {
    const client = createClaudeClient(collect());
    await client.ping();
    setResult(result, "接続OK ✓", true);
  } catch (err) {
    setResult(result, String(err.message), false);
  }
}

async function testStt() {
  const result = document.getElementById("stt-result");
  const s = collect();
  result.textContent = "確認中…";
  result.className = "result";
  if (!s.sttApiKey || s.sttProvider === "none") {
    setResult(result, "キー未設定", false);
    return;
  }
  try {
    let res;
    if (s.sttProvider === "openai") {
      res = await fetch("https://api.openai.com/v1/models", {
        headers: { Authorization: `Bearer ${s.sttApiKey}` },
      });
    } else if (s.sttProvider === "deepgram") {
      res = await fetch("https://api.deepgram.com/v1/projects", {
        headers: { Authorization: `Token ${s.sttApiKey}` },
      });
    }
    if (res && res.ok) setResult(result, "接続OK ✓", true);
    else setResult(result, `失敗: ${res ? res.status : "不明"}`, false);
  } catch (err) {
    setResult(result, String(err.message), false);
  }
}

function setResult(el, text, ok) {
  el.textContent = text;
  el.className = "result " + (ok ? "ok" : "ng");
}

function flash(id, text, ok) {
  setResult(document.getElementById(id), text, ok);
  setTimeout(() => {
    const el = document.getElementById(id);
    el.textContent = "";
    el.className = "result";
  }, 2500);
}
