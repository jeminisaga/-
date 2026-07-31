// Scheduling logic. The pure helpers (windowFor, isJoinableNow, pickToJoin) are
// unit-tested; the Scheduler class wires them to timers + a handler callback.
import { DateTime } from "luxon";

/**
 * Compute the timing window for a meeting.
 * @param {{start:Date|string, end:Date|string}} meeting
 * @param {object} cfg
 */
export function windowFor(meeting, cfg) {
  const start = new Date(meeting.start).getTime();
  const end = new Date(meeting.end).getTime();
  const joinAt = start - cfg.joinLeadSeconds * 1000;
  const hardStop = end + cfg.graceMinutesAfterEnd * 60 * 1000;
  const maxStop = joinAt + cfg.maxMeetingHours * 60 * 60 * 1000;
  return { joinAt, start, end, hardStop, maxStop, leaveBy: Math.min(hardStop, maxStop) };
}

/**
 * Is `now` inside the join window (join lead has passed, meeting not yet over)?
 */
export function isJoinableNow(meeting, cfg, now = Date.now()) {
  const w = windowFor(meeting, cfg);
  return now >= w.joinAt && now < w.hardStop;
}

/**
 * From a list of meetings, pick those that should be joined right now and are
 * not already handled. Pure — returns the subset to act on.
 */
export function pickToJoin(meetings, handledIds, cfg, now = Date.now()) {
  return meetings.filter((m) => !handledIds.has(m.id) && isJoinableNow(m, cfg, now));
}

export class Scheduler {
  /**
   * @param {object} cfg
   * @param {(meeting:object)=>Promise<void>} onJoin called when a meeting should be joined
   * @param {object} log
   */
  constructor(cfg, onJoin, log) {
    this.cfg = cfg;
    this.onJoin = onJoin;
    this.log = log;
    this.handled = new Set(); // meeting ids we've already started/joined
  }

  /**
   * Reconcile the current set of upcoming meetings. Called every poll.
   * Immediately joins anything already inside its window (catch-up after a
   * restart), and schedules a timer for anything upcoming.
   */
  sync(meetings) {
    const now = Date.now();
    for (const m of meetings) {
      if (this.handled.has(m.id)) continue;
      const w = windowFor(m, this.cfg);
      if (now >= w.hardStop) {
        // Already over — mark handled so we never touch it.
        this.handled.add(m.id);
        continue;
      }
      if (now >= w.joinAt) {
        this._join(m, "catch-up");
      } else {
        const delay = w.joinAt - now;
        this.log.info(
          `scheduled "${m.title}" to join in ${Math.round(delay / 1000)}s (${new Date(w.joinAt).toISOString()})`
        );
        setTimeout(() => {
          if (!this.handled.has(m.id)) this._join(m, "scheduled");
        }, delay);
      }
    }
  }

  _join(meeting, why) {
    this.handled.add(meeting.id);
    this.log.info(`joining "${meeting.title}" (${why}) [${meeting.platform}] ${meeting.url}`);
    Promise.resolve(this.onJoin(meeting)).catch((e) =>
      this.log.error(`join failed for "${meeting.title}":`, String(e))
    );
  }
}

// Small helper used by the poller to format times in the configured zone.
export function fmt(dt, zone) {
  return DateTime.fromJSDate(new Date(dt)).setZone(zone).toFormat("yyyy-LL-dd HH:mm");
}
