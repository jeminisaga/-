/**
 * 空き日程 ― Googleカレンダー版（Google Apps Script）
 *
 * このファイルと index.html を Apps Script のプロジェクトに入れて、
 * 「ウェブアプリ」として公開すると、Googleカレンダーの予定から空きを出せる。
 * 手順は README.md。
 */

// 読むカレンダー。空のままなら「自分が持っているカレンダー全部」を読む。
// 特定のカレンダーだけ読みたいときは、カレンダーID（多くはメールアドレス）を並べる。
// 例: var CALENDAR_IDS = ['example@gmail.com'];
var CALENDAR_IDS = [];

// 日付と時刻をこの時間帯で扱う
var TIME_ZONE = 'Asia/Tokyo';

/** 画面を返す */
function doGet() {
  return HtmlService.createHtmlOutputFromFile('index')
    .setTitle('空き日程')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover');
}

/**
 * 画面から呼ばれる。startKey〜endKey（'YYYY-MM-DD'、両端を含む）の予定を返す。
 * 返す形: [{ id, date: 'YYYY-MM-DD', start: 'HH:mm', end: 'HH:mm', title, allDay }]
 * 日をまたぐ予定は日ごとに分ける。断った予定は入れない。
 */
function getEvents(startKey, endKey) {
  var start = Utilities.parseDate(startKey, TIME_ZONE, 'yyyy-MM-dd');
  var endExclusive = Utilities.parseDate(endKey, TIME_ZONE, 'yyyy-MM-dd');
  endExclusive.setDate(endExclusive.getDate() + 1);

  var out = [];
  getCalendars_().forEach(function (cal) {
    cal.getEvents(start, endExclusive).forEach(function (ev) {
      if (isDeclined_(ev)) return;
      splitByDay_(ev).forEach(function (piece) {
        if (piece.date < startKey || piece.date > endKey) return;
        out.push(piece);
      });
    });
  });
  return out;
}

function getCalendars_() {
  if (CALENDAR_IDS.length) {
    return CALENDAR_IDS.map(function (id) { return CalendarApp.getCalendarById(id); })
      .filter(function (c) { return !!c; });
  }
  return CalendarApp.getAllOwnedCalendars();
}

function isDeclined_(ev) {
  try { return ev.getMyStatus() === CalendarApp.GuestStatus.NO; } catch (e) { return false; }
}

function fmtDate_(d) { return Utilities.formatDate(d, TIME_ZONE, 'yyyy-MM-dd'); }
function fmtTime_(d) { return Utilities.formatDate(d, TIME_ZONE, 'HH:mm'); }

function splitByDay_(ev) {
  var id = ev.getId();
  var title = ev.getTitle() || '予定';
  var pieces = [];

  if (ev.isAllDayEvent()) {
    var d = new Date(ev.getAllDayStartDate());
    var end = ev.getAllDayEndDate(); // 翌日の0時（含まない）
    var guard = 0;
    while (d < end && guard++ < 62) {
      pieces.push({ id: id + '_' + fmtDate_(d), date: fmtDate_(d), start: '', end: '', title: title, allDay: true });
      d.setDate(d.getDate() + 1);
    }
    return pieces;
  }

  var s = ev.getStartTime();
  var e = ev.getEndTime();
  var sKey = fmtDate_(s);
  var eKey = fmtDate_(e);
  if (sKey === eKey) {
    pieces.push({ id: id, date: sKey, start: fmtTime_(s), end: fmtTime_(e), title: title, allDay: false });
    return pieces;
  }
  // 日をまたぐ: 初日は開始〜24:00、間の日は終日、最終日は0:00〜終了
  pieces.push({ id: id + '_a', date: sKey, start: fmtTime_(s), end: '24:00', title: title, allDay: false });
  var mid = new Date(s.getTime());
  mid.setDate(mid.getDate() + 1);
  var guard2 = 0;
  while (fmtDate_(mid) < eKey && guard2++ < 62) {
    pieces.push({ id: id + '_' + fmtDate_(mid), date: fmtDate_(mid), start: '', end: '', title: title, allDay: true });
    mid.setDate(mid.getDate() + 1);
  }
  if (fmtTime_(e) !== '00:00') {
    pieces.push({ id: id + '_z', date: eKey, start: '00:00', end: fmtTime_(e), title: title, allDay: false });
  }
  return pieces;
}

/** 動作確認用。エディタで実行すると、来週の予定がログに出る。 */
function testGetEvents() {
  var today = new Date();
  var a = new Date(today.getTime() + 1 * 86400000);
  var b = new Date(today.getTime() + 14 * 86400000);
  var list = getEvents(fmtDate_(a), fmtDate_(b));
  Logger.log(list.length + ' 件');
  list.forEach(function (ev) { Logger.log(ev.date + ' ' + (ev.allDay ? '終日' : ev.start + '〜' + ev.end) + ' ' + ev.title); });
}
