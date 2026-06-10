'use strict';

const { SlashCommandBuilder } = require('discord.js');

// 登録するスラッシュコマンドの定義。deploy-commands.js と index.js の両方から参照する。
const commands = [
  new SlashCommandBuilder()
    .setName('record')
    .setDescription('あなたが参加中のボイスチャンネルの録音を開始します（話者ごとに .ogg 保存）。'),
  new SlashCommandBuilder()
    .setName('stop')
    .setDescription('録音を停止してボイスチャンネルから退出します。'),
];

module.exports = {
  commands,
  // REST 登録用に JSON 化した配列。
  commandsJSON: commands.map((c) => c.toJSON()),
};
