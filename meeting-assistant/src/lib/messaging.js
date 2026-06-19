// メッセージング薄ラッパ（既存 background.js の return-true パターンを共通化）

export async function sendToBackground(type, payload = {}) {
  try {
    return await chrome.runtime.sendMessage({ type, ...payload });
  } catch (err) {
    // 受信側不在（SW 起動中など）は無視
    console.warn("[MA] sendToBackground failed", type, err);
    return null;
  }
}

export async function sendToTab(tabId, type, payload = {}) {
  try {
    return await chrome.tabs.sendMessage(tabId, { type, ...payload });
  } catch (err) {
    // content script 未注入のページなど
    console.warn("[MA] sendToTab failed", type, err);
    return null;
  }
}

// handlerMap: { TYPE: async (msg, sender) => result }
// 非同期ハンドラのため常に true を返してチャネルを開いたままにする
export function onMessage(handlerMap) {
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    const handler = msg && handlerMap[msg.type];
    if (!handler) return false;
    Promise.resolve(handler(msg, sender))
      .then((result) => sendResponse({ ok: true, result }))
      .catch((err) => {
        console.error("[MA] handler error", msg.type, err);
        sendResponse({ ok: false, error: String(err && err.message) });
      });
    return true;
  });
}
