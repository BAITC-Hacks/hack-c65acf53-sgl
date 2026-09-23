"""Deterministic city pulse. Only baseline and Q8 contain numeric observations.

Issue IDs identify district/indicator pairs across runs. Event IDs additionally
identify a run, branch and observation; regenerating a bundle is idempotent.
No global user state is stored, and callers must pass simulator results, never
client-supplied numeric state. Values below 60 remain active issues.
"""
from collections import Counter
import re
from uuid import uuid4

from city_simulator import DISTRICTS, MEASURES, WEIGHTS
from presentation import INDICATORS

DISTRICT_IDS = {"Есиль": "yesil", "Алматы": "almaty", "Сарыарка": "saryarka",
                "Байконур": "baikonur", "Нура": "nura"}
CATEGORIES = dict(zip("TESBC", ("transport", "ecology", "social", "safety", "services")))
SEVERITY_LABELS = {"critical": "Критическая проблема", "high": "Высокий приоритет",
                   "attention": "Требует внимания", "normal": "В пределах нормы модели"}
# These appeals describe a modeled concern, not a real complaint or statistic.
CONCERNS = {
    "T1": "Хотелось бы, чтобы по району было удобнее передвигаться.",
    "T2": "Доступность общественного транспорта требует внимания.",
    "E1": "Хотелось бы больше внимания к озеленению района.",
    "E2": "Качество воздуха остаётся важной темой для района.",
    "S1": "Школы и детсады требуют особого внимания.",
    "S2": "Доступность первичной медицинской помощи требует внимания.",
    "B1": "Хотелось бы чувствовать себя безопаснее на улицах.",
    "B2": "Безопасность дорожного движения требует внимания.",
    "C1": "Надёжность коммунальных сетей остаётся важной темой.",
    "C2": "Хотелось бы, чтобы обращения решались лучше.",
}


def severity(value):
    return "critical" if value < 40 else "high" if value < 50 else "attention" if value < 60 else "normal"


def identity(run_id=None, branch="main"):
    if branch not in ("main", "alternative"):
        raise ValueError("Неизвестная ветка")
    if run_id is None:
        run_id = uuid4().hex
    if not isinstance(run_id, str) or not re.fullmatch(r"[a-zA-Z0-9_-]{1,64}", run_id):
        raise ValueError("Некорректный run_id")
    return run_id, branch


def draft_plan(plan):
    """Validate identity/scope of partial selections without pretending it is runnable.

    Budget, incompatibilities and direction limits remain the existing validator's
    responsibility. Advisors can discuss an over-budget draft without scoring it.
    """
    if not isinstance(plan, list) or len(plan) > 5:
        raise ValueError("Ожидается план из не более пяти мер")
    seen, selections = set(), []
    for item in plan:
        if not isinstance(item, dict) or set(item) - {"measure_id", "district"}:
            raise ValueError("Некорректная мера")
        key, district = item.get("measure_id"), item.get("district")
        if not isinstance(key, str) or key not in MEASURES or key in seen:
            raise ValueError("Неизвестная или повторная мера")
        m = MEASURES[key]
        if (m.scope == "Район" and (not isinstance(district, str) or district not in DISTRICTS)
                or m.scope == "Город" and district is not None):
            raise ValueError("Некорректный район меры")
        seen.add(key)
        selections.append({"measure_id": key, "district": district})
    return selections


def related_projects(name, code, plan, positive_only=False):
    return sorted(s["measure_id"] for s in plan
                  if (s.get("district") == name or MEASURES[s["measure_id"]].scope == "Город")
                  and (MEASURES[s["measure_id"]].effects.get(code, 0) > 0 if positive_only
                       else MEASURES[s["measure_id"]].effects.get(code, 0) != 0))


def detect_issues(result=None, plan=()):
    """All weak pairs, ordered by value, weight, then stable identity (no randomness)."""
    issues = []
    for name, district in DISTRICTS.items():
        values = result["districts"][name]["after"] if result else district.indicators
        for code, value in values.items():
            if value >= 60:
                continue
            before = district.indicators[code]
            related = related_projects(name, code, plan)
            issues.append({"id": f"{DISTRICT_IDS[name]}:{code}", "district": name,
                           "indicator": code, "indicator_code": code, "title": INDICATORS[code],
                           "category": CATEGORIES[code[0]], "severity": severity(value),
                           "before": before, "value": value, "delta": value - before,
                           "status": ("improved" if value > before else "unresolved") if result else
                                     ("planned" if related_projects(name, code, plan, True) else "new"),
                           "related_projects": related, "is_synthetic": True,
                           "source_basis": "final" if result else "baseline",
                           "source": "template", "message": CONCERNS[code]})
    return sorted(issues, key=lambda a: (a["value"], -WEIGHTS[a["indicator"]], a["id"]))


def top_per_district(issues, limit=2):
    counts, chosen = Counter(), []
    for issue in issues:
        if counts[issue["district"]] < limit:
            chosen.append(issue)
            counts[issue["district"]] += 1
    return chosen


def advisor(issues, plan, result=None, district=None):
    ranked = [i for i in issues if district is None or i["district"] == district]
    priority = ranked[0] if ranked else None
    counts = dict(sorted(Counter(MEASURES[s["measure_id"]].direction for s in plan).items()))
    untouched = next((i for i in ranked if not related_projects(i["district"], i["indicator"], plan, True)), None)
    best = max(result["districts"], key=lambda n: result["districts"][n]["score_delta"]) if result else None
    return {"priority": priority, "direction_counts": counts, "untouched": untouched,
            "biggest_gain": {"district": best, "delta": result["districts"][best]["score_delta"]} if best else None,
            "recommendations": [key for key, m in MEASURES.items()
                                if priority and m.effects.get(priority["indicator"], 0) > 0],
            "basis": "final" if result else "baseline",
            "message": (f"Приоритет — {priority['title'].lower()}: {priority['district']}. "
                        + CONCERNS[priority["indicator"]]) if priority else "Слабых показателей по порогу модели нет."}


def city_state(plan=(), result=None):
    issues = detect_issues(result, plan)
    return {"issues": issues, "map_issue_ids": [i["id"] for i in top_per_district(issues, 3)],
            "advisor": advisor(issues, plan, result),
            "district_advisors": {name: advisor(issues, plan, result, name) for name in DISTRICTS}}


def wording_variants(event):
    """Closed, fact-safe paraphrases. AI may select prose, never add propositions.

    A blacklist cannot guarantee truthful unrestricted prose. Exact membership
    deliberately provides that guarantee for the phase-2 presentation layer.
    """
    message = event["message"]
    if event["event_type"] == "activation":
        return [message, message.replace("Начинает работать", "В модели начинает действовать", 1)]
    return [message, "В учебной модели: " + message[0].lower() + message[1:]]


def event_bundle(plan=(), result=None, run_id="initial", branch="main"):
    run_id, branch = identity(run_id, branch)
    baseline, final = city_state(plan), city_state(plan, result) if result else None
    events = {}

    def add(key, quarter, event_type, message, **facts):
        event_id = f"{run_id}:{branch}:{key}"
        event = {"event_id": event_id, "run_id": run_id, "branch": branch, "quarter": quarter,
                 "event_type": event_type, "is_synthetic": True, "message": message,
                 "source": "template", **facts}
        event["allowed_messages"] = wording_variants(event)
        events.setdefault(event_id, event)

    for issue in top_per_district(baseline["issues"]):
        facts = {k: issue[k] for k in ("district", "indicator", "category", "severity", "before", "value", "title")}
        # Q0 history records the baseline concern, never later planning annotations.
        add(f"q0:{issue['id']}", 0, "resident_complaint", issue["message"], issue_id=issue["id"],
            trend="unknown", related_projects=[], source_basis="baseline", **facts)
    if result:
        for s in sorted(plan, key=lambda p: p["measure_id"]):
            key = s["measure_id"]
            m = MEASURES[key]
            add(f"activation:{key}", m.lag + 1, "activation",
                f"Начинает работать проект «{m.name}». Проверенные изменения будут доступны в конце симуляции.",
                district=s.get("district"), category=CATEGORIES[next(iter(m.effects))[0]],
                title=m.name, related_projects=[key], source_basis="catalog_activation",
                target_indicators=[INDICATORS[c] for c in m.effects])
        remaining = {i["id"] for i in top_per_district(final["issues"])}
        for name, d in result["districts"].items():
            for code, value in d["after"].items():
                before, delta = d["before"][code], d["delta"][code]
                issue_id = f"{DISTRICT_IDS[name]}:{code}"
                if not delta and issue_id not in remaining:
                    continue
                trend = "improved" if delta > 0 else "worsened" if delta < 0 else "unchanged"
                message = ("Показатель улучшился." if delta > 0 else "Показатель снизился." if delta < 0
                           else "Показатель не изменился.")
                message += " Проблема сохраняется и требует внимания." if value < 60 else " По порогу модели показатель в пределах нормы."
                add(f"q8:{issue_id}", 8, "reaction" if delta else "remaining_problem", message,
                    district=name, indicator=code, title=INDICATORS[code], category=CATEGORIES[code[0]],
                    severity=severity(value), before=before, value=value, delta=delta,
                    trend=trend, related_projects=related_projects(name, code, plan),
                    issue_id=issue_id, source_basis="final")
    # Advisor wording has the same contract/cache, but is not a historical event.
    for stage in [baseline] + ([final] if final else []):
        for scope, advice in [("city", stage["advisor"]), *stage["district_advisors"].items()]:
            p = advice["priority"]
            advice["wording"] = {"event_id": f"{run_id}:{branch}:advisor:{advice['basis']}:{scope}",
                "run_id": run_id, "branch": branch, "event_type": "advisor", "message": advice["message"],
                "source_basis": advice["basis"], "district": p["district"] if p else None,
                "title": p["title"] if p else None, "severity": p["severity"] if p else "normal"}
            advice["wording"]["allowed_messages"] = wording_variants(advice["wording"])
    return {"run_id": run_id, "branch": branch, "initial": baseline, "final": final,
            "events": sorted(events.values(), key=lambda e: (e["quarter"], e["event_id"]))}


def wording_items(bundle):
    items = list(bundle["events"])
    for stage in (bundle["initial"], bundle["final"]):
        if stage:
            items.extend(a["wording"] for a in [stage["advisor"], *stage["district_advisors"].values()])
    return items
