'use strict';

// スラッシュコマンド登録の共通ロジック。
// deploy-commands.js（CLI）と index.js（起動時オプション）の両方から使う。
const { REST, Routes } = require('discord.js');
const { token, clientId, guildId } = require('./config');
const { commandsJSON } = require('./commands');

async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(token);
  const names = commandsJSON.map((c) => '/' + c.name);

  if (guildId) {
    // ギルド限定登録 ── 反映が即時なので開発向き。
    await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: commandsJSON });
    return { scope: 'guild', guildId, names };
  }
  // グローバル登録 ── 全サーバーで使えるが反映に最大1時間。
  await rest.put(Routes.applicationCommands(clientId), { body: commandsJSON });
  return { scope: 'global', names };
}

module.exports = { registerCommands };
