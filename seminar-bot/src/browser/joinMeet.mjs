// Google Meet join flow. Defensive by design: Meet's DOM changes and the labels
// are localized, so we try multiple strategies and fail with a clear reason
// (e.g. never admitted) rather than hanging. Selectors live in selectors.mjs.
import { meet } from "./selectors.mjs";

const TAB_MARKER = "SEMINAR_REC_TAB";

async function clickByText(page, texts, timeout = 4000) {
  for (const t of texts) {
    const btn = page.getByRole("button", { name: t, exact: false }).first();
    try {
      if (await btn.isVisible({ timeout: 400 })) {
        await btn.click({ timeout });
        return true;
      }
    } catch {}
  }
  return false;
}

// Turn OFF camera and mic before joining. Meet's pre-join toggle buttons carry
// a data-is-muted attribute; if it's "false" the device is ON and we click it.
async function muteDevices(page, log) {
  const toggles = page.locator('div[role="button"][data-is-muted], button[data-is-muted]');
  const n = await toggles.count().catch(() => 0);
  for (let i = 0; i < n; i++) {
    const el = toggles.nth(i);
    const muted = await el.getAttribute("data-is-muted").catch(() => null);
    if (muted === "false") {
      await el.click({ timeout: 2000 }).catch(() => {});
      log.info("turned a device off before joining");
    }
  }
}

// Lock the tab title so --auto-select-tab-capture-source-by-title reliably
// matches this tab when getDisplayMedia runs. Meet otherwise rewrites the title.
async function lockTitle(page) {
  await page
    .evaluate((marker) => {
      try {
        Object.defineProperty(document, "title", {
          configurable: true,
          get: () => marker,
          set: () => {},
        });
      } catch {}
      let el = document.querySelector("title");
      if (!el) {
        el = document.createElement("title");
        document.head.appendChild(el);
      }
      el.textContent = marker;
    }, TAB_MARKER)
    .catch(() => {});
}

/**
 * Join a Meet meeting.
 * @returns {Promise<{page:import('playwright').Page, tabTitle:string}>}
 * @throws if not admitted within admitTimeoutMinutes.
 */
export async function joinMeet(context, meeting, cfg, log) {
  const page = await context.newPage();
  await page.goto(meeting.url, { waitUntil: "domcontentloaded", timeout: 60000 });

  // Fill guest name if prompted (only shown when not signed in).
  try {
    const name = page.locator(meet.nameInput).first();
    if (await name.isVisible({ timeout: 5000 })) {
      await name.fill(cfg.botDisplayName);
      log.info("entered guest name");
    }
  } catch {}

  await muteDevices(page, log);

  const joined = await clickByText(page, meet.joinButtonTexts);
  if (!joined) {
    // Sometimes the button needs a moment; retry once after networkidle.
    await page.waitForTimeout(2000);
    if (!(await clickByText(page, meet.joinButtonTexts))) {
      throw new Error("could not find a Meet join button");
    }
  }
  log.info("clicked join; waiting to be admitted...");

  // Wait for the in-call toolbar (leave button) = admitted.
  const admitMs = cfg.admitTimeoutMinutes * 60 * 1000;
  try {
    await page.locator(meet.inCallMarker).first().waitFor({ state: "visible", timeout: admitMs });
  } catch {
    throw new Error(`not admitted within ${cfg.admitTimeoutMinutes} min (still in waiting room?)`);
  }
  log.info("admitted to the meeting");

  await lockTitle(page);
  return { page, tabTitle: TAB_MARKER };
}

export async function leaveMeet(page, log) {
  try {
    await page.locator(meet.leaveButtonSelector).first().click({ timeout: 3000 });
    log.info("left the meeting");
  } catch {
    log.warn("leave button not found; closing page");
  }
}

export { TAB_MARKER };
