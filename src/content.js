(() => {
  if (window.__mpgInjected) return;
  window.__mpgInjected = true;

  let overlayEl = null;
  let countdownInterval = null;

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg?.type === "INTRUDE") {
      showOverlay(msg);
      sendResponse({ ok: true });
    }
  });

  const PET_LINES = [
    "ねぇ、{site}より私のほうが可愛くないですか？",
    "{site}スクロール{minutes}分。そろそろ目を休ませて 🐾",
    "今日{count}回目の乱入、ごめんね。",
    "ちょっとだけでいい、こっち見て？",
    "{site}閉じて、おやつの話しよ。",
    "そのタイムライン、どうせ明日も伸びてるよ。",
  ];

  const SPECIES_EMOJI = {
    cat: "🐈",
    dog: "🐕",
    rabbit: "🐇",
    hamster: "🐹",
    bird: "🐦",
    other: "🐾",
  };

  function showOverlay({
    pet,
    breakMinutes,
    siteLabel = "SNS",
    usageMinutes = 0,
    breakCount = 1,
  }) {
    if (overlayEl) return; // already showing

    const line = pick(PET_LINES)
      .replaceAll("{site}", siteLabel)
      .replaceAll("{minutes}", String(usageMinutes))
      .replaceAll("{count}", String(breakCount));

    const handle = handleFromName(pet.name);
    const species = SPECIES_EMOJI[pet.species] || SPECIES_EMOJI.other;

    // Stable-feeling fake engagement so it looks like a "伸びてる投稿"
    const seed = (pet.name.length + breakCount) * 37;
    const replies = 120 + (seed * 7) % 880;
    const reposts = 240 + (seed * 11) % 1760;
    const likes = 2400 + (seed * 13) % 12600;

    const root = document.createElement("div");
    root.id = "mpg-overlay";
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-modal", "true");
    root.innerHTML = `
      <article class="mpg-card">
        <header class="mpg-row">
          <div class="mpg-avatar"><img alt=""></div>
          <div class="mpg-id">
            <div class="mpg-id-line">
              <span class="mpg-name">${escapeHtml(pet.name)}</span>
              <span class="mpg-verify" aria-label="うちの子認証">✓</span>
              <span class="mpg-dot">·</span>
              <span class="mpg-time">いま</span>
            </div>
            <div class="mpg-handle">@${escapeHtml(handle)} <span class="mpg-species">${species}</span></div>
          </div>
        </header>
        <p class="mpg-body">${escapeHtml(line)}</p>
        <section class="mpg-quote" aria-label="引用された投稿">
          <div class="mpg-q-head">
            <span class="mpg-q-avatar" aria-hidden="true"></span>
            <span class="mpg-q-name">あなた</span>
            <span class="mpg-q-handle">@you</span>
            <span class="mpg-dot">·</span>
            <span class="mpg-q-time">${escapeHtml(String(usageMinutes))}分</span>
          </div>
          <div class="mpg-q-body">${escapeHtml(siteLabel)}を${escapeHtml(String(usageMinutes))}分スクロールしました。</div>
        </section>
        <footer class="mpg-actions" aria-hidden="true">
          <span class="mpg-act">${ICON_REPLY}<span>${fmtCount(replies)}</span></span>
          <span class="mpg-act">${ICON_REPOST}<span>${fmtCount(reposts)}</span></span>
          <span class="mpg-act mpg-act-like">${ICON_HEART}<span>${fmtCount(likes)}</span></span>
          <span class="mpg-act">${ICON_SHARE}</span>
        </footer>
      </article>
      <div class="mpg-timer-chip" role="status" aria-live="polite">
        <span class="mpg-timer-num"></span>
        <span class="mpg-timer-label">休憩中 🐾</span>
      </div>
    `;
    root.querySelector(".mpg-avatar img").src = pet.imageBase64;
    document.documentElement.appendChild(root);
    document.documentElement.classList.add("mpg-locked");
    overlayEl = root;

    let remaining = Math.max(1, breakMinutes) * 60;
    const timerNum = root.querySelector(".mpg-timer-num");
    const updateTimer = () => {
      const m = Math.floor(remaining / 60);
      const s = remaining % 60;
      timerNum.textContent = `${m}:${String(s).padStart(2, "0")}`;
    };
    updateTimer();
    countdownInterval = setInterval(() => {
      remaining -= 1;
      if (remaining <= 0) {
        clearInterval(countdownInterval);
        countdownInterval = null;
        finish();
      } else {
        updateTimer();
      }
    }, 1000);

    document.addEventListener("keydown", blockKey, true);
    document.addEventListener("wheel", blockWheel, { capture: true, passive: false });
    document.addEventListener("touchmove", blockWheel, { capture: true, passive: false });
  }

  function finish() {
    if (!overlayEl) return;
    overlayEl.classList.add("mpg-fadeout");
    setTimeout(() => {
      overlayEl?.remove();
      overlayEl = null;
      document.documentElement.classList.remove("mpg-locked");
      document.removeEventListener("keydown", blockKey, true);
      document.removeEventListener("wheel", blockWheel, { capture: true });
      document.removeEventListener("touchmove", blockWheel, { capture: true });
      try {
        chrome.runtime.sendMessage({ type: "BREAK_FINISHED" });
      } catch {
        /* noop */
      }
    }, 500);
  }

  function blockKey(e) {
    e.stopPropagation();
    e.preventDefault();
  }

  function blockWheel(e) {
    if (overlayEl && !overlayEl.contains(e.target)) {
      e.preventDefault();
      e.stopPropagation();
    }
  }

  function pick(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  function fmtCount(n) {
    if (n >= 10000) return (n / 10000).toFixed(1).replace(/\.0$/, "") + "万";
    if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, "") + "K";
    return String(n);
  }

  function handleFromName(name) {
    const trimmed = String(name).trim();
    if (/^[\x00-\x7f]+$/.test(trimmed)) {
      return trimmed.toLowerCase().replace(/\s+/g, "_") || "uchinoko";
    }
    return trimmed.replace(/\s+/g, "") || "うちのこ";
  }

  function escapeHtml(s) {
    return String(s).replace(
      /[&<>"']/g,
      (c) =>
        ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]
    );
  }

  // Threads風アクションアイコン（outline）
  const ICON_REPLY =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 11.5a8.4 8.4 0 0 1-12.4 7.4L3 21l2.1-5.6A8.4 8.4 0 1 1 21 11.5z"/></svg>';
  const ICON_REPOST =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17 2l4 4-4 4M3 11V9a4 4 0 0 1 4-4h14M7 22l-4-4 4-4M21 13v2a4 4 0 0 1-4 4H3"/></svg>';
  const ICON_HEART =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78L12 21.23l8.84-8.84a5.5 5.5 0 0 0 0-7.78z"/></svg>';
  const ICON_SHARE =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7M16 6l-4-4-4 4M12 2v13"/></svg>';
})();
