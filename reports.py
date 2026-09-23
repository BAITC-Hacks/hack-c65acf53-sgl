"""Optional server-side Chat Completions adapter; credentials never reach the browser."""
import json
import os
from urllib.request import Request, urlopen
from urllib.parse import urlparse

from city_simulator import CitySimulator
from presentation import INDICATORS, compare, explain


def configured():
    return bool((os.getenv("LLM_API_KEY") or os.getenv("OPENAI_API_KEY")) and os.getenv("LLM_MODEL"))


def request_json(messages, schema, name="city_report"):
    base = os.getenv("LLM_BASE_URL", "https://api.openai.com/v1").rstrip("/")
    parsed = urlparse(base)
    if parsed.scheme != "https" and not (parsed.scheme == "http" and parsed.hostname in {"localhost", "127.0.0.1", "::1"}):
        raise ValueError("API требует HTTPS или локальный адрес")
    payload = {"model": os.environ["LLM_MODEL"], "messages": messages,
               "response_format": {"type": "json_schema", "json_schema": {
                   "name": name, "strict": True, "schema": schema}}}
    request = Request(base + "/chat/completions", data=json.dumps(payload).encode("utf-8"), headers={
        "Authorization": "Bearer " + (os.getenv("LLM_API_KEY") or os.environ["OPENAI_API_KEY"]),
        "Content-Type": "application/json"})
    with urlopen(request, timeout=35) as response:
        raw = response.read(262145)
    if len(raw) > 262144:
        raise ValueError("Ответ слишком большой")
    message = json.loads(raw)["choices"][0]["message"]
    if message.get("refusal"):
        raise ValueError("Модель отказалась формировать отчёт")
    return json.loads(message["content"])


def validate_report(report):
    if not isinstance(report, dict) or set(report) != {"summary", "strengths", "risks", "recommendation"}:
        raise ValueError("Некорректная структура AI-отчёта")
    for key in ("summary", "recommendation"):
        if not isinstance(report[key], str) or not report[key].strip() or len(report[key]) > 12000:
            raise ValueError("Некорректный текст AI-отчёта")
    for key in ("strengths", "risks"):
        if not isinstance(report[key], list) or len(report[key]) > 30:
            raise ValueError("Некорректный список AI-отчёта")
        if any(not isinstance(item, str) or len(item) > 12000 for item in report[key]):
            raise ValueError("Некорректный пункт AI-отчёта")
    return report


def generate_report(result, reference=None):
    fallback = {"source": "calculation", "report": explain(result)}
    if not configured():
        return {**fallback, "notice": "AI не настроен. Показано объяснение по формулам модели."}
    try:
        prompt = CitySimulator.build_report_prompt(result)
        prompt["messages"][0]["content"] += "\nОфициальные названия показателей: " + json.dumps(INDICATORS, ensure_ascii=False)
        if reference is not None:
            prompt["messages"].append({"role": "user", "content": json.dumps({
                "reference_plan": reference,
                "current_minus_reference": compare(reference, result),
                "instruction": "Объясни также различия текущего плана и сохранённого. Дельты уже посчитаны.",
            }, ensure_ascii=False)})
        return {"source": "ai", "report": validate_report(request_json(prompt["messages"], prompt["report_schema"]))}
    except (OSError, ValueError, KeyError, IndexError, TypeError):
        return {**fallback, "notice": "AI-сервис недоступен или вернул некорректный ответ. Показано объяснение по расчётам."}
