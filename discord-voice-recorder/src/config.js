'use strict';

require('dotenv').config();

const path = require('path');

const { DISCORD_TOKEN, CLIENT_ID, GUILD_ID, AUTO_RECORD, AUTO_RECORD_CHANNEL_ID, SILENCE_TIMEOUT_MINUTES } = process.env;

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
  // 人がVCに入った瞬間に自動で録音を開始するか。
  autoRecord: String(AUTO_RECORD).toLowerCase() === 'true',
  // 自動録音の対象チャンネルを限定したい場合のVCチャンネルID（未設定なら全VC対象）。
  autoRecordChannelId: AUTO_RECORD_CHANNEL_ID || null,
  // 無音がこの分数続いたら自動停止（0 または未設定で無効）。
  silenceTimeoutMs: Math.max(0, Number(SILENCE_TIMEOUT_MINUTES) || 0) * 60 * 1000,
};
