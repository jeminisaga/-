@echo off
rem 起動して使うためのワンショット・ランチャー（Windows）。
rem 初回は依存インストールと .env 案内、2回目以降はそのまま起動します。
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js が見つかりません。https://nodejs.org から v18 以上を入れてください。
  pause
  exit /b 1
)

if not exist .env (
  copy .env.example .env >nul
  echo .env を作成しました。DISCORD_TOKEN と CLIENT_ID を記入してから、もう一度実行してください。
  pause
  exit /b 1
)

if not exist node_modules (
  echo 依存関係をインストール中...
  call npm install
)

set REGISTER_COMMANDS_ON_START=true
echo Bot を起動します（停止は Ctrl+C）...
node src/index.js
