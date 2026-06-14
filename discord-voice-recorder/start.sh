#!/usr/bin/env bash
# 起動して使うためのワンショット・ランチャー（Mac / Linux）。
# 初回は依存インストールと .env 案内、2回目以降はそのまま起動します。
set -euo pipefail
cd "$(dirname "$0")"

# Node.js チェック。
if ! command -v node >/dev/null 2>&1; then
  echo "❌ Node.js が見つかりません。https://nodejs.org から v18 以上を入れてください。"
  exit 1
fi

# .env が無ければテンプレからコピーして案内して終了。
if [ ! -f .env ]; then
  cp .env.example .env
  echo "✏️  .env を作成しました。エディタで開いて DISCORD_TOKEN と CLIENT_ID を入力し、"
  echo "    もう一度このスクリプトを実行してください。"
  exit 1
fi

# 依存が未インストールなら入れる。
if [ ! -d node_modules ]; then
  echo "📦 依存関係をインストール中..."
  npm install
fi

# 起動時にスラッシュコマンドを自動登録して起動（npm run deploy 不要）。
export REGISTER_COMMANDS_ON_START=true
echo "🚀 Bot を起動します（停止は Ctrl+C）..."
exec node src/index.js
