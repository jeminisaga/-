"""合成データ用のオフライン採点ドライバ。

src.settle は結果を API から取りにいくので、APIキーなしでは動かない。
このドライバは round_99.json（合成データ）の未消化fixtureに架空の
スコアを埋め、ApiFootball を差し替えて src.settle.main() をそのまま
呼ぶ。採点ロジック本体には一切手を入れない。

  python -m tools.settle_offline --seed 42
"""
from __future__ import annotations

import argparse
import json
import random
import sys

from src.api import load_config, ROOT
from src import settle as S

ROUND = 99


class StubApi:
    """settle が呼ぶ get() だけを実装した差し替え用クライアント。"""

    def __init__(self, finished: list[dict]):
        self._finished = finished

    def __call__(self, *a, **kw):        # ApiFootball(cfg) の呼び出しを受ける
        return self

    def get(self, endpoint, params=None, force=False, ttl_hours=None):
        if endpoint != "/fixtures":
            raise RuntimeError(f"想定外のエンドポイント: {endpoint}")
        return self._finished


def simulate(raw: dict, seed: int) -> list[dict]:
    rng = random.Random(seed)
    out = []
    for f in raw["fixtures"]:
        g = json.loads(json.dumps(f))
        gh, ga = rng.randint(0, 3), rng.randint(0, 3)
        g["goals"] = {"home": gh, "away": ga}
        g["score"]["fulltime"] = {"home": gh, "away": ga}
        g["fixture"]["status"]["short"] = "FT"
        out.append(g)
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--seed", type=int, default=42)
    args = ap.parse_args()

    cfg = load_config()
    raw_path = ROOT / cfg["paths"]["raw"] / f"round_{ROUND:02d}.json"
    raw = json.loads(raw_path.read_text(encoding="utf-8"))
    if not raw.get("_synthetic"):
        print("round_99.json が合成データではありません。中止します。")
        return 1

    S.ApiFootball = StubApi(simulate(raw, args.seed))
    sys.argv = ["settle", "--round", str(ROUND)]
    return S.main()


if __name__ == "__main__":
    raise SystemExit(main())
