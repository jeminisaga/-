"""1節分のデータを取得して data/raw/round_XX.json にまとめる。

消費リクエスト目安(1節):
  fixtures 1 + standings 1 + team_stats 20 + injuries 1 + odds 1 + h2h 10  = 約34
  ただしキャッシュが効くので、同一節の再実行はほぼ0。
  team_stats は日次で変わらないため ttl=24h。

実行:
  python -m src.fetch --round 5
  python -m src.fetch --next          # 次節を自動判定
  python -m src.fetch --round 5 --lineups   # キックオフ直前に追加取得
"""
from __future__ import annotations

import argparse
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

from .api import ApiFootball, load_config, save_json, ROOT

JST = timezone(timedelta(hours=9))


def round_label(cfg: dict, n: int) -> str:
    return f"Regular Season - {n}"


def find_next_round(api: ApiFootball, lid: int, season: int) -> int:
    """未消化のfixtureのうち最も早い節を返す。"""
    fx = api.get("/fixtures", {"league": lid, "season": season, "next": 20},
                 ttl_hours=6)
    rounds = []
    for f in fx:
        r = f["league"]["round"]
        digits = "".join(ch for ch in r.split("-")[-1] if ch.isdigit())
        if digits:
            rounds.append(int(digits))
    if not rounds:
        raise RuntimeError("未消化の試合が見つかりません")
    return min(rounds)


def fetch_round(api: ApiFootball, cfg: dict, rnd: int, with_lineups: bool) -> dict:
    lid = cfg["league"]["id"]
    season = cfg["league"]["season"]
    if lid is None:
        raise RuntimeError("config.yaml の league.id が未設定です。先に src.discover を実行。")

    fixtures = api.get("/fixtures", {
        "league": lid, "season": season, "round": round_label(cfg, rnd)},
        ttl_hours=6)
    if not fixtures:
        raise RuntimeError(f"第{rnd}節のfixtureが取得できません")

    standings = api.get("/standings", {"league": lid, "season": season},
                        ttl_hours=24)

    team_ids = sorted({t
                       for f in fixtures
                       for t in (f["teams"]["home"]["id"], f["teams"]["away"]["id"])})

    team_stats = {}
    for tid in team_ids:
        try:
            team_stats[str(tid)] = api.get("/teams/statistics", {
                "league": lid, "season": season, "team": tid}, ttl_hours=24)
        except Exception as e:  # 取れないチームがあっても止めない
            team_stats[str(tid)] = {"_error": str(e)}

    # 直近試合（フォーム算出用）。リーグ全体の消化済み試合を1回で取得
    past = api.get("/fixtures", {"league": lid, "season": season,
                                 "status": "FT-AET-PEN"}, ttl_hours=12)

    injuries = []
    try:
        injuries = api.get("/injuries", {"league": lid, "season": season},
                           ttl_hours=12)
    except Exception as e:
        injuries = [{"_error": str(e)}]

    odds = []
    try:
        odds = api.get("/odds", {"league": lid, "season": season,
                                 "bet": 1}, ttl_hours=6)   # bet=1: Match Winner
    except Exception as e:
        odds = [{"_error": str(e)}]

    h2h = {}
    for f in fixtures:
        h, a = f["teams"]["home"]["id"], f["teams"]["away"]["id"]
        try:
            h2h[f"{h}-{a}"] = api.get("/fixtures/headtohead",
                                      {"h2h": f"{h}-{a}", "last": 6})
        except Exception:
            h2h[f"{h}-{a}"] = []

    lineups = {}
    if with_lineups:
        for f in fixtures:
            fid = f["fixture"]["id"]
            try:
                lineups[str(fid)] = api.get("/fixtures/lineups",
                                            {"fixture": fid},
                                            force=True)
            except Exception as e:
                lineups[str(fid)] = {"_error": str(e)}

    return {
        "round": rnd,
        "season": season,
        "league_id": lid,
        "fetched_at": datetime.now(JST).isoformat(),
        "fixtures": fixtures,
        "standings": standings,
        "team_stats": team_stats,
        "past_fixtures": past,
        "injuries": injuries,
        "odds": odds,
        "h2h": h2h,
        "lineups": lineups,
    }


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--round", type=int)
    p.add_argument("--next", action="store_true")
    p.add_argument("--lineups", action="store_true",
                   help="キックオフ直前にスタメンを追加取得（D腕用）")
    args = p.parse_args()

    cfg = load_config()
    api = ApiFootball(cfg)

    rnd = args.round
    if args.next or rnd is None:
        rnd = find_next_round(api, cfg["league"]["id"], cfg["league"]["season"])
        print(f"次節 = 第{rnd}節")

    out = ROOT / cfg["paths"]["raw"] / f"round_{rnd:02d}.json"

    # スタメン追加取得の場合は既存ファイルにマージ
    if args.lineups and out.exists():
        base = json.loads(out.read_text(encoding="utf-8"))
        fresh = fetch_round(api, cfg, rnd, with_lineups=True)
        base["lineups"] = fresh["lineups"]
        base["lineups_fetched_at"] = datetime.now(JST).isoformat()
        save_json(out, base)
    else:
        save_json(out, fetch_round(api, cfg, rnd, with_lineups=args.lineups))

    print(f"保存: {out.relative_to(ROOT)}  (残りリクエスト目安 {api.remaining()})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
