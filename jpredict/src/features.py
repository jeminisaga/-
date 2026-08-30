"""生データから、試合ごと・腕ごとの「入力テキスト」を組み立てる。

アブレーション実験の中核。腕Aから腕Eへ、情報ブロックが単調に増える。
同じ試合に対して腕ごとに別々の予測を出させ、Brierの差分で
「その情報ブロックに価値があったか」を測る。
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any


# ---------- 個別ブロック ----------

def block_teams(fx: dict) -> str:
    h = fx["teams"]["home"]["name"]
    a = fx["teams"]["away"]["name"]
    return f"【対戦】{h}（ホーム） vs {a}（アウェイ）"


def block_standings(fx: dict, raw: dict) -> str:
    table = {}
    for group in raw.get("standings", []):
        for tbl in group.get("league", {}).get("standings", []):
            for row in tbl:
                table[row["team"]["id"]] = row
    lines = ["【順位】"]
    for side in ("home", "away"):
        t = fx["teams"][side]
        r = table.get(t["id"])
        if not r:
            lines.append(f"  {t['name']}: 順位情報なし")
            continue
        al = r["all"]
        lines.append(
            f"  {t['name']}: {r['rank']}位 勝点{r['points']} "
            f"{al['played']}試合 {al['win']}勝{al['draw']}分{al['lose']}敗 "
            f"得{al['goals']['for']}/失{al['goals']['against']}"
        )
    return "\n".join(lines)


def _recent(raw: dict, team_id: int, n: int = 6) -> list[dict]:
    games = [f for f in raw.get("past_fixtures", [])
             if team_id in (f["teams"]["home"]["id"], f["teams"]["away"]["id"])]
    games.sort(key=lambda f: f["fixture"]["date"], reverse=True)
    return games[:n]


def block_recent_form(fx: dict, raw: dict) -> str:
    lines = ["【直近6試合】"]
    for side in ("home", "away"):
        t = fx["teams"][side]
        rows = []
        for g in _recent(raw, t["id"]):
            gh, ga = g["goals"]["home"], g["goals"]["away"]
            is_home = g["teams"]["home"]["id"] == t["id"]
            gf, gaa = (gh, ga) if is_home else (ga, gh)
            res = "○" if (gf or 0) > (gaa or 0) else "△" if gf == gaa else "●"
            opp = g["teams"]["away" if is_home else "home"]["name"]
            venue = "H" if is_home else "A"
            rows.append(f"{res}{gf}-{gaa}({venue} vs {opp})")
        lines.append(f"  {t['name']}: " + " / ".join(rows) if rows
                     else f"  {t['name']}: データなし")
    return "\n".join(lines)


def block_team_stats(fx: dict, raw: dict) -> str:
    lines = ["【詳細スタッツ（今季）】"]
    for side in ("home", "away"):
        t = fx["teams"][side]
        s = raw.get("team_stats", {}).get(str(t["id"]), {})
        if not s or "_error" in s:
            lines.append(f"  {t['name']}: 取得できず")
            continue
        g = s.get("goals", {})
        gf = g.get("for", {}).get("average", {})
        ga = g.get("against", {}).get("average", {})
        fixtures = s.get("fixtures", {})
        cs = s.get("clean_sheet", {})
        lines.append(
            f"  {t['name']}: "
            f"平均得点 全{gf.get('total')} (H{gf.get('home')}/A{gf.get('away')}) / "
            f"平均失点 全{ga.get('total')} (H{ga.get('home')}/A{ga.get('away')}) / "
            f"完封{cs.get('total')} / "
            f"H成績{fixtures.get('wins',{}).get('home')}勝-"
            f"{fixtures.get('draws',{}).get('home')}分-"
            f"{fixtures.get('loses',{}).get('home')}敗"
        )
        if s.get("form"):
            lines.append(f"    フォーム文字列: {s['form'][-10:]}")
    return "\n".join(lines)


def block_h2h(fx: dict, raw: dict) -> str:
    h, a = fx["teams"]["home"]["id"], fx["teams"]["away"]["id"]
    games = raw.get("h2h", {}).get(f"{h}-{a}", [])
    if not games:
        return "【対戦履歴】データなし"
    lines = ["【対戦履歴（直近）】"]
    for g in games[-6:]:
        d = g["fixture"]["date"][:10]
        lines.append(f"  {d} {g['teams']['home']['name']} "
                     f"{g['goals']['home']}-{g['goals']['away']} "
                     f"{g['teams']['away']['name']}")
    return "\n".join(lines)


def block_injuries(fx: dict, raw: dict) -> str:
    ids = {fx["teams"]["home"]["id"], fx["teams"]["away"]["id"]}
    rows = [i for i in raw.get("injuries", [])
            if isinstance(i, dict) and i.get("team", {}).get("id") in ids]
    if not rows:
        return "【欠場】情報なし（取得できていない可能性あり）"
    by_team: dict[str, list[str]] = {}
    for i in rows:
        by_team.setdefault(i["team"]["name"], []).append(
            f"{i['player']['name']}({i['player'].get('reason','?')})")
    lines = ["【欠場・負傷】"]
    for k, v in by_team.items():
        lines.append(f"  {k}: " + ", ".join(sorted(set(v))[:12]))
    return "\n".join(lines)


def block_rest_days(fx: dict, raw: dict) -> str:
    kickoff = datetime.fromisoformat(fx["fixture"]["date"].replace("Z", "+00:00"))
    lines = ["【日程間隔】"]
    for side in ("home", "away"):
        t = fx["teams"][side]
        rec = _recent(raw, t["id"], n=1)
        if not rec:
            lines.append(f"  {t['name']}: 前戦不明")
            continue
        prev = datetime.fromisoformat(
            rec[0]["fixture"]["date"].replace("Z", "+00:00"))
        days = (kickoff - prev).days
        note = "（過密）" if days <= 3 else ""
        lines.append(f"  {t['name']}: 中{days}日{note}")
    return "\n".join(lines)


def block_lineups(fx: dict, raw: dict) -> str:
    fid = str(fx["fixture"]["id"])
    lu = raw.get("lineups", {}).get(fid)
    if not lu or isinstance(lu, dict):
        return "【スタメン】未発表（この時点では取得できていない）"
    lines = ["【スタメン】"]
    for team in lu:
        names = [p["player"]["name"] for p in team.get("startXI", [])]
        lines.append(f"  {team['team']['name']} [{team.get('formation')}]: "
                     + ", ".join(names))
    return "\n".join(lines)


def block_news(fx: dict, raw: dict) -> str:
    """E腕用。news/<fixture_id>.txt に手動 or 別スクリプトで置いたテキストを読む。
    無ければ空。E腕の価値検証は「入れると悪化するか」を見るのが目的。"""
    txt = raw.get("news", {}).get(str(fx["fixture"]["id"]), "")
    if not txt:
        return "【報道・文脈】なし"
    return "【報道・文脈】\n" + txt.strip()[:2000]


BLOCKS = {
    "teams": block_teams,
    "standings": block_standings,
    "recent_form": block_recent_form,
    "team_stats": block_team_stats,
    "h2h": block_h2h,
    "injuries": block_injuries,
    "rest_days": block_rest_days,
    "lineups": block_lineups,
    "news": block_news,
}


def build_context(fx: dict, raw: dict, blocks: list[str]) -> str:
    parts = []
    for name in blocks:
        fn = BLOCKS[name]
        parts.append(fn(fx) if name == "teams" else fn(fx, raw))
    return "\n\n".join(parts)


def fixture_meta(fx: dict) -> dict[str, Any]:
    return {
        "fixture_id": fx["fixture"]["id"],
        "kickoff": fx["fixture"]["date"],
        "home": fx["teams"]["home"]["name"],
        "away": fx["teams"]["away"]["name"],
        "home_id": fx["teams"]["home"]["id"],
        "away_id": fx["teams"]["away"]["id"],
    }
