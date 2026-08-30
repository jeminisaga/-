"""試合後に結果を取得し、全予測者を採点する。

指標:
  brier    = Σ(p_i - o_i)^2 （3値。0が完璧、2が最悪。ランダム=0.667）
  logloss  = -ln(p_実際の結果) （0が完璧。ランダム=1.099）
  hit      = 最大確率の結果が当たったか（参考値。単独では使わない）

logloss は確率0を出すと発散するので 1e-4 でクリップする。
ホーム固定(0/1予測)が対数損失で壊滅するのは仕様どおり。

  python -m src.settle --round 5
"""
from __future__ import annotations

import argparse
import json
import math
from datetime import datetime, timedelta, timezone
from pathlib import Path

from .api import ApiFootball, load_config, save_json, ROOT

JST = timezone(timedelta(hours=9))
EPS = 1e-4
OUTCOMES = ("home", "draw", "away")


def outcome_of(gh: int, ga: int) -> str:
    return "home" if gh > ga else "draw" if gh == ga else "away"


def brier(p: dict, actual: str) -> float:
    return sum((float(p.get(k, 0)) - (1.0 if k == actual else 0.0)) ** 2
               for k in OUTCOMES)


def logloss(p: dict, actual: str) -> float:
    return -math.log(max(min(float(p.get(actual, 0)), 1.0), EPS))


def hit(p: dict, actual: str) -> int:
    return int(max(OUTCOMES, key=lambda k: float(p.get(k, 0))) == actual)


def collect_predictions(pdir: Path) -> dict[str, dict[int, dict]]:
    """予測者名 -> {fixture_id: probs} """
    out: dict[str, dict[int, dict]] = {}

    bf = pdir / "baselines.json"
    if bf.exists():
        data = json.loads(bf.read_text(encoding="utf-8"))
        for m in data["matches"]:
            for name, probs in m["baselines"].items():
                out.setdefault(f"base:{name}", {})[m["fixture_id"]] = probs

    for f in sorted(pdir.glob("llm_*.json")):
        data = json.loads(f.read_text(encoding="utf-8"))
        name = f"llm:{data['arm']}"
        for pr in data["predictions"]:
            if pr.get("fixture_id") is not None:
                out.setdefault(name, {})[int(pr["fixture_id"])] = pr
    return out


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--round", type=int, required=True)
    args = p.parse_args()

    cfg = load_config()
    rnd = args.round
    api = ApiFootball(cfg)

    raw_path = ROOT / cfg["paths"]["raw"] / f"round_{rnd:02d}.json"
    raw = json.loads(raw_path.read_text(encoding="utf-8"))
    lid, season = raw["league_id"], raw["season"]

    finished = api.get("/fixtures", {
        "league": lid, "season": season,
        "round": f"Regular Season - {rnd}"}, force=True)

    actuals = {}
    for f in finished:
        if f["fixture"]["status"]["short"] not in ("FT", "AET", "PEN"):
            continue
        gh, ga = f["score"]["fulltime"]["home"], f["score"]["fulltime"]["away"]
        if gh is None:
            continue
        actuals[f["fixture"]["id"]] = {
            "home_team": f["teams"]["home"]["name"],
            "away_team": f["teams"]["away"]["name"],
            "score": f"{gh}-{ga}",
            "outcome": outcome_of(gh, ga),
        }

    if not actuals:
        print(f"第{rnd}節はまだ結果が出ていません")
        return 1

    pdir = ROOT / cfg["paths"]["predictions"] / f"round_{rnd:02d}"
    preds = collect_predictions(pdir)
    if not preds:
        print("予測ファイルがありません")
        return 1

    rows = []
    for name, byfx in preds.items():
        n = 0
        sb = sl = sh = 0.0
        for fid, act in actuals.items():
            pr = byfx.get(fid)
            if not pr:
                continue
            n += 1
            sb += brier(pr, act["outcome"])
            sl += logloss(pr, act["outcome"])
            sh += hit(pr, act["outcome"])
        if n:
            rows.append({"predictor": name, "n": n,
                         "brier": round(sb / n, 4),
                         "logloss": round(sl / n, 4),
                         "hit_rate": round(sh / n, 3)})

    rows.sort(key=lambda r: r["brier"])

    # 前提が崩れた試合の抽出（振り返り用）
    misses = []
    for fid, act in actuals.items():
        pr = (preds.get("llm:C") or preds.get("llm:B") or {}).get(fid)
        if not pr:
            continue
        if brier(pr, act["outcome"]) > 1.0:
            misses.append({
                "match": f"{act['home_team']} {act['score']} {act['away_team']}",
                "predicted": {k: round(float(pr.get(k, 0)), 2) for k in OUTCOMES},
                "actual": act["outcome"],
                "key_assumption": pr.get("key_assumption"),
            })

    result = {
        "round": rnd,
        "settled_at": datetime.now(JST).isoformat(),
        "matches_scored": len(actuals),
        "scores": rows,
        "broken_assumptions": misses,
        "actuals": actuals,
    }
    save_json(ROOT / cfg["paths"]["results"] / f"round_{rnd:02d}.json", result)

    print(f"\n=== 第{rnd}節 採点（{len(actuals)}試合） ===")
    print(f"{'予測者':<18}{'Brier':>8}{'LogLoss':>10}{'的中率':>8}")
    for r in rows:
        print(f"{r['predictor']:<18}{r['brier']:>8.4f}{r['logloss']:>10.4f}"
              f"{r['hit_rate']:>8.1%}")
    print("\n参考: ランダム予測 Brier=0.6667 / LogLoss=1.0986")

    if misses:
        print(f"\n--- 前提が崩れた試合 {len(misses)}件 ---")
        for m in misses:
            print(f"  {m['match']}  → {m['actual']}")
            print(f"    崩れた前提: {m['key_assumption']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
