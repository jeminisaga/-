// Zoom web-client join — BEST EFFORT ONLY. Zoom hides the browser-join path,
// frequently shows a CAPTCHA on guest join, and its ToS disallows bots. We do
// NOT attempt to solve CAPTCHAs. If we hit a wall we screenshot, throw a
// zoom_blocked error, and the orchestrator moves on / notifies the user.
const NAME_INPUT = '#input-for-name, input[aria-label*="name" i], input[placeholder*="name" i]';
const JOIN_TEXTS = ["Join", "参加", "Agree and Join", "同意して参加"];
const CAPTCHA_HINT = 'iframe[src*="recaptcha"], iframe[title*="captcha" i], [id*="captcha" i]';

const TAB_MARKER = "SEMINAR_REC_TAB";

export async function joinZoom(context, meeting, cfg, log) {
  const page = await context.newPage();
  await page.goto(meeting.url, { waitUntil: "domcontentloaded", timeout: 60000 });

  // Detect a CAPTCHA/anti-bot wall early and bail out gracefully.
  try {
    if (await page.locator(CAPTCHA_HINT).first().isVisible({ timeout: 4000 })) {
      const shot = await page.screenshot().catch(() => null);
      const err = new Error("zoom_blocked: CAPTCHA/anti-bot wall on join");
      err.screenshot = shot;
      throw err;
    }
  } catch (e) {
    if (String(e).includes("zoom_blocked")) throw e;
  }

  try {
    const name = page.locator(NAME_INPUT).first();
    if (await name.isVisible({ timeout: 8000 })) {
      await name.fill(cfg.botDisplayName);
    }
  } catch {}

  let clicked = false;
  for (const t of JOIN_TEXTS) {
    const btn = page.getByRole("button", { name: t, exact: false }).first();
    try {
      if (await btn.isVisible({ timeout: 800 })) {
        await btn.click();
        clicked = true;
        break;
      }
    } catch {}
  }
  if (!clicked) throw new Error("zoom_blocked: could not find a browser join button");

  // Wait for the meeting canvas / footer as a sign we're in.
  try {
    await page
      .locator('#wc-footer, [class*="footer"], video')
      .first()
      .waitFor({ state: "visible", timeout: cfg.admitTimeoutMinutes * 60 * 1000 });
  } catch {
    throw new Error("zoom_blocked: never reached the in-meeting view");
  }

  await page
    .evaluate((marker) => {
      try {
        Object.defineProperty(document, "title", { configurable: true, get: () => marker, set: () => {} });
      } catch {}
    }, TAB_MARKER)
    .catch(() => {});

  log.info("joined Zoom (web client)");
  return { page, tabTitle: TAB_MARKER };
}
