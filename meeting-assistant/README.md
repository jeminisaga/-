# 商談リアルタイム・アシスタント（Chrome 拡張）

Zoom（Web版）や Google Meet の商談中に、**相手の発言をリアルタイムで文字起こし**し、
それに対する **切り返し／提案トークの候補** を画面のフローティングパネルに表示する Chrome 拡張です。

> ⚠️ **プライバシー注意**
> 本拡張は会議タブの音声（＝相手の発言）を取得し、文字起こしのため音声認識クラウド
> （OpenAI Whisper または Deepgram）へ、回答候補生成のため Anthropic (Claude) へ送信します。
> **完全ローカルでは動作しません。** 録音・文字起こし・AI解析には相手の同意が必要な場合があります。
> APIキーはこのブラウザのローカル（`chrome.storage.local`）にのみ保存されます。

## しくみ

ブラウザでZoom/Meetを使っている場合、`chrome.tabCapture` で取得できるタブ音声には
**相手（リモート参加者）の声のみ**が含まれます（自分のマイク音声はタブに戻ってこないため）。
これを利用して相手の発言だけを文字起こしします。

```
popup「開始」 → background(SW)
  → chrome.tabCapture.getMediaStreamId
  → offscreen document（getUserMedia + AudioWorkletで16kHz PCM化）
  → STT（OpenAI/Deepgram）で文字起こし
  → background が蓄積・デバウンスして Claude(claude-opus-4-8) を呼び出し
  → content script のオーバーレイに 文字起こし＋回答候補カード を表示
```

MV3 の service worker は DOM/getUserMedia を持てないため、音声処理は **offscreen document** が担います。

## インストール（開発者モード）

1. このリポジトリをクローン
2. Chrome で `chrome://extensions` を開く
3. 右上「デベロッパーモード」を ON
4. 「パッケージ化されていない拡張機能を読み込む」→ `meeting-assistant/` フォルダを選択
5. ツールバーにアイコンが追加されたら成功

## 使い方

1. アイコン → 「詳細設定」で APIキーを設定
   - 音声認識: OpenAI(Whisper) か Deepgram のキー
   - 回答生成: Anthropic (Claude) のキー、モデル `claude-opus-4-8`
   - 「テスト接続」で疎通確認
2. 業種/商材を入力するとプロンプトに反映されます
3. Zoom(Web版)/Meet のタブを開き、popup の「開始」を押す
   - 画面右上にオーバーレイが表示され、相手の発言と回答候補が出ます
   - 相手の声は引き続き聞こえます
4. 「停止」で終了

## ファイル構成

```
manifest.json                 MV3 マニフェスト
src/
  background.js               service worker（オーケストレーション/Claude呼び出し/ルーティング）
  offscreen.html / .js        タブ音声取得 + STT（DOMが必要なため）
  audio/pcm-worklet.js        48kHz→16kHz mono PCM 変換（AudioWorklet）
  content.js / content.css    フローティング・オーバーレイ
  popup.html / .js / .css     開始/停止・状態・クイック設定
  options.html / .js / .css   APIキー等の詳細設定・テスト接続
  lib/
    constants.js              既定設定 / メッセージ種別 / プロバイダ
    storage.js                chrome.storage.local ラッパ
    messaging.js              メッセージング薄ラッパ
    stt/                      STTプロバイダ抽象化（base/openai/deepgram/index）
    llm/                      Claude クライアント（claude/prompt/index）
icons/                        アイコン（仮）
```

## 設計メモ

- プロバイダ（STT/LLM）は差し替え可能。STT 追加 = `lib/stt/` に1ファイル + `index.js` に1分岐。
- APIキー未設定でもクラッシュせず、「APIキーを設定してください」状態で動作します。
- Claude はブラウザから直叩きするため `anthropic-dangerous-direct-browser-access: true` ヘッダを使用。
- `claude-opus-4-8` では `temperature`/`budget_tokens` 等は送らず、構造化出力（`output_config.format`）で
  回答候補を JSON で受け取ります。
- 文字起こし/LLM出力は全て HTML エスケープしてから表示します。

## 既知のリスク / スコープ外

- **Zoom デスクトップアプリは非対応**（ブラウザ拡張はタブ音声しか取得できないため）。Web版が対象。
  Zoom Web版は音声取得が取りこぼす場合があり best-effort。Google Meet を主対象として推奨。
- STT のレイテンシ/コストはプロバイダ依存（ストリーミングは低遅延、チャンクPOSTは安価だが2–4秒遅延）。
- service worker は失効しうるが、offscreen と音声/STT は独立して動作し、セッション状態は
  `chrome.storage.local` にミラーして復元します。

## テスト手順

1. `chrome://extensions` から `meeting-assistant/` を読み込み、manifest エラーが無いこと
2. 詳細設定で STT/Claude キーを入れ、「テスト接続」が OK になること
3. Claudeキーを空にして開始 → オーバーレイが「APIキーを設定してください」を表示（クラッシュしない）
4. Google Meet のテスト通話で既知の発話を流す → 開始 → 文字起こしと回答候補が出ること
5. タブを閉じる/切り替えるとキャプチャが停止すること
