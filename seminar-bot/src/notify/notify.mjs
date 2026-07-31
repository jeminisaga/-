// Lightweight notifications. Keeps a dependency-free default (logs a prominent
// line + appends to output/notifications.log). A desktop-toast integration can
// be dropped in here later without changing callers.
import fs from "node:fs";
import path from "node:path";

export function makeNotifier(cfg, log) {
  const file = path.join(cfg.outputDir, "notifications.log");
  fs.mkdirSync(cfg.outputDir, { recursive: true });
  return {
    notify(title, detail) {
      const line = `${new Date().toISOString()}  ${title}${detail ? " — " + detail : ""}`;
      log.warn(`🔔 ${title}${detail ? " — " + detail : ""}`);
      try {
        fs.appendFileSync(file, line + "\n");
      } catch {}
    },
  };
}
