import { test } from "node:test";
import assert from "node:assert/strict";
import { extractMeetingLink, normalizeZoom } from "../src/calendar/linkParser.mjs";

test("native hangoutLink -> meet", () => {
  const r = extractMeetingLink({ hangoutLink: "https://meet.google.com/abc-defg-hij" });
  assert.deepEqual(r, { platform: "meet", url: "https://meet.google.com/abc-defg-hij" });
});

test("conferenceData entryPoint meet", () => {
  const r = extractMeetingLink({
    conferenceData: { entryPoints: [{ uri: "https://meet.google.com/xyz-abcd-efg" }] },
  });
  assert.equal(r.platform, "meet");
});

test("zoom link in description -> normalized to wc/join", () => {
  const r = extractMeetingLink({
    description: "Join here: https://us02web.zoom.us/j/81234567890?pwd=SECRET end",
  });
  assert.equal(r.platform, "zoom");
  assert.ok(r.url.includes("/wc/join/81234567890"));
  assert.ok(r.url.includes("pwd=SECRET"));
});

test("zoom link in location", () => {
  const r = extractMeetingLink({ location: "https://zoom.us/j/999888777" });
  assert.equal(r.platform, "zoom");
});

test("meet preferred over zoom when both present", () => {
  const r = extractMeetingLink({
    hangoutLink: "https://meet.google.com/aaa-bbbb-ccc",
    description: "backup https://zoom.us/j/111222333",
  });
  assert.equal(r.platform, "meet");
});

test("no link -> null", () => {
  assert.equal(extractMeetingLink({ description: "no meeting here" }), null);
  assert.equal(extractMeetingLink(null), null);
});

test("normalizeZoom keeps pwd, rewrites /j/ to /wc/join/", () => {
  assert.equal(
    normalizeZoom("https://x.zoom.us/j/123456789?pwd=ab"),
    "https://x.zoom.us/wc/join/123456789?pwd=ab"
  );
});
