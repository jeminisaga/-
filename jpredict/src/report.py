"""全節の結果を集計して REPORT.md を書き出す。

  python -m src.report
"""
from __future__ import annotations

import json
import math
from collections import defaultdict
from datetime import datetime, timedelta, timezone

from .api import load_config, ROOT

JST = timezone(timedelta(hours=9))
NAMES = {
    "base:home_fixed": "ホーム固定",
    "base:base_rate": "リーグ基準率",
    "base:poisson": "ポアソン",
    "base:market": "市場オッズ",
    "llm:A": "LLM A(チーム名のみ)",
    "llm:B": "LLM B(+順位・直近)",
    "llm:C": "LLM C(+詳細スタッツ)",
    "llm:D": "LLM D(+スタメン・欠場)",
    "llm:E": "LLM E(+報道)",
}


def main() -> int:
    cfg = load_config()
    rdir = ROOT / cfg["paths"]["results"]
    files = sorted(rdir.glob("round_*.json"))
    if not files:
        print("結果ファイルがありません")
        return 1

    agg = defaultdict(lambda: {"n": 0, "brier": 0.0, "logloss": 0.0, "hit": 0.0})
    rounds = []
    broken = []

    for f in files:
        d = json.loads(f.read_text(encoding="utf-8"))
        rounds.append(d["round"])
        for r in d["scores"]:
            a = agg[r["predictor"]]
            a["n"] += r["n"]
            a["brier"] += r["brier"] * r["n"]
            a["logloss"] += r["logloss"] * r["n"]
            a["hit"] += r["hit_rate"] * r["n"]
        for m in d.get("broken_assumptions", []):
            broken.append({"round": d["round"], **m})

    table = []
    for k, a in agg.items():
        n = a["n"]
        b = a["brier"] / n
        # Brierの標準誤差（試合ごとのBrierを独立と仮定した粗い推定）
        se = 0.35 / math.sqrt(n) if n else 0
        table.append({"key": k, "name": NAMES.get(k, k), "n": n,
                      "brier": b, "se": se,
                      "logloss": a["logloss"] / n, "hit": a["hit"] / n})
    table.sort(key=lambda r: r["brier"])

    lines = [
        "# Jリーグ予測 情報量アブレーション実験",
        "",
        f"更新: {datetime.now(JST).strftime('%Y-%m-%d %H:%M')} JST  ",
        f"対象: 第{min(rounds)}節〜第{max(rounds)}節（{len(rounds)}節）",
        "",
        "Brierスコアは 0 が完璧、0.667 がランダム、2 が最悪。低いほど良い。",
        "的中率は参考値であり、この実験の判定には使わない。",
        "",
        "## 累積スコア",
        "",
        "| 予測者 | 試合数 | Brier | ±SE | LogLoss | 的中率 |",
        "|---|---:|---:|---:|---:|---:|",
    ]
    for r in table:
        lines.append(
            f"| {r['name']} | {r['n']} | **{r['brier']:.4f}** | "
            f"±{r['se']:.3f} | {r['logloss']:.4f} | {r['hit']:.1%} |")

    # アブレーション差分
    lines += ["", "## 情報を1段足したときの効果（Brier差、マイナスが改善）", ""]
    order = ["llm:A", "llm:B", "llm:C", "llm:D", "llm:E"]
    idx = {r["key"]: r for r in table}
    lines.append("| 追加した情報 | Brier変化 | 判定 |")
    lines.append("|---|---:|---|")
    for prev, nxt in zip(order, order[1:]):
        if prev in idx and nxt in idx:
            d = idx[nxt]["brier"] - idx[prev]["brier"]
            se = math.hypot(idx[prev]["se"], idx[nxt]["se"])
            verdict = ("改善" if d < -se else
                       "悪化" if d > se else "差が見えない")
            lines.append(f"| {NAMES[prev]} → {NAMES[nxt]} | {d:+.4f} | {verdict} |")

    # 位置づけ。table は Brier昇順なので、最初に現れる llm: が最良腕。
    best = next((r for r in table if r["key"].startswith("llm:")), None)
    if best and "base:poisson" in idx:
        d = best["brier"] - idx["base:poisson"]["brier"]
        lines += ["", "## LLMはどこに位置したか", "",
                  f"- 最良LLM腕（{best['name']}） vs ポアソン: {d:+.4f}"]
        if "base:market" in idx:
            d2 = best["brier"] - idx["base:market"]["brier"]
            lines.append(f"- 最良LLM腕（{best['name']}） vs 市場オッズ: {d2:+.4f}")
        lines.append("")
        lines.append("※ 差がSEの範囲内なら「差が見えない」が正しい結論。"
                     "サンプルが増えるまで判定を保留する。")

    if broken:
        lines += ["", "## 崩れた前提のログ", ""]
        for b in broken[-20:]:
            lines.append(f"- 第{b['round']}節 {b['match']} → 実際は {b['actual']}")
            lines.append(f"  - 前提: {b['key_assumption']}")

    (ROOT / "REPORT.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print("REPORT.md を更新しました")
    print("\n".join(lines[:20]))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
