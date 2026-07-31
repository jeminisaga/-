# Seminar Bot 🎥

Googleカレンダーの予定を見て、時間になったらオンラインセミナー（Google Meet / Zoom）に
**自動で参加 → 録画 → 終了したら退出 → 文字起こし**するローカル常駐ボット。

- 動作環境: **自分のWindows PC 常時起動**（追加費用ほぼゼロ）
- 録画: Playwright起動のChromiumに録画拡張を読み込み、`getDisplayMedia` でタブを録画 → localhost保存
- 文字起こし: **whisper.cpp（ローカル・無料・オフライン）**

> ⚠️ **利用上の注意**: Botが黙って参加・録画する行為は、主催者の利用規約や録音の同意ルールに
> 触れる場合があります。**録画が許可されたセミナーに限定**して使ってください。Zoom はBot参加を
> 規約で禁止しており（2026/3以降さらに厳格化）、CAPTCHAが出た場合の自動突破は行いません。
> → **Google Meet が本命（信頼性高）、Zoom は"入れたらラッキー"のベストエフォート**です。

---

## セットアップ（Windows）

### 1. 前提ツール
- [Node.js](https://nodejs.org/) 20+（`node -v` で確認）
- [ffmpeg](https://www.gyan.dev/ffmpeg/builds/)（音声抽出用。PATHを通す）
- [whisper.cpp](https://github.com/ggerganov/whisper.cpp)（文字起こし用。ビルド済みバイナリ + 日本語モデル `ggml-large-v3.bin`）

### 2. インストール
```powershell
cd seminar-bot
npm install
npx playwright install chromium
```

### 3. Googleカレンダーの認証（初回のみ）
1. [Google Cloud Console](https://console.cloud.google.com/) で Calendar API を有効化
2. 「APIとサービス > 認証情報」で **OAuthクライアントID（デスクトップアプリ）** を作成
3. JSONをダウンロードして `config/credentials.json` として保存
4. 認証フローを実行:
   ```powershell
   npm run auth
   ```
   表示されたURLをブラウザで開いて許可 → `config/token.json` が作られます（読み取り専用）

### 4. 設定
`config/config.example.json` を `config/config.json` にコピーして調整:
```powershell
copy config\config.example.json config\config.json
```
主な項目:
- `botDisplayName` … 会議での表示名（例: `録画ボット`。録画中だと分かる名前を推奨）
- `platforms` … `{ "meet": true, "zoom": false }`（Zoomは既定オフ。使うなら true）
- `calendar.titleIncludeKeywords / titleExcludeKeywords` … 対象/除外する予定のタイトル語
- `calendar.onlyEventsWhereIAmInvited` … 自分が招待された予定だけ対象にする
- `transcription.whisperBin / whisperModel` … whisper.cppの実行ファイルとモデルのパス

### 5. 起動
```powershell
npm start
```
このプロセスを常時起動しておくと、カレンダーを定期的に見て、時間になった予定へ自動参加します。
出力は `output/recordings/*.webm`、`output/transcripts/*.txt`、`output/meta/*.json`。

### Windows 常時起動メモ
- 電源オプションで **スリープを「なし」** に。**画面ロック中は録画が止まる**場合があるため注意。
- Botはヘッド付きChromiumを起動するので、Windowsにログインした状態のセッションが必要。
- Meetの信頼性を上げたい場合、初回に起動したChromium（`.chromium-profile`）で **Bot用Googleアカウントに一度ログイン**しておくと、ゲスト制限のある会議にも入りやすくなります。

---

## 動作の流れ

```
カレンダー監視(poll) → 予定の開始 - joinLeadSeconds でスケジュール
  → Chromium起動(拡張入り) → Meet/Zoom参加(カメラ/マイクOFF, 入室許可待ち)
  → 録画開始 → 多層の終了検知(ハードストップ/最大時間/DOM終了/孤立) → 退出
  → 録画をlocalhostへ保存 → ffmpeg + whisper.cpp で文字起こし → meta保存
```

終了検知は「予定の終了時刻+猶予」を**唯一の保証**とし、DOMの終了表示・参加者が自分だけ・最大時間の
各シグナルを併用します。入室が承認されない/Zoomが壁にぶつかった場合は通知して次へ進みます。

---

## プロジェクト構成

```
seminar-bot/
  src/
    index.mjs                 メイン: poll → schedule → 参加/録画/退出/文字起こし
    config.mjs                設定の読み込み・検証・パス解決
    logger.mjs / notify/      ログ・通知
    calendar/
      auth.mjs                Google OAuth デスクトップフロー（npm run auth）
      poll.mjs                予定取得 → 会議へマッピング（フィルタ）
      linkParser.mjs          Meet/Zoomリンク抽出
    scheduler/scheduler.mjs   参加タイミングの決定 + 再起動時catch-up
    browser/
      launch.mjs              拡張入りChromium起動 + キャプチャ用フラグ
      joinMeet.mjs            Meet参加（日本語UI対応セレクタ）
      joinZoom.mjs            Zoom参加（ベストエフォート）
      endDetection.mjs        多層の終了検知
      selectors.mjs           Meetのセレクタ集約（保守はここ）
    recording/recorderServer.mjs  localhost制御 + webm受信・保存
    transcription/transcribe.mjs  ffmpeg音声抽出 + whisper.cpp
  extension/                  録画専用MV3拡張（getDisplayMedia + MediaRecorder）
  spike/                      Phase 0 検証（下記）
  test/                       純ロジックのユニットテスト（node --test）
  config/                     config.json / credentials.json / token.json
  output/                     recordings / transcripts / meta（gitignore）
```

## テスト
純ロジック（リンク抽出・スケジューリング・設定・イベント変換）はユニットテスト済み:
```powershell
npm test        # 23 tests
```

## Phase 0 スパイク（録画パイプライン検証）
Meetログイン無しで「タブ録画→保存」が成立するかを検証するスパイク。自前で音声+映像を出す
テストページを録画対象にします。
```powershell
$env:CAPTURE_AUDIO="1"; npm run spike
# => output/recordings/spike.webm が生成され、末尾に PASS
```
※ GPU/オーディオの無いCI環境では実キャプチャができないため、`SELFTEST=1` で合成ストリームに
切り替えて encode→保存 の経路のみ検証できます（詳細は spike/spike.mjs のコメント参照）。

## この先（Phase 2）
- Zoom対応の強化、デスクトップ通知の充実、AI要約（`transcribe` にフックあり）、常駐サービス化
