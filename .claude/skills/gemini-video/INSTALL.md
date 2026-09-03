# Claude Code への入れ方

このフォルダごと Claude Code の Skills ディレクトリに置く。

## 個人スキル（全プロジェクトで使う）

```bash
mkdir -p ~/.claude/skills
cp -R gemini-video ~/.claude/skills/gemini-video
chmod +x ~/.claude/skills/gemini-video/scripts/analyze.py
pip3 install -U google-genai
```

## Windows

Claude Code を **WSL 上で**使っている場合は、上の Linux/macOS 手順をそのまま WSL 内で実行する（`\\wsl$` 側のホームに入る）。以下は **Windows ネイティブ**の場合。

PowerShell で:

```powershell
# 1. 配置
New-Item -ItemType Directory -Force "$env:USERPROFILE\.claude\skills" | Out-Null
Expand-Archive -Path "$env:USERPROFILE\Downloads\gemini-video-skill.zip" `
               -DestinationPath "$env:USERPROFILE\.claude\skills" -Force

# 2. 依存
python -m pip install -U google-genai

# 3. APIキー
cd "$env:USERPROFILE\.claude\skills\gemini-video"
Copy-Item .env.example .env
notepad .env          # GEMINI_API_KEY= の後ろにキーを貼って保存

# 4. 確認
python scripts\analyze.py --self-check --live
```

配置先は `C:\Users\<ユーザー名>\.claude\skills\gemini-video`。

注意点:

- **`python` が本物とは限らない。** 別アプリが同梱する venv（`AppData\Local\<アプリ名>\venv\Scripts\python.exe`）に乗っ取られていると `No module named pip` になる。`py -3 -c "import sys; print(sys.executable)"` でパスを確認し、`AppData\Local\Python\...` のような本体を指していれば以降すべて `py -3` を使う:

  ```powershell
  py -3 -m pip install -U google-genai
  py -3 scripts\analyze.py --self-check --live
  ```

- `py` も `python` も無い / Microsoft Store が開く場合は https://www.python.org/downloads/ から導入し、**"Add python.exe to PATH"** にチェック。PowerShell を開き直してから再実行。
- コマンドは `python3` ではない。スキル内のコマンド例は macOS/Linux 表記なので読み替える。
- エクスプローラーで `.claude` は隠しフォルダ。アドレスバーに `%USERPROFILE%\.claude\skills` を直接入力すれば開く。
- `.env` をエクスプローラーから新規作成しようとすると名前を拒否されることがある。上記の `Copy-Item` を使うこと。
- `chmod 600` は不要（Windows にはない）。気になる場合はファイルのプロパティ →セキュリティで自分以外のアクセスを外す。
- 出力の文字化け対策はスクリプト側で処理済み（stdout を UTF-8 に固定）。`PYTHONUTF8` の設定は不要。

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

## Python のバージョン

`--self-check --live` に次の行が出たら、Python が古くて SDK も古い版が入っている:

```
--: SDK が古く interactions API / media_processing が未対応。動作はするが agentic 処理は使えない
```

分析自体は動くが、精度とコスト効率の良い agentic 処理が使えない。Python 3.10 以上にすると解消する。

macOS（システムPythonは 3.9 のまま更新されない）:

```bash
brew install python          # 3.13 が入る
python3 --version            # 3.10 以上になっていること
python3 -m pip install -U google-genai
```

Homebrew 未導入なら https://www.python.org/downloads/ から入れてもよい。

## トラブル

| 症状 | 対応 |
|---|---|
| `google-genai が未インストール` | `pip3 install -U google-genai` |
| `APIキーが無効です` | キーを再発行。`--self-check --live` で確認 |
| 全モデルが `--` になる | そのAPIキーのプロジェクトでモデルが有効化されていない |
| ローカル動画が 2GB を超える | 分割するか `--start/--end` で切り出す |
