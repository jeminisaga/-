"""Claude Code などの出力(.raw)を正規化して llm_X.json にする。

  python -m src.ingest --round 5 --arm A
"""
from __future__ import annotations

import argparse
from datetime import datetime, timedelta, timezone

from . import llm as L
from .api import load_config, save_json, ROOT

JST = timezone(timedelta(hours=9))


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--round", type=int, required=True)
    p.add_argument("--arm", required=True)
    p.add_argument("--file", default=None)
    args = p.parse_args()

    cfg = load_config()
    d = ROOT / cfg["paths"]["predictions"] / f"round_{args.round:02d}"
    src = ROOT / args.file if args.file else d / f"llm_{args.arm}.raw"
    if not src.exists():
        print(f"{src} がありません")
        return 1

    preds = L.extract_json(src.read_text(encoding="utf-8"))
    out = [{**L.normalize(x), "fixture_id": x.get("fixture_id")} for x in preds]

    save_json(d / f"llm_{args.arm}.json", {
        "round": args.round,
        "arm": args.arm,
        "arm_label": cfg["arms"][args.arm]["label"],
        "ingested_at": datetime.now(JST).isoformat(),
        "predictions": out,
    })
    bad = sum(1 for x in out if x.get("_normalize_error"))
    print(f"腕{args.arm}: {len(out)}件取り込み" + (f"（うち不正 {bad}件）" if bad else ""))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
