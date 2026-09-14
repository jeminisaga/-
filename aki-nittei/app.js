/* 空き日程を出す道具 ― 画面の動き。計算は slots.js。 */
(function () {
  'use strict';
  var S = window.AkiSlots;
  var KEY_SETTINGS = 'akinittei.settings';
  var KEY_EVENTS = 'akinittei.events';
  var KEY_PERIOD = 'akinittei.period';

  // ---------- 予定の出どころ ----------
  // Google Apps Script のウェブアプリとして動いているときは Googleカレンダーから読む。
  // それ以外（ふつうに index.html を開いたとき）は端末内の予定（初回はお試しの予定）を使う。
  var calendarMode = !!(window.google && window.google.script && window.google.script.run);

  // ---------- 保存（端末の中） ----------
  function load(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) { return fallback; }
  }
  function save(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* 保存できなくても動く */ }
  }

  var settings = Object.assign({}, S.DEFAULT_SETTINGS, load(KEY_SETTINGS, {}));
  var period = load(KEY_PERIOD, 'nextWeek');

  // 端末内の予定（お試し版のときだけ使う）
  var localEvents = load(KEY_EVENTS, null);
  var usingSample = false;
  if (!Array.isArray(localEvents)) { localEvents = S.sampleEvents(new Date()); usingSample = true; save(KEY_EVENTS, localEvents); }
  else usingSample = localEvents.length > 0 && localEvents.every(function (e) { return /^sample-/.test(e.id); });

  // Googleカレンダーから最後に読んだ予定（期間ごとに持つ）
  var fetched = { key: null, events: [] };

  // 期間ぶんの予定を返す（Promise）
  function fetchEvents(range) {
    if (!calendarMode) return Promise.resolve(localEvents);
    var key = S.dateKey(range.start) + '_' + S.dateKey(range.end);
    if (fetched.key === key) return Promise.resolve(fetched.events);
    return new Promise(function (resolve, reject) {
      google.script.run
        .withSuccessHandler(function (list) { fetched = { key: key, events: list || [] }; resolve(fetched.events); })
        .withFailureHandler(function (err) { reject(err); })
        .getEvents(S.dateKey(range.start), S.dateKey(range.end));
    });
  }

  // ---------- 要素 ----------
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  var views = { main: $('#view-main'), events: $('#view-events'), settings: $('#view-settings') };
  var generateBtn = $('#btn-generate');
  var outputCard = $('#output-card');
  var output = $('#output');
  var outputHint = $('#output-hint');
  var rangeLabel = $('#range-label');
  var errorBox = $('#fetch-error');
  var toastEl = $('#toast');
  var toastTimer = null;

  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.hidden = true; }, 1800);
  }

  // モードに応じて見せる部分を切り替える
  document.body.classList.add(calendarMode ? 'mode-calendar' : 'mode-sample');
  $$('[data-only="sample"]').forEach(function (el) { el.hidden = calendarMode; });
  $$('[data-only="calendar"]').forEach(function (el) { el.hidden = !calendarMode; });

  // ---------- 画面の切り替え ----------
  function show(name) {
    Object.keys(views).forEach(function (k) { views[k].hidden = k !== name; });
    window.scrollTo(0, 0);
    if (name === 'events') renderEvents();
    if (name === 'settings') fillSettingsForm();
  }
  $$('[data-open]').forEach(function (b) { b.addEventListener('click', function () { show(b.getAttribute('data-open')); }); });
  $$('[data-close]').forEach(function (b) { b.addEventListener('click', function () { show('main'); }); });

  // ---------- メイン：期間 ----------
  function currentRange() { return S.periodRange(period, new Date()); }
  function renderPeriod() {
    $$('.seg').forEach(function (b) { b.setAttribute('aria-checked', String(b.getAttribute('data-period') === period)); });
    var r = currentRange();
    rangeLabel.textContent = S.fmtDate(r.start) + ' 〜 ' + S.fmtDate(r.end);
  }
  $$('.seg').forEach(function (b) {
    b.addEventListener('click', function () {
      period = b.getAttribute('data-period');
      save(KEY_PERIOD, period);
      renderPeriod();
      if (!outputCard.hidden) generate();
    });
  });

  // ---------- メイン：空きを出す ----------
  function autosize() {
    output.style.height = 'auto';
    output.style.height = (output.scrollHeight + 4) + 'px';
  }
  function setBusy(busy) {
    generateBtn.disabled = busy;
    generateBtn.textContent = busy ? '予定を読んでいます…' : '空きを出す';
  }
  function showFetchError(err) {
    var detail = (err && (err.message || String(err))) || '';
    errorBox.textContent = 'Googleカレンダーの予定を読めませんでした。ページを開き直してみてください。' + (detail ? '（' + detail + '）' : '');
    errorBox.hidden = false;
  }
  var generating = false;
  function generate() {
    if (generating) return;
    generating = true;
    errorBox.hidden = true;
    var range = currentRange();
    setBusy(calendarMode);
    fetchEvents(range).then(function (events) {
      var slots = S.findSlots(events, range, settings, new Date());
      output.value = S.buildText(slots, settings);
      outputCard.hidden = false;
      autosize();
      if (slots.length === 0) {
        outputHint.textContent = period === 'thisWeek' ? '「来週」か「2週間」にしてみてください。' : '設定で時間帯や土日を広げると出やすくなります。';
      } else {
        outputHint.textContent = slots.length + '件の候補です。文面は直接書き足せます。';
      }
    }, showFetchError).then(function () { setBusy(false); generating = false; });
  }
  generateBtn.addEventListener('click', generate);
  output.addEventListener('input', autosize);
  output.removeAttribute('readonly'); // 出た文面をその場で直せるように

  // ---------- メイン：コピー ----------
  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
    return new Promise(function (resolve, reject) {
      try {
        output.focus(); output.select(); output.setSelectionRange(0, text.length);
        var ok = document.execCommand('copy');
        output.blur();
        ok ? resolve() : reject(new Error('copy failed'));
      } catch (e) { reject(e); }
    });
  }
  $('#btn-copy').addEventListener('click', function () {
    var text = output.value;
    if (!text) return;
    copyText(text).then(function () { toast('コピーしました'); },
      function () { output.focus(); output.select(); toast('長押しでコピーしてください'); });
  });

  // ---------- 予定 ----------
  var eventForm = $('#event-form');
  var eventError = $('#event-error');
  var eventList = $('#event-list');
  var eventEmpty = $('#event-empty');
  var eventsHint = $('#events-hint');
  var sampleNote = $('#sample-note');

  function setLocalEvents(next, sample) {
    localEvents = next; usingSample = !!sample;
    save(KEY_EVENTS, localEvents);
    renderEvents();
    sampleNote.hidden = !usingSample;
    if (!outputCard.hidden) generate();
  }

  function renderEventList(events, deletable) {
    var sorted = events.slice().sort(function (a, b) {
      return (a.date + (a.allDay ? '00:00' : a.start)).localeCompare(b.date + (b.allDay ? '00:00' : b.start));
    });
    eventList.innerHTML = '';
    eventEmpty.hidden = sorted.length > 0;
    sorted.forEach(function (ev) {
      var li = document.createElement('li');
      var d = S.fromKey(ev.date);
      var date = document.createElement('span'); date.className = 'event-date'; date.textContent = d ? S.fmtDate(d) : ev.date;
      var time = document.createElement('span'); time.className = 'event-time'; time.textContent = ev.allDay ? '終日' : ev.start + '〜' + ev.end;
      var title = document.createElement('span'); title.className = 'event-title'; title.textContent = ev.title || '予定';
      li.append(date, time, title);
      if (deletable) {
        var del = document.createElement('button'); del.type = 'button'; del.className = 'event-del'; del.textContent = '消す';
        del.setAttribute('aria-label', (ev.title || '予定') + 'を消す');
        del.addEventListener('click', function () {
          setLocalEvents(localEvents.filter(function (e) { return e.id !== ev.id; }), false);
        });
        li.appendChild(del);
      }
      eventList.appendChild(li);
    });
  }

  function renderEvents() {
    if (!calendarMode) { renderEventList(localEvents, true); return; }
    // Googleカレンダー版：いま選んでいる期間の予定を読んで見せるだけ（直すのはカレンダー側で）
    var range = currentRange();
    eventsHint.textContent = S.fmtDate(range.start) + ' 〜 ' + S.fmtDate(range.end) + ' の予定を読んでいます…';
    fetchEvents(range).then(function (events) {
      eventsHint.textContent = S.fmtDate(range.start) + ' 〜 ' + S.fmtDate(range.end) + ' の予定です。直すときは Googleカレンダーで。';
      renderEventList(events, false);
    }, function (err) {
      eventsHint.textContent = '';
      showFetchError(err);
    });
  }

  var allDayBox = eventForm.elements.allDay;
  var timeRow = $('#time-row');
  allDayBox.addEventListener('change', function () { timeRow.hidden = allDayBox.checked; });
  eventForm.elements.date.value = S.dateKey(S.addDays(new Date(), 1));

  eventForm.addEventListener('submit', function (e) {
    e.preventDefault();
    var f = eventForm.elements;
    var ev = {
      id: 'ev-' + Date.now(),
      date: f.date.value,
      allDay: f.allDay.checked,
      start: f.allDay.checked ? '' : f.start.value,
      end: f.allDay.checked ? '' : f.end.value,
      title: f.title.value.trim()
    };
    eventError.hidden = true;
    if (!S.fromKey(ev.date)) return showError('日付を入れてください。');
    if (!ev.allDay) {
      var s = S.parseHM(ev.start), en = S.parseHM(ev.end);
      if (s === null || en === null) return showError('開始と終了の時刻を入れてください。');
      if (en <= s) return showError('終了は開始より後にしてください。');
    }
    setLocalEvents(localEvents.concat([ev]), false);
    f.title.value = '';
    toast('予定を足しました');
  });
  function showError(msg) { eventError.textContent = msg; eventError.hidden = false; }

  $('#btn-reset-sample').addEventListener('click', function () {
    setLocalEvents(S.sampleEvents(new Date()), true);
    toast('お試しの予定に戻しました');
  });
  // 「全部消す」は二度押しで確定する（確認ダイアログが出ない環境でも動くように）
  var clearBtn = $('#btn-clear-events');
  var clearArmed = null;
  clearBtn.addEventListener('click', function () {
    if (clearArmed) {
      clearTimeout(clearArmed); clearArmed = null;
      clearBtn.textContent = '予定を全部消す';
      setLocalEvents([], false);
      toast('予定を消しました');
      return;
    }
    clearBtn.textContent = 'もう一度押すと全部消えます';
    clearArmed = setTimeout(function () { clearArmed = null; clearBtn.textContent = '予定を全部消す'; }, 3000);
  });

  // Googleカレンダー版：読み直し
  $('#btn-reload-events').addEventListener('click', function () {
    fetched = { key: null, events: [] };
    renderEvents();
  });

  // ---------- 設定 ----------
  var settingsForm = $('#settings-form');
  var settingKeys = ['startTime', 'endTime', 'slotMinutes', 'bufferMinutes', 'includeWeekends', 'allDayBlocks', 'skipDays', 'perDayMax', 'mode', 'header', 'footer', 'bullet', 'emptyText'];

  function fillSettingsForm() {
    settingKeys.forEach(function (k) {
      var el = settingsForm.elements[k];
      if (!el) return;
      if (el.type === 'checkbox') el.checked = !!settings[k];
      else el.value = String(settings[k]);
    });
  }
  function readSettingsForm() {
    settingKeys.forEach(function (k) {
      var el = settingsForm.elements[k];
      if (!el) return;
      if (el.type === 'checkbox') settings[k] = el.checked;
      else if (['slotMinutes', 'bufferMinutes', 'skipDays', 'perDayMax'].indexOf(k) >= 0) settings[k] = Number(el.value);
      else settings[k] = el.value;
    });
    save(KEY_SETTINGS, settings);
    if (!outputCard.hidden) generate();
  }
  settingsForm.addEventListener('change', readSettingsForm);
  settingsForm.addEventListener('input', function (e) { if (e.target.tagName === 'TEXTAREA' || e.target.type === 'text') readSettingsForm(); });
  settingsForm.addEventListener('submit', function (e) { e.preventDefault(); });
  $('#btn-reset-settings').addEventListener('click', function () {
    settings = Object.assign({}, S.DEFAULT_SETTINGS);
    save(KEY_SETTINGS, settings);
    fillSettingsForm();
    toast('最初の設定に戻しました');
  });

  // ---------- 起動 ----------
  sampleNote.hidden = calendarMode || !usingSample;
  renderPeriod();
  show('main');
})();
