// Layered meeting-end detection. No single signal is trustworthy, so we race:
//   1. hard stop  = event end + grace (authoritative fallback)
//   2. max cap    = absolute safety duration
//   3. DOM signal = "you've left / meeting ended / removed" text appears
//   4. alone      = only the bot remains for aloneLeaveMinutes
// Resolves with the reason that fired first.
import { meet } from "./selectors.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function domSaysEnded(page) {
  try {
    const body = await page.evaluate(() => document.body?.innerText || "");
    return meet.endTextFragments.some((f) => body.includes(f));
  } catch {
    // page closed/navigated => treat as ended
    return true;
  }
}

async function participantCount(page) {
  try {
    return await page.evaluate(() => {
      // Meet renders a participant count in a few places; try known patterns.
      const nums = [];
      const push = (s) => {
        const m = String(s || "").match(/\b(\d{1,4})\b/);
        if (m) nums.push(Number(m[1]));
      };
      document
        .querySelectorAll('[aria-label*="participant" i],[aria-label*="参加者"],[aria-label*="ユーザー"]')
        .forEach((el) => push(el.getAttribute("aria-label")));
      return nums.length ? Math.max(...nums) : null;
    });
  } catch {
    return null;
  }
}

/**
 * @param {import('playwright').Page} page
 * @param {object} window from scheduler.windowFor(meeting)
 * @param {object} cfg
 * @param {object} log
 * @param {()=>boolean} [aborted] optional external stop
 * @returns {Promise<string>} reason
 */
export async function waitForEnd(page, window, cfg, log, aborted = () => false) {
  const aloneNeeded = cfg.aloneLeaveMinutes * 60 * 1000;
  let aloneSince = null;

  for (;;) {
    if (aborted()) return "aborted";
    const now = Date.now();

    if (now >= window.hardStop) return "hard-stop (event end + grace)";
    if (now >= window.maxStop) return "max-duration cap";

    if (await domSaysEnded(page)) return "dom end signal";

    const count = await participantCount(page);
    if (count === 1) {
      if (aloneSince == null) aloneSince = now;
      else if (now - aloneSince >= aloneNeeded) return "alone (everyone left)";
    } else if (count != null && count > 1) {
      aloneSince = null;
    }

    await sleep(5000);
  }
}
