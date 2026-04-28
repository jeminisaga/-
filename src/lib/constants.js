export const DEFAULT_SITES = [
  "x.com",
  "twitter.com",
  "www.instagram.com",
  "www.tiktok.com",
  "www.youtube.com",
  "www.threads.net",
  "threads.net",
  "bsky.app",
  "www.reddit.com",
  "www.facebook.com",
];

export const SITE_LABELS = {
  "x.com": "X",
  "twitter.com": "Twitter",
  "www.instagram.com": "Instagram",
  "www.tiktok.com": "TikTok",
  "www.youtube.com": "YouTube",
  "www.threads.net": "Threads",
  "threads.net": "Threads",
  "bsky.app": "Bluesky",
  "www.reddit.com": "Reddit",
  "www.facebook.com": "Facebook",
};

export const DEFAULT_SETTINGS = {
  todayPetId: "random",
  usageLimitMinutes: 60,
  breakMinutes: 5,
  enabledSites: [...DEFAULT_SITES],
};

export const SPECIES = [
  { value: "cat", label: "猫" },
  { value: "dog", label: "犬" },
  { value: "rabbit", label: "うさぎ" },
  { value: "hamster", label: "ハムスター" },
  { value: "bird", label: "鳥" },
  { value: "other", label: "その他" },
];

export const MAX_PETS = 5;
