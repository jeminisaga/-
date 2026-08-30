"""最初に1回だけ実行する調査スクリプト。

やること:
  1. 日本のリーグ一覧から J1 の league_id を特定
  2. 対象シーズンの coverage フラグを表示（何が取れるかの自己申告）
  3. 直近のfixtureで lineups が試合前に埋まるかを実測できる形で提示

消費リクエスト: 1〜2
実行: APIFOOTBALL_KEY=xxx python -m src.discover
"""
from __future__ import annotations

import sys

from .api import ApiFootball, load_config

KEYS = ["events", "lineups", "statistics_fixtures", "statistics_players"]
TOP = ["standings", "players", "top_scorers", "injuries", "predictions", "odds"]


def main() -> int:
    cfg = load_config()
    api = ApiFootball(cfg)

    leagues = api.get("/leagues", {"country": "Japan"})
    if not leagues:
        print("日本のリーグが取得できませんでした。キーとプランを確認してください。")
        return 1

    print("=== 日本のリーグ一覧 ===")
    target = None
    for item in leagues:
        lg = item["league"]
        seasons = [s["year"] for s in item["seasons"]]
        print(f"  id={lg['id']:<6} {lg['name']:<28} type={lg['type']:<6} "
              f"seasons={seasons[-4:]}")
        if lg["name"].strip().lower() in ("j1 league", "j. league division 1"):
            target = item

    if target is None:
        print("\nJ1 が自動判定できませんでした。上の一覧から id を config.yaml に手入力してください。")
        return 1

    lid = target["league"]["id"]
    print(f"\n=== J1 league_id = {lid} ===")
    print("config.yaml の league.id にこの値を設定してください。\n")

    print("=== シーズン別 coverage ===")
    for s in target["seasons"][-3:]:
        cov = s.get("coverage", {})
        fx = cov.get("fixtures", {})
        print(f"\n[season {s['year']}] {s.get('start')} 〜 {s.get('end')} "
              f"current={s.get('current')}")
        print("  fixtures: " + "  ".join(
            f"{k}={str(fx.get(k)):5}" for k in KEYS))
        print("  other   : " + "  ".join(
            f"{k}={str(cov.get(k)):5}" for k in TOP))

    print("""
--- 判断ポイント ---
lineups            : false なら D腕(スタメン込み)は成立しない → 腕をA〜Cに縮小
statistics_fixtures: false なら C腕が薄くなる → 代替ソースを検討
odds               : false ならベースライン3(市場)が無料では取れない
                     → 上限ラインが不明のまま走ることになる（実験としては成立する）
injuries           : false なら D腕から欠場情報が抜ける

次: python -m src.fetch --round next  で1節分を取得
""")
    return 0


if __name__ == "__main__":
    sys.exit(main())
