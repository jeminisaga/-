# デプロイ手順（どこでも常時稼働させる）

このBotは Discord のゲートウェイ＋音声に常時つなぐ**常駐プロセス**です。サーバーレス（Lambda 等）には向かないので、
「24時間動くホストでコンテナとして動かす」のが基本です。Docker さえ動けばどこでも同じように動きます。

---

## 0. 事前準備（どのサーバーでも使えるように）

1. **グローバルコマンドにする** → `.env` の `GUILD_ID` は**空**にする（特定サーバー限定ではなく全サーバーで `/record` が使えるようになります。反映に最大1時間）。
2. **起動時に自動登録** → `REGISTER_COMMANDS_ON_START=true` にしておくと、ホスト上で `npm run deploy` を別途流さなくても起動時にコマンド登録されます。
3. **誰でも招待できる招待URL**（`CLIENT_ID` を差し替え）:
   ```
   https://discord.com/oauth2/authorize?client_id=CLIENT_ID&permissions=3148800&scope=bot%20applications.commands
   ```
   入れたいサーバーごとにこのURLから追加します（サーバーの「管理」権限が必要）。

> ⚠️ **録音ファイルの永続化**: コンテナのファイルシステムは再起動で消えます。`recordings/` は必ず
> 永続ボリュームにマウントしてください（各手順に記載）。本命は「録音 → STT に流して外部保存」なので、
> 長期保存はそちらに寄せる設計が安全です。

---

## A. Docker（自分のPC / どんなVPSでも）

```bash
cd discord-voice-recorder
cp .env.example .env          # 値を埋める（GUILD_ID は空、REGISTER_COMMANDS_ON_START=true 推奨）
docker build -t discord-voice-recorder .
docker run -d --name dvr \
  --restart unless-stopped \
  --env-file .env \
  -e REGISTER_COMMANDS_ON_START=true \
  -v "$(pwd)/recordings:/app/recordings" \
  discord-voice-recorder
docker logs -f dvr            # 「ログインしました」が出れば成功
```

## B. docker-compose（VPS におすすめ・一番ラク）

`docker-compose.yml` を同梱しています。VPS（さくら / ConoHa / Hetzner / EC2 など）に Docker を入れて：

```bash
git clone -b claude/discord-voice-recorder-7sde9z https://github.com/jeminisaga/-.git
cd -/discord-voice-recorder
cp .env.example .env          # 値を埋める
docker compose up -d --build
docker compose logs -f
```

更新時は `git pull && docker compose up -d --build` だけ。再起動後も `restart: unless-stopped` で自動復帰します。

## C. Railway

1. Railway で **New Project → Deploy from GitHub repo** を選択
2. ルートディレクトリを `discord-voice-recorder` に設定（Dockerfile を自動検出）
3. **Variables** に `.env` の中身を登録（`DISCORD_TOKEN`, `CLIENT_ID`, `REGISTER_COMMANDS_ON_START=true` など。`GUILD_ID` は空）
4. **Volume** を追加し、マウント先を `/app/recordings` に設定（永続化）
5. Deploy → Logs で起動確認

## D. Fly.io

`fly.toml` を同梱しています（`app` 名とリージョンは自分用に変更）。

```bash
cd discord-voice-recorder
fly launch --no-deploy            # 既存の fly.toml を使う
fly volumes create recordings --size 1 --region nrt
fly secrets set DISCORD_TOKEN=xxx CLIENT_ID=xxx REGISTER_COMMANDS_ON_START=true
fly deploy
fly logs
```

## E. 素の VPS + systemd（Docker を使いたくない場合）

```bash
# Node 20 と build-essential, python3, ffmpeg を入れてから
cd /opt && git clone -b claude/discord-voice-recorder-7sde9z https://github.com/jeminisaga/-.git dvr
cd dvr/discord-voice-recorder && npm install --omit=dev && cp .env.example .env  # 値を埋める
```

`/etc/systemd/system/dvr.service`:

```ini
[Unit]
Description=Discord Voice Recorder
After=network-online.target

[Service]
WorkingDirectory=/opt/dvr/discord-voice-recorder
EnvironmentFile=/opt/dvr/discord-voice-recorder/.env
ExecStart=/usr/bin/node src/index.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload && sudo systemctl enable --now dvr
journalctl -u dvr -f
```

---

## 動作確認

1. Bot を入れたサーバーの VC に自分が入る
2. `/record`（または `AUTO_RECORD=true` なら入室で自動開始）
3. 喋ると `recordings/` に `.ogg` が増える
4. 全員退出 or 無音タイマーで自動停止

## よくある詰まり

- **コマンドが出ない** → `REGISTER_COMMANDS_ON_START=true` で起動したか、招待に `applications.commands` が付いているか。グローバルは反映に最大1時間。
- **再起動で録音が消える** → `recordings/` をボリュームにマウントしているか確認。
- **ビルドで `@discordjs/opus` がコケる** → Docker を使えば回避できます（builder ステージで必要ツールを同梱済み）。
