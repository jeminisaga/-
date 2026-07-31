# Seminar Bot 🎥

Googleカレンダーの予定を見て、時間になったらオンラインセミナー（Google Meet / Zoom）に
**自動で参加 → 録画 → 終了したら退出 → 文字起こし**するローカル常駐ボット。

- 動作環境: **自分のWindows PC 常時起動**（追加費用ほぼゼロ）
- 録画方式: Playwright で拡張入りChromiumを起動し、拡張の offscreen document が
  `getDisplayMedia` でタブを録画 → localhost の受け口へ webm をPOST
- 文字起こし: **whisper.cpp（ローカル・無料・オフライン）**

> ⚠️ **利用上の注意**: Botが黙って参加・録画する行為は、主催者の利用規約や録音の同意ルールに
> 触れる場合があります。**録画が許可されたセミナーに限定**して使ってください。Zoom はBot参加を
> 規約で禁止しており（2026/3以降さらに厳格化）、CAPTCHAが出た場合の自動突破は行いません。

---

## 現在のステータス: Phase 0（録画パイプラインの検証）完了 ✅

「そもそもタブ録画→保存が成立するか」という一番きわどい部分を、Google Meetログイン無しで
検証するスパイクを実装済み。自前で音声+映像を出すテストページを録画対象にします。

### 構成（Phase 0）

```
seminar-bot/
  extension/            録画専用の同梱MV3拡張
    manifest.json
    service_worker.js   orchestrator と WebSocket で接続し start/stop を中継
    offscreen.html
    offscreen.js        getDisplayMedia + MediaRecorder + blobをPOST
  spike/
    testpage.html       録画対象のテスト映像(canvas)+音(440Hzトーン)
    spike.mjs           orchestrator: サーバ起動→Chromium起動→10秒録画→保存→検証
  output/recordings/    保存先（gitignore）
```

### 動かし方（あなたのWindows PCで）

```powershell
cd seminar-bot
npm install
npx playwright install chromium   # 初回のみ。ブラウザを取得

# 音声も録る本番相当のテスト（Windowsなら音声もキャプチャ可）
$env:CAPTURE_AUDIO="1"; npm run spike
```

成功すると `output/recordings/spike.webm` が生成され、ログの最後に
`PASS: got a valid, non-trivial webm recording` と出ます。生成された webm を再生して、
動く映像とトーン音が入っていれば録画パイプラインはOKです。

### この環境（Linux CI）での検証結果

CIコンテナには GPU/オーディオが無いため、実際の画面キャプチャ（フレーム生成）と音声取得は
`NotReadableError: Could not start video source/audio source` になります（これはハードウェア制約で、
コード側の問題ではありません）。そこで CI 検証用に `SELFTEST=1` を用意し、実キャプチャが使えない時だけ
合成ストリーム（canvasの映像）に切り替えて **encode→POST→保存→検証** の経路を確認しています。

```bash
# Linux/CIでの検証（合成ストリームでパイプラインだけ確認）
CHROMIUM_PATH=/path/to/chrome SELFTEST=1 xvfb-run -a node spike/spike.mjs
# => saved 42715 bytes -> output/recordings/spike.webm
# => ffmpeg: Video: vp9, 320x240, 15.17 fps
# => PASS
```

検証済みの項目:
- Playwright起動のChromiumに拡張が読み込まれる
- Service worker ↔ orchestrator の WebSocket 制御チャネルが双方向で動く
- offscreen document 生成 → `getDisplayMedia` 呼び出し → 自動選択フラグでソース解決
- MediaRecorder が有効な VP9 webm を生成
- webm を localhost へPOST → ディスク保存 → マジックバイト + ffmpeg デコードで妥当性確認

**要・実機確認（Windows PC）**: 実際の Meet タブの映像・**音声**キャプチャ。CIでは物理的に不可のため、
Windowsで `CAPTURE_AUDIO=1 npm run spike` を一度実行して音声入りwebmが録れることを確認してください。

---

## この先の予定

- **Phase 1**: Googleカレンダー連携 → 時間になったらMeetに自動参加（カメラ/マイクOFF）→ 録画 →
  多層の終了検知で退出 → whisper.cpp で日本語文字起こし
- **Phase 2**: Zoom ベストエフォート対応、デスクトップ通知、要約フック、常駐サービス化

### Windows 常時起動メモ
- 電源オプションで **スリープを「なし」** に。**画面ロック中は録画が止まる**場合があるため注意。
- Botはヘッド付きChromiumを起動するので、Windowsにログインした状態のセッションが必要。
