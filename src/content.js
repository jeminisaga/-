(() => {
  if (window.__mpgInjected) return;
  window.__mpgInjected = true;

  let overlayEl = null;
  let countdownInterval = null;

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg?.type === "INTRUDE") {
      showOverlay(msg.pet, msg.breakMinutes);
      sendResponse({ ok: true });
    }
  });

  function showOverlay(pet, breakMinutes) {
    if (overlayEl) return; // already showing
    const root = document.createElement("div");
    root.id = "mpg-overlay";
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-modal", "true");
    root.innerHTML = `
      <div class="mpg-stage">
        <div class="mpg-pet-wrap">
          <img class="mpg-pet-img" alt="${escapeHtml(pet.name)}" />
          <div class="mpg-pet-tail"></div>
        </div>
        <div class="mpg-msg">
          <div class="mpg-msg-line1">${escapeHtml(pet.name)}が来ちゃった…</div>
          <div class="mpg-msg-line2">休憩しよ 🐾</div>
        </div>
        <div class="mpg-timer">
          <span class="mpg-timer-num"></span>
          <span class="mpg-timer-label">残り</span>
        </div>
      </div>
    `;
    root.querySelector(".mpg-pet-img").src = pet.imageBase64;
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

    // Block page scroll/key/wheel that target underlying content
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
    }, 600);
  }

  function blockKey(e) {
    // Allow nothing through. Esc explicitly blocked too — break is mandatory.
    e.stopPropagation();
    e.preventDefault();
  }

  function blockWheel(e) {
    if (overlayEl && !overlayEl.contains(e.target)) {
      e.preventDefault();
      e.stopPropagation();
    }
  }

  function escapeHtml(s) {
    return String(s).replace(
      /[&<>"']/g,
      (c) =>
        ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]
    );
  }
})();
