"""APIキーなしでパイプラインを通すための合成データ生成器。

API-Football のレスポンス形状だけを再現した架空のリーグを作り、
data/raw/round_99.json として書き出す。中身は乱数なので予測の中身に
意味はない。目的は fetch 以降（predict → ingest → settle → report）が
実データなしで最後まで動くことを確認すること。

  python -m tools.gen_fixture_data              # 第99節の合成データ
  python -m tools.gen_fixture_data --seed 7     # 別の乱数で生成
  python -m tools.gen_fixture_data --history    # 較正テスト用の合成履歴
"""
from __future__ import annotations

import argparse
import random
from datetime import datetime, timedelta, timezone

from src.api import load_config, save_json, ROOT

JST = timezone(timedelta(hours=9))
ROUND = 99

TEAMS = [
    "Vissel Kobe", "Sanfrecce Hiroshima", "Machida Zelvia", "Gamba Osaka",
    "Kashima Antlers", "Cerezo Osaka", "Tokyo Verdy", "FC Tokyo",
    "Kawasaki Frontale", "Avispa Fukuoka", "Nagoya Grampus", "Kyoto Sanga",
    "Urawa Reds", "Shonan Bellmare", "Yokohama F Marinos", "Niigata",
    "Kashiwa Reysol", "Consadole Sapporo", "Jubilo Iwata", "Sagan Tosu",
]


def _fx(fid, kickoff, h, a, gh=None, ga=None, rnd=ROUND):
    """fixture 1件。gh/ga が None なら未消化。"""
    done = gh is not None
    return {
        "fixture": {
            "id": fid,
            "date": kickoff.astimezone(timezone.utc).isoformat().replace("+00:00", "+00:00"),
            "status": {"short": "FT" if done else "NS"},
        },
        "league": {"id": 98, "season": 2026, "round": f"Regular Season - {rnd}"},
        "teams": {"home": {"id": h[0], "name": h[1]},
                  "away": {"id": a[0], "name": a[1]}},
        "goals": {"home": gh, "away": ga},
        "score": {"fulltime": {"home": gh, "away": ga}},
    }


def build(seed: int) -> dict:
    rng = random.Random(seed)
    teams = [(100 + i, name) for i, name in enumerate(TEAMS)]
    strength = {t[0]: rng.uniform(0.75, 1.35) for t in teams}

    now = datetime.now(JST)

    # --- 消化済み試合（ポアソン学習・フォーム算出用）---
    past, fid = [], 500000
    for wk in range(12):
        shuffled = teams[:]
        rng.shuffle(shuffled)
        day = now - timedelta(days=7 * (12 - wk) + 1)
        for i in range(0, len(shuffled), 2):
            h, a = shuffled[i], shuffled[i + 1]
            lam_h = 1.35 * strength[h[0]] / strength[a[0]] * 1.15
            lam_a = 1.35 * strength[a[0]] / strength[h[0]]
            gh = min(_poisson(rng, lam_h), 6)
            ga = min(_poisson(rng, lam_a), 6)
            fid += 1
            past.append(_fx(fid, day, h, a, gh, ga, rnd=wk + 1))

    # --- 対象節（未消化）---
    fixtures = []
    shuffled = teams[:]
    rng.shuffle(shuffled)
    for i in range(0, len(shuffled), 2):
        h, a = shuffled[i], shuffled[i + 1]
        fid += 1
        # 2日後 = キックオフ前。lineup_watch の窓判定も試せる
        ko = now + timedelta(days=2, hours=i)
        fixtures.append(_fx(fid, ko, h, a))

    # --- standings ---
    agg = {t[0]: {"played": 0, "win": 0, "draw": 0, "lose": 0, "gf": 0, "ga": 0}
           for t in teams}
    for f in past:
        h, a = f["teams"]["home"]["id"], f["teams"]["away"]["id"]
        gh, ga = f["goals"]["home"], f["goals"]["away"]
        for tid, gf, gaa in ((h, gh, ga), (a, ga, gh)):
            r = agg[tid]
            r["played"] += 1; r["gf"] += gf; r["ga"] += gaa
            r["win" if gf > gaa else "draw" if gf == gaa else "lose"] += 1

    ranked = sorted(teams, key=lambda t: -(agg[t[0]]["win"] * 3 + agg[t[0]]["draw"]))
    rows = []
    for rank, (tid, name) in enumerate(ranked, 1):
        r = agg[tid]
        rows.append({
            "rank": rank,
            "team": {"id": tid, "name": name},
            "points": r["win"] * 3 + r["draw"],
            "all": {"played": r["played"], "win": r["win"], "draw": r["draw"],
                    "lose": r["lose"],
                    "goals": {"for": r["gf"], "against": r["ga"]}},
        })
    standings = [{"league": {"id": 98, "season": 2026, "standings": [rows]}}]

    # --- team_stats ---
    team_stats = {}
    for tid, name in teams:
        r = agg[tid]
        n = max(r["played"], 1)
        team_stats[str(tid)] = {
            "goals": {
                "for": {"average": {"total": round(r["gf"] / n, 2),
                                    "home": round(r["gf"] / n * 1.1, 2),
                                    "away": round(r["gf"] / n * 0.9, 2)}},
                "against": {"average": {"total": round(r["ga"] / n, 2),
                                        "home": round(r["ga"] / n * 0.9, 2),
                                        "away": round(r["ga"] / n * 1.1, 2)}},
            },
            "fixtures": {"wins": {"home": r["win"] // 2 + r["win"] % 2},
                         "draws": {"home": r["draw"] // 2},
                         "loses": {"home": r["lose"] // 2}},
            "clean_sheet": {"total": rng.randint(0, 5)},
            "form": "".join(rng.choice("WDL") for _ in range(12)),
        }

    # --- injuries / odds / h2h / lineups ---
    injuries = []
    for tid, name in teams:
        for _ in range(rng.randint(0, 3)):
            injuries.append({
                "team": {"id": tid, "name": name},
                "player": {"name": f"Player {rng.randint(1, 30)}",
                           "reason": rng.choice(["Muscle Injury", "Knock",
                                                 "Suspended", "Illness"])},
            })

    odds = []
    for f in fixtures:
        h, a = f["teams"]["home"]["id"], f["teams"]["away"]["id"]
        p = [0.30 + strength[h] * 0.12, 0.26, 0.30 + strength[a] * 0.12]
        s = sum(p)
        p = [x / s for x in p]
        margin = 1.06
        odds.append({
            "fixture": {"id": f["fixture"]["id"]},
            "bookmakers": [{
                "id": 8, "name": "Synthetic Books",
                "bets": [{"id": 1, "name": "Match Winner", "values": [
                    {"value": "Home", "odd": f"{1 / (p[0] * margin):.2f}"},
                    {"value": "Draw", "odd": f"{1 / (p[1] * margin):.2f}"},
                    {"value": "Away", "odd": f"{1 / (p[2] * margin):.2f}"},
                ]}],
            }],
        })

    h2h = {}
    for f in fixtures:
        h, a = f["teams"]["home"], f["teams"]["away"]
        key = f"{h['id']}-{a['id']}"
        games = []
        for k in range(4):
            fid += 1
            games.append(_fx(fid, now - timedelta(days=200 + 90 * k),
                             (h["id"], h["name"]), (a["id"], a["name"]),
                             rng.randint(0, 3), rng.randint(0, 3)))
        h2h[key] = games

    lineups = {}
    for f in fixtures:
        lineups[str(f["fixture"]["id"])] = [
            {"team": {"id": f["teams"][side]["id"],
                      "name": f["teams"][side]["name"]},
             "formation": rng.choice(["4-4-2", "4-2-3-1", "3-4-2-1"]),
             "startXI": [{"player": {"name": f"Player {i}", "pos": "M"}}
                         for i in range(1, 12)]}
            for side in ("home", "away")
        ]

    return {
        "round": ROUND,
        "season": 2026,
        "league_id": 98,
        "fetched_at": datetime.now(JST).isoformat(),
        "_synthetic": True,
        "fixtures": fixtures,
        "standings": standings,
        "team_stats": team_stats,
        "past_fixtures": past,
        "injuries": injuries,
        "odds": odds,
        "h2h": h2h,
        "lineups": lineups,
    }


def _poisson(rng: random.Random, lam: float) -> int:
    import math
    L, k, p = math.exp(-lam), 0, 1.0
    while True:
        k += 1
        p *= rng.random()
        if p <= L:
            return k - 1


def build_history(seed: int, seasons=(2022, 2023, 2024),
                  rounds: int = 34) -> dict:
    """tools.calibrate の動作確認用の合成履歴（3シーズン分）。

    実データと同じ形状で、シーズンごとにチーム強度を引き直す。
    中身は乱数なので較正結果に意味はない。確認できるのは
    walk-forward の探索が最後まで動くことだけ。
    """
    rng = random.Random(seed)
    teams = [(100 + i, name) for i, name in enumerate(TEAMS)]
    past, fid = [], 900000
    base = datetime.now(JST) - timedelta(days=365 * 4)

    for si, season in enumerate(seasons):
        strength = {t[0]: rng.uniform(0.75, 1.35) for t in teams}
        for rnd in range(1, rounds + 1):
            shuffled = teams[:]
            rng.shuffle(shuffled)
            day = base + timedelta(days=365 * si + 7 * rnd)
            for i in range(0, len(shuffled), 2):
                h, a = shuffled[i], shuffled[i + 1]
                lam_h = 1.35 * strength[h[0]] / strength[a[0]] * 1.15
                lam_a = 1.35 * strength[a[0]] / strength[h[0]]
                fid += 1
                f = _fx(fid, day, h, a,
                        min(_poisson(rng, lam_h), 6),
                        min(_poisson(rng, lam_a), 6), rnd=rnd)
                f["league"]["season"] = season
                past.append(f)

    return {
        "_source": "合成データ（tools.gen_fixture_data --history）",
        "_synthetic": True,
        "seasons": list(seasons),
        "league_id": 98,
        "past_fixtures": past,
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--history", action="store_true",
                    help="第99節ではなく較正テスト用の合成履歴を生成する")
    args = ap.parse_args()

    cfg = load_config()

    if args.history:
        out = ROOT / "data" / "history" / "j1_history.json"
        data = build_history(args.seed)
        save_json(out, data)
        print(f"合成履歴生成: {out.relative_to(ROOT)}  "
              f"({len(data['past_fixtures'])}試合 / "
              f"{len(data['seasons'])}シーズン)")
        return 0
    out = ROOT / cfg["paths"]["raw"] / f"round_{ROUND:02d}.json"
    data = build(args.seed)
    save_json(out, data)
    print(f"合成データ生成: {out.relative_to(ROOT)}  "
          f"({len(data['fixtures'])}試合 / 消化済み{len(data['past_fixtures'])}試合)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
