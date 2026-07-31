// Extracts a joinable meeting link + platform from a Google Calendar event.
// Google puts conference info in several places depending on how the event was
// created (native Meet, pasted Zoom link in the body, link in location, etc.),
// so we check them all in priority order.

const MEET_RE = /https?:\/\/meet\.google\.com\/[a-z]{3,}-[a-z]{3,}-[a-z]{3,}/i;
// Zoom join links: https://xxx.zoom.us/j/<id>?pwd=... or /wc/join/<id>
const ZOOM_RE = /https?:\/\/[\w.-]*zoom\.us\/(?:j|wc\/join|w)\/\d{9,}(?:\?[^\s"'<>]*)?/i;

function firstMatch(re, ...texts) {
  for (const t of texts) {
    if (!t) continue;
    const m = String(t).match(re);
    if (m) return m[0];
  }
  return null;
}

/**
 * @param {object} event Google Calendar event resource.
 * @returns {{platform:'meet'|'zoom', url:string} | null}
 */
export function extractMeetingLink(event) {
  if (!event) return null;

  // Native Meet link (most reliable when present).
  if (event.hangoutLink && MEET_RE.test(event.hangoutLink)) {
    return { platform: "meet", url: event.hangoutLink.match(MEET_RE)[0] };
  }

  // conferenceData entry points.
  const entryUris = (event.conferenceData?.entryPoints || [])
    .map((e) => e.uri)
    .filter(Boolean);

  const bodies = [
    ...entryUris,
    event.location,
    event.description,
  ];

  const meet = firstMatch(MEET_RE, ...bodies);
  if (meet) return { platform: "meet", url: meet };

  const zoom = firstMatch(ZOOM_RE, ...bodies);
  if (zoom) return { platform: "zoom", url: normalizeZoom(zoom) };

  return null;
}

// Prefer the browser web-client URL for Zoom so Playwright can attempt to join
// without the desktop app. Turns .../j/<id> into .../wc/join/<id>, preserving pwd.
export function normalizeZoom(url) {
  try {
    const u = new URL(url);
    const m = u.pathname.match(/\/j\/(\d+)/);
    if (m) u.pathname = `/wc/join/${m[1]}`;
    return u.toString();
  } catch {
    return url;
  }
}

export const _internal = { MEET_RE, ZOOM_RE };
