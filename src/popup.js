import {
  getPets,
  savePet,
  deletePet,
  getSettings,
  updateSettings,
  getUsage,
  getStats,
} from "./lib/storage.js";
import { fileToResizedBase64 } from "./lib/image.js";
import {
  DEFAULT_SITES,
  SITE_LABELS,
  SPECIES,
  MAX_PETS,
} from "./lib/constants.js";

// ---------- Tabs ----------
document.querySelectorAll(".mpg-tab").forEach((btn) => {
  btn.addEventListener("click", () => {
    document
      .querySelectorAll(".mpg-tab")
      .forEach((b) => b.classList.toggle("is-active", b === btn));
    const target = btn.dataset.tab;
    document.querySelectorAll(".mpg-panel").forEach((p) => {
      p.classList.toggle("is-active", p.dataset.panel === target);
    });
    if (target === "stats") renderStats();
    if (target === "settings") renderSettings();
  });
});

// ---------- Pets ----------
async function renderPets() {
  const grid = document.getElementById("petsGrid");
  const pets = await getPets();
  grid.innerHTML = "";
  if (pets.length === 0) {
    grid.innerHTML = '<div class="mpg-empty">まだ登録されていません</div>';
  } else {
    for (const pet of pets) {
      const card = document.createElement("div");
      card.className = "mpg-pet-card";
      card.innerHTML = `
        <button class="delete" title="削除" data-id="${pet.id}">×</button>
        <img alt="${escapeHtml(pet.name)}" src="${pet.imageBase64}" />
        <div class="name">${escapeHtml(pet.name)}</div>
        <div class="species">${speciesLabel(pet.species)}</div>
      `;
      card.querySelector(".delete").addEventListener("click", async (e) => {
        e.stopPropagation();
        const id = e.currentTarget.dataset.id;
        if (confirm("このペットを削除しますか？")) {
          await deletePet(id);
          renderPets();
        }
      });
      grid.appendChild(card);
    }
  }
  document.getElementById("addPetBtn").disabled = pets.length >= MAX_PETS;
}

function speciesLabel(value) {
  return SPECIES.find((s) => s.value === value)?.label || "その他";
}

function escapeHtml(s) {
  return String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]
  );
}

// ---------- Add pet dialog ----------
const dialog = document.getElementById("addPetDialog");
const speciesSelect = document.getElementById("petSpeciesSelect");
SPECIES.forEach((s) => {
  const opt = document.createElement("option");
  opt.value = s.value;
  opt.textContent = s.label;
  speciesSelect.appendChild(opt);
});

document.getElementById("addPetBtn").addEventListener("click", () => {
  document.getElementById("addPetForm").reset();
  document.getElementById("petPreview").hidden = true;
  document.getElementById("petPreview").innerHTML = "";
  dialog.showModal();
});

document.getElementById("petImageInput").addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  try {
    const dataUrl = await fileToResizedBase64(file);
    const preview = document.getElementById("petPreview");
    preview.innerHTML = `<img src="${dataUrl}" alt="preview" />`;
    preview.hidden = false;
    preview.dataset.dataUrl = dataUrl;
  } catch (err) {
    alert(err.message || "画像の処理に失敗しました");
  }
});

document.getElementById("cancelAddPet").addEventListener("click", () => {
  dialog.close();
});

document.getElementById("addPetForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = document.getElementById("petNameInput").value.trim();
  const species = speciesSelect.value;
  const dataUrl = document.getElementById("petPreview").dataset.dataUrl;
  if (!name || !dataUrl) return;
  await savePet({
    id: `pet_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    name,
    species,
    imageBase64: dataUrl,
    createdAt: new Date().toISOString(),
  });
  dialog.close();
  await renderPets();
  await renderSettings();
});

// ---------- Settings ----------
async function renderSettings() {
  const settings = await getSettings();
  const pets = await getPets();
  const select = document.getElementById("todayPetSelect");
  select.innerHTML = "";
  const randomOpt = document.createElement("option");
  randomOpt.value = "random";
  randomOpt.textContent = "毎回ランダム";
  select.appendChild(randomOpt);
  for (const pet of pets) {
    const opt = document.createElement("option");
    opt.value = pet.id;
    opt.textContent = pet.name;
    select.appendChild(opt);
  }
  select.value = pets.find((p) => p.id === settings.todayPetId)
    ? settings.todayPetId
    : "random";

  document.getElementById("usageLimitInput").value = settings.usageLimitMinutes;
  document.getElementById("breakMinutesInput").value = settings.breakMinutes;

  const sitesList = document.getElementById("sitesList");
  sitesList.innerHTML = "";
  // Deduplicate visual labels (threads.net + www.threads.net share label)
  const seen = new Set();
  for (const site of DEFAULT_SITES) {
    const label = SITE_LABELS[site] || site;
    if (seen.has(label)) continue;
    seen.add(label);
    const wrap = document.createElement("label");
    const checked = settings.enabledSites.includes(site);
    wrap.innerHTML = `<input type="checkbox" data-label="${label}" ${
      checked ? "checked" : ""
    } /> ${label}`;
    sitesList.appendChild(wrap);
  }
}

document.getElementById("saveSettingsBtn").addEventListener("click", async () => {
  const todayPetId = document.getElementById("todayPetSelect").value;
  const usageLimitMinutes = clampInt(
    document.getElementById("usageLimitInput").value,
    1,
    999,
    60
  );
  const breakMinutes = clampInt(
    document.getElementById("breakMinutesInput").value,
    1,
    60,
    5
  );

  // Build enabledSites by re-mapping selected labels back to all hosts that share that label
  const checkedLabels = new Set();
  document.querySelectorAll("#sitesList input:checked").forEach((cb) => {
    checkedLabels.add(cb.dataset.label);
  });
  const enabledSites = DEFAULT_SITES.filter((s) =>
    checkedLabels.has(SITE_LABELS[s] || s)
  );

  await updateSettings({
    todayPetId,
    usageLimitMinutes,
    breakMinutes,
    enabledSites,
  });

  // Notify background to apply new limits immediately
  try {
    await chrome.runtime.sendMessage({ type: "SETTINGS_UPDATED" });
  } catch {
    /* background may be sleeping; it will pick up storage on next tick */
  }

  const msg = document.getElementById("savedMsg");
  msg.hidden = false;
  setTimeout(() => (msg.hidden = true), 1500);
});

function clampInt(raw, min, max, fallback) {
  const n = parseInt(raw, 10);
  if (Number.isNaN(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

// ---------- Stats ----------
async function renderStats() {
  const stats = await getStats();
  document.getElementById("breakToday").textContent = stats.breakCountToday;
  document.getElementById("breakAll").textContent = stats.breakCountAllTime;

  const usage = await getUsage();
  const list = document.getElementById("usageList");
  list.innerHTML = "";
  // Aggregate by visual label
  const totalsByLabel = {};
  for (const [domain, ms] of Object.entries(usage.totalsMs)) {
    const label = SITE_LABELS[domain] || domain;
    totalsByLabel[label] = (totalsByLabel[label] || 0) + ms;
  }
  const entries = Object.entries(totalsByLabel).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) {
    const li = document.createElement("li");
    li.innerHTML = '<span class="label">まだ記録がありません</span>';
    list.appendChild(li);
    return;
  }
  for (const [label, ms] of entries) {
    const li = document.createElement("li");
    li.innerHTML = `
      <span class="label">${escapeHtml(label)}</span>
      <span class="value">${formatMs(ms)}</span>
    `;
    list.appendChild(li);
  }
}

function formatMs(ms) {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}時間${m}分`;
  if (m > 0) return `${m}分${s}秒`;
  return `${s}秒`;
}

// ---------- Init ----------
renderPets();
renderSettings();
