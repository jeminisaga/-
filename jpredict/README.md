# jpredict — Jリーグ予測の情報量アブレーション実験

「AIにサッカーの試合結果をどこまで予測できるか」を、**情報を1段ずつ足しながら**測る。
勝つことではなく、**どの情報が精度に効いたかを数字で確定させること**が目的。

---

## この実験が答える問い

同じ試合を、情報量の異なる5条件で予測させて比較する。

| 腕 | 与える情報 |
|---|---|
| A | チーム名のみ |
| B | + 順位・直近成績 |
| C | + 詳細スタッツ・対戦履歴 |
| D | + スタメン・欠場・日程間隔 |
| E | + 報道テキスト |

Brierスコアの差分を見れば、「スタメン情報は本当に効くのか」「ニュースを入れると悪化するのか」が実測で出る。
**E腕が効かないことを示せたら、それが一番価値のある発見**（通説の検証になる）。

同時に、以下のベースラインと同じ土俵で採点する。

- **ホーム固定** — 何も考えないbot。下限
- **リーグ基準率** — 実測のH/D/A比率
- **ポアソン** — 得失点のシュリンケージ推定。統計の素朴な下限
- **市場オッズ** — マージン除去した1X2確率。事実上の上限

LLMがこの4つのどこに位置するかが、この実験の答え。

## 評価指標

| 指標 | 意味 | ランダム値 |
|---|---|---|
| **Brier** | Σ(p−o)²。確率の正しさ。**これが主指標** | 0.667 |
| LogLoss | −ln(p実際)。外れの痛みが重い | 1.099 |
| 的中率 | 参考値。**判定には使わない** | 約0.42 |

的中率を主指標にしない理由は、情報量が少なすぎるから。30試合での標準誤差は±9ポイント前後あり、50%と60%を区別できない。Brierは1試合ごとに連続値で採点できるので、必要サンプル数が一桁下がる。

## セットアップ

### 1. APIキー（無料）

https://www.api-football.com/ でアカウント作成 → Free プラン（100リクエスト/日）。
（RapidAPI経由ではなく直接契約のほうがヘッダが単純）

```bash
export APIFOOTBALL_KEY="取得したキー"
pip install -r requirements.txt
```

### 2. 最初の調査（消費1〜2リクエスト）

```bash
python -m src.discover
```

J1のleague_idと、**シーズンごとのcoverageフラグ**が表示される。ここで実験の形が決まる。

| フラグ | falseだったら |
|---|---|
| `lineups` | D腕（スタメン込み）が成立しない → A〜Cに縮小 |
| `statistics_fixtures` | C腕が薄くなる → 代替ソースを検討 |
| `injuries` | D腕から欠場情報が抜ける |
| `odds` | **上限ライン（市場）が無料では取れない** → LLMの立ち位置が不明のまま走ることになる |

表示された `league_id` を `config.yaml` の `league.id` に書き込む。
`season` の値もdiscoverの出力で確認する（2026/27シーズンをAPIが `2026` と呼ぶか要確認）。

※ J1の `league.id` は **98** と実測済み（下の「データ源の実測結果」参照）。
   無料プランでは `discover` の coverage は 2022-2024 のものしか見られない。

### 3. 週次運用

```bash
./run_week.sh 5 A B C        # 金曜: 取得 → ベースライン → LLM予測 → commit
python -m src.lineup_watch --round 5   # 試合直前: スタメンが出ていれば取得
python -m src.predict --round 5 --arms D E
python -m src.settle --round 5         # 月曜: 結果照合・採点
python -m src.report                   # REPORT.md 更新
```

GitHub Actions（`.github/workflows/`）を使えば、取得・採点・レポートは自動。
LLM腕だけローカルで `claude -p` に流す（サブスクリプションの範囲＝追加課金なし）。
完全自動化したい場合は `config.yaml` の `llm.mode` を `api` にする（従量課金）。

## リクエスト予算

無料枠100/日に対して、

| 処理 | 消費 |
|---|---|
| 1節分の取得 | 約34（fixtures 1 + standings 1 + team_stats 20 + h2h 10 + injuries 1 + odds 1） |
| スタメン | 10（窓に入った試合のみ） |
| 結果取得 | 1 |

全レスポンスを `data/raw/` にキャッシュするので、再実行では消費しない。
`_quota.json` で日次カウントし、上限で例外を投げて止まる。

## 守るべき2つのルール

**1. バックテストはしない。**
過去シーズンで検証しても、モデルが結果を学習済みの可能性を排除できない。
キックオフ前に予測を確定し、pushする。**commit時刻がこの実験の唯一の証拠**。

**2. サンプルが貯まるまで判定しない。**
1節10試合ではBrierの標準誤差が±0.11ある。腕AとC の差が0.03なら「差が見えない」が正しい結論。
`report.py` は差分がSEを超えたときだけ「改善」「悪化」と判定する。
おおむね**100試合（10節）で傾向が見え、300試合で判定できる**水準。

## 今シーズン固有の注意

- 2026/27シーズンは秋春制移行の初年度で、8月開幕・翌年6月閉幕
- 移行期の2026年前半に開催された特別大会は**PK戦による完全決着方式（引き分けなし）**
  → その期間のデータは勝敗確率の推定に使えない
- したがって序盤は学習データが極端に薄い。`poisson.shrinkage_k` が効く場面

序盤10節は「情報が薄い状態でのAIの振る舞い」を観察する期間と割り切る。
節が進むにつれてBrierが改善するかどうか、という時系列自体がデータになる。

## ディレクトリ

このリポジトリでは `jpredict/` 配下に置いてある（リポジトリ直下の `src/` は
別プロジェクトのChrome拡張が使っているため）。以下のコマンドはすべて
`jpredict/` をカレントディレクトリにして実行する。
GitHub Actions のワークフローはリポジトリ直下の `.github/workflows/` にあり、
`working-directory: jpredict` を指定している。

```
config.yaml              設定（league_id, 腕の定義, ポアソンのパラメータ）
src/discover.py          初回調査。coverageフラグ確認
src/fetch.py             1節分の取得
src/features.py          腕A〜Eの入力テキスト組み立て ← 実験の中核
src/baseline.py          ホーム固定 / ポアソン / 市場オッズ
src/llm.py               プロンプト生成・API呼び出し・正規化
src/predict.py           予測確定（キックオフ前に実行）
src/lineup_watch.py      キックオフ45分前の窓でのみスタメン取得
src/ingest.py            Claude Code出力の取り込み
src/settle.py            結果照合・採点
src/report.py            REPORT.md 生成
tools/fetch_history.py     過去シーズン(2022-2024)の取得。ベースライン較正用
tools/calibrate.py         ポアソンのパラメータをwalk-forwardで較正
tools/gen_fixture_data.py  合成データ生成（APIキーなしの動作確認用）
tools/settle_offline.py    合成データ用のオフライン採点ドライバ
data/raw/                APIレスポンスのキャッシュ
data/predictions/        予測（時刻・commit hash 付き）
data/results/            採点結果
REPORT.md                累積レポート
```

## APIキーなしでの動作確認（スモークテスト）

`tools/` に、架空のリーグを生成してパイプラインを最後まで通すための道具がある。
API-Football のレスポンス形状だけを再現した乱数データなので、**出てくる
Brierに意味はない**。確認できるのは「fetch以降が最後まで落ちずに動くか」
「腕A〜Eで情報量が単調に増えているか」の2点だけ。

```bash
python -m tools.gen_fixture_data          # data/raw/round_99.json を生成
python -m src.predict --round 99 --arms A B C D E
for A in A B C D E; do
  cat prompts/round_99/arm_$A.md | claude -p > data/predictions/round_99/llm_$A.raw
  python -m src.ingest --round 99 --arm $A
done
python -m tools.settle_offline            # 架空のスコアで採点
python -m src.report
```

第99節の生成物は `.gitignore` に入れてある。実データと混ざると
`report.py` の累積集計を汚染するため、コミットしないこと。

## データ源の実測結果（2026-08時点）

API-Football のダッシュボードで実測した結果、**無料プランでは現行シーズンが
取れない**ことが判明した。

| 検証内容 | 結果 |
|---|---|
| `fixtures?league=98&season=2026` | ✗ `Free plans do not have access to this season, try from 2022 to 2024.` |
| `fixtures?league=98&season=2024` | ✓ 380試合を1リクエストで取得 |
| `fixtures/lineups`（2024） | ✓ フォーメーション＋スタメン11人 |
| `fixtures/statistics`（2024） | ✓ |
| `predictions` | ✓（API側の予測値） |
| `next` / `last` パラメータ | ✗ 無料プランでは使用不可 |
| `odds` / `injuries` | ✗ 実質0件 |

J1の league id は **98**。無料枠は「2022〜2024の3シーズン、履歴のみ」。

### これが実験に与える影響

**過去シーズンでLLM腕を採点することはできない。** ルール1のとおり、
2022-2024のJ1の結果はLLMの学習データに入っている可能性が排除できず、
採点しても「予測精度」ではなく「想起の正確さ」を測ることになる。
腕A（チーム名のみ）が最良になっても、それが推論なのか記憶なのか区別できない。
`src/predict.py` は結果の出ている試合にLLM予測を作らせないよう機械的に止める。

**ベースラインの較正には使える。** ポアソンとリーグ基準率は得点から係数を
推定するだけで結果を記憶しないので、過去データで係数を選ぶのは統計の通常手順。
`config.yaml` の `shrinkage_k: 6` と `home_advantage: 1.15` は現状ただの
当て推量なので、ここを実測値に置き換えられる。

**必要なのは3リクエストだけ。** ベースライン較正が読むのは
チームIDと得点だけ（`src/baseline.py` 参照）。スタメンとスタッツは
1試合1リクエストで約2280リクエスト＝23日かかるが、それが効くのは腕C・Dの
特徴量であって、その腕は過去シーズンでは走らせられない。
**23日かけて取るデータは、使えない腕のためのもの。**

### 過去シーズンの使い方

```bash
export APIFOOTBALL_KEY=xxxxx
python -m tools.fetch_history fixtures    # 3リクエスト。1140試合
python -m tools.fetch_history export      # ベースライン較正用JSON
python -m tools.calibrate                 # walk-forward でパラメータ探索
python -m tools.calibrate --write         # 最良値を config.yaml へ
```

`tools/calibrate.py` は前向き検証で評価する。第r節を予測するとき学習に使うのは
同一シーズンの第r-1節までだけで、これは本番の `predict.py` と同じ状況。
節帯（序盤/中盤/終盤）ごとのBrierも出るので、序盤にshrinkageがどれだけ効くかが
そのまま読める。

### 現行シーズンをどう取るか（未解決）

前向き実験には現行シーズンのデータが要る。ここは未解決で、選択肢は以下。

- **TheSportsDB 無料** — 日程・結果のみ。順位表とスタメンは有料。腕Aしか成立しない
- **API-Football Pro $19/月** — 現行シーズン＋スタメンまで取れる唯一の現実解
- football-data.org 無料枠は欧州12大会のみでJリーグ非対応

注意: 「1か月だけ契約して一気に落として解約」は**履歴には有効だが前向き実験には
使えない**。前向き実験は毎週キックオフ前にその週のデータが要るので、実験を
走らせる期間ぶんの契約が必要になる。

## 未検証の点

- ラインナップが試合前に埋まるかはリーグ依存。1試合で実測してからD腕の可否を決める
- 無料プランの分あたりリクエスト上限は未確認。`tools/fetch_history.py` の
  `--sleep` 既定値は約9req/分と保守的に置いてある
- スクレイピングによる補完（Football-LAB等）は各サイトの規約確認が必要
