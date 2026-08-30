"""予測を確定させる。キックオフ前に実行し、必ずコミットして時刻証拠を残す。

  python -m src.predict --round 5              # A〜C腕 + ベースライン（前日）
  python -m src.predict --round 5 --arms D E   # スタメン取得後（直前）

出力:
  data/predictions/round_05/baselines.json
  prompts/round_05/arm_A.md ...       (mode=prompts)
  data/predictions/round_05/llm_A.json (mode=api なら自動生成)
"""
from __future__ import annotations

import argparse
import json
import subprocess
from datetime import datetime, timedelta, timezone
from pathlib import Path

from . import baseline as bl
from . import features as ft
from . import llm as L
from .api import load_config, save_json, ROOT

JST = timezone(timedelta(hours=9))


def git_head() -> str:
    try:
        return subprocess.check_output(
            ["git", "rev-parse", "--short", "HEAD"], cwd=ROOT,
            stderr=subprocess.DEVNULL).decode().strip()
    except Exception:
        return "no-git"


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--round", type=int, required=True)
    p.add_argument("--arms", nargs="*", default=None)
    args = p.parse_args()

    cfg = load_config()
    rnd = args.round
    raw_path = ROOT / cfg["paths"]["raw"] / f"round_{rnd:02d}.json"
    if not raw_path.exists():
        print(f"{raw_path} がありません。先に src.fetch を実行してください。")
        return 1
    raw = json.loads(raw_path.read_text(encoding="utf-8"))

    fixtures = raw["fixtures"]
    past = raw.get("past_fixtures", [])
    outdir = ROOT / cfg["paths"]["predictions"] / f"round_{rnd:02d}"
    outdir.mkdir(parents=True, exist_ok=True)

    # ---------- ベースライン ----------
    st = bl.fit_strengths(past, cfg["poisson"]["shrinkage_k"])
    base_rate = bl.home_base_rate(past)

    rows = []
    for fx in fixtures:
        m = ft.fixture_meta(fx)
        entry = {**m, "baselines": {}}
        entry["baselines"]["home_fixed"] = bl.home_fixed()
        entry["baselines"]["base_rate"] = base_rate
        pp = bl.poisson_probs(m["home_id"], m["away_id"], st,
                              cfg["poisson"]["home_advantage"],
                              cfg["poisson"]["max_goals"])
        entry["baselines"]["poisson"] = pp
        entry["poisson_scoreline"] = bl.poisson_scoreline(
            m["home_id"], m["away_id"], st, cfg["poisson"]["home_advantage"])
        mk = bl.market_probs(raw.get("odds", []), m["fixture_id"])
        if mk:
            entry["baselines"]["market"] = mk
        rows.append(entry)

    save_json(outdir / "baselines.json", {
        "round": rnd,
        "predicted_at": datetime.now(JST).isoformat(),
        "git": git_head(),
        "poisson_fit": {"games_used": st.get("games"),
                        "league_avg": round(st.get("league_avg", 0), 3),
                        "home_adv_estimated": round(st.get("home_adv", 0), 3)},
        "market_available": any("market" in r["baselines"] for r in rows),
        "matches": rows,
    })
    print(f"ベースライン保存: {len(rows)}試合  "
          f"（ポアソン学習に使った試合数: {st.get('games')}）")

    # ---------- LLM腕 ----------
    # ルール1（バックテストはしない）の機械的な担保。
    # 結果が既に出ている試合にLLM予測を作らせると、測っているのが
    # 「予測」なのか「学習データの想起」なのか永久に区別できなくなる。
    # ベースライン（ポアソン等）は結果を記憶しないのでこの制限を受けない。
    settled = [f for f in fixtures
               if f["fixture"]["status"]["short"] in ("FT", "AET", "PEN")
               or f["goals"]["home"] is not None]
    if settled:
        print(f"""
中止: 第{rnd}節の {len(settled)}/{len(fixtures)} 試合は既に結果が出ています。
結果の出た試合にLLM腕の予測を作らせることはできません（README ルール1）。
LLMが2022-2024のJリーグを学習済みである可能性を排除できないため、
その採点は「予測精度」ではなく「想起の正確さ」を測ってしまいます。

ベースラインは上に保存済みです（統計モデルは結果を記憶しないため過去
シーズンでも有効）。過去シーズンでやるべきなのはベースラインの較正です:
  python -m tools.calibrate
""")
        return 1

    arms = args.arms or list(cfg["arms"].keys())
    mode = cfg["llm"]["mode"]

    for arm in arms:
        spec = cfg["arms"][arm]
        contexts = []
        for fx in fixtures:
            m = ft.fixture_meta(fx)
            body = ft.build_context(fx, raw, spec["blocks"])
            contexts.append(f"fixture_id: {m['fixture_id']}\n"
                            f"キックオフ: {m['kickoff']}\n{body}")

        prompt = L.build_prompt(cfg["league"]["name"], rnd,
                                spec["label"], contexts)

        if mode == "api":
            preds = L.call_api(prompt, cfg["llm"]["model"],
                               cfg["llm"]["max_tokens"])
            save_json(outdir / f"llm_{arm}.json", {
                "round": rnd, "arm": arm, "arm_label": spec["label"],
                "predicted_at": datetime.now(JST).isoformat(),
                "git": git_head(), "model": cfg["llm"]["model"],
                "predictions": [{**L.normalize(x),
                                 "fixture_id": x.get("fixture_id")}
                                for x in preds],
            })
            print(f"  腕{arm}: API実行 → llm_{arm}.json")
        else:
            pf = ROOT / cfg["paths"]["prompts"] / f"round_{rnd:02d}" / f"arm_{arm}.md"
            L.write_prompt_file(pf, prompt)
            print(f"  腕{arm}: プロンプト生成 → {pf.relative_to(ROOT)}")

    if mode != "api":
        print(f"""
次の手順で予測を確定させてください（Claude Code の場合）:

  for A in {' '.join(arms)}; do
    cat prompts/round_{rnd:02d}/arm_$A.md | claude -p \\
      > data/predictions/round_{rnd:02d}/llm_$A.raw
    python -m src.ingest --round {rnd} --arm $A
  done
  git add -A && git commit -m "predict round {rnd}" && git push

※ push した時刻がキックオフ前であることが、この実験の唯一の証拠です。
""")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
