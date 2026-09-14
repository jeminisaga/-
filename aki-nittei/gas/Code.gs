/**
 * 空き日程 ― Googleカレンダー版（Google Apps Script）
 *
 * このファイルと index.html を Apps Script のプロジェクトに入れて、
 * 「ウェブアプリ」として公開すると、Googleカレンダーの予定から空きを出せる。
 * 手順は README.md。
 *
 * 「サービス」に Google Calendar API を追加しておくと、Googleカレンダーの
 * 「予定あり／予定なし」の設定を読める（終日の予定は既定で「予定なし」なので、これが大事）。
 * 追加していなくても動くが、そのときは終日の予定をすべて「埋まっている」とみなす。
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
 * 画面から呼ばれる。いま誰のカレンダーを読んでいるか（ログイン中の Googleアカウント）と、
 * 別のアカウントに切り替えるときの URL を返す。
 * 「次のユーザーとして実行: ウェブアプリにアクセスしているユーザー」で公開したときに意味がある。
 */
function getWhoAmI() {
  var email = '';
  try { email = Session.getEffectiveUser().getEmail() || ''; } catch (e) { email = ''; }
  var url = '';
  try { url = ScriptApp.getService().getUrl() || ''; } catch (e) { url = ''; }
  return {
    email: email,
    switchUrl: url ? 'https://accounts.google.com/AccountChooser?continue=' + encodeURIComponent(url) : 'https://accounts.google.com/'
  };
}

/**
 * 画面から呼ばれる。startKey〜endKey（'YYYY-MM-DD'、両端を含む）の予定を返す。
 * 返す形: [{ id, date: 'YYYY-MM-DD', start: 'HH:mm', end: 'HH:mm', title, allDay }]
 * - 日をまたぐ予定は日ごとに分ける
 * - 断った予定、「予定なし」設定の予定、キャンセルされた予定は入れない
 */
function getEvents(startKey, endKey) {
  var start = Utilities.parseDate(startKey, TIME_ZONE, 'yyyy-MM-dd');
  var endExclusive = Utilities.parseDate(endKey, TIME_ZONE, 'yyyy-MM-dd');
  endExclusive.setDate(endExclusive.getDate() + 1);

  var pieces = hasCalendarApi_() ? readWithApi_(start, endExclusive) : readWithCalendarApp_(start, endExclusive);
  return pieces.filter(function (p) { return p.date >= startKey && p.date <= endKey; });
}

// ---------- Calendar API（拡張サービス）で読む：予定あり／なしが分かる ----------

function hasCalendarApi_() {
  try { return typeof Calendar !== 'undefined' && !!Calendar.Events; } catch (e) { return false; }
}

function getCalendarIdsApi_() {
  if (CALENDAR_IDS.length) return CALENDAR_IDS.slice();
  var ids = [];
  var pageToken = null;
  do {
    var res = Calendar.CalendarList.list({ pageToken: pageToken, showHidden: false });
    (res.items || []).forEach(function (c) {
      if (c.accessRole === 'owner' && c.selected !== false) ids.push(c.id);
    });
    pageToken = res.nextPageToken;
  } while (pageToken);
  return ids;
}

function readWithApi_(start, endExclusive) {
  var out = [];
  getCalendarIdsApi_().forEach(function (calId) {
    var pageToken = null;
    do {
      var res = Calendar.Events.list(calId, {
        timeMin: start.toISOString(),
        timeMax: endExclusive.toISOString(),
        singleEvents: true,
        orderBy: 'startTime',
        maxResults: 2500,
        pageToken: pageToken
      });
      (res.items || []).forEach(function (item) {
        if (item.status === 'cancelled') return;
        if (item.transparency === 'transparent') return;   // 「予定なし」= 空きとして扱う
        if (item.eventType === 'workingLocation') return;  // 勤務場所は予定ではない
        if (isDeclinedApi_(item)) return;
        splitByDayApi_(item).forEach(function (p) { out.push(p); });
      });
      pageToken = res.nextPageToken;
    } while (pageToken);
  });
  return out;
}

function isDeclinedApi_(item) {
  var me = (item.attendees || []).filter(function (a) { return a.self; })[0];
  return !!(me && me.responseStatus === 'declined');
}

function splitByDayApi_(item) {
  var id = item.id;
  var title = item.summary || '予定';
  if (item.start && item.start.date) {
    // 終日。end.date は含まない（翌日）
    var d = Utilities.parseDate(item.start.date, TIME_ZONE, 'yyyy-MM-dd');
    var end = Utilities.parseDate(item.end.date, TIME_ZONE, 'yyyy-MM-dd');
    var pieces = [];
    var guard = 0;
    while (d < end && guard++ < 62) {
      pieces.push({ id: id + '_' + fmtDate_(d), date: fmtDate_(d), start: '', end: '', title: title, allDay: true });
      d.setDate(d.getDate() + 1);
    }
    return pieces;
  }
  return splitTimed_(id, title, new Date(item.start.dateTime), new Date(item.end.dateTime));
}

// ---------- CalendarApp で読む（拡張サービスを追加していないとき） ----------

function getCalendars_() {
  if (CALENDAR_IDS.length) {
    return CALENDAR_IDS.map(function (id) { return CalendarApp.getCalendarById(id); })
      .filter(function (c) { return !!c; });
  }
  return CalendarApp.getAllOwnedCalendars();
}

function readWithCalendarApp_(start, endExclusive) {
  var out = [];
  getCalendars_().forEach(function (cal) {
    cal.getEvents(start, endExclusive).forEach(function (ev) {
      if (isDeclined_(ev)) return;
      splitByDay_(ev).forEach(function (p) { out.push(p); });
    });
  });
  return out;
}

function isDeclined_(ev) {
  try { return ev.getMyStatus() === CalendarApp.GuestStatus.NO; } catch (e) { return false; }
}

function splitByDay_(ev) {
  var id = ev.getId();
  var title = ev.getTitle() || '予定';
  if (ev.isAllDayEvent()) {
    var d = new Date(ev.getAllDayStartDate());
    var end = ev.getAllDayEndDate(); // 翌日の0時（含まない）
    var pieces = [];
    var guard = 0;
    while (d < end && guard++ < 62) {
      pieces.push({ id: id + '_' + fmtDate_(d), date: fmtDate_(d), start: '', end: '', title: title, allDay: true });
      d.setDate(d.getDate() + 1);
    }
    return pieces;
  }
  return splitTimed_(id, title, ev.getStartTime(), ev.getEndTime());
}

// ---------- 共通 ----------

function fmtDate_(d) { return Utilities.formatDate(d, TIME_ZONE, 'yyyy-MM-dd'); }
function fmtTime_(d) { return Utilities.formatDate(d, TIME_ZONE, 'HH:mm'); }

// 時刻つきの予定を日ごとに分ける。日をまたぐ: 初日は開始〜24:00、間の日は終日、最終日は0:00〜終了
function splitTimed_(id, title, s, e) {
  var sKey = fmtDate_(s);
  var eKey = fmtDate_(e);
  if (sKey === eKey) {
    return [{ id: id, date: sKey, start: fmtTime_(s), end: fmtTime_(e), title: title, allDay: false }];
  }
  var pieces = [{ id: id + '_a', date: sKey, start: fmtTime_(s), end: '24:00', title: title, allDay: false }];
  var mid = new Date(s.getTime());
  mid.setDate(mid.getDate() + 1);
  var guard = 0;
  while (fmtDate_(mid) < eKey && guard++ < 62) {
    pieces.push({ id: id + '_' + fmtDate_(mid), date: fmtDate_(mid), start: '', end: '', title: title, allDay: true });
    mid.setDate(mid.getDate() + 1);
  }
  if (fmtTime_(e) !== '00:00') {
    pieces.push({ id: id + '_z', date: eKey, start: '00:00', end: fmtTime_(e), title: title, allDay: false });
  }
  return pieces;
}

/** 動作確認用。エディタで実行すると、今日から2週間の予定がログに出る。 */
function testGetEvents() {
  var today = new Date();
  var a = new Date(today.getTime() + 1 * 86400000);
  var b = new Date(today.getTime() + 14 * 86400000);
  Logger.log('読み方: ' + (hasCalendarApi_() ? 'Calendar API（予定あり／なしを反映）' : 'CalendarApp（終日はすべて埋まり扱い）'));
  var list = getEvents(fmtDate_(a), fmtDate_(b));
  Logger.log(list.length + ' 件');
  list.forEach(function (ev) { Logger.log(ev.date + ' ' + (ev.allDay ? '終日' : ev.start + '〜' + ev.end) + ' ' + ev.title); });
}
