"""過去シーズンからベースラインのパラメータを較正する。

config.yaml の poisson.shrinkage_k と poisson.home_advantage は現状ただの
初期値（当て推量）。過去シーズンの得点データがあれば、これは実測できる。

なぜこれは「バックテスト禁止」に抵触しないか:
  ポアソンとリーグ基準率は得点から係数を推定するだけで、試合結果を記憶しない。
  過去データで係数を選ぶのは統計モデルの通常の手順であって、
  「モデルが答えを知っている」問題は起きない。
  同じことをLLM腕でやると成立しない（LLMは2022-2024のJ1を覚えている
  可能性が排除できない）。だからこのツールはベースラインしか触らない。

評価は walk-forward（前向き検証）で行う:
  第r節を予測するとき、学習に使うのは同一シーズンの第r-1節までだけ。
  これは本番の predict.py が置かれている状況と同じ。

  python -m tools.calibrate
  python -m tools.calibrate --write     # 最良値を config.yaml に書き込む
"""
from __future__ import annotations

import argparse
import json
import re
from collections import defaultdict

from src import baseline as bl
from src.api import ROOT, load_config

OUTCOMES = ("home", "draw", "away")
K_GRID = [0, 1, 2, 4, 6, 8, 12, 20, 40]
HA_GRID = [1.0, 1.05, 1.10, 1.15, 1.20, 1.25, None]   # None = データから推定
WARMUP_ROUNDS = 3      # これ以前は学習データが無さすぎるので採点から除く


def _round_no(f: dict) -> int:
    digits = re.findall(r"\d+", f["league"]["round"].split("-")[-1])
    return int(digits[0]) if digits else 0


def _outcome(f: dict) -> str | None:
    gh, ga = f["goals"]["home"], f["goals"]["away"]
    if gh is None or ga is None:
        return None
    return "home" if gh > ga else "draw" if gh == ga else "away"


def brier(p: dict, actual: str) -> float:
    return sum((float(p.get(k, 0)) - (1.0 if k == actual else 0.0)) ** 2
               for k in OUTCOMES)


def walk_forward(past: list[dict], k: float, ha: float | None):
    """節ごとに「その節より前」だけで学習して、その節を採点する。

    戻り値: (全体のBrier, 試合数, 消化節数帯ごとのBrier)
    """
    by_season: dict[int, dict[int, list]] = defaultdict(lambda: defaultdict(list))
    for f in past:
        if _outcome(f) is None:
            continue
        by_season[f["league"]["season"]][_round_no(f)].append(f)

    total, n = 0.0, 0
    buckets: dict[str, list[float]] = defaultdict(list)

    for season, rounds in by_season.items():
        order = sorted(rounds)
        history: list[dict] = []
        for r in order:
            games = rounds[r]
            if r > WARMUP_ROUNDS and history:
                st = bl.fit_strengths(history, k)
                for f in games:
                    act = _outcome(f)
                    p = bl.poisson_probs(f["teams"]["home"]["id"],
                                         f["teams"]["away"]["id"], st, ha)
                    b = brier(p, act)
                    total += b
                    n += 1
                    bucket = ("序盤(〜10節)" if r <= 10 else
                              "中盤(11-25節)" if r <= 25 else "終盤(26節〜)")
                    buckets[bucket].append(b)
            history.extend(games)

    return (total / n if n else float("nan"), n,
            {k2: sum(v) / len(v) for k2, v in buckets.items()})


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--history", default="data/history/j1_history.json")
    ap.add_argument("--write", action="store_true",
                    help="最良パラメータを config.yaml に書き込む")
    args = ap.parse_args()

    hp = ROOT / args.history
    if not hp.exists():
        print(f"{args.history} がありません。先に以下を実行してください:\n"
              f"  python -m tools.fetch_history fixtures\n"
              f"  python -m tools.fetch_history export")
        return 1

    data = json.loads(hp.read_text(encoding="utf-8"))
    past = data["past_fixtures"]
    played = [f for f in past if _outcome(f)]
    print(f"履歴: {len(played)}試合 / シーズン {data.get('seasons')}\n")

    # --- リーグ基準率（無思考ベースラインの正しい値）---
    rate = bl.home_base_rate(played)
    print("=== リーグ基準率（実測 H/D/A）===")
    print("  " + "  ".join(f"{k}={rate[k]:.3f}" for k in OUTCOMES))
    print(f"  この分布を毎試合出すだけの Brier = "
          f"{sum(brier(rate, _outcome(f)) for f in played) / len(played):.4f}")
    print("  （ランダム=0.6667。これがLLMが超えるべき最低ライン）\n")

    # --- グリッド探索 ---
    print("=== ポアソン walk-forward 探索（Brier、低いほど良い）===")
    print(f"{'shrinkage_k':>12} " + " ".join(
        f"{('推定' if h is None else f'{h:.2f}'):>7}" for h in HA_GRID))
    results = []
    for k in K_GRID:
        row = []
        for ha in HA_GRID:
            b, n, _ = walk_forward(played, k, ha)
            row.append(b)
            results.append({"k": k, "ha": ha, "brier": b, "n": n})
        print(f"{k:>12} " + " ".join(f"{b:>7.4f}" for b in row))

    best = min(results, key=lambda r: r["brier"])
    ha_label = "推定値を使う" if best["ha"] is None else f"{best['ha']:.2f}"
    print(f"\n最良: shrinkage_k={best['k']}  home_advantage={ha_label}  "
          f"Brier={best['brier']:.4f}  (n={best['n']})")

    cur = load_config()["poisson"]
    b_cur, _, _ = walk_forward(played, cur["shrinkage_k"], cur["home_advantage"])
    print(f"現行設定: shrinkage_k={cur['shrinkage_k']} "
          f"home_advantage={cur['home_advantage']}  Brier={b_cur:.4f}"
          f"  → 差 {best['brier'] - b_cur:+.4f}")

    # --- 節帯ごと。序盤でkがどれだけ効くかを見る ---
    _, _, buckets = walk_forward(played, best["k"], best["ha"])
    _, _, buckets_cur = walk_forward(played, cur["shrinkage_k"],
                                     cur["home_advantage"])
    print("\n=== 節帯ごとのBrier（序盤ほど shrinkage が効く）===")
    print(f"{'':<16}{'最良設定':>10}{'現行設定':>10}{'差':>9}")
    for name in ("序盤(〜10節)", "中盤(11-25節)", "終盤(26節〜)"):
        if name in buckets:
            d = buckets[name] - buckets_cur[name]
            print(f"{name:<16}{buckets[name]:>10.4f}{buckets_cur[name]:>10.4f}"
                  f"{d:>+9.4f}")

    if args.write:
        p = ROOT / "config.yaml"
        t = p.read_text(encoding="utf-8")
        t = re.sub(r"^(\s*shrinkage_k:\s*)\S+", rf"\g<1>{best['k']}",
                   t, count=1, flags=re.MULTILINE)
        if best["ha"] is not None:
            t = re.sub(r"^(\s*home_advantage:\s*)[\d.]+",
                       rf"\g<1>{best['ha']:.2f}", t, count=1, flags=re.MULTILINE)
        p.write_text(t, encoding="utf-8")
        print(f"\nconfig.yaml を更新しました "
              f"(shrinkage_k={best['k']}"
              + ("" if best["ha"] is None else f", home_advantage={best['ha']:.2f}")
              + ")")
        if best["ha"] is None:
            print("※ home_advantage は「データから推定」が最良でした。"
                  "config.yaml の値は据え置き、推定に切り替える場合は "
                  "predict.py に渡す引数を None にしてください。")
    else:
        print("\n--write を付けると config.yaml に書き込みます。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
