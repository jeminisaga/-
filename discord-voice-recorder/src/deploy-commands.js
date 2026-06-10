'use strict';

// スラッシュコマンドを Discord に登録するスクリプト。
// 使い方: npm run deploy
const { REST, Routes } = require('discord.js');
const { token, clientId, guildId } = require('./config');
const { commandsJSON } = require('./commands');

const rest = new REST({ version: '10' }).setToken(token);

(async () => {
  try {
    if (guildId) {
      // ギルド限定登録 ── 反映が即時なので開発向き。
      await rest.put(Routes.applicationGuildCommands(clientId, guildId), {
        body: commandsJSON,
      });
      console.log(`[deploy] ギルド(${guildId})にコマンドを登録しました: ${commandsJSON.map((c) => '/' + c.name).join(', ')}`);
    } else {
      // グローバル登録 ── 全サーバーで使えるが反映に最大1時間。
      await rest.put(Routes.applicationCommands(clientId), {
        body: commandsJSON,
      });
      console.log(`[deploy] グローバルにコマンドを登録しました（反映に最大1時間）: ${commandsJSON.map((c) => '/' + c.name).join(', ')}`);
    }
  } catch (error) {
    console.error('[deploy] コマンド登録に失敗しました:', error);
    process.exit(1);
  }
})();
