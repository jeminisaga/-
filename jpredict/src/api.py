"""API-Football クライアント。

無料枠(100 req/day)を守るための設計:
  - 全レスポンスを data/raw/ に JSON キャッシュ。同じ引数なら再取得しない
  - 1日の消費数を data/raw/_quota.json でカウント。上限で例外
  - force=True を明示したときだけキャッシュを無視
"""
from __future__ import annotations

import hashlib
import json
import os
import time
from datetime import date
from pathlib import Path
from typing import Any

import requests
import yaml

ROOT = Path(__file__).resolve().parent.parent


def load_config() -> dict:
    with open(ROOT / "config.yaml", encoding="utf-8") as f:
        return yaml.safe_load(f)


class QuotaExceeded(RuntimeError):
    pass


class ApiFootball:
    def __init__(self, config: dict | None = None, api_key: str | None = None):
        self.cfg = config or load_config()
        self.key = api_key or os.environ.get("APIFOOTBALL_KEY")
        if not self.key:
            raise RuntimeError("環境変数 APIFOOTBALL_KEY が未設定です")
        self.base = self.cfg["api"]["base_url"]
        self.timeout = self.cfg["api"]["timeout"]
        self.budget = self.cfg["api"]["daily_budget"]
        self.raw = ROOT / self.cfg["paths"]["raw"]
        self.raw.mkdir(parents=True, exist_ok=True)
        self.quota_file = self.raw / "_quota.json"

    # ---------- quota ----------
    def _quota(self) -> dict:
        today = date.today().isoformat()
        if self.quota_file.exists():
            q = json.loads(self.quota_file.read_text())
            if q.get("date") == today:
                return q
        return {"date": today, "used": 0}

    def _bump(self) -> None:
        q = self._quota()
        q["used"] += 1
        self.quota_file.write_text(json.dumps(q))

    def remaining(self) -> int:
        return self.budget - self._quota()["used"]

    # ---------- cache ----------
    def _cache_path(self, endpoint: str, params: dict) -> Path:
        key = json.dumps({"e": endpoint, "p": params}, sort_keys=True)
        h = hashlib.sha1(key.encode()).hexdigest()[:16]
        safe = endpoint.strip("/").replace("/", "_")
        return self.raw / f"{safe}__{h}.json"

    def get(self, endpoint: str, params: dict | None = None,
            force: bool = False, ttl_hours: float | None = None) -> dict:
        """endpoint 例: '/fixtures'。ttl_hours を指定するとその時間で失効。"""
        params = params or {}
        cache = self._cache_path(endpoint, params)

        if cache.exists() and not force:
            payload = json.loads(cache.read_text(encoding="utf-8"))
            fresh = ttl_hours is None or (
                time.time() - payload.get("_fetched_at", 0) < ttl_hours * 3600
            )
            if fresh:
                return payload["response"]

        if self.remaining() <= 0:
            raise QuotaExceeded(
                f"本日のリクエスト上限 {self.budget} に到達。翌日に再実行してください。"
            )

        r = requests.get(
            self.base + endpoint,
            headers={"x-apisports-key": self.key},
            params=params,
            timeout=self.timeout,
        )
        self._bump()
        r.raise_for_status()
        body = r.json()

        if body.get("errors"):
            raise RuntimeError(f"API error: {body['errors']}")

        payload = {
            "_fetched_at": time.time(),
            "_endpoint": endpoint,
            "_params": params,
            "response": body.get("response", []),
            "results": body.get("results"),
        }
        cache.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
        return payload["response"]


def save_json(path: Path, obj: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, ensure_ascii=False, indent=2), encoding="utf-8")
