'use strict';

// スラッシュコマンドを Discord に登録するスクリプト。
// 使い方: npm run deploy
const { registerCommands } = require('./register-commands');

(async () => {
  try {
    const result = await registerCommands();
    if (result.scope === 'guild') {
      console.log(`[deploy] ギルド(${result.guildId})にコマンドを登録しました: ${result.names.join(', ')}`);
    } else {
      console.log(`[deploy] グローバルにコマンドを登録しました（反映に最大1時間）: ${result.names.join(', ')}`);
    }
  } catch (error) {
    console.error('[deploy] コマンド登録に失敗しました:', error);
    process.exit(1);
  }
})();
