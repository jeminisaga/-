// Launches a headed Chromium (persistent profile) with the recorder extension
// loaded and the capture-automation flags. The persistent profile means you can
// sign the bot's Google account in ONCE (improves Meet reliability a lot) and it
// stays signed in across runs.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { ROOT } from "../config.mjs";

const EXT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "extension");
const PROFILE_DIR = path.join(ROOT, ".chromium-profile");

export async function launchBrowser(tabTitle) {
  return chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false, // extensions + real media capture require headed Chromium
    executablePath: process.env.CHROMIUM_PATH || undefined,
    viewport: null,
    args: [
      `--disable-extensions-except=${EXT_DIR}`,
      `--load-extension=${EXT_DIR}`,
      "--use-fake-ui-for-media-stream", // auto-grant cam/mic/screen prompts
      `--auto-select-tab-capture-source-by-title=${tabTitle}`, // no picker
      "--autoplay-policy=no-user-gesture-required",
      "--no-first-run",
      "--no-default-browser-check",
      "--start-maximized",
    ],
  });
}

export { PROFILE_DIR, EXT_DIR };
