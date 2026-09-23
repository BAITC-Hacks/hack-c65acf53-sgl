"""Game events derived from model data. No random facts or AI-generated scores."""
from city_simulator import CitySimulator, DISTRICTS, MEASURES, PlanValidationError
from presentation import INDICATORS, compare, explain

CATEGORIES = {"T": "Транспорт", "E": "Экология", "S": "Соцсфера", "B": "Безопасность", "C": "Сервисы"}
VOICES = {
    "T1": ("Водитель", "Дорога домой снова затянулась. Хотелось бы тратить меньше времени в пробках."),
    "T2": ("Пассажир", "Хочется добираться на работу общественным транспортом без долгого ожидания."),
    "E1": ("Житель района", "В районе не хватает зелёных мест для прогулок. Нам нужен парк рядом с домом."),
    "E2": ("Житель района", "Хочется чаще открывать окна и гулять с детьми. Чистый воздух для нас очень важен."),
    "S1": ("Родитель", "Найти место в школе рядом с домом непросто. Надеемся на новые учебные места."),
    "S2": ("Пенсионер", "Хотелось бы получать первичную медицинскую помощь ближе к дому."),
    "B1": ("Житель района", "Вечером хочется чувствовать себя спокойнее на улицах. Нужны свет и безопасные дворы."),
    "B2": ("Родитель", "Дорога в школу должна быть безопасной. Обратите внимание на переходы."),
    "C1": ("Житель района", "Хотелось бы меньше переживать за воду и отопление. Надёжность сетей важна каждый день."),
    "C2": ("Предприниматель", "Хочется понимать, когда решат обращение, и получать ответ вовремя."),
}


def severity(value):
    return "critical" if value < 40 else "high" if value < 50 else "medium" if value < 60 else "normal"


def appeals(result=None, plan=()):
    """Keep baseline issue IDs after simulation, even when their severity changes."""
    items = []
    for name, district in DISTRICTS.items():
        weakest = sorted(district.indicators, key=district.indicators.get)[:2]
        for code in weakest:
            before = district.indicators[code]
            if before >= 60:
                continue
            after = result["districts"][name]["after"][code] if result else before
            planned = any(MEASURES[s["measure_id"]].effects.get(code, 0) > 0
                          and (MEASURES[s["measure_id"]].scope == "Город" or s.get("district") == name)
                          for s in plan if s.get("measure_id") in MEASURES)
            role, message = VOICES[code]
            items.append({"id": f"{name}-{code}", "district": name, "category": CATEGORIES[code[0]],
                          "indicator_code": code, "severity": severity(after), "initial_severity": severity(before),
                          "title": INDICATORS[code], "message": message, "resident_type": role,
                          "status": ("improved" if after > before else "unresolved") if result else ("planned" if planned else "new"),
                          "is_synthetic": True, "source": "template", "before": before, "value": after})
    return items


def aftermath(result):
    reactions = []
    for name, district in result["districts"].items():
        best = max(district["delta"], key=district["delta"].get)
        weak = min(district["after"], key=district["after"].get)
        gain = district["delta"][best]
        message = (f"{INDICATORS[best]}: стало лучше ({gain:+.2f}). " if gain > 0 else "Заметных улучшений показателей в нашем районе не произошло. ")
        message += f"{INDICATORS[weak]} остаётся приоритетом: {district['after'][weak]:.2f} из 100."
        reactions.append({"district": name, "resident_type": "Житель района", "sentiment": "mixed" if gain > 0 else "negative",
                          "message": message, "linked_indicators": list(dict.fromkeys([best, weak])), "source": "template"})
    # A concrete remaining weakness is the deterministic anchor of the question.
    candidates = [(d["after"][k], name, k) for name, d in result["districts"].items() for k in INDICATORS]
    value, name, code = min(candidates)
    question = f"Вы потратили {result['total_cost']} из 100 единиц бюджета. В районе {name} показатель «{INDICATORS[code]}» остался на уровне {value:.2f}. Как вы объясните выбранные приоритеты и этот компромисс?"
    return {"citizen_reactions": reactions, "press_question": {"question": question, "district": name,
            "linked_indicators": [code]}, "summary": explain(result)["summary"], "source": "template"}


def alternative(plan):
    """Best valid one-measure replacement; not a claim of global optimality."""
    sim = CitySimulator()
    original = sim.simulate(plan)
    selected = {s["measure_id"] for s in plan}
    best = None
    count = 0
    for index in range(len(plan)):
        for mid, measure in MEASURES.items():
            if mid in selected:
                continue
            for district in (list(DISTRICTS) if measure.scope == "Район" else [None]):
                candidate = [dict(s) for s in plan]
                candidate[index] = {"measure_id": mid, **({"district": district} if district else {})}
                try:
                    value = sim.simulate(candidate)
                except PlanValidationError:
                    continue
                count += 1
                rank = (value["result"]["score"], -value["total_cost"])
                if best is None or rank > best[0]:
                    best = (rank, candidate, value, index)
    if best is None:
        return {"available": False, "checked": count}
    _, candidate, value, index = best
    return {"available": True, "checked": count, "plan": candidate, "result": value,
            "comparison": compare(original, value), "replaced": plan[index], "replacement": candidate[index],
            "appeals": appeals(value), "aftermath": aftermath(value)}
