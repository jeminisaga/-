// Post-meeting transcription. Extracts audio with ffmpeg, then runs whisper.cpp
// locally (engine:"local"). The engine is pluggable so an API path can be added
// later without touching callers. Returns the transcript file path(s).
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";

function run(bin, args, log) {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        err.stderr = stderr;
        return reject(err);
      }
      resolve({ stdout, stderr });
    });
  });
}

/** ffmpeg webm -> 16kHz mono wav (what whisper.cpp expects). */
export async function extractAudio(webmPath, cfg, log) {
  const wavPath = webmPath.replace(/\.webm$/i, ".wav");
  await run(cfg.transcription.ffmpegBin, ["-y", "-i", webmPath, "-ar", "16000", "-ac", "1", wavPath], log);
  return wavPath;
}

/** Transcribe a recording. Returns { txt, srt } paths (whichever were produced). */
export async function transcribe(webmPath, cfg, log) {
  if (cfg.transcription.engine === "off") {
    log.info("transcription disabled (engine: off)");
    return null;
  }
  fs.mkdirSync(cfg.transcription.outputDir, { recursive: true });
  const base = path.basename(webmPath).replace(/\.webm$/i, "");
  const outBase = path.join(cfg.transcription.outputDir, base);

  const wav = await extractAudio(webmPath, cfg, log);
  log.info(`extracted audio: ${wav}`);

  if (cfg.transcription.engine === "local") {
    // whisper.cpp: -otxt/-osrt write <outBase>.txt / .srt
    await run(
      cfg.transcription.whisperBin,
      [
        "-m", cfg.transcription.whisperModel,
        "-l", cfg.transcription.language,
        "-f", wav,
        "-otxt", "-osrt",
        "-of", outBase,
      ],
      log
    );
    log.info(`transcript written: ${outBase}.txt`);
    return { txt: `${outBase}.txt`, srt: `${outBase}.srt` };
  }

  // openai/groq API paths are intentionally left as a future extension.
  log.warn(`transcription engine "${cfg.transcription.engine}" not implemented yet; kept the wav at ${wav}`);
  return null;
}
