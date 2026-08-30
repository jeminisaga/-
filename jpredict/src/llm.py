"""LLM層。2モードを持つ。

mode: "prompts"（既定・追加課金なし）
    プロンプトを prompts/round_XX/arm_A.md 等に書き出すだけ。
    Claude Code で以下のように流し込む:
        cat prompts/round_05/arm_A.md | claude -p > data/predictions/round_05/llm_A.json
    サブスクリプションの範囲で動くので、API従量課金が発生しない。

mode: "api"
    Anthropic API を直接呼ぶ。ANTHROPIC_API_KEY が必要（従量課金）。
    GitHub Actions で完全自動化したい場合はこちら。
"""
from __future__ import annotations

import json
import os
import re
from pathlib import Path

SYSTEM = """あなたはサッカーの試合結果を確率で予測するアナリストです。

厳守事項:
- 与えられた情報だけを根拠にする。記憶や推測でチームの近況を補わない。
- 情報が乏しい場合は、確率を平坦（引き分け寄り）にする。自信のないときに
  極端な確率を出すのが最悪の失敗です。
- home / draw / away の3値の合計は必ず 1.0 にする。
- 出力はJSONのみ。前置き・後書き・マークダウンのコードフェンスを一切書かない。
"""

USER_TEMPLATE = """以下は {league} 第{round}節の {n} 試合です。
各試合について、与えられた情報のみを根拠に勝敗確率を出してください。

情報量の条件: {arm_label}
（この条件で与えられていない種類の情報は、存在しないものとして扱ってください）

--- 試合情報 ---
{contexts}
--- ここまで ---

次のJSON配列だけを出力してください。

[
  {{
    "fixture_id": <整数>,
    "home": <0-1の小数>,
    "draw": <0-1の小数>,
    "away": <0-1の小数>,
    "scoreline": "<最も可能性の高いスコア 例 1-1>",
    "key_assumption": "<この予測が依拠している前提を1文。これが崩れると予測は外れる>",
    "confidence": "<low|mid|high>"
  }}
]
"""


def build_prompt(league: str, rnd: int, arm_label: str,
                 contexts: list[str]) -> str:
    joined = "\n\n========================================\n\n".join(contexts)
    return USER_TEMPLATE.format(league=league, round=rnd, n=len(contexts),
                                arm_label=arm_label, contexts=joined)


def write_prompt_file(path: Path, prompt: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(SYSTEM + "\n\n---\n\n" + prompt, encoding="utf-8")


def extract_json(text: str):
    """コードフェンスや前置きが混ざっても配列を取り出す。"""
    text = text.strip()
    text = re.sub(r"^```(?:json)?|```$", "", text, flags=re.MULTILINE).strip()
    start = text.find("[")
    end = text.rfind("]")
    if start == -1 or end == -1:
        raise ValueError("JSON配列が見つかりません:\n" + text[:400])
    return json.loads(text[start:end + 1])


def call_api(prompt: str, model: str, max_tokens: int) -> list:
    """mode='api' 用。anthropic パッケージが必要。"""
    from anthropic import Anthropic

    client = Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])
    resp = client.messages.create(
        model=model,
        max_tokens=max_tokens,
        system=SYSTEM,
        messages=[{"role": "user", "content": prompt}],
    )
    text = "".join(b.text for b in resp.content if b.type == "text")
    return extract_json(text)


def normalize(pred: dict) -> dict:
    """合計1に正規化。壊れた出力は一様分布に落とす。

    落としたことは out["_normalize_error"] で呼び出し側に伝える。
    黙って一様分布にすり替わると、LLMが壊れた出力を出した節と
    「自信がないので平坦にした」節が採点上まったく区別できなくなる。
    """
    try:
        v = {k: max(float(pred.get(k, 0)), 0.0) for k in ("home", "draw", "away")}
        s = sum(v.values())
        if s <= 0:
            raise ValueError
        out = {k: x / s for k, x in v.items()}
    except Exception:
        out = {"home": 1 / 3, "draw": 1 / 3, "away": 1 / 3, "_normalize_error": True}
    out["scoreline"] = pred.get("scoreline")
    out["key_assumption"] = pred.get("key_assumption")
    out["confidence"] = pred.get("confidence")
    return out
