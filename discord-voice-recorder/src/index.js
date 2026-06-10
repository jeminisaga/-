'use strict';

const { Client, GatewayIntentBits, Events, ChannelType } = require('discord.js');
const { token } = require('./config');
const { startRecording, stopRecording, getSession } = require('./recorder');

const client = new Client({
  // 特権インテントは不要。Guilds と GuildVoiceStates だけで動く。
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
});

client.once(Events.ClientReady, (c) => {
  console.log(`[bot] ログインしました: ${c.user.tag}`);
});

// ── スラッシュコマンド処理 ──
client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === 'record') {
    await handleRecord(interaction);
  } else if (interaction.commandName === 'stop') {
    await handleStop(interaction);
  }
});

async function handleRecord(interaction) {
  const member = interaction.member;
  const voiceChannel = member && member.voice ? member.voice.channel : null;

  if (!voiceChannel) {
    await interaction.reply({
      content: '先にボイスチャンネルに参加してから /record を実行してください。',
      ephemeral: true,
    });
    return;
  }

  if (getSession(interaction.guildId)) {
    await interaction.reply({
      content: '既に録音中です。停止するには /stop を使ってください。',
      ephemeral: true,
    });
    return;
  }

  // 接続に少し時間がかかるので defer しておく。
  await interaction.deferReply();

  try {
    await startRecording(voiceChannel, interaction.channel, client);
    await interaction.editReply(
      `🔴 **${voiceChannel.name}** の録音を開始しました。話者ごとに .ogg で保存します。\n` +
        '全員が退出すると自動で停止・退出します（手動停止は /stop）。'
    );
  } catch (err) {
    console.error('[bot] /record 失敗:', err);
    await interaction.editReply(`録音を開始できませんでした: ${err.message}`);
  }
}

async function handleStop(interaction) {
  const result = stopRecording(interaction.guildId);
  if (!result) {
    await interaction.reply({
      content: 'このサーバーでは現在録音していません。',
      ephemeral: true,
    });
    return;
  }
  await interaction.reply(
    `⏹️ 録音を停止しました。${result.fileCount} 件のファイルを保存しました。`
  );
}

// ── 自動停止: VC からボット以外が全員いなくなったら停止・退出 ──
client.on(Events.VoiceStateUpdate, (oldState, newState) => {
  const guildId = (oldState.guild || newState.guild).id;
  const session = getSession(guildId);
  if (!session) return;

  // 録音中のチャンネルに関係する変化だけ見る。
  const channel = oldState.guild.channels.cache.get(session.channelId);
  if (!channel || channel.type !== ChannelType.GuildVoice) return;

  const humans = channel.members.filter((m) => !m.user.bot).size;
  if (humans > 0) return;

  // ボットだけになった → 自動停止。
  const result = stopRecording(guildId);
  if (!result) return;

  console.log(`[bot] VCが空になったため自動停止: guild=${guildId}`);
  if (result.textChannelId) {
    const textChannel = client.channels.cache.get(result.textChannelId);
    if (textChannel && textChannel.isTextBased()) {
      textChannel
        .send(`⏹️ VCが空になったので録音を自動停止しました。${result.fileCount} 件のファイルを保存しました。`)
        .catch(() => {});
    }
  }
});

// ── 異常終了時のクリーンアップ ──
function shutdown() {
  console.log('[bot] 終了処理中...');
  for (const guild of client.guilds.cache.values()) {
    stopRecording(guild.id);
  }
  client.destroy();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

client.login(token);
