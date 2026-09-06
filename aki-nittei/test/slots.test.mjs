import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const S = require('../slots.js');

// 2026-09-06 は日曜。テストは基準日を固定する。
const SUN = new Date(2026, 8, 6, 9, 0);   // 9/6（日）9:00
const MON = new Date(2026, 8, 7, 9, 0);   // 9/7（月）9:00

test('periodRange: 今週は今日〜日曜、来週は月〜日、2週間は14日', () => {
  const r1 = S.periodRange('thisWeek', MON);
  assert.equal(S.dateKey(r1.start), '2026-09-07');
  assert.equal(S.dateKey(r1.end), '2026-09-13');
  const r2 = S.periodRange('nextWeek', MON);
  assert.equal(S.dateKey(r2.start), '2026-09-14');
  assert.equal(S.dateKey(r2.end), '2026-09-20');
  const r3 = S.periodRange('twoWeeks', MON);
  assert.equal(S.dateKey(r3.start), '2026-09-07');
  assert.equal(S.dateKey(r3.end), '2026-09-20');
  // 日曜に開いたら「今週」は今日だけ
  const r4 = S.periodRange('thisWeek', SUN);
  assert.equal(S.dateKey(r4.start), '2026-09-06');
  assert.equal(S.dateKey(r4.end), '2026-09-06');
});

test('subtract: 予定を引いた残りが正しい', () => {
  const free = S.subtract({ start: 600, end: 1080 }, S.mergeIntervals([
    { start: 660, end: 720 }, { start: 700, end: 780 }, { start: 1050, end: 1200 }
  ]));
  assert.deepEqual(free, [{ start: 600, end: 660 }, { start: 780, end: 1050 }]);
});

test('findSlots: 予定なしなら時間帯を枠で埋め、1日の上限で止まる', () => {
  const range = { start: new Date(2026, 8, 8), end: new Date(2026, 8, 8) };
  const slots = S.findSlots([], range, { perDayMax: 0 }, MON);
  assert.deepEqual(slots.map(S.formatSlot), [
    '9/8（火）10:00〜11:00', '9/8（火）11:00〜12:00', '9/8（火）12:00〜13:00', '9/8（火）13:00〜14:00',
    '9/8（火）14:00〜15:00', '9/8（火）15:00〜16:00', '9/8（火）16:00〜17:00', '9/8（火）17:00〜18:00'
  ]);
  const capped = S.findSlots([], range, { perDayMax: 2 }, MON);
  assert.equal(capped.length, 2);
});

test('findSlots: 予定の前後に余白を取り、開始は30分単位に揃う', () => {
  const range = { start: new Date(2026, 8, 8), end: new Date(2026, 8, 8) };
  const events = [{ date: '2026-09-08', start: '11:00', end: '12:20', title: 'x' }];
  const slots = S.findSlots(events, range, { perDayMax: 0, bufferMinutes: 30 }, MON);
  // 予定は 10:30〜12:50 を塞ぐ。次の枠は 13:00 から。
  assert.deepEqual(slots.map(S.formatSlot), [
    '9/8（火）13:00〜14:00', '9/8（火）14:00〜15:00', '9/8（火）15:00〜16:00', '9/8（火）16:00〜17:00', '9/8（火）17:00〜18:00'
  ]);
});

test('findSlots: 終日予定の日は出ない。土日は設定で切り替わる', () => {
  const range = { start: new Date(2026, 8, 8), end: new Date(2026, 8, 13) };
  const events = [{ date: '2026-09-09', allDay: true, title: '研修' }];
  const a = S.findSlots(events, range, { perDayMax: 1 }, MON);
  assert.deepEqual(a.map(s => S.dateKey(s.date)), ['2026-09-08', '2026-09-10', '2026-09-11']);
  const b = S.findSlots(events, range, { perDayMax: 1, includeWeekends: true }, MON);
  assert.deepEqual(b.map(s => S.dateKey(s.date)), ['2026-09-08', '2026-09-10', '2026-09-11', '2026-09-12', '2026-09-13']);
});

test('findSlots: 直近を除く日数。今日を含めるときは過ぎた時刻を出さない', () => {
  const range = { start: new Date(2026, 8, 7), end: new Date(2026, 8, 8) };
  const now = new Date(2026, 8, 7, 14, 10);
  const skip1 = S.findSlots([], range, { perDayMax: 1, skipDays: 1 }, now);
  assert.deepEqual(skip1.map(S.formatSlot), ['9/8（火）10:00〜11:00']);
  const skip0 = S.findSlots([], range, { perDayMax: 1, skipDays: 0 }, now);
  assert.deepEqual(skip0.map(S.formatSlot), ['9/7（月）14:30〜15:30', '9/8（火）10:00〜11:00']);
});

test('findSlots: まとめて出す形', () => {
  const range = { start: new Date(2026, 8, 8), end: new Date(2026, 8, 8) };
  const events = [{ date: '2026-09-08', start: '13:00', end: '14:00', title: 'x' }];
  const slots = S.findSlots(events, range, { mode: 'range', perDayMax: 0, bufferMinutes: 0 }, MON);
  assert.deepEqual(slots.map(S.formatSlot), ['9/8（火）10:00〜13:00', '9/8（火）14:00〜18:00']);
  // 枠の長さに満たない残りは出さない
  const short = S.findSlots(events, range, { mode: 'range', perDayMax: 0, bufferMinutes: 0, slotMinutes: 240 }, MON);
  assert.deepEqual(short.map(S.formatSlot), ['9/8（火）14:00〜18:00']);
});

test('buildText: 要件定義の出力イメージどおりの形になる', () => {
  const slots = [
    { date: new Date(2026, 8, 8), start: 840, end: 900 },
    { date: new Date(2026, 8, 9), start: 600, end: 660 },
    { date: new Date(2026, 8, 10), start: 780, end: 840 }
  ];
  assert.equal(S.buildText(slots, {}),
    '下記の日程でしたら空いております。\n\n・9/8（火）14:00〜15:00\n・9/9（水）10:00〜11:00\n・9/10（木）13:00〜14:00\n\nご都合いかがでしょうか。');
  assert.equal(S.buildText([], {}), 'この期間は空きがありません。');
  assert.equal(S.buildText(slots.slice(0, 1), { header: '', footer: '', bullet: '' }), '9/8（火）14:00〜15:00');
});

test('generate + sampleEvents: お試しの予定で来週の候補が出る', () => {
  const events = S.sampleEvents(MON);
  assert.ok(events.length > 5);
  const out = S.generate(events, 'nextWeek', {}, MON);
  assert.ok(out.slots.length >= 4, 'slots: ' + out.slots.length);
  assert.match(out.text, /^下記の日程でしたら空いております。\n\n・9\/1[4-9]（/);
  // 終日予定の日は候補に出ない
  const allDayKeys = new Set(events.filter(e => e.allDay).map(e => e.date));
  for (const s of out.slots) assert.ok(!allDayKeys.has(S.dateKey(s.date)));
});

test('findSlots: 同じ日の候補は空き区間をまたいで散らす', () => {
  const range = { start: new Date(2026, 8, 8), end: new Date(2026, 8, 8) };
  const events = [{ date: '2026-09-08', start: '12:30', end: '13:30', title: 'x' }];
  const two = S.findSlots(events, range, { perDayMax: 2, bufferMinutes: 30 }, MON);
  assert.deepEqual(two.map(S.formatSlot), ['9/8（火）10:00〜11:00', '9/8（火）14:00〜15:00']);
  const three = S.findSlots(events, range, { perDayMax: 3, bufferMinutes: 30 }, MON);
  assert.deepEqual(three.map(S.formatSlot), ['9/8（火）10:00〜11:00', '9/8（火）11:00〜12:00', '9/8（火）14:00〜15:00']);
});
