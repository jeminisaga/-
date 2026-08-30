"""LLMと同じ土俵で採点するベースライン。

  1. home_fixed : ホーム勝ち固定（思考しないbot）→ 下限
  2. poisson    : 得失点のシュリンケージ推定 + 独立ポアソン → 統計の素朴な下限
  3. market     : ブックメーカーのオッズをマージン除去して確率化 → 事実上の上限

LLMがこの3つのどこに位置するかが、この実験の答え。
"""
from __future__ import annotations

import math
from collections import defaultdict


# ---------- 1. ホーム固定 ----------

def home_fixed() -> dict[str, float]:
    return {"home": 1.0, "draw": 0.0, "away": 0.0}


def home_base_rate(past: list[dict]) -> dict[str, float]:
    """実測のリーグ基準率。home_fixed より賢い「無思考」版。"""
    c = {"home": 0, "draw": 0, "away": 0}
    for f in past:
        gh, ga = f["goals"]["home"], f["goals"]["away"]
        if gh is None:
            continue
        c["home" if gh > ga else "draw" if gh == ga else "away"] += 1
    n = sum(c.values()) or 1
    return {k: v / n for k, v in c.items()}


# ---------- 2. ポアソン ----------

def fit_strengths(past: list[dict], shrinkage_k: float = 6.0) -> dict:
    """各チームの攻撃力・守備力をリーグ平均比で推定し、試合数で縮小する。

    序盤はn=3程度しかないので、最尤推定より縮小推定のほうが安定する。
    weight = n / (n + k) でリーグ平均へ引き寄せる。
    """
    gf, ga, n = defaultdict(float), defaultdict(float), defaultdict(int)
    tot_h = tot_a = games = 0

    for f in past:
        h, a = f["teams"]["home"]["id"], f["teams"]["away"]["id"]
        gh, gaw = f["goals"]["home"], f["goals"]["away"]
        if gh is None or gaw is None:
            continue
        gf[h] += gh; ga[h] += gaw; n[h] += 1
        gf[a] += gaw; ga[a] += gh; n[a] += 1
        tot_h += gh; tot_a += gaw; games += 1

    if games == 0:
        return {"ok": False}

    league_avg = (tot_h + tot_a) / (2 * games)     # 1チーム1試合あたり得点
    home_adv = (tot_h / games) / max(tot_a / games, 1e-9)

    atk, dfn = {}, {}
    for t in n:
        w = n[t] / (n[t] + shrinkage_k)
        atk[t] = 1.0 + w * ((gf[t] / n[t]) / league_avg - 1.0)
        dfn[t] = 1.0 + w * ((ga[t] / n[t]) / league_avg - 1.0)

    return {"ok": True, "atk": atk, "dfn": dfn,
            "league_avg": league_avg, "home_adv": home_adv, "games": games}


def _pois(k: int, lam: float) -> float:
    return math.exp(-lam) * lam ** k / math.factorial(k)


def poisson_probs(home_id: int, away_id: int, st: dict,
                  home_advantage: float | None = None,
                  max_goals: int = 8) -> dict[str, float]:
    if not st.get("ok"):
        return {"home": 1 / 3, "draw": 1 / 3, "away": 1 / 3}

    ha = home_advantage if home_advantage is not None else st["home_adv"]
    ha = min(max(ha, 1.0), 1.4)   # 暴走防止
    base = st["league_avg"]
    atk, dfn = st["atk"], st["dfn"]

    lam_h = base * atk.get(home_id, 1.0) * dfn.get(away_id, 1.0) * math.sqrt(ha)
    lam_a = base * atk.get(away_id, 1.0) * dfn.get(home_id, 1.0) / math.sqrt(ha)
    lam_h, lam_a = max(lam_h, 0.15), max(lam_a, 0.15)

    ph = [_pois(i, lam_h) for i in range(max_goals + 1)]
    pa = [_pois(i, lam_a) for i in range(max_goals + 1)]

    p = {"home": 0.0, "draw": 0.0, "away": 0.0}
    for i, x in enumerate(ph):
        for j, y in enumerate(pa):
            q = x * y
            p["home" if i > j else "draw" if i == j else "away"] += q
    s = sum(p.values())
    out = {k: v / s for k, v in p.items()}
    out["_lambda"] = [round(lam_h, 3), round(lam_a, 3)]
    return out


def poisson_scoreline(home_id: int, away_id: int, st: dict,
                      home_advantage: float | None = None,
                      max_goals: int = 6) -> str:
    if not st.get("ok"):
        return "1-1"
    p = poisson_probs(home_id, away_id, st, home_advantage, max_goals)
    lam_h, lam_a = p["_lambda"]
    best, score = -1.0, "1-1"
    for i in range(max_goals + 1):
        for j in range(max_goals + 1):
            q = _pois(i, lam_h) * _pois(j, lam_a)
            if q > best:
                best, score = q, f"{i}-{j}"
    return score


# ---------- 3. 市場オッズ ----------

def market_probs(odds_rows: list, fixture_id: int) -> dict[str, float] | None:
    """1X2オッズをマージン除去(比例配分)して確率化。

    複数ブックメーカーがある場合は各社を確率化してから中央値→再正規化。
    """
    cands = []
    for row in odds_rows:
        if not isinstance(row, dict):
            continue
        if row.get("fixture", {}).get("id") != fixture_id:
            continue
        for bm in row.get("bookmakers", []):
            for bet in bm.get("bets", []):
                if bet.get("name") not in ("Match Winner", "1x2"):
                    continue
                vals = {v["value"].lower(): float(v["odd"])
                        for v in bet.get("values", []) if v.get("odd")}
                keys = {"home": vals.get("home"), "draw": vals.get("draw"),
                        "away": vals.get("away")}
                if not all(keys.values()):
                    continue
                inv = {k: 1 / v for k, v in keys.items()}
                s = sum(inv.values())
                cands.append({k: v / s for k, v in inv.items()})

    if not cands:
        return None

    med = {}
    for k in ("home", "draw", "away"):
        xs = sorted(c[k] for c in cands)
        med[k] = xs[len(xs) // 2]
    s = sum(med.values())
    return {k: v / s for k, v in med.items()}
