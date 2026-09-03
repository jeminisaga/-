# Claude Code への入れ方

このフォルダごと Claude Code の Skills ディレクトリに置く。

## 個人スキル（全プロジェクトで使う）

```bash
mkdir -p ~/.claude/skills
cp -R gemini-video ~/.claude/skills/gemini-video
chmod +x ~/.claude/skills/gemini-video/scripts/analyze.py
pip3 install -U google-genai
```

## プロジェクトスキル（そのリポジトリだけ）

```bash
mkdir -p .claude/skills
cp -R gemini-video .claude/skills/gemini-video
chmod +x .claude/skills/gemini-video/scripts/analyze.py
pip3 install -U google-genai
```

## APIキー

https://aistudio.google.com/apikey で取得し、シェルかプロジェクトの `.env` に置く。

```bash
export GEMINI_API_KEY="your-key"
```

スクリプトは以下の順で `.env` を探す（既存の環境変数が優先）:
カレント → その親ディレクトリ（5階層まで）→ ホーム → スキルディレクトリ。

`.env` は `.gitignore` に入れること。キーをチャットに貼らない。

任意:

```bash
export GEMINI_VIDEO_MODEL="gemini-3.7-flash"   # 既定値。通常は不要
```

## 動作確認

```bash
python3 ~/.claude/skills/gemini-video/scripts/analyze.py --self-check --live
```

`--live` を付けると API に実際に疎通し、モデルが使えるかまで確認する。全て `ok:` なら準備完了。

```
ok: google-genai (2.22.0)
ok: API key (…abcd)
ok: API 疎通（58 models）
ok: gemini-3.7-flash
```

## 使い方

Claude Code では `/gemini-video` で呼べる。自然文でも「このYouTube分析して」で Skill が載る。

CLI から直接叩く場合:

```bash
python3 ~/.claude/skills/gemini-video/scripts/analyze.py --help
```

## CLAUDE.md に1行足す場合

```
YouTubeや動画の分解は gemini-video スキルを使い、同梱の analyze.py を実行する。
```

## トラブル

| 症状 | 対応 |
|---|---|
| `google-genai が未インストール` | `pip3 install -U google-genai` |
| `APIキーが無効です` | キーを再発行。`--self-check --live` で確認 |
| 全モデルが `--` になる | そのAPIキーのプロジェクトでモデルが有効化されていない |
| ローカル動画が 2GB を超える | 分割するか `--start/--end` で切り出す |
