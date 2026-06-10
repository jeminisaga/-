'use strict';

const fs = require('fs');
const path = require('path');
const { pipeline } = require('stream');
const prism = require('prism-media');
const {
  joinVoiceChannel,
  getVoiceConnection,
  EndBehaviorType,
  VoiceConnectionStatus,
  entersState,
} = require('@discordjs/voice');
const { recordingsDir } = require('./config');

// guildId -> セッション情報 のマップ。1サーバーにつき1録音まで。
const sessions = new Map();

// ファイル名に使えない文字を潰す。
function safeName(name) {
  return String(name).replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 40) || 'unknown';
}

// 録音セッションの開始時刻をフォルダ名/接頭辞に使う（例: 2026-06-10T12-30-00）。
function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
}

// 話者ひとり分の Opus ストリームを購読し、.ogg として書き出す。
function createListeningStream(session, userId, client) {
  // 既に同じユーザーを録音中なら二重購読しない。
  if (session.activeUsers.has(userId)) return;
  session.activeUsers.add(userId);

  const receiver = session.connection.receiver;
  const opusStream = receiver.subscribe(userId, {
    end: {
      // 一定時間（1秒）無音が続いたらそのチャンクの録音を区切る。
      behavior: EndBehaviorType.AfterSilence,
      duration: 1000,
    },
  });

  const oggStream = new prism.opus.OggLogicalBitstream({
    opusHead: new prism.opus.OpusHead({ channelCount: 2, sampleRate: 48000 }),
    pageSizeControl: { maxPackets: 10 },
  });

  const user = client.users.cache.get(userId);
  const label = safeName(user ? user.username : userId);
  const filename = path.join(session.dir, `${Date.now()}_${label}.ogg`);
  const out = fs.createWriteStream(filename);

  pipeline(opusStream, oggStream, out, (err) => {
    session.activeUsers.delete(userId);
    if (err) {
      console.error(`[recorder] 書き出し失敗 (${label}):`, err.message);
    } else {
      session.files.push(filename);
      console.log(`[recorder] 保存しました: ${path.relative(process.cwd(), filename)}`);
    }
  });
}

// 録音を開始する。channel はユーザーが参加中の VoiceChannel。
async function startRecording(channel, textChannel, client) {
  const guildId = channel.guild.id;
  if (sessions.has(guildId)) {
    throw new Error('このサーバーでは既に録音中です。先に /stop してください。');
  }

  const connection = joinVoiceChannel({
    channelId: channel.id,
    guildId,
    adapterCreator: channel.guild.voiceAdapterCreator,
    // 音声を受信するには selfDeaf を必ず false にする（ここが空ファイルになる定番のハマりどころ）。
    selfDeaf: false,
    selfMute: true,
  });

  // 接続が確立するまで待つ（失敗したら片付ける）。
  try {
    await entersState(connection, VoiceConnectionStatus.Ready, 20_000);
  } catch (err) {
    connection.destroy();
    throw new Error('ボイスチャンネルへの接続に失敗しました。');
  }

  // 出力先フォルダをセッションごとに作る。
  const dir = path.join(recordingsDir, `${timestamp()}_${safeName(channel.name)}`);
  fs.mkdirSync(dir, { recursive: true });

  const session = {
    guildId,
    channelId: channel.id,
    textChannelId: textChannel ? textChannel.id : null,
    connection,
    dir,
    activeUsers: new Set(),
    files: [],
  };
  sessions.set(guildId, session);

  // 誰かが喋り始めるたびにその人専用の録音ストリームを起こす。
  const receiver = connection.receiver;
  receiver.speaking.on('start', (userId) => {
    createListeningStream(session, userId, client);
  });

  // 切断されたら後始末。
  connection.on(VoiceConnectionStatus.Disconnected, () => {
    stopRecording(guildId);
  });

  console.log(`[recorder] 録音開始: ${channel.name} (${channel.id}) -> ${path.relative(process.cwd(), dir)}`);
  return session;
}

// 録音を停止し、接続を破棄する。戻り値は保存件数など。
function stopRecording(guildId) {
  const session = sessions.get(guildId);
  if (!session) return null;

  sessions.delete(guildId);

  try {
    const connection = getVoiceConnection(guildId) || session.connection;
    if (connection) connection.destroy();
  } catch (err) {
    console.error('[recorder] 切断時エラー:', err.message);
  }

  console.log(`[recorder] 録音停止: guild=${guildId}, ファイル数=${session.files.length}`);
  return {
    dir: session.dir,
    fileCount: session.files.length,
    textChannelId: session.textChannelId,
    channelId: session.channelId,
  };
}

function getSession(guildId) {
  return sessions.get(guildId) || null;
}

module.exports = {
  startRecording,
  stopRecording,
  getSession,
};
