import { test } from "node:test";
import assert from "node:assert/strict";
import { eventToMeeting } from "../src/calendar/poll.mjs";
import { DEFAULTS } from "../src/config.mjs";

const base = JSON.parse(JSON.stringify(DEFAULTS));
base.platforms = { meet: true, zoom: true };

function ev(over = {}) {
  return {
    id: "e1",
    summary: "Marketing Webinar",
    start: { dateTime: "2026-08-01T10:00:00Z" },
    end: { dateTime: "2026-08-01T11:00:00Z" },
    hangoutLink: "https://meet.google.com/abc-defg-hij",
    ...over,
  };
}

test("maps a normal meet event", () => {
  const m = eventToMeeting(ev(), base);
  assert.equal(m.platform, "meet");
  assert.equal(m.title, "Marketing Webinar");
});

test("skips all-day events (date, not dateTime)", () => {
  const m = eventToMeeting(ev({ start: { date: "2026-08-01" } }), base);
  assert.equal(m, null);
});

test("skips cancelled events", () => {
  assert.equal(eventToMeeting(ev({ status: "cancelled" }), base), null);
});

test("respects disabled platform", () => {
  const cfg = { ...base, platforms: { meet: false, zoom: true } };
  assert.equal(eventToMeeting(ev(), cfg), null);
});

test("include keyword filter", () => {
  const cfg = { ...base, calendar: { ...base.calendar, titleIncludeKeywords: ["seminar"] } };
  assert.equal(eventToMeeting(ev({ summary: "Random sync" }), cfg), null);
  assert.ok(eventToMeeting(ev({ summary: "AI Seminar" }), cfg));
});

test("exclude keyword filter", () => {
  const cfg = { ...base, calendar: { ...base.calendar, titleExcludeKeywords: ["1on1"] } };
  assert.equal(eventToMeeting(ev({ summary: "Weekly 1on1" }), cfg), null);
});

test("skips events the user declined", () => {
  const m = eventToMeeting(ev({ attendees: [{ self: true, responseStatus: "declined" }] }), base);
  assert.equal(m, null);
});
