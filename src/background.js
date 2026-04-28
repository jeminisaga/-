import {
  getSettings,
  addUsageMs,
  getUsage,
  updateUsage,
  getActiveSession,
  setActiveSession,
  pickTodayPet,
  incrementBreakCount,
} from "./lib/storage.js";

const ALARM_TICK = "mpg-tick";

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(ALARM_TICK, { periodInMinutes: 0.5 });
});
chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create(ALARM_TICK, { periodInMinutes: 0.5 });
});

// ---------- Active tab tracking ----------
chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  await reconcile(tabId);
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (!tab.active) return;
  if (changeInfo.url || changeInfo.status === "complete") {
    await reconcile(tabId);
  }
});

chrome.windows.onFocusChanged.addListener(async (windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) {
    await endSession();
    return;
  }
  const [tab] = await chrome.tabs.query({ active: true, windowId });
  if (tab) await reconcile(tab.id);
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const session = await getActiveSession();
  if (session && session.tabId === tabId) {
    await endSession();
  }
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== ALARM_TICK) return;
  await tick();
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === "BREAK_FINISHED") {
    handleBreakFinished().then(() => sendResponse({ ok: true }));
    return true;
  }
  if (msg?.type === "SETTINGS_UPDATED") {
    tick().then(() => sendResponse({ ok: true }));
    return true;
  }
});

// ---------- Core logic ----------
function getDomainFromUrl(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

async function reconcile(tabId) {
  let tab;
  try {
    tab = await chrome.tabs.get(tabId);
  } catch {
    await endSession();
    return;
  }
  if (!tab || !tab.url) {
    await endSession();
    return;
  }
  const domain = getDomainFromUrl(tab.url);
  const settings = await getSettings();
  const isTracked = domain && settings.enabledSites.includes(domain);

  const session = await getActiveSession();
  const now = Date.now();

  if (session) {
    // settle previous
    await addUsageMs(session.domain, now - session.startedAt);
  }

  if (isTracked) {
    await setActiveSession({ domain, tabId, startedAt: now });
    await maybeTriggerBreak(tabId, domain);
  } else {
    await setActiveSession(null);
  }
}

async function endSession() {
  const session = await getActiveSession();
  if (!session) return;
  const now = Date.now();
  await addUsageMs(session.domain, now - session.startedAt);
  await setActiveSession(null);
}

async function tick() {
  const session = await getActiveSession();
  if (session) {
    const now = Date.now();
    await addUsageMs(session.domain, now - session.startedAt);
    await setActiveSession({ ...session, startedAt: now });
    await maybeTriggerBreak(session.tabId, session.domain);
  }
}

async function maybeTriggerBreak(tabId, domain) {
  const settings = await getSettings();
  const usage = await getUsage();
  const now = Date.now();
  if (now < usage.breakInProgressUntil) return;

  const totalMs = settings.enabledSites.reduce(
    (s, d) => s + (usage.totalsMs[d] || 0),
    0
  );
  const limitMs = settings.usageLimitMinutes * 60 * 1000;
  if (totalMs - usage.lastBreakAtTotalMs < limitMs) return;

  const pet = await pickTodayPet();
  if (!pet) return; // No pets registered → silently skip

  const breakMs = settings.breakMinutes * 60 * 1000;
  await updateUsage({
    lastBreakAtTotalMs: totalMs,
    breakInProgressUntil: now + breakMs + 1000, // small grace period
  });
  await incrementBreakCount();

  try {
    await chrome.tabs.sendMessage(tabId, {
      type: "INTRUDE",
      pet: { name: pet.name, imageBase64: pet.imageBase64, species: pet.species },
      breakMinutes: settings.breakMinutes,
    });
  } catch (err) {
    // Content script may not be loaded yet (e.g. chrome:// page after redirect)
    console.warn("[MPG] failed to deliver INTRUDE", err);
  }
}

async function handleBreakFinished() {
  const usage = await getUsage();
  if (Date.now() < usage.breakInProgressUntil - 2000) {
    // Sanity: only clear if we're actually near the end
    return;
  }
  await updateUsage({ breakInProgressUntil: 0 });
}
