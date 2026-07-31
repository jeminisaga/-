import { test } from "node:test";
import assert from "node:assert/strict";
import { windowFor, isJoinableNow, pickToJoin } from "../src/scheduler/scheduler.mjs";

const cfg = { joinLeadSeconds: 60, graceMinutesAfterEnd: 10, maxMeetingHours: 4 };
const T0 = Date.parse("2026-08-01T10:00:00Z"); // meeting start
const meeting = {
  id: "m1",
  title: "Test",
  start: "2026-08-01T10:00:00Z",
  end: "2026-08-01T11:00:00Z",
};

test("windowFor computes join lead and grace", () => {
  const w = windowFor(meeting, cfg);
  assert.equal(w.joinAt, T0 - 60 * 1000);
  assert.equal(w.hardStop, Date.parse("2026-08-01T11:10:00Z"));
});

test("not joinable before the lead window", () => {
  assert.equal(isJoinableNow(meeting, cfg, T0 - 5 * 60 * 1000), false);
});

test("joinable once inside the lead window", () => {
  assert.equal(isJoinableNow(meeting, cfg, T0 - 30 * 1000), true);
  assert.equal(isJoinableNow(meeting, cfg, T0 + 30 * 60 * 1000), true);
});

test("not joinable after end + grace", () => {
  assert.equal(isJoinableNow(meeting, cfg, Date.parse("2026-08-01T11:11:00Z")), false);
});

test("pickToJoin skips handled ids and out-of-window meetings", () => {
  const later = { id: "m2", start: "2026-08-01T20:00:00Z", end: "2026-08-01T21:00:00Z" };
  const now = T0; // m1 is joinable, m2 is not
  const picked = pickToJoin([meeting, later], new Set(), cfg, now);
  assert.deepEqual(picked.map((m) => m.id), ["m1"]);

  const picked2 = pickToJoin([meeting, later], new Set(["m1"]), cfg, now);
  assert.deepEqual(picked2.map((m) => m.id), []);
});
