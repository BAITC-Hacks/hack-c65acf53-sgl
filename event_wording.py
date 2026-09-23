"""Optional batched presentation wording with bounded, process-local LRU cache.

Only approved prose is accepted. Even a schema-valid hallucination falls back.
Cache keys exclude run/branch identity but include all semantic event content.
"""
from collections import OrderedDict
from hashlib import sha256
import json
from threading import Lock

from reports import configured, request_json
from city_events import wording_items

PROMPT_VERSION = "city-pulse-safe-prose-v1"
_cache = OrderedDict()
_lock = Lock()
_request_lock = Lock()
CACHE_LIMIT = 512


def cache_key(event):
    facts = {k: v for k, v in event.items() if k not in ("event_id", "run_id", "branch", "source")}
    return sha256(json.dumps([PROMPT_VERSION, facts], sort_keys=True, ensure_ascii=False).encode()).hexdigest()


def enrich(bundle, event_ids=None):
    """Return wording patches only; the browser keeps the immutable facts.

    The caller reconstructs this bundle from validated catalog/plan facts. Client
    event IDs are only a filter, never a source of city state or instructions.
    """
    items = wording_items(bundle)
    if event_ids is not None:
        if (not isinstance(event_ids, list) or len(event_ids) > 80
                or any(not isinstance(i, str) for i in event_ids)
                or not set(event_ids).issubset({e["event_id"] for e in items})):
            raise ValueError("Неизвестные event_id")
        items = [e for e in items if e["event_id"] in event_ids]
    messages = {e["event_id"]: {"event_id": e["event_id"], "message": e["message"], "source": "template"} for e in items}
    if configured() and items:
        # Single flight across HTTP worker threads; simulation never takes this lock.
        with _request_lock:
            missing = []
            for e in items:
                key = cache_key(e)
                with _lock:
                    cached = _cache.get(key)
                    if cached is not None:
                        _cache.move_to_end(key)
                if cached is None:
                    missing.append(e)
                else:
                    messages[e["event_id"]].update(message=cached, source="ai")
            if missing:
                schema = {"type": "object", "additionalProperties": False, "required": ["items"],
                    "properties": {"items": {"type": "array", "items": {"type": "object",
                        "additionalProperties": False, "required": ["event_id", "message"],
                        "properties": {"event_id": {"type": "string"}, "message": {"type": "string"}}}}}}
                try:
                    value = request_json([
                        {"role": "system", "content":
                         "Ты редактор синтетических обращений учебного симулятора. Для каждого event_id "
                         "выбери ровно один естественный текст из allowed_messages, дословно. Это полный список "
                         "разрешённых утверждений. Не добавляй и не пересчитывай значения, оценки, бюджет, "
                         "эффекты, жителей, адреса, школы, даты, сроки ожидания, статистику, проценты, "
                         "измерения загрязнения или факты завершения проектов. До финала есть только "
                         "исходные проблемы и факт начала работы из каталога. Улучшение не означает "
                         "решения проблемы. Не выбирай проекты. Верни только items с event_id и message."},
                        {"role": "user", "content": json.dumps(missing, ensure_ascii=False)}
                    ], schema, "city_event_wording")
                    if not isinstance(value, dict) or set(value) != {"items"} or not isinstance(value["items"], list):
                        raise ValueError("Invalid wording envelope")
                    expected = {e["event_id"]: e for e in missing}
                    accepted = {}
                    for patch in value["items"]:
                        if not isinstance(patch, dict) or set(patch) != {"event_id", "message"}:
                            raise ValueError("Invalid wording item")
                        eid, message = patch["event_id"], patch["message"]
                        if (not isinstance(eid, str) or eid not in expected or eid in accepted
                                or not isinstance(message, str) or not 1 <= len(message) <= 500
                                or message not in expected[eid]["allowed_messages"]):
                            raise ValueError("Unsupported wording")
                        accepted[eid] = message
                    if set(accepted) != set(expected):
                        raise ValueError("Missing wording")
                    with _lock:
                        for eid, message in accepted.items():
                            _cache[cache_key(expected[eid])] = message
                            messages[eid].update(message=message, source="ai")
                        while len(_cache) > CACHE_LIMIT:
                            _cache.popitem(last=False)
                except (OSError, ValueError, TypeError, KeyError, IndexError):
                    pass  # Fallback already present; no mutation of facts, no failed run.
    return {"run_id": bundle["run_id"], "branch": bundle["branch"], "items": list(messages.values())}
