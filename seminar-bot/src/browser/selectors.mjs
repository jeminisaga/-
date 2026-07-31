// Centralized selector map for Google Meet. The UI is LOCALIZED, so the user's
// Japanese Meet renders Japanese aria-labels. We match by BOTH languages and,
// where possible, prefer keyboard shortcuts (which are locale-independent) over
// clicking labelled buttons. This is the single highest-maintenance surface of
// the whole project — when Meet changes its DOM, fix it here.

// Mic/camera toggles. Meet exposes them as buttons whose aria-label starts with
// "Turn off/on microphone" (en) or "マイクをオフ/オンにする" (ja). We target by a
// substring match on either language.
export const meet = {
  // Pre-join screen "your name" input (guest, not signed in).
  nameInput: 'input[aria-label*="name" i], input[aria-label*="名前"], input[placeholder*="name" i], input[placeholder*="名前"]',

  // Join buttons. Text differs by state: "Join now" / "Ask to join" (en),
  // "今すぐ参加" / "参加をリクエスト" (ja).
  joinButtonTexts: ["今すぐ参加", "参加をリクエスト", "参加", "Join now", "Ask to join", "Join"],

  // Leave call button aria-label.
  leaveButtonSelector:
    'button[aria-label*="Leave call" i], button[aria-label*="通話から退出"], button[aria-label*="退出"]',

  // In-call toolbar marker used to detect successful admission (leave button present).
  inCallMarker: 'button[aria-label*="Leave call" i], button[aria-label*="退出"]',

  // People / participants count element aria-labels differ; we read the button
  // that shows the participant count.
  participantCountSelector:
    'button[aria-label*="people" i] , div[aria-label*="participant" i], button[aria-label*="ユーザー"], button[aria-label*="参加者"]',

  // Keyboard shortcuts (locale-independent). Meet: Ctrl/Cmd+D = mic, Ctrl/Cmd+E = camera.
  shortcuts: { toggleMic: "ControlOrMeta+d", toggleCam: "ControlOrMeta+e" },

  // Text fragments that indicate the meeting/call has ended or we were removed.
  endTextFragments: [
    "会議から退出しました",
    "通話から退出しました",
    "ホーム画面に戻る",
    "この会議は終了しました",
    "You've left the meeting",
    "You left the call",
    "Return to home screen",
    "Your host ended the meeting",
    "removed from the meeting",
  ],
};
