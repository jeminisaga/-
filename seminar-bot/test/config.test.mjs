import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadConfig, DEFAULTS } from "../src/config.mjs";

function writeTmp(obj) {
  const p = path.join(os.tmpdir(), `cfg-${process.pid}-${Math.round(performance.now())}.json`);
  fs.writeFileSync(p, JSON.stringify(obj));
  return p;
}

test("missing file yields defaults with absolute paths", () => {
  const cfg = loadConfig(path.join(os.tmpdir(), "does-not-exist-xyz.json"));
  assert.equal(cfg.timezone, DEFAULTS.timezone);
  assert.ok(path.isAbsolute(cfg.outputDir));
  assert.ok(path.isAbsolute(cfg.recording.outputDir));
});

test("user values deep-merge over defaults", () => {
  const p = writeTmp({ joinLeadSeconds: 30, platforms: { zoom: true } });
  const cfg = loadConfig(p);
  assert.equal(cfg.joinLeadSeconds, 30);
  assert.equal(cfg.platforms.zoom, true);
  assert.equal(cfg.platforms.meet, true); // default preserved
  fs.unlinkSync(p);
});

test("invalid transcription engine throws", () => {
  const p = writeTmp({ transcription: { engine: "nope" } });
  assert.throws(() => loadConfig(p), /transcription.engine/);
  fs.unlinkSync(p);
});

test("out-of-range port throws", () => {
  const p = writeTmp({ orchestratorPort: 99999 });
  assert.throws(() => loadConfig(p), /orchestratorPort/);
  fs.unlinkSync(p);
});
