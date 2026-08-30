"""キックオフ直前にだけスタメンを取得する。

API-Football のラインナップは試合の20〜40分前に利用可能になるため、
「45分前〜キックオフ」の窓に入っている試合がある場合だけAPIを叩く。
窓外なら1リクエストも消費せずに終了する（fixture時刻はキャッシュ済み）。

GitHub Actions から1時間ごとに呼ぶ想定。

  python -m src.lineup_watch --round 5
  python -m src.lineup_watch --round 5 --window 45
"""
from __future__ import annotations

import argparse
import json
from datetime import datetime, timedelta, timezone

from .api import ApiFootball, load_config, save_json, ROOT

JST = timezone(timedelta(hours=9))


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--round", type=int, required=True)
    p.add_argument("--window", type=int, default=45, help="キックオフ何分前から取りにいくか")
    args = p.parse_args()

    cfg = load_config()
    raw_path = ROOT / cfg["paths"]["raw"] / f"round_{args.round:02d}.json"
    if not raw_path.exists():
        print("raw がありません。先に src.fetch を実行してください。")
        return 1

    raw = json.loads(raw_path.read_text(encoding="utf-8"))
    now = datetime.now(timezone.utc)

    due = []
    for f in raw["fixtures"]:
        ko = datetime.fromisoformat(f["fixture"]["date"].replace("Z", "+00:00"))
        delta = (ko - now).total_seconds() / 60
        fid = str(f["fixture"]["id"])
        already = raw.get("lineups", {}).get(fid)
        has_xi = isinstance(already, list) and already
        if -10 <= delta <= args.window and not has_xi:
            due.append(f)

    if not due:
        print(f"取得対象なし（{now.astimezone(JST):%m/%d %H:%M} JST）。API消費 0")
        return 0

    api = ApiFootball(cfg)
    raw.setdefault("lineups", {})
    got = 0
    for f in due:
        fid = f["fixture"]["id"]
        try:
            lu = api.get("/fixtures/lineups", {"fixture": fid}, force=True)
            if lu:
                raw["lineups"][str(fid)] = lu
                got += 1
                print(f"  取得: {f['teams']['home']['name']} vs "
                      f"{f['teams']['away']['name']}")
            else:
                print(f"  未発表: {f['teams']['home']['name']} vs "
                      f"{f['teams']['away']['name']}")
        except Exception as e:
            print(f"  失敗: {fid} {e}")

    raw["lineups_checked_at"] = datetime.now(JST).isoformat()
    save_json(raw_path, raw)
    print(f"{got}件のスタメンを取得。残り目安 {api.remaining()}")

    if got:
        print("→ D腕・E腕の予測を実行してください:")
        print(f"   python -m src.predict --round {args.round} --arms D E")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
