import { DEFAULT_SETTINGS } from "./constants.js";

const KEYS = {
  pets: "pets",
  settings: "settings",
  usage: "usage",
  stats: "stats",
  activeSession: "activeSession",
};

function todayStr() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

export async function getPets() {
  const { [KEYS.pets]: pets } = await chrome.storage.local.get(KEYS.pets);
  return pets || [];
}

export async function savePet(pet) {
  const pets = await getPets();
  const idx = pets.findIndex((p) => p.id === pet.id);
  if (idx >= 0) pets[idx] = pet;
  else pets.push(pet);
  await chrome.storage.local.set({ [KEYS.pets]: pets });
  return pet;
}

export async function deletePet(id) {
  const pets = await getPets();
  const next = pets.filter((p) => p.id !== id);
  await chrome.storage.local.set({ [KEYS.pets]: next });
  const settings = await getSettings();
  if (settings.todayPetId === id) {
    await updateSettings({ todayPetId: "random" });
  }
}

export async function getSettings() {
  const { [KEYS.settings]: s } = await chrome.storage.local.get(KEYS.settings);
  return { ...DEFAULT_SETTINGS, ...(s || {}) };
}

export async function updateSettings(patch) {
  const current = await getSettings();
  const next = { ...current, ...patch };
  await chrome.storage.local.set({ [KEYS.settings]: next });
  return next;
}

export async function getUsage() {
  const { [KEYS.usage]: u } = await chrome.storage.local.get(KEYS.usage);
  const today = todayStr();
  if (!u || u.date !== today) {
    const fresh = {
      date: today,
      totalsMs: {},
      lastBreakAtTotalMs: 0,
      breakInProgressUntil: 0,
    };
    await chrome.storage.local.set({ [KEYS.usage]: fresh });
    return fresh;
  }
  // Backfill fields for users upgrading mid-day
  if (typeof u.lastBreakAtTotalMs !== "number") u.lastBreakAtTotalMs = 0;
  if (typeof u.breakInProgressUntil !== "number") u.breakInProgressUntil = 0;
  return u;
}

export async function addUsageMs(domain, ms) {
  if (!domain || !ms || ms <= 0) return;
  const usage = await getUsage();
  usage.totalsMs[domain] = (usage.totalsMs[domain] || 0) + ms;
  await chrome.storage.local.set({ [KEYS.usage]: usage });
  return usage;
}

export async function updateUsage(patch) {
  const usage = await getUsage();
  const next = { ...usage, ...patch };
  await chrome.storage.local.set({ [KEYS.usage]: next });
  return next;
}

export async function getTotalUsageMs(enabledSites) {
  const usage = await getUsage();
  if (!enabledSites) {
    return Object.values(usage.totalsMs).reduce((a, b) => a + b, 0);
  }
  return enabledSites.reduce((sum, s) => sum + (usage.totalsMs[s] || 0), 0);
}

export async function getStats() {
  const { [KEYS.stats]: s } = await chrome.storage.local.get(KEYS.stats);
  const today = todayStr();
  if (!s || s.date !== today) {
    const fresh = {
      date: today,
      breakCountToday: 0,
      breakCountAllTime: s?.breakCountAllTime || 0,
    };
    await chrome.storage.local.set({ [KEYS.stats]: fresh });
    return fresh;
  }
  return s;
}

export async function incrementBreakCount() {
  const stats = await getStats();
  stats.breakCountToday += 1;
  stats.breakCountAllTime += 1;
  await chrome.storage.local.set({ [KEYS.stats]: stats });
  return stats;
}

export async function getActiveSession() {
  const { [KEYS.activeSession]: a } = await chrome.storage.local.get(
    KEYS.activeSession
  );
  return a || null;
}

export async function setActiveSession(session) {
  if (session === null) {
    await chrome.storage.local.remove(KEYS.activeSession);
  } else {
    await chrome.storage.local.set({ [KEYS.activeSession]: session });
  }
}

export async function pickTodayPet() {
  const pets = await getPets();
  if (pets.length === 0) return null;
  const settings = await getSettings();
  if (settings.todayPetId === "random") {
    return pets[Math.floor(Math.random() * pets.length)];
  }
  return pets.find((p) => p.id === settings.todayPetId) || pets[0];
}
