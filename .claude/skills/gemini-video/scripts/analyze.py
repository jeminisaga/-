#!/usr/bin/env python3
"""Gemini video understanding (agentic / static) for Claude Code.

Examples:
  analyze.py --url https://www.youtube.com/watch?v=XXXX --preset hook
  analyze.py --file ./clip.mp4 --preset clips --question "笑いのピークは?"
  analyze.py --url URL --preset qa --question "CTAは何回?" --start 0:00 --end 5:00
  analyze.py --self-check --live
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

# --------------------------------------------------------------------------
# models
# --------------------------------------------------------------------------
# 実在するモデル名のみ（google-genai の Model リテラルに準拠）。
# 先頭から順に試し、404 / model-not-supported のときだけ次に落とす。
DEFAULT_MODEL = "gemini-3.7-flash"
FALLBACK_MODELS = ["gemini-3.6-flash", "gemini-flash-latest"]

# Files API の上限（2GB）。これを超えるものは事前に弾く。
MAX_UPLOAD_BYTES = 2 * 1024**3

# 一時エラーとみなして同一モデルで再試行するHTTPステータス
TRANSIENT_STATUS = {408, 429, 500, 502, 503, 504}
# モデルを次候補に落とすHTTPステータス
MODEL_SWITCH_STATUS = {400, 403, 404}

YOUTUBE_HOSTS = {
    "youtube.com",
    "www.youtube.com",
    "m.youtube.com",
    "music.youtube.com",
    "youtu.be",
    "www.youtu.be",
}

# --------------------------------------------------------------------------
# prompts
# --------------------------------------------------------------------------
# 全presetで共通の出力ルール。両APIとも system_instruction として渡す。
SYSTEM_RULES = """あなたは動画を分析するアシスタントです。以下を必ず守ってください。

- 出力は日本語。
- タイムスタンプは MM:SS（1時間超は H:MM:SS）。実際に確認した時刻だけを書く。
- 映像で確認した事実と、推論を分ける。推論には必ず「推測:」を付ける。
- 見えない/聞き取れないものは「不明」と書く。埋めない。
- 前置き・要約の繰り返し・締めの定型文は書かない。本文だけ出す。"""

PRESETS: dict[str, str] = {
    "hook": """この動画の冒頭フックを分解してください。

必ず含める:
1. 0:00-0:08 / 0:08-0:15 / 0:15-0:30 の3区間で、画面・音声・テロップを分けて記述
2. 最初の約束（視聴者が得ると期待するもの）
3. フックの型（問題提起 / 結果先出し / デモ / 対立 / 数字 など）
4. 改善案を3つ。今の素材を活かす前提で具体的に（撮り直し前提の案は分けて書く）
""",
    "structure": """この動画の構成をタイムスタンプ付きで分解してください。

各セクションに:
- 開始-終了
- 役割（導入/問題/方法/実証/CTA など）
- 画面で起きていること（1行）
- 話している主張（1行）

最後に:
- 全体の型（例: フック→問題→解決→証拠→CTA）
- 冗長な区間（時刻と、なぜ冗長か）
""",
    "clips": """ショート/切り抜き候補を抽出してください。

候補は最大8本。各候補:
- 開始-終了（15-45秒を目安。外れるなら理由）
- 1行フック案
- なぜ単体で成立するか
- 画面上の決めカット（時刻）
- 注意（文脈欠落、権利、説明不足）

優先: 結論が早い / ビジュアル変化がある / 数字・ビフォーアフターがある区間。
最後に、単体成立の強さで1位から並べ直す。
""",
    "competitor": """YouTube競合分析として見てください。運営者が翌日マネできる粒度で。

1. 誰向けか（1行）
2. タイトル/サムネが動画本体とどう接続しているか（分かる範囲）
3. フック、中盤の維持装置、CTA
4. 情報密度（高い/普通/低い）と、そう判断した根拠の時刻
5. 真似してよい型 3つ
6. 真似しなくてよい点 3つ（理由: 属人性/予算/尺 など）
7. 自分のチャンネルに移植するなら最初の1本の企画案（タイトル案込み）
""",
    "retention": """視聴維持の観点で、離脱しそうな地点を特定してください。

- 離脱リスクが高い時刻を最大6箇所。各箇所に:
  - 時刻（区間）
  - 何が起きているか（画面/音声）
  - なぜ離脱を招くか（間延び / 話題の飛躍 / 情報が出てこない / 画に変化がない など）
  - その場で直すなら何をするか（カット / テロップ / Bロール / 順序入替）
- 逆に、引き戻せている地点を最大3箇所（時刻と理由）
- 尺を20%削るとしたらどこを削るか、時刻で列挙
""",
    "chapters": """YouTube章立て案を作ってください。

制約:
- 各章タイトルは全角28字以内
- 開始時刻 MM:SS、最初の章は 0:00
- 章は内容が変わる点で切る。機械的な等間隔は禁止
- 各章に説明を1行

最後に、概要欄にそのまま貼れる形（時刻＋タイトルのみ）を再掲。
""",
    "edit": """編集者向けのショットリストを作ってください。

タイムスタンプ必須。
- 残すべきカット
- 切ってよい間（フィラー、沈黙、言い直し）
- Bロールを足すべき箇所（何の画か）
- テロップ推奨（時刻＋文言案）
- 音量/間の問題
""",
    "qa": """ユーザーの質問に、根拠となるタイムスタンプを付けて答えてください。
質問に答えることだけをする。関係ない分析は足さない。""",
}


# --------------------------------------------------------------------------
# helpers
# --------------------------------------------------------------------------
def force_utf8_io() -> None:
    """Windows は stdout がパイプだと locale encoding（日本語環境では cp932）になり、
    モデル出力に cp932 に無い文字が混ざると UnicodeEncodeError で落ちる。UTF-8 に固定する。"""
    for stream in (sys.stdout, sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)
        if reconfigure is None:
            continue
        try:
            reconfigure(encoding="utf-8", errors="replace")
        except (ValueError, OSError):
            pass


def log(msg: str) -> None:
    print(f"[gemini-video] {msg}", file=sys.stderr)


def die(msg: str, code: int = 1) -> None:
    log(msg)
    sys.exit(code)


def load_dotenv_nearby() -> None:
    """cwd / cwd の親（gitルートまで）/ home / スキルディレクトリの .env を読む。"""
    candidates: list[Path] = []
    cwd = Path.cwd()
    for parent in [cwd, *cwd.parents][:6]:
        candidates.append(parent / ".env")
    candidates.append(Path.home() / ".env")
    candidates.append(Path(__file__).resolve().parent.parent / ".env")

    seen: set[Path] = set()
    for candidate in candidates:
        if candidate in seen or not candidate.is_file():
            continue
        seen.add(candidate)
        try:
            raw_text = candidate.read_text(encoding="utf-8")
        except OSError:
            continue
        for raw in raw_text.splitlines():
            line = raw.strip()
            if line.startswith("export "):
                line = line[len("export "):].strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, val = line.partition("=")
            key = key.strip()
            val = val.strip()
            if val[:1] in {'"', "'"} and val[-1:] == val[:1] and len(val) >= 2:
                val = val[1:-1]
            else:
                # クォートなしの場合のみ行末コメントを落とす
                val = val.split(" #", 1)[0].strip()
            if key and key not in os.environ:
                os.environ[key] = val


def parse_timecode(value: str | None) -> str | None:
    """'90' / '1:30' / '0:01:30' / '90s' -> '90s'（API が要求する秒表記）。"""
    if value is None:
        return None
    text = value.strip().lower().rstrip("s")
    if not text:
        return None
    try:
        parts = [float(p) for p in text.split(":")]
    except ValueError:
        die(f"時刻の書式が不正です: {value}（例: 90 / 1:30 / 0:01:30）")
    seconds = 0.0
    for part in parts:
        seconds = seconds * 60 + part
    if seconds < 0:
        die(f"時刻が負です: {value}")
    return f"{seconds:g}s"


def normalize_youtube_url(url: str) -> str:
    """youtu.be / shorts / live を watch 形式に寄せ、非YouTubeは弾く。"""
    match = re.match(r"^https?://([^/?#]+)(/[^?#]*)?", url.strip())
    if not match:
        die(f"URL として解釈できません: {url}")
    host = match.group(1).lower()
    path = match.group(2) or ""
    if host not in YOUTUBE_HOSTS:
        die(
            f"Gemini API の URL 入力は公開 YouTube のみ対応です（受け取った host: {host}）。"
            " ダウンロードして --file で渡してください。"
        )
    video_id = None
    if host.endswith("youtu.be"):
        video_id = path.strip("/").split("/")[0]
    else:
        for prefix in ("/shorts/", "/live/", "/embed/", "/v/"):
            if path.startswith(prefix):
                video_id = path[len(prefix):].split("/")[0]
                break
    if video_id:
        return f"https://www.youtube.com/watch?v={video_id}"
    return url.strip()


def build_prompt(preset: str, question: str | None) -> str:
    """出力ルールは system_instruction 側で渡すので、ここはタスク本文のみ。"""
    base = PRESETS[preset]
    if not question:
        return base
    return f"{base}\n\n追加の分析観点:\n{question.strip()}\n"


# interactions は low/medium/high/ultra_high、generate_content は ULTRA_HIGH 非対応
def generate_content_resolution(resolution: str | None) -> str | None:
    if not resolution:
        return None
    level = "HIGH" if resolution == "ultra_high" else resolution.upper()
    return f"MEDIA_RESOLUTION_{level}"


def status_code_of(exc: Exception) -> int | None:
    for attr in ("code", "status_code"):
        val = getattr(exc, attr, None)
        if isinstance(val, int):
            return val
    match = re.search(r"\b(4\d\d|5\d\d)\b", str(exc))
    return int(match.group(1)) if match else None


def is_transient(exc: Exception) -> bool:
    code = status_code_of(exc)
    if code in TRANSIENT_STATUS:
        return True
    if code is not None:
        return False
    text = str(exc).lower()
    return any(k in text for k in ("timeout", "timed out", "connection", "temporarily"))


def should_switch_model(exc: Exception) -> bool:
    code = status_code_of(exc)
    if code in MODEL_SWITCH_STATUS:
        text = str(exc).lower()
        return any(
            k in text
            for k in ("model", "not found", "not supported", "unsupported", "unavailable")
        )
    return False


def is_fatal_auth(exc: Exception) -> bool:
    """キーが無効なら再試行もモデル切替も無意味。無効キーは 400 API_KEY_INVALID で返る。"""
    code = status_code_of(exc)
    text = str(exc).lower()
    if code in {401, 403} and any(
        k in text for k in ("api key", "api_key", "credential", "permission", "unauthenticated")
    ):
        return True
    return "api_key_invalid" in text or "api key not valid" in text


# --------------------------------------------------------------------------
# files API
# --------------------------------------------------------------------------
def wait_file_active(client, uploaded, timeout_s: int):
    name = uploaded.name
    started = time.time()
    current = uploaded
    delay = 2.0
    while True:
        state = getattr(current, "state", None)
        state_name = (getattr(state, "name", None) or str(state or "")).upper()
        if state_name in {"ACTIVE", "SUCCEEDED", "READY"}:
            return current
        if state_name in {"FAILED", "ERROR"}:
            reason = getattr(current, "error", None)
            die(f"Files API の処理が失敗しました: {state_name} {reason or ''}".strip())
        if time.time() - started > timeout_s:
            die(f"動画の処理待ちが {timeout_s}s でタイムアウトしました")
        log(f"processing file state={state_name or 'UNKNOWN'} ({int(time.time() - started)}s) ...")
        time.sleep(delay)
        delay = min(delay * 1.5, 15.0)
        current = client.files.get(name=name)


def delete_upload(client, file_name: str | None) -> None:
    if not file_name:
        return
    try:
        client.files.delete(name=file_name)
        log(f"deleted upload {file_name}")
    except Exception as exc:  # noqa: BLE001 - 後始末の失敗で本処理を落とさない
        log(f"アップロード済みファイルの削除に失敗（48時間で自動失効）: {exc}")


# --------------------------------------------------------------------------
# response parsing
# --------------------------------------------------------------------------
def extract_text(result) -> str:
    """テキストが取れなければ空文字を返す（repr をそのまま出力しない）。"""
    if result is None:
        return ""
    for attr in ("output_text", "text"):
        val = getattr(result, attr, None)
        if isinstance(val, str) and val.strip():
            return val
    parts: list[str] = []
    for cand in getattr(result, "candidates", None) or []:
        content = getattr(cand, "content", None)
        for part in getattr(content, "parts", None) or []:
            if getattr(part, "thought", False):
                continue
            text = getattr(part, "text", None)
            if text:
                parts.append(text)
    return "\n".join(parts)


def finish_reason_of(result) -> str | None:
    for cand in getattr(result, "candidates", None) or []:
        reason = getattr(cand, "finish_reason", None)
        if reason:
            return getattr(reason, "name", None) or str(reason)
    for attr in ("status", "finish_reason", "stop_reason"):
        val = getattr(result, attr, None)
        if val:
            return getattr(val, "name", None) or str(val)
    return None


def usage_dict(result) -> dict:
    usage = getattr(result, "usage", None) or getattr(result, "usage_metadata", None)
    if usage is None:
        return {}
    if hasattr(usage, "model_dump"):
        try:
            dumped = usage.model_dump(exclude_none=True)
            return {k: v for k, v in dumped.items() if isinstance(v, (int, float, str))}
        except Exception:  # noqa: BLE001
            pass
    out = {}
    for key in (
        "total_tokens",
        "total_input_tokens",
        "total_output_tokens",
        "total_thought_tokens",
        "total_tool_use_tokens",
        "prompt_token_count",
        "candidates_token_count",
        "total_token_count",
    ):
        val = getattr(usage, key, None)
        if val is not None:
            out[key] = val
    return out


# --------------------------------------------------------------------------
# API calls
# --------------------------------------------------------------------------
def build_processing(processing: str, start: str | None, end: str | None, fps: float | None):
    """clip/fps 指定があれば static オブジェクト形式、無ければ文字列。"""
    if start is None and end is None and fps is None:
        return processing
    block: dict = {"type": "static"}
    if start:
        block["start_offset"] = start
    if end:
        block["end_offset"] = end
    if fps:
        block["fps"] = fps
    return block


def call_interactions(client, model, video_block, prompt, timeout_s):
    return client.interactions.create(
        model=model,
        input=[video_block, {"type": "text", "text": prompt}],
        system_instruction=SYSTEM_RULES,
        timeout=timeout_s,
    )


def call_generate_content(client, model, uri, mime, processing, resolution, start, end, fps, prompt, timeout_s):
    from google.genai import types

    file_kwargs = {"file_uri": uri}
    if mime:
        file_kwargs["mime_type"] = mime

    part_kwargs: dict = {"file_data": types.FileData(**file_kwargs)}
    if start or end or fps:
        vm: dict = {}
        if start:
            vm["start_offset"] = start
        if end:
            vm["end_offset"] = end
        if fps:
            vm["fps"] = fps
        part_kwargs["video_metadata"] = types.VideoMetadata(**vm)
        part_kwargs["media_processing"] = "STATIC"
    else:
        part_kwargs["media_processing"] = processing.upper()

    config: dict = {
        "system_instruction": SYSTEM_RULES,
        "http_options": {"timeout": int(timeout_s * 1000)},
    }
    media_resolution = generate_content_resolution(resolution)
    if media_resolution:
        config["media_resolution"] = media_resolution

    try:
        return client.models.generate_content(
            model=model,
            contents=[types.Part(**part_kwargs), prompt],
            config=config,
        )
    except TypeError:
        # 古いSDKで media_resolution / media_processing が無い場合は落として再試行
        part_kwargs.pop("media_processing", None)
        config.pop("media_resolution", None)
        return client.models.generate_content(
            model=model,
            contents=[types.Part(**part_kwargs), prompt],
            config=config,
        )


def run_with_retries(fn, *, models: list[str], max_retries: int, label: str):
    """モデル候補を順に、各モデルで一時エラーのみ指数バックオフ再試行。"""
    last_exc: Exception | None = None
    for model in models:
        for attempt in range(max_retries + 1):
            try:
                return fn(model), model
            except Exception as exc:  # noqa: BLE001
                last_exc = exc
                if is_fatal_auth(exc):
                    die(
                        "APIキーが無効です。GEMINI_API_KEY を確認してください"
                        " (https://aistudio.google.com/apikey)"
                    )
                if is_transient(exc) and attempt < max_retries:
                    wait = 4 * (3**attempt)
                    log(f"{label}: 一時エラー（{model}）。{wait}s 後に再試行: {exc}")
                    time.sleep(wait)
                    continue
                if should_switch_model(exc) and model != models[-1]:
                    log(f"{label}: {model} が使えません。次のモデルへ: {exc}")
                    break
                raise
    if last_exc:
        raise last_exc
    raise RuntimeError("no model candidates")


# --------------------------------------------------------------------------
# main flow
# --------------------------------------------------------------------------
def analyze(args) -> dict:
    try:
        from google import genai
    except ImportError:
        die("google-genai が未インストールです:  pip3 install -U google-genai")

    api_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
    if not api_key:
        die("GEMINI_API_KEY（または GOOGLE_API_KEY）が設定されていません")

    start = parse_timecode(args.start)
    end = parse_timecode(args.end)
    if start and end and float(start[:-1]) >= float(end[:-1]):
        die(f"--start ({args.start}) は --end ({args.end}) より前である必要があります")

    processing = args.processing
    if (start or end or args.fps) and processing == "agentic":
        log("--start/--end/--fps 指定のため processing=static に切り替えます")
        processing = "static"

    client = genai.Client(api_key=api_key)
    prompt = build_prompt(args.preset, args.question)

    models = [args.model] + [m for m in FALLBACK_MODELS if m != args.model]

    uri: str | None = None
    mime: str | None = None
    upload_name: str | None = None

    if args.url:
        uri = args.url
        source = uri
    else:
        path = Path(args.file_path).expanduser().resolve()
        if not path.is_file():
            die(f"ファイルがありません: {path}")
        size = path.stat().st_size
        if size > MAX_UPLOAD_BYTES:
            die(
                f"Files API の上限 2GB を超えています（{size / 1024**3:.1f}GB）。"
                " ffmpeg で分割するか、解像度を落として再エンコードしてください"
                " (--start/--end はサーバー側の処理範囲指定なので、アップロード量は減りません)"
            )
        log(f"uploading {path.name} ({size / 1024**2:.1f}MB) ...")
        uploaded = client.files.upload(file=str(path))
        uploaded = wait_file_active(client, uploaded, args.upload_timeout)
        uri = uploaded.uri
        mime = uploaded.mime_type
        upload_name = uploaded.name
        source = str(path)

    video_block: dict = {
        "type": "video",
        "uri": uri,
        "processing": build_processing(processing, start, end, args.fps),
    }
    if mime:
        video_block["mime_type"] = mime
    if args.resolution:
        video_block["resolution"] = args.resolution

    clip_note = f" clip={args.start or '0'}-{args.end or 'end'}" if (start or end) else ""
    log(f"model={models[0]} processing={processing} preset={args.preset}{clip_note}")

    try:
        result = None
        used_api = "interactions"
        used_model = models[0]
        first_error: Exception | None = None
        try:
            result, used_model = run_with_retries(
                lambda m: call_interactions(client, m, video_block, prompt, args.timeout),
                models=models,
                max_retries=args.max_retries,
                label="interactions",
            )
        except Exception as exc:  # noqa: BLE001
            first_error = exc
            log(f"interactions API 失敗、generate_content にフォールバック: {exc}")
            used_api = "generate_content"
            try:
                result, used_model = run_with_retries(
                    lambda m: call_generate_content(
                        client, m, uri, mime, processing, args.resolution,
                        start, end, args.fps, prompt, args.timeout,
                    ),
                    models=models,
                    max_retries=args.max_retries,
                    label="generate_content",
                )
            except Exception as exc2:  # noqa: BLE001
                die(
                    "Gemini 呼び出しに失敗しました。\n"
                    f"  interactions: {first_error}\n"
                    f"  generate_content: {exc2}"
                )

        text = extract_text(result).strip()
        if not text:
            reason = finish_reason_of(result) or "不明"
            die(
                f"モデルから空の応答が返りました（finish_reason={reason}）。"
                " --preset qa で質問を短くする、または --resolution low で再試行してください。"
            )
    finally:
        if upload_name and not args.keep_upload:
            delete_upload(client, upload_name)

    return {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "source": source,
        "model": used_model,
        "processing": processing,
        "resolution": args.resolution,
        "clip": f"{args.start or ''}-{args.end or ''}".strip("-") or None,
        "fps": args.fps,
        "preset": args.preset,
        "question": args.question,
        "api": used_api,
        "usage": usage_dict(result),
        "text": text,
    }


def render_markdown(payload: dict) -> str:
    usage = payload.get("usage") or {}
    meta = [
        ("source", payload.get("source")),
        ("model", payload.get("model")),
        ("processing", payload.get("processing")),
        ("resolution", payload.get("resolution")),
        ("clip", payload.get("clip")),
        ("fps", payload.get("fps")),
        ("preset", payload.get("preset")),
        ("question", payload.get("question")),
        ("api", payload.get("api")),
        ("generated_at", payload.get("generated_at")),
        ("usage", ", ".join(f"{k}={v}" for k, v in usage.items()) or None),
    ]
    lines = ["# Gemini video analysis", ""]
    lines += [f"- {k}: {v}" for k, v in meta if v not in (None, "")]
    lines += ["", "## Result", "", payload.get("text", "").rstrip(), ""]
    return "\n".join(lines)


def self_check(live: bool) -> None:
    ok = True
    try:
        import google.genai  # noqa: F401

        version = getattr(google.genai, "__version__", "?")
        print(f"ok: google-genai ({version})")
    except ImportError:
        print("ng: google-genai 未インストール -> pip3 install -U google-genai")
        ok = False

    key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
    if key:
        print(f"ok: API key (…{key[-4:]})")
    else:
        print("ng: GEMINI_API_KEY / GOOGLE_API_KEY なし")
        ok = False

    if live and ok:
        try:
            from google import genai

            client = genai.Client(api_key=key)
            names = [m.name for m in list(client.models.list())[:200]]
            print(f"ok: API 疎通（{len(names)} models）")
            for candidate in [DEFAULT_MODEL, *FALLBACK_MODELS]:
                hit = any(candidate in (n or "") for n in names)
                print(f"{'ok' if hit else '--'}: {candidate}")
        except Exception as exc:  # noqa: BLE001
            print(f"ng: API 疎通に失敗: {exc}")
            ok = False
    elif live:
        print("--: 前提が満たされないため疎通確認はスキップ")

    sys.exit(0 if ok else 2)


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description="Gemini video understanding for Claude Code",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    src = p.add_mutually_exclusive_group()
    src.add_argument("--url", help="公開YouTube URL")
    src.add_argument("--file", dest="file_path", help="ローカル動画ファイル")

    p.add_argument("--preset", default="structure", choices=sorted(PRESETS), help="分析テンプレ")
    p.add_argument("--question", help="追加質問。--preset qa では必須")

    p.add_argument("--model", default=os.environ.get("GEMINI_VIDEO_MODEL", DEFAULT_MODEL))
    p.add_argument("--processing", default="agentic", choices=["agentic", "static"])
    p.add_argument("--resolution", choices=["low", "medium", "high", "ultra_high"],
                   help="トークン量と精度のトレードオフ。長尺は low を検討")
    p.add_argument("--start", help="開始時刻 (例: 1:30 / 90 / 0:01:30)。指定すると static 処理になる")
    p.add_argument("--end", help="終了時刻。同上")
    p.add_argument("--fps", type=float, help="サンプリングfps (0 < fps <= 24)。同上")

    p.add_argument("--timeout", type=float, default=900, help="API 1回あたりの上限秒")
    p.add_argument("--upload-timeout", type=int, default=900, help="アップロード後の処理待ち上限秒")
    p.add_argument("--max-retries", type=int, default=2, help="一時エラー時の再試行回数（モデルごと）")
    p.add_argument("--keep-upload", action="store_true", help="アップロードしたファイルを削除しない")

    p.add_argument("--out", type=Path, help="Markdownの保存先")
    p.add_argument("--dump-json", type=Path, help="メタデータ込みJSONの保存先")
    p.add_argument("--quiet", action="store_true", help="標準出力へのMarkdown出力を抑止（--out と併用）")
    p.add_argument("--self-check", action="store_true", help="依存関係とAPIキーを確認")
    p.add_argument("--live", action="store_true", help="--self-check でAPI疎通も確認")

    args = p.parse_args(argv)

    if args.self_check:
        return args
    if not args.url and not args.file_path:
        p.error("--url か --file のどちらかが必要です")
    if args.preset == "qa" and not args.question:
        p.error("--preset qa には --question が必要です")
    if args.fps is not None and not (0 < args.fps <= 24):
        p.error("--fps は 0 より大きく 24 以下です")
    if args.quiet and not args.out:
        p.error("--quiet は --out と一緒に使ってください")
    if args.url:
        # SDK やキーを要求する前に、直せる入力ミスを先に潰す
        args.url = normalize_youtube_url(args.url)
    return args


def main() -> None:
    force_utf8_io()
    load_dotenv_nearby()
    args = parse_args()
    if args.self_check:
        self_check(args.live)
        return

    payload = analyze(args)
    md = render_markdown(payload)

    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(md, encoding="utf-8")
        log(f"wrote {args.out}")
    if args.dump_json:
        args.dump_json.parent.mkdir(parents=True, exist_ok=True)
        args.dump_json.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        log(f"wrote {args.dump_json}")
    if not args.quiet:
        print(md)


if __name__ == "__main__":
    main()
