// フローティング・オーバーレイ（ドラッグ/折りたたみ可）。
// content script は ES module import を使えないため自己完結の IIFE。
(() => {
  if (window.__maInjected) return;
  window.__maInjected = true;

  // background/constants.js と一致させるメッセージ種別
  const MSG = {
    START_CAPTURE: "START_CAPTURE",
    STOP_CAPTURE: "STOP_CAPTURE",
    STATUS: "STATUS",
    SESSION_STARTED: "SESSION_STARTED",
    SESSION_STOPPED: "SESSION_STOPPED",
    OVERLAY_TRANSCRIPT: "OVERLAY_TRANSCRIPT",
    SUGGESTION_DELTA: "SUGGESTION_DELTA",
    SUGGESTIONS: "SUGGESTIONS",
    SUGGESTIONS_NEEDS_KEY: "SUGGESTIONS_NEEDS_KEY",
    OFFSCREEN_ERROR: "OFFSCREEN_ERROR",
  };

  let root, transcriptEl, cardsEl, toggleBtn, statusEl;
  let capturing = false;

  init();

  async function init() {
    const settings = await getSettings();
    mountPanel(settings);
    // 既にキャプチャ中か確認
    chrome.runtime.sendMessage({ type: MSG.STATUS }, (res) => {
      if (chrome.runtime.lastError) return;
      if (res && res.capturing) setCapturing(true);
    });
  }

  function mountPanel(settings) {
    root = document.createElement("div");
    root.id = "ma-overlay";
    if (settings.overlayCollapsed) root.classList.add("ma-collapsed");
    root.style.left = (settings.overlayPos?.x ?? 24) + "px";
    root.style.top = (settings.overlayPos?.y ?? 24) + "px";

    root.innerHTML = `
      <div class="ma-header">
        <span class="ma-drag" title="ドラッグで移動">🟢 商談アシスタント</span>
        <span class="ma-status" id="ma-status">停止中</span>
        <button class="ma-btn" id="ma-toggle">開始</button>
        <button class="ma-iconbtn" id="ma-collapse" title="折りたたみ">▾</button>
      </div>
      <div class="ma-body">
        <div class="ma-section-label">相手の発言</div>
        <div class="ma-transcript" id="ma-transcript"></div>
        <div class="ma-section-label">回答候補</div>
        <div class="ma-cards" id="ma-cards"></div>
      </div>
    `;
    document.documentElement.appendChild(root);

    transcriptEl = root.querySelector("#ma-transcript");
    cardsEl = root.querySelector("#ma-cards");
    toggleBtn = root.querySelector("#ma-toggle");
    statusEl = root.querySelector("#ma-status");

    toggleBtn.addEventListener("click", onToggle);
    root.querySelector("#ma-collapse").addEventListener("click", onCollapse);
    setupDrag(root.querySelector(".ma-drag"));
  }

  function onToggle() {
    if (capturing) {
      chrome.runtime.sendMessage({ type: MSG.STOP_CAPTURE });
    } else {
      chrome.runtime.sendMessage({ type: MSG.START_CAPTURE }, (res) => {
        if (chrome.runtime.lastError || (res && !res.ok)) {
          toast("開始に失敗: " + (res?.error || chrome.runtime.lastError?.message));
        }
      });
    }
  }

  function onCollapse() {
    root.classList.toggle("ma-collapsed");
    updateSettings({ overlayCollapsed: root.classList.contains("ma-collapsed") });
  }

  function setCapturing(on) {
    capturing = on;
    toggleBtn.textContent = on ? "停止" : "開始";
    statusEl.textContent = on ? "● 認識中" : "停止中";
    statusEl.classList.toggle("ma-on", on);
  }

  // ---------- メッセージ受信 ----------
  chrome.runtime.onMessage.addListener((msg) => {
    if (!msg) return;
    switch (msg.type) {
      case MSG.SESSION_STARTED:
        setCapturing(true);
        clearCards();
        break;
      case MSG.SESSION_STOPPED:
        setCapturing(false);
        break;
      case MSG.OVERLAY_TRANSCRIPT:
        renderTranscript(msg);
        break;
      case MSG.SUGGESTION_DELTA:
        renderDelta(msg.partial);
        break;
      case MSG.SUGGESTIONS:
        renderCards(msg.cards || []);
        break;
      case MSG.SUGGESTIONS_NEEDS_KEY:
        renderNeedsKey();
        break;
      case MSG.OFFSCREEN_ERROR:
        toast("エラー: " + msg.message);
        break;
    }
  });

  // ---------- レンダリング ----------
  function renderTranscript(seg) {
    const last = transcriptEl.lastElementChild;
    if (last && last.dataset.final === "false") {
      last.textContent = seg.text;
      last.dataset.final = String(seg.final);
    } else {
      const line = document.createElement("div");
      line.className = "ma-tline";
      line.dataset.final = String(seg.final);
      line.textContent = seg.text;
      transcriptEl.appendChild(line);
    }
    transcriptEl.scrollTop = transcriptEl.scrollHeight;
  }

  function renderDelta(partial) {
    // ストリーミング中は生テキストを薄く表示（JSON 整形前のプレビュー）
    cardsEl.innerHTML = `<div class="ma-streaming">${escapeHtml(
      previewFromJson(partial)
    )}</div>`;
  }

  function renderCards(cards) {
    if (!cards.length) {
      cardsEl.innerHTML = `<div class="ma-empty">候補なし</div>`;
      return;
    }
    cardsEl.innerHTML = "";
    for (const c of cards) {
      const badge = c.type === "rebuttal" ? "切り返し" : "提案";
      const el = document.createElement("div");
      el.className = "ma-card ma-card-" + (c.type || "proposal");
      el.innerHTML = `
        <div class="ma-card-head">
          <span class="ma-badge">${badge}</span>
          <span class="ma-card-title">${escapeHtml(c.title || "")}</span>
          <button class="ma-copy" title="コピー">📋</button>
        </div>
        <div class="ma-card-script">${escapeHtml(c.script || "")}</div>
      `;
      el.querySelector(".ma-copy").addEventListener("click", () => {
        navigator.clipboard.writeText(c.script || "").then(() => toast("コピーしました"));
      });
      cardsEl.appendChild(el);
    }
  }

  function renderNeedsKey() {
    cardsEl.innerHTML = `
      <div class="ma-needskey">
        Claude APIキーが未設定です。<br />
        <a href="#" id="ma-openopts">詳細設定を開く</a>
      </div>`;
    const link = cardsEl.querySelector("#ma-openopts");
    if (link)
      link.addEventListener("click", (e) => {
        e.preventDefault();
        chrome.runtime.sendMessage({ type: "OPEN_OPTIONS" });
      });
  }

  function clearCards() {
    cardsEl.innerHTML = "";
  }

  // JSON が完成する前のストリーミング表示用に script らしき文字列を拾う
  function previewFromJson(s) {
    const m = s.match(/"script"\s*:\s*"([^"]*)/);
    return m ? m[1] : "生成中…";
  }

  // ---------- ドラッグ ----------
  function setupDrag(handle) {
    let sx, sy, ox, oy, dragging = false;
    handle.addEventListener("pointerdown", (e) => {
      dragging = true;
      handle.setPointerCapture(e.pointerId);
      sx = e.clientX;
      sy = e.clientY;
      ox = root.offsetLeft;
      oy = root.offsetTop;
    });
    handle.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      const x = Math.max(0, ox + e.clientX - sx);
      const y = Math.max(0, oy + e.clientY - sy);
      root.style.left = x + "px";
      root.style.top = y + "px";
    });
    handle.addEventListener("pointerup", () => {
      if (!dragging) return;
      dragging = false;
      updateSettings({
        overlayPos: { x: root.offsetLeft, y: root.offsetTop },
      });
    });
  }

  // ---------- ユーティリティ ----------
  function toast(text) {
    const t = document.createElement("div");
    t.className = "ma-toast";
    t.textContent = text;
    root.appendChild(t);
    setTimeout(() => t.remove(), 2500);
  }

  function getSettings() {
    return new Promise((resolve) => {
      chrome.storage.local.get("settings", ({ settings }) =>
        resolve(settings || {})
      );
    });
  }

  function updateSettings(patch) {
    chrome.storage.local.get("settings", ({ settings }) => {
      chrome.storage.local.set({ settings: { ...(settings || {}), ...patch } });
    });
  }

  function escapeHtml(s) {
    return String(s).replace(
      /[&<>"']/g,
      (c) =>
        ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]
    );
  }
})();
