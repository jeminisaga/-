# 🎙️ Discord Voice Recorder

参加中のボイスチャンネル（VC）を **話者ごとに `.ogg` ファイルで録音** する Discord Bot です。
あとで文字起こし（STT）パイプラインに流し込みやすい形で保存します。

## 特徴

- **`/record`** ── 実行した人が参加中の VC に Bot が入り、録音を開始
- **入室で自動開始（任意）** ── `AUTO_RECORD=true` にすると、誰かが VC に入った瞬間に Bot が自動入室して録音開始（`/record` 不要）
- **話者ごとに分割** ── 喋った人ごとに `.ogg` を保存（`recordings/<日時_チャンネル名>/` 配下）
- **自動停止（全員退出）** ── `voiceStateUpdate` を監視し、Bot 以外の人数が 0 になった瞬間に録音停止＆退出
- **自動停止（無音タイマー・任意）** ── `SILENCE_TIMEOUT_MINUTES` で指定した分数だけ発話が無ければ自動停止＆退出
- **`/stop`** ── 手動でいつでも停止
- **特権インテント不要** ── `Guilds` と `GuildVoiceStates` だけで動くので Developer Portal 側の設定が最小限

## 必要環境

- Node.js 18 以上
- ネイティブモジュール（`@discordjs/opus` など）のビルドに以下が必要な場合があります
  - macOS: `xcode-select --install`
  - Linux: `build-essential`, `python3`
  - Windows: `windows-build-tools` 相当のビルド環境

## セットアップ

### 1. 依存関係のインストール

```bash
cd discord-voice-recorder
npm install
```

### 2. Discord アプリケーションの作成

1. [Discord Developer Portal](https://discord.com/developers/applications) で **New Application**
2. 左メニュー **Bot** → **Reset Token** でトークンを取得
3. **General Information** の **Application ID** を控える
4. 特権インテント（Presence / Server Members / Message Content）は **OFF のままで OK**

### 3. 環境変数の設定

`.env.example` をコピーして `.env` を作り、値を埋めます。

```bash
cp .env.example .env
```

```dotenv
DISCORD_TOKEN=あなたのBotトークン
CLIENT_ID=あなたのApplication ID
GUILD_ID=テスト用サーバーのID          # 任意。設定するとコマンドが即時反映されます
AUTO_RECORD=true                       # 任意。VCに人が入った瞬間に自動録音開始
AUTO_RECORD_CHANNEL_ID=                # 任意。対象VCを1つに絞りたい時だけそのチャンネルID
SILENCE_TIMEOUT_MINUTES=5              # 任意。N分間 発話が無ければ自動停止（0で無効）
```

### 無音での自動停止について

`SILENCE_TIMEOUT_MINUTES` に分数を入れると、**その時間だけ誰も喋らなければ録音を自動停止して退出**します（0 や未設定なら無効）。
「会議は実質終わったのに人が残っていて、全員退出の自動停止が効かない」ケースの保険になります。
判定は「最後に誰かが喋った時刻」から計測し、15 秒ごとにチェックします。

### 自動録音モードについて

`AUTO_RECORD=true` にすると、`/record` を打たなくても **誰かが VC に入った瞬間に Bot が自動入室して録音を開始**します。
全員が抜ければ従来どおり自動停止・退出します。

- `AUTO_RECORD_CHANNEL_ID` を設定すると、その VC に入った時だけ自動録音します（未設定なら全 VC が対象）。
- 自動開始の通知はサーバーの「システムメッセージチャンネル」に送られます（設定が無ければ通知なし・録音は動作します）。

### 4. Bot をサーバーに招待

OAuth2 URL に以下を含めて招待します。

- **Scopes**: `bot`, `applications.commands`
- **Bot Permissions**: `View Channels`, `Connect`, `Speak`, `Send Messages`

例（`CLIENT_ID` を置き換え）:

```
https://discord.com/oauth2/authorize?client_id=CLIENT_ID&permissions=3148800&scope=bot%20applications.commands
```

### 5. スラッシュコマンドを登録

```bash
npm run deploy
```

`GUILD_ID` を設定していればそのサーバーで即時反映、未設定ならグローバル登録（反映に最大1時間）。

### 6. Bot を起動

```bash
npm start
```

`[bot] ログインしました: ...` が出れば成功です。

## デプロイ（24時間・どのサーバーでも使う）

常時稼働させて複数サーバーで使うには Docker でホストに載せるのが確実です。手順は **[DEPLOY.md](./DEPLOY.md)** を参照（Docker / docker-compose / Railway / Fly.io / systemd を網羅）。要点だけ：

- `GUILD_ID` を空にするとグローバルコマンドになり、**どのサーバーでも** `/record` が使えます（反映に最大1時間）。
- `REGISTER_COMMANDS_ON_START=true` で起動時にコマンドを自動登録（ホスト側で別途 `npm run deploy` 不要）。
- `recordings/` は永続ボリュームにマウントして保存（コンテナ再起動で消えるため）。

最短（docker-compose）:

```bash
cp .env.example .env   # 値を埋める
docker compose up -d --build
```

## 使い方

1. 録音したい VC に**自分が参加**する
2. テキストチャンネルで **`/record`** を実行 → Bot が VC に入って録音開始
3. 普通に会話する（喋った人ごとに `.ogg` が増えていきます）
4. 全員が VC から抜けると **自動で停止・退出**（手動なら `/stop`）

録音ファイルは `recordings/<開始日時_チャンネル名>/<タイムスタンプ_ユーザー名>.ogg` に保存されます。

## ハマりどころ

- **録音ファイルが空っぽになる** → Bot が VC に入るとき `selfDeaf: false` でないと音声を一切受信できません。本コードでは設定済みですが、自分で改造する際は注意。
- **コマンドが出てこない** → `npm run deploy` を実行したか、招待時に `applications.commands` スコープを付けたか確認。グローバル登録は反映に時間がかかります。
- **`@discordjs/opus` のインストールでコケる** → ビルドツール（上記「必要環境」）を入れてから `npm install` し直してください。

## ファイル構成

```
discord-voice-recorder/
├── package.json
├── .env.example
├── README.md
├── recordings/            # 録音出力先（.gitignore 済み）
└── src/
    ├── config.js          # .env 読み込み・検証
    ├── commands.js        # スラッシュコマンド定義
    ├── deploy-commands.js # コマンド登録スクリプト（npm run deploy）
    ├── recorder.js        # 録音ロジック（話者ごとの .ogg 書き出し）
    └── index.js           # Bot 本体（コマンド処理・自動停止）
```

## 次の一手（文字起こしパイプライン連携）

`recordings/` 配下の `.ogg` を STT に投げて整形 → Discord / Notion 等へ投稿する自動化が自然な拡張です。
`recorder.js` の `stopRecording()` は保存先 `dir` とファイル数を返すので、停止フックから後処理を呼び出せます。
