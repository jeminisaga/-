// Loads config/config.json, applies defaults, and resolves relative paths
// against the project root. Kept dependency-free (no zod) so it runs with a
// bare `node` install; validation is explicit and forgiving with clear errors.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const DEFAULTS = {
  timezone: "Asia/Tokyo",
  botDisplayName: "録画ボット",
  pollIntervalMinutes: 10,
  joinLeadSeconds: 60,
  graceMinutesAfterEnd: 10,
  maxMeetingHours: 4,
  aloneLeaveMinutes: 3,
  admitTimeoutMinutes: 5,
  orchestratorPort: 8787,
  platforms: { meet: true, zoom: false },
  calendar: {
    calendarId: "primary",
    onlyEventsWhereIAmInvited: true,
    lookaheadHours: 48,
    titleIncludeKeywords: [],
    titleExcludeKeywords: [],
  },
  recording: { outputDir: "./output/recordings", captureAudio: true },
  transcription: {
    engine: "local",
    language: "ja",
    ffmpegBin: "ffmpeg",
    whisperBin: "./bin/whisper.cpp/main",
    whisperModel: "./bin/whisper.cpp/models/ggml-large-v3.bin",
    outputDir: "./output/transcripts",
  },
  outputDir: "./output",
};

function deepMerge(base, over) {
  if (Array.isArray(over) || over === null || typeof over !== "object") return over;
  const out = { ...base };
  for (const k of Object.keys(over)) {
    out[k] = k in base && typeof base[k] === "object" && !Array.isArray(base[k])
      ? deepMerge(base[k], over[k])
      : over[k];
  }
  return out;
}

function resolvePath(p) {
  if (!p) return p;
  return path.isAbsolute(p) ? p : path.resolve(ROOT, p);
}

export function loadConfig(configPath) {
  const file = configPath || path.join(ROOT, "config", "config.json");
  let user = {};
  if (fs.existsSync(file)) {
    try {
      user = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch (e) {
      throw new Error(`config file ${file} is not valid JSON: ${e.message}`);
    }
  }
  const cfg = deepMerge(DEFAULTS, user);

  // Basic sanity checks with actionable messages.
  if (cfg.pollIntervalMinutes < 1) throw new Error("pollIntervalMinutes must be >= 1");
  if (cfg.orchestratorPort < 1 || cfg.orchestratorPort > 65535) throw new Error("orchestratorPort out of range");
  if (!["local", "openai", "groq", "off"].includes(cfg.transcription.engine))
    throw new Error(`transcription.engine must be one of local|openai|groq|off`);

  // Resolve output paths to absolutes so the rest of the app doesn't care about cwd.
  cfg.outputDir = resolvePath(cfg.outputDir);
  cfg.recording.outputDir = resolvePath(cfg.recording.outputDir);
  cfg.transcription.outputDir = resolvePath(cfg.transcription.outputDir);
  cfg.transcription.whisperBin = resolvePath(cfg.transcription.whisperBin);
  cfg.transcription.whisperModel = resolvePath(cfg.transcription.whisperModel);

  return cfg;
}

export { DEFAULTS };
