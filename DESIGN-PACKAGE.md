# Design Package — My Pet Gatekeeper

## 1. The brand premise
One word: **うちの子**. Every blocker on the market loses the same way: it puts a button
in front of you and you press it. This one puts something you love in front of you, and
you don't. The site teaches that single idea and sells it: 意志ではなく、愛で止まる。
Every section serves it. Anything that doesn't, isn't on the page.

## 2. Palette as CSS tokens
Sampled from two places: the product's own popup.css, and the hero footage's grade.
```css
:root{
  --canvas:#FCF2EA;        /* warm milk, tinted toward the footage's peach ending */
  --panel:#FFFFFF;
  --panel-2:#FFF7F1;
  --line:#F0E0D4;
  --accent:#FF5C52;        /* taken exactly from the extension's own accent */
  --accent-hover:#E8443A;
  --accent-soft:#FF8A80;   /* also the extension's */
  --accent-muted:rgba(255,92,82,.14);
  --cool:#8B97B4;          /* the doomscroll world, sampled from the footage */
  --cool-deep:#5C6884;
  --text-secondary:#7D756E;
  --text-primary:#2D2A26;
}
```

## 3. Type trio
- Display: **Zen Maru Gothic** 700/900. Rounded gothic, warm, reads cute without going childish, full Japanese coverage.
- Body: **Zen Kaku Gothic New** 400/500.
- Mono: **Space Mono** 400/700, for the counter and small labels only.
Not Inter, not Roboto.

## 4. Band map (hero = 620vh, scroll range 520vh)
| Band | Range | Footage moment | Copy (verbatim) | Entrance |
|---|---|---|---|---|
| 1 | 0.000–0.175 | feed starts falling, cold | ちょっとだけ、のつもりだった。 | drift-down |
| 2 | 0.235–0.415 | feed accelerating, colour draining | 気づいたら、2時間。 | word-punch, 「2時間」emphasised |
| 3 | 0.470–0.660 | the paw sweeps in, the feed stops dead | 止めてくれたのは、意志じゃなかった。 | scatter |
| 4 | 0.750–1.000 | warm room, うちの子 sitting, at rest | おかえり。 / SNSの使いすぎを、うちの子が止める。/ 無料で使ってみる | word-by-word rise, staged settle |

Plateaus land at 91vh / 94vh / 99vh / 138vh. Starting points, validated by the flick test.
Text lives in the left half the whole way; the action lane (feed, paw, cat) stays clear on the right.

## 5. Static-hero copy block (phones, reduced motion)
Headline: おかえり。
Subline: SNSの使いすぎを、うちの子が止めてくれる Chrome 拡張。
CTA: 無料で使ってみる

## 6. Below-fold outline (every section funnels to #install)
1. **解除ボタン** — the objection, answered first. Two cards: 普通のブロッカー（「あとで」が押せる）/ うちの子（押せない）.
2. **しくみ** — three steps, each with a real product screenshot. Equal treatment, no step without an image.
3. **休憩してみる** — the one interactive moment. Press and hold; the pet rises over a mock feed and the break completes. Release early and it eases back down. Reduced motion gets the finished state.
4. **プライバシー** — 写真は端末から出ない。chrome.storage.local のみ。外部送信ゼロ。
5. **対応サイト** — the ten domains the extension actually watches.
6. **FAQ** — the four real objections found in research.
7. **#install** — the single call to action, plus the notify form.
8. **Footer** — no fictional-brand disclosure needed; the product is real. One honest line about the artwork.

Form microcopy: label メールアドレス / placeholder you@example.com / button 知らせてもらう /
success 登録しました。公開したらすぐ連絡します。
Handling on a static site: **JS-only success state** for now. Nothing is sent anywhere.
This is flagged to the owner, and swaps to a form service the moment they hand over an endpoint.

## 7. Vector layer plan
Hand-drawn SVG only, no libraries: the paw mark (favicon, nav, section dividers), a
self-drawing connector line down the しくみ steps, a soft dashed arc under the settle CTA,
and whisper-level drifting motes on one fixed background layer. All honor reduced motion:
final states shown, drives stopped.

## 8. Engineering list
Blob fetch with progress ring and watchdog; dt-normalised lerp that rests; gated seeks with
the error-path deadlock escape; delta-gated DOM writes; band pacing validated by the flick
test; the legibility system **inverted for dark-on-light footage** (light veil scrims, audit
measures the darkest pixel); five static-hero gates kept live with change listeners;
complete-without-video; the full quality floor.

## 9. Copy gate
Every line above ships verbatim. The built page must pass the Phase 9 grep gate before
anyone sees it: zero em dashes, zero stock words, plus the AI-tell sweep. Deliberate brand
devices stay: 「押せる。／押せない。」 is a designed pair, not a drift.
