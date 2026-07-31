// Polls Google Calendar for upcoming events, extracts joinable meetings, and
// applies the include/exclude filters from config. The mapping step
// (eventToMeeting) is pure and unit-tested; fetchMeetings does the network call.
import { google } from "googleapis";
import { extractMeetingLink } from "./linkParser.mjs";

/**
 * Convert a calendar event into a normalized meeting, or null if it isn't a
 * joinable seminar for this config.
 * @returns {{id,title,start,end,platform,url} | null}
 */
export function eventToMeeting(event, cfg) {
  if (event.status === "cancelled") return null;
  if (!event.start?.dateTime) return null; // skip all-day events

  const link = extractMeetingLink(event);
  if (!link) return null;
  if (!cfg.platforms[link.platform]) return null; // platform disabled

  const title = event.summary || "(no title)";
  const cal = cfg.calendar;

  const inc = cal.titleIncludeKeywords || [];
  if (inc.length && !inc.some((k) => title.toLowerCase().includes(k.toLowerCase()))) return null;
  const exc = cal.titleExcludeKeywords || [];
  if (exc.some((k) => title.toLowerCase().includes(k.toLowerCase()))) return null;

  if (cal.onlyEventsWhereIAmInvited && event.attendees) {
    const me = event.attendees.find((a) => a.self);
    if (me && me.responseStatus === "declined") return null;
  }

  return {
    id: event.id,
    title,
    start: event.start.dateTime,
    end: event.end?.dateTime || event.start.dateTime,
    platform: link.platform,
    url: link.url,
  };
}

/** Fetch upcoming meetings from Google Calendar. */
export async function fetchMeetings(authClient, cfg, log) {
  const calendar = google.calendar({ version: "v3", auth: authClient });
  const now = new Date();
  const timeMax = new Date(now.getTime() + cfg.calendar.lookaheadHours * 3600 * 1000);

  const res = await calendar.events.list({
    calendarId: cfg.calendar.calendarId,
    timeMin: now.toISOString(),
    timeMax: timeMax.toISOString(),
    singleEvents: true,
    orderBy: "startTime",
    maxResults: 50,
  });

  const events = res.data.items || [];
  const meetings = [];
  for (const ev of events) {
    const m = eventToMeeting(ev, cfg);
    if (m) meetings.push(m);
  }
  if (log) log.info(`calendar: ${events.length} events, ${meetings.length} joinable meeting(s)`);
  return meetings;
}
