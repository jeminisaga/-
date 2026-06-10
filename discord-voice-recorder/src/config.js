'use strict';

require('dotenv').config();

const path = require('path');

const { DISCORD_TOKEN, CLIENT_ID, GUILD_ID } = process.env;

if (!DISCORD_TOKEN) {
  console.error('[config] DISCORD_TOKEN が未設定です。.env を確認してください。');
  process.exit(1);
}
if (!CLIENT_ID) {
  console.error('[config] CLIENT_ID が未設定です。.env を確認してください。');
  process.exit(1);
}

module.exports = {
  token: DISCORD_TOKEN,
  clientId: CLIENT_ID,
  // 未設定なら null（グローバルコマンドとして登録）。
  guildId: GUILD_ID || null,
  // 録音ファイルの出力先。
  recordingsDir: path.join(__dirname, '..', 'recordings'),
};
