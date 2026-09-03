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

https://aistudio.google.com/apikey で取得する。

### 推奨: このスキルの中だけで使う

スキルディレクトリ直下に `.env` を置く。`analyze.py` の実行時にだけ読まれ、シェルにも他のプロセスにも公開されない。

```bash
cd ~/.claude/skills/gemini-video
cp .env.example .env
# .env を開いて GEMINI_API_KEY= の後ろにキーを貼る
chmod 600 .env
```

カレントディレクトリがどこでも効く。`.gitignore` 済み。

### 全体で使う場合

`~/.claude/settings.json` の `env` ブロック、またはシェルの `export`。
プロジェクト内の `.claude/settings.json` には**書かない**（コミットされる）。

### 探索順

スクリプトは `.env` を次の順で探し、**先に見つかったものが優先**（既存の環境変数が最優先）:
カレント → その親（5階層まで）→ ホーム → スキルディレクトリ。

プロジェクトごとに別のキーを使いたい場合は、そのプロジェクトに `.env` を置けばスキル側の設定を上書きできる。

キーをチャットに貼らない。

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
