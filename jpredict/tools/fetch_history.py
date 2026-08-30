#!/usr/bin/env python3
"""過去シーズン(2022-2024)の取得。API-Football 無料プラン前提。

無料プランの実測制約（ユーザのダッシュボードで確認済み）:
  - アクセス可能シーズン: 2022 / 2023 / 2024 のみ。現行シーズンは不可
  - next / last パラメータ使用不可（シーズン一括取得で回避）
  - odds / injuries は実質0件
  - 1日100リクエスト → 中断・再開できるようSQLiteに逐次保存

【重要】このデータをLLM腕(A〜E)の採点に使ってはいけない。
2022-2024のJ1の結果はLLMの学習データに入っている可能性が排除できず、
「予測」ではなく「想起」を測ることになる。README の守るべきルール1参照。
用途はベースライン（ポアソン/基準率）の較正のみ。
→ tools/calibrate.py

使い方:
  export APIFOOTBALL_KEY=xxxxx
  python -m tools.fetch_history fixtures        # 3シーズン分の試合(3リクエスト)
  python -m tools.fetch_history export          # ベースライン較正用JSONを書き出し

  # 以下はLLM腕の特徴量用。ベースライン較正には不要（下の注意を読むこと）
  python -m tools.fetch_history detail --budget 90
"""
from __future__ import annotations

import argparse
import json
import os
import sqlite3
import sys
import time
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from src.api import ROOT, save_json  # noqa: E402

BASE = "https://v3.football.api-sports.io/"
LEAGUE = 98            # J1 League
SEASONS = [2022, 2023, 2024]
DB = ROOT / "data" / "history" / "jpredict.db"

# 無料プランは1日100リクエストのほかに分あたりの上限がある。
# 上限値はプラン表示で確認すること。既定は保守的に約9req/分。
DEFAULT_SLEEP = 6.5


def _key() -> str:
    # プロジェクト本体は APIFOOTBALL_KEY を使う。元スクリプトの
    # API_FOOTBALL_KEY も受け付けて取り違えを防ぐ。
    k = os.environ.get("APIFOOTBALL_KEY") or os.environ.get("API_FOOTBALL_KEY")
    if not k:
        sys.exit("環境変数 APIFOOTBALL_KEY が未設定です")
    return k


def get(path: str) -> dict:
    req = urllib.request.Request(BASE + path,
                                 headers={"x-apisports-key": _key()})
    with urllib.request.urlopen(req, timeout=30) as r:
        data = json.load(r)
    if data.get("errors"):
        raise RuntimeError(f"{path} -> {data['errors']}")
    return data


def db() -> sqlite3.Connection:
    DB.parent.mkdir(parents=True, exist_ok=True)
    c = sqlite3.connect(DB)
    c.executescript("""
    CREATE TABLE IF NOT EXISTS fixtures(
      id INTEGER PRIMARY KEY, season INT, date TEXT, round TEXT, status TEXT,
      home_id INT, home TEXT, away_id INT, away TEXT,
      gh INT, ga INT, ht_h INT, ht_a INT, raw TEXT);
    CREATE TABLE IF NOT EXISTS lineups(fixture_id INTEGER PRIMARY KEY, raw TEXT);
    CREATE TABLE IF NOT EXISTS stats(fixture_id INTEGER PRIMARY KEY, raw TEXT);
    -- 恒久的に取得できない試合を記録する。これがないと毎日リトライして
    -- 予算を食い潰す（元スクリプトの挙動）。
    CREATE TABLE IF NOT EXISTS failures(
      fixture_id INTEGER, kind TEXT, tries INT DEFAULT 0, last_error TEXT,
      PRIMARY KEY(fixture_id, kind));
    """)
    return c


def cmd_fixtures(a) -> None:
    c = db()
    for s in SEASONS:
        d = get(f"fixtures?league={LEAGUE}&season={s}")
        rows = []
        for f in d["response"]:
            fx, t, g, sc = f["fixture"], f["teams"], f["goals"], f["score"]
            rows.append((fx["id"], s, fx["date"], f["league"]["round"],
                         fx["status"]["short"],
                         t["home"]["id"], t["home"]["name"],
                         t["away"]["id"], t["away"]["name"],
                         g["home"], g["away"],
                         sc["halftime"]["home"], sc["halftime"]["away"],
                         json.dumps(f, ensure_ascii=False)))
        c.executemany(
            "INSERT OR REPLACE INTO fixtures VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            rows)
        c.commit()
        print(f"{s}: {len(rows)} 試合")
    n = c.execute("SELECT COUNT(*) FROM fixtures WHERE status='FT'").fetchone()[0]
    print(f"合計 {n} 試合（消化済み）")
    print("\n次: python -m tools.fetch_history export  → ベースライン較正用JSON")


def cmd_detail(a) -> None:
    """未取得の試合について lineups と statistics を予算内で取得(再開可)。

    注意: ベースラインの較正にはこのデータは要らない（得点と対戦カードだけで
    足りる）。ここで取れるのはLLM腕C・Dの特徴量だが、過去シーズンでLLM腕を
    採点することは README のルール1で禁じている。実行前に用途を確認すること。
    """
    if not a.i_know_this_is_not_for_llm_arms:
        print("""このコマンドが取るデータ(lineups/statistics)は、ベースライン較正には
不要です。LLM腕C・Dの特徴量ですが、過去シーズンでLLM腕を採点することは
README のルール1（バックテストはしない）で禁じています。

1140試合 x 2 = 約2280リクエスト = 無料枠で23日かかります。
用途を理解した上で実行する場合は --i-know-this-is-not-for-llm-arms を付けてください。""")
        return

    c = db()
    todo = c.execute("""SELECT id FROM fixtures f WHERE status='FT'
        AND (id NOT IN (SELECT fixture_id FROM lineups)
          OR id NOT IN (SELECT fixture_id FROM stats)) ORDER BY date""").fetchall()
    dead = {(r[0], r[1]) for r in
            c.execute("SELECT fixture_id, kind FROM failures WHERE tries>=3")}
    print(f"残り {len(todo)} 試合 / 今回の予算 {a.budget} リクエスト "
          f"/ 諦めた項目 {len(dead)}")
    used = 0
    for (fid,) in todo:
        for table, path in (("lineups", f"fixtures/lineups?fixture={fid}"),
                            ("stats",   f"fixtures/statistics?fixture={fid}")):
            if (fid, table) in dead:
                continue
            if c.execute(f"SELECT 1 FROM {table} WHERE fixture_id=?",
                         (fid,)).fetchone():
                continue
            if used >= a.budget:
                c.commit()
                print(f"予算到達。{used} リクエスト使用。明日また実行してください。")
                return
            try:
                d = get(path)
            except Exception as e:
                used += 1
                c.execute("""INSERT INTO failures(fixture_id, kind, tries, last_error)
                             VALUES(?,?,1,?)
                             ON CONFLICT(fixture_id, kind) DO UPDATE SET
                               tries = tries + 1, last_error = excluded.last_error""",
                          (fid, table, str(e)))
                c.commit()
                print("skip", fid, table, e)
                time.sleep(a.sleep)
                continue
            c.execute(f"INSERT OR REPLACE INTO {table} VALUES(?,?)",
                      (fid, json.dumps(d["response"], ensure_ascii=False)))
            used += 1
            time.sleep(a.sleep)
        c.commit()
    print(f"完了。{used} リクエスト使用。")


def cmd_export(a) -> None:
    """src.baseline がそのまま食える形（past_fixtures と同じ形状）で書き出す。"""
    c = db()
    rows = c.execute("""SELECT id, season, date, round, home_id, home,
                               away_id, away, gh, ga
                        FROM fixtures WHERE status='FT'
                          AND gh IS NOT NULL AND ga IS NOT NULL
                        ORDER BY date""").fetchall()
    if not rows:
        print("消化済みの試合がありません。先に fixtures を実行してください。")
        return

    past = [{
        "fixture": {"id": r[0], "date": r[2], "status": {"short": "FT"}},
        "league": {"id": LEAGUE, "season": r[1], "round": r[3]},
        "teams": {"home": {"id": r[4], "name": r[5]},
                  "away": {"id": r[6], "name": r[7]}},
        "goals": {"home": r[8], "away": r[9]},
        "score": {"fulltime": {"home": r[8], "away": r[9]}},
    } for r in rows]

    out = ROOT / "data" / "history" / "j1_history.json"
    save_json(out, {
        "_source": "API-Football 無料プラン (2022-2024)",
        "_warning": "LLM腕の採点に使わないこと。ベースライン較正専用。",
        "seasons": SEASONS,
        "league_id": LEAGUE,
        "past_fixtures": past,
    })
    by_season: dict[int, int] = {}
    for r in rows:
        by_season[r[1]] = by_season.get(r[1], 0) + 1
    print(f"書き出し: {out.relative_to(ROOT)}  {len(past)}試合 "
          + " ".join(f"{k}:{v}" for k, v in sorted(by_season.items())))
    print("\n次: python -m tools.calibrate")


def cmd_export_csv(a) -> None:
    """スタメン付き学習用CSV（detail を取得済みの場合のみ意味がある）。"""
    import csv
    c = db()
    out = ROOT / "data" / "history" / "j1_matches.csv"
    out.parent.mkdir(parents=True, exist_ok=True)
    with open(out, "w", newline="", encoding="utf-8") as fp:
        w = csv.writer(fp)
        w.writerow(["fixture_id", "season", "date", "round", "home", "away",
                    "gh", "ga", "ht_h", "ht_a", "home_formation",
                    "away_formation", "home_xi", "away_xi"])
        for r in c.execute("""SELECT f.*, l.raw FROM fixtures f
                              LEFT JOIN lineups l ON l.fixture_id=f.id
                              WHERE f.status='FT' ORDER BY f.date"""):
            lu = json.loads(r[14]) if r[14] else []
            form = {t["team"]["id"]: (t.get("formation"),
                    "|".join(p["player"]["name"] for p in t.get("startXI") or []))
                    for t in lu}
            h, aw = form.get(r[5], (None, None)), form.get(r[7], (None, None))
            w.writerow([r[0], r[1], r[2], r[3], r[6], r[8], r[9], r[10],
                        r[11], r[12], h[0], aw[0], h[1], aw[1]])
    print("書き出し:", out.relative_to(ROOT))


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("fixtures").set_defaults(func=cmd_fixtures)
    d = sub.add_parser("detail")
    d.add_argument("--budget", type=int, default=90)
    d.add_argument("--sleep", type=float, default=DEFAULT_SLEEP,
                   help=f"リクエスト間隔秒。既定 {DEFAULT_SLEEP}（分あたり上限対策）")
    d.add_argument("--i-know-this-is-not-for-llm-arms", action="store_true",
                   dest="i_know_this_is_not_for_llm_arms")
    d.set_defaults(func=cmd_detail)
    sub.add_parser("export").set_defaults(func=cmd_export)
    sub.add_parser("export-csv").set_defaults(func=cmd_export_csv)
    a = p.parse_args()
    a.func(a)
