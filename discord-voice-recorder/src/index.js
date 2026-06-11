'use strict';

const { Client, GatewayIntentBits, Events, ChannelType } = require('discord.js');
const { token, autoRecord, autoRecordChannelId } = require('./config');
const { startRecording, stopRecording, getSession } = require('./recorder');

const client = new Client({
  // 特権インテントは不要。Guilds と GuildVoiceStates だけで動く。
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
});

client.once(Events.ClientReady, (c) => {
  console.log(`[bot] ログインしました: ${c.user.tag}`);
  if (autoRecord) {
    const target = autoRecordChannelId ? `チャンネルID=${autoRecordChannelId}` : '全VC';
    console.log(`[bot] 自動録音モード: ON（対象: ${target}）`);
  } else {
    console.log('[bot] 自動録音モード: OFF（/record で手動開始）');
  }
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

// ── 自動開始 / 自動停止: VC の入退室を監視 ──
client.on(Events.VoiceStateUpdate, async (oldState, newState) => {
  const guild = newState.guild || oldState.guild;
  const guildId = guild.id;
  const session = getSession(guildId);

  // 録音中でなければ、自動録音モード時のみ「入室による自動開始」を検討する。
  if (!session) {
    if (autoRecord) await maybeAutoStart(oldState, newState);
    return;
  }

  // 録音中 → ボット以外が全員いなくなったら自動停止。
  const channel = guild.channels.cache.get(session.channelId);
  if (!channel || channel.type !== ChannelType.GuildVoice) return;

  const humans = channel.members.filter((m) => !m.user.bot).size;
  if (humans > 0) return;

  const result = stopRecording(guildId);
  if (!result) return;

  console.log(`[bot] VCが空になったため自動停止: guild=${guildId}`);
  notifyTextChannel(
    result.textChannelId,
    `⏹️ VCが空になったので録音を自動停止しました。${result.fileCount} 件のファイルを保存しました。`
  );
});

// 人がVCに入った瞬間に自動で入室・録音開始する。
async function maybeAutoStart(oldState, newState) {
  const member = newState.member;
  // ボット自身の入退室や、入室イベント以外（ミュート切替など）は無視。
  if (!member || member.user.bot) return;
  if (!newState.channelId || oldState.channelId === newState.channelId) return;

  // 対象チャンネルを限定している場合はそれ以外を無視。
  if (autoRecordChannelId && newState.channelId !== autoRecordChannelId) return;

  const channel = newState.channel;
  if (!channel || channel.type !== ChannelType.GuildVoice) return;

  // 既に Bot が録音中なら何もしない（同時多重防止）。
  if (getSession(channel.guild.id)) return;

  try {
    // 通知先はそのサーバーのシステムチャンネル（無ければ通知なし）。
    await startRecording(channel, channel.guild.systemChannel, client);
    console.log(`[bot] 入室を検知して自動録音開始: ${channel.name} (${channel.id})`);
    notifyTextChannel(
      channel.guild.systemChannel ? channel.guild.systemChannel.id : null,
      `🔴 ${member.user.username} さんの入室を検知し、**${channel.name}** の録音を自動開始しました。`
    );
  } catch (err) {
    console.error('[bot] 自動録音の開始に失敗:', err.message);
  }
}

// 指定テキストチャンネルへメッセージを送る（送れなければ黙ってスキップ）。
function notifyTextChannel(channelId, content) {
  if (!channelId) return;
  const textChannel = client.channels.cache.get(channelId);
  if (textChannel && textChannel.isTextBased()) {
    textChannel.send(content).catch(() => {});
  }
}

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
