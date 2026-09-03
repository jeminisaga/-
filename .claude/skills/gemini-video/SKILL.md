---
name: gemini-video
description: Geminiのvideo understanding（agentic/static）でYouTubeやローカル動画を分析する。フック分解、構成、切り抜き候補、視聴維持、競合分析、章立て、編集ショットリストが必要なときに使う。トリガーは動画分析、YouTube分析、動画を見て、切り抜き抽出、/gemini-video、video analysis、analyze this video。
---

# Gemini video（Claude Code）

Gemini API の video understanding で動画を分析する。**自分でフレームを抽出するな。必ず同梱の `analyze.py` を呼べ。**

## いつ使う

- YouTube URL やローカル mp4 の中身を分解したい
- フック、構成、切り抜き、視聴維持、章立て、競合の型を抜きたい
- 「この動画見て」系で、文字起こし以上の視覚理解が必要

文字起こしだけが目的ならこのスキルは使わない。

## 事前条件

`GEMINI_API_KEY`（または `GOOGLE_API_KEY`）が必要。スキルディレクトリ直下の `.env` に置いてあれば、`analyze.py` が実行時にだけ読む（シェルの環境変数は不要）。

```bash
python3 "<SKILL_DIR>/scripts/analyze.py" --self-check --live
```

`--live` は API に実際に疎通し、モデルが使えるかまで確認する。`ng:` が出たら分析を始めず、`INSTALL.md` の該当箇所だけ案内して止める。`<SKILL_DIR>` は `~/.claude/skills/gemini-video` か `.claude/skills/gemini-video`。見つからなければ `find` する。

未インストールなら `pip3 install -U google-genai`。

## 実行手順

1. **入力を確定する。** 公開YouTube URL か、ローカルファイル。非公開・限定公開のYouTubeはAPIから読めない。その場合はファイル提出を求める。YouTube以外のURL（Vimeo, Drive, X など）もURL渡し不可 → ダウンロードして `--file`。
2. **長尺なら範囲を切る。** 目安10分超で、見たい箇所が分かっているなら `--start` / `--end`。分からないなら先に `--preset structure --resolution low` で全体を1回通し、当たりを付けてから本命のpresetを範囲指定で回す。全編を高解像度で何度も回すのは時間もコストも無駄。
3. **presetを選ぶ**（下表）。
4. **実行する。** 長尺・agenticは数分かかる。途中で止めない。
5. **標準出力の Markdown を読み、ユーザーの質問に答える形に再構成する。** タイムスタンプは落とさない。モデルが「推測:」「不明」と書いた箇所を、断定に書き換えない。
6. 長い結果は `--out` で保存し、保存先も伝える。

```bash
# YouTube のフック分解
python3 "<SKILL_DIR>/scripts/analyze.py" \
  --url "https://www.youtube.com/watch?v=VIDEO_ID" \
  --preset hook \
  --out "./artifacts/video-hook.md"

# ローカル動画から切り抜き候補
python3 "<SKILL_DIR>/scripts/analyze.py" \
  --file "./input.mp4" \
  --preset clips \
  --question "冒頭以外で単体ショートになる区間は?" \
  --out "./artifacts/video-clips.md"

# 長尺の一部だけをピンポイントで
python3 "<SKILL_DIR>/scripts/analyze.py" \
  --url "URL" --preset qa \
  --question "デモが成功する瞬間のタイムスタンプは?" \
  --start 12:00 --end 18:00
```

## preset

| preset | 用途 |
|---|---|
| `hook` | 冒頭30秒のフック分解 |
| `structure` | 全体構成とタイムライン |
| `clips` | ショート/切り抜き候補 |
| `retention` | 離脱ポイントと尺の削りどころ |
| `competitor` | 競合の型抽出、移植案 |
| `chapters` | YouTube章立て |
| `edit` | 編集ショットリスト |
| `qa` | 任意質問（`--question` 必須） |

選び方: 指定が曖昧なら `structure`。「冒頭」「フック」→ `hook`。「切り抜き」「ショート」→ `clips`。「伸びない」「離脱」「長い」→ `retention`。「他人の動画」「参考にしたい」→ `competitor`。特定の一点を聞かれているだけなら `qa`（余計な分析を出さないため）。

`--question` は `qa` 以外にも付けられる。presetの出力に観点を1つ足したいときに使う。

## オプションの使い分け

| 状況 | 指定 |
|---|---|
| 通常 | 何も付けない（`--processing agentic`、モデル自動フォールバック） |
| 5分未満で全フレーム精度が要る | `--processing static` |
| 特定区間だけ見たい | `--start 3:20 --end 5:00`（自動で static になる） |
| 動きの速い映像を細かく見たい | `--fps 2`（上限24。上げるほど高コスト） |
| 長尺のざっくり把握、コストを抑えたい | `--resolution low` |
| 画面の細かい文字を読ませたい | `--resolution high` |
| スクリプトが自動で処理すること | モデルのフォールバック、429/5xx の再試行、アップロードの後始末 |

モデルは `gemini-3.7-flash` → `gemini-3.6-flash` → `gemini-flash-latest` の順にスクリプトが自動で落とす。手で `--model` を指定するのは、ユーザーが明示的に指定したときだけ。

## API呼び出しは1依頼につき1回が原則

課金が発生するので、勝手に複数回叩かない。

- 1回の依頼に対して `analyze.py` の実行は1回。
- 追加で回したくなったら（別preset、範囲を変える、解像度を上げる）**実行前にユーザーに確認する。** 何を追加で見たいのか、なぜ1回目で足りないのかを1行で示す。
- 20分を超える動画を初めて解析するときは、実行前に一声かける。`--resolution low` での通し1回を提案するとよい。
- 失敗時の再試行はスクリプトが自動でやる。同じコマンドを手で撃ち直さない。

## やってはいけないこと

- 動画を ffmpeg で全フレーム化してから読む（コストも精度も劣る）
- 非公開YouTube URLが通ると決めつける
- モデルが「推測:」と書いた内容を、事実として要約し直す
- 出力に無いタイムスタンプを補完・丸める
- APIキーをチャットや生成ファイルにエコーする
- 長尺動画をユーザーに断りなく解析する、または断りなく複数回叩く

## 失敗時

| 症状 | 対応 |
|---|---|
| `APIキーが無効です` | 再試行しない。キーの再発行を案内して止める |
| `interactions API 失敗` | スクリプトが自動で `generate_content` に倒す。その結果を使う |
| 両APIとも失敗（2つのエラーが出る） | エラー文をそのままユーザーに見せる。当て推量で書き換えない |
| 空の応答 | `--preset qa` で質問を1つに絞る、または `--resolution low` で再試行（スクリプトが誘導する） |
| タイムアウト | `--start/--end` で範囲を狭めるか `--timeout` を伸ばす |
| 2GB超のファイル | ffmpeg で分割／再エンコードする（`--start/--end` はアップロード量を減らさない） |
| 公開制限エラー | ローカルファイル提出に誘導 |

preset選択の判断材料と、出力が良いかどうかの見分け方は `references/presets.md`。
