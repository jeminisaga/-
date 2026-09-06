/*
 * 空き日程を出す道具 ― 計算部分
 * 画面（app.js）からも Node のテストからも同じものを使う。
 * ここには「予定」→「空き」→「文面」の変換しか書かない。画面のことは書かない。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AkiSlots = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

  var DEFAULT_SETTINGS = {
    startTime: '10:00',      // 候補にする時間帯（開始）
    endTime: '18:00',        // 候補にする時間帯（終了）
    slotMinutes: 60,         // 1件あたりの長さ
    bufferMinutes: 30,       // 予定の前後にあける余白
    includeWeekends: false,  // 土日を候補に入れるか
    skipDays: 1,             // 直近を何日除くか（1 = 明日から）
    perDayMax: 2,            // 1日に出す候補の数（0 = 全部）
    mode: 'slot',            // 'slot' = 枠に分ける / 'range' = 空いている時間帯をまとめて
    alignMinutes: 30,        // 枠の開始をこの分単位に揃える
    header: '下記の日程でしたら空いております。',
    footer: 'ご都合いかがでしょうか。',
    bullet: '・',
    emptyText: 'この期間は空きがありません。'
  };

  // ---------- 日付・時刻のちいさな道具 ----------

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  function parseHM(s) {
    var m = /^(\d{1,2}):(\d{2})$/.exec(String(s || '').trim());
    if (!m) return null;
    return Number(m[1]) * 60 + Number(m[2]);
  }

  function fmtHM(min) {
    return Math.floor(min / 60) + ':' + pad2(min % 60);
  }

  function startOfDay(d) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }

  function addDays(d, n) {
    var r = startOfDay(d);
    r.setDate(r.getDate() + n);
    return r;
  }

  function dateKey(d) {
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  function fromKey(key) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key || ''));
    if (!m) return null;
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  }

  function isWeekend(d) {
    var w = d.getDay();
    return w === 0 || w === 6;
  }

  function fmtDate(d) {
    return (d.getMonth() + 1) + '/' + d.getDate() + '（' + WEEKDAYS[d.getDay()] + '）';
  }

  // ---------- 期間 ----------

  // period: 'thisWeek' | 'nextWeek' | 'twoWeeks'
  // 週は月曜はじまり。今週 = 今日〜次の日曜。来週 = 次の月曜〜日曜。2週間 = 今日から14日。
  function periodRange(period, today) {
    var t = startOfDay(today);
    var daysToSunday = (7 - t.getDay()) % 7;
    if (period === 'thisWeek') return { start: t, end: addDays(t, daysToSunday) };
    if (period === 'nextWeek') {
      var mon = addDays(t, daysToSunday + 1);
      return { start: mon, end: addDays(mon, 6) };
    }
    return { start: t, end: addDays(t, 13) };
  }

  // ---------- 区間の計算 ----------

  function mergeIntervals(list) {
    var sorted = list.slice().sort(function (a, b) { return a.start - b.start; });
    var out = [];
    for (var i = 0; i < sorted.length; i++) {
      var cur = sorted[i];
      var last = out[out.length - 1];
      if (last && cur.start <= last.end) {
        if (cur.end > last.end) last.end = cur.end;
      } else {
        out.push({ start: cur.start, end: cur.end });
      }
    }
    return out;
  }

  // window から busy（merge 済み）を引いた残り
  function subtract(win, busy) {
    var free = [];
    var cursor = win.start;
    for (var i = 0; i < busy.length; i++) {
      var b = busy[i];
      if (b.end <= cursor) continue;
      if (b.start >= win.end) break;
      if (b.start > cursor) free.push({ start: cursor, end: Math.min(b.start, win.end) });
      cursor = Math.max(cursor, b.end);
      if (cursor >= win.end) break;
    }
    if (cursor < win.end) free.push({ start: cursor, end: win.end });
    return free;
  }

  // その日の busy 区間（分）。余白つき。終日は日全体。
  function busyForDay(events, day, settings) {
    var key = dateKey(day);
    var buffer = Number(settings.bufferMinutes) || 0;
    var out = [];
    for (var i = 0; i < events.length; i++) {
      var ev = events[i];
      if (ev.date !== key) continue;
      if (ev.allDay) { out.push({ start: -Infinity, end: Infinity }); continue; }
      var s = parseHM(ev.start), e = parseHM(ev.end);
      if (s === null || e === null || e <= s) continue;
      out.push({ start: s - buffer, end: e + buffer });
    }
    return mergeIntervals(out);
  }

  function ceilTo(value, unit) {
    if (!unit || unit <= 0) return value;
    return Math.ceil(value / unit) * unit;
  }

  // ---------- 空きを探す ----------

  // 戻り値: [{ date: Date, start: 分, end: 分 }, ...]
  function findSlots(events, range, settings, now) {
    var s = Object.assign({}, DEFAULT_SETTINGS, settings || {});
    var winStart = parseHM(s.startTime);
    var winEnd = parseHM(s.endTime);
    var slotLen = Number(s.slotMinutes) || 60;
    var perDayMax = Number(s.perDayMax) || 0;
    var align = Number(s.alignMinutes) || 0;
    if (winStart === null || winEnd === null || winEnd <= winStart) return [];

    var nowDate = now ? new Date(now) : new Date();
    var firstDay = addDays(nowDate, Number(s.skipDays) || 0);
    var nowMinutes = nowDate.getHours() * 60 + nowDate.getMinutes();

    var result = [];
    for (var day = startOfDay(range.start); day <= range.end; day = addDays(day, 1)) {
      if (day < firstDay) continue;
      if (!s.includeWeekends && isWeekend(day)) continue;

      var win = { start: winStart, end: winEnd };
      // 今日を含める設定のときは、もう過ぎた時刻を除く
      if (dateKey(day) === dateKey(nowDate)) win.start = Math.max(win.start, ceilTo(nowMinutes, align || 1));
      if (win.end - win.start < slotLen) continue;

      var free = subtract(win, busyForDay(events, day, s));
      var picked = [];
      if (s.mode === 'range') {
        for (var i = 0; i < free.length; i++) {
          var rs = ceilTo(free[i].start, align);
          if (free[i].end - rs >= slotLen) picked.push({ date: day, start: rs, end: free[i].end });
        }
      } else {
        // 空き区間ごとに枠を並べ、区間をまたいで交互に取る。
        // 同じ日に「10:00〜11:00」「11:00〜12:00」と続けて出すより、午前と午後に散らしたほうが相手が選びやすい。
        var perInterval = free.map(function (f) {
          var list = [];
          for (var st = ceilTo(f.start, align); st + slotLen <= f.end; st += slotLen) list.push({ date: day, start: st, end: st + slotLen });
          return list;
        });
        for (var k = 0; perInterval.some(function (l) { return l.length > k; }); k++) {
          for (var j = 0; j < perInterval.length; j++) if (perInterval[j][k]) picked.push(perInterval[j][k]);
        }
      }
      if (perDayMax && picked.length > perDayMax) picked = picked.slice(0, perDayMax);
      picked.sort(function (a, b) { return a.start - b.start; });
      for (var q = 0; q < picked.length; q++) result.push(picked[q]);
    }
    return result;
  }

  // ---------- 文面にする ----------

  function formatSlot(slot) {
    return fmtDate(slot.date) + fmtHM(slot.start) + '〜' + fmtHM(slot.end);
  }

  function buildText(slots, settings) {
    var s = Object.assign({}, DEFAULT_SETTINGS, settings || {});
    if (!slots.length) return s.emptyText;
    var lines = [];
    if (s.header) lines.push(s.header, '');
    for (var i = 0; i < slots.length; i++) lines.push((s.bullet || '') + formatSlot(slots[i]));
    if (s.footer) lines.push('', s.footer);
    return lines.join('\n');
  }

  function generate(events, period, settings, now) {
    var nowDate = now ? new Date(now) : new Date();
    var range = periodRange(period, nowDate);
    var slots = findSlots(events, range, settings, nowDate);
    return { range: range, slots: slots, text: buildText(slots, settings) };
  }

  // ---------- お試しの予定（段階1用） ----------

  // 今日を起点に、それらしい予定を並べる。乱数は使わない（いつ開いても同じ形になるように）。
  function sampleEvents(today) {
    var t = startOfDay(today || new Date());
    var out = [];
    var id = 1;
    function push(offset, start, end, title, allDay) {
      out.push({ id: 'sample-' + (id++), date: dateKey(addDays(t, offset)), start: start, end: end, title: title, allDay: !!allDay });
    }
    for (var off = 0; off <= 20; off++) {
      var d = addDays(t, off);
      var w = d.getDay();
      if (w === 0) continue;                          // 日曜は空ける
      if (w === 6) { if (off % 2 === 0) push(off, '', '', '研修', true); continue; }
      switch (off % 5) {
        case 0: push(off, '10:00', '12:00', '訪問（田中さん）'); push(off, '15:00', '16:00', '打ち合わせ'); break;
        case 1: push(off, '13:00', '14:30', '訪問（佐藤さん）'); break;
        case 2: push(off, '', '', '研修', true); break;
        case 3: push(off, '10:30', '11:30', '面談'); push(off, '16:00', '17:30', '訪問（鈴木さん）'); break;
        case 4: push(off, '14:00', '15:00', '打ち合わせ'); break;
      }
    }
    return out;
  }

  return {
    WEEKDAYS: WEEKDAYS,
    DEFAULT_SETTINGS: DEFAULT_SETTINGS,
    parseHM: parseHM,
    fmtHM: fmtHM,
    fmtDate: fmtDate,
    dateKey: dateKey,
    fromKey: fromKey,
    addDays: addDays,
    startOfDay: startOfDay,
    periodRange: periodRange,
    mergeIntervals: mergeIntervals,
    subtract: subtract,
    findSlots: findSlots,
    formatSlot: formatSlot,
    buildText: buildText,
    generate: generate,
    sampleEvents: sampleEvents
  };
});
