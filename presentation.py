"""Human-readable metadata and deterministic explanations of calculated results."""

INDICATORS = {
    "T1": "Разгрузка дорог", "T2": "Доступность общественного транспорта",
    "E1": "Озеленение", "E2": "Качество воздуха",
    "S1": "Школы и детсады", "S2": "Поликлиники и первичная помощь",
    "B1": "Безопасность улиц", "B2": "Безопасность дорожного движения",
    "C1": "Надёжность ЖКХ", "C2": "Скорость решения обращений",
}

PROFILES = {
    "Есиль": "Пробки на мостах и переполненные школы.",
    "Алматы": "Старые коммунальные сети и пробки.",
    "Сарыарка": "Смог от частного сектора и нехватка зелени.",
    "Байконур": "Сбалансированные показатели без ярких перекосов.",
    "Нура": "Самые острые проблемы — соцсфера и транспорт.",
}


def explain(result):
    after = result["result"]
    changes = sorted(
        ((delta, name, key) for name, district in result["districts"].items()
         for key, delta in district["delta"].items()), reverse=True)
    weakest = min(after["district_scores"], key=after["district_scores"].get)
    risks = [f"{p['district']}: {INDICATORS[p['indicator']]} — {p['value']:.2f}, ниже порога 40."
             for p in after["critical_pairs"]]
    risks += [f"{name}: {INDICATORS[key]} снижается на {abs(delta):.2f}."
              for delta, name, key in changes if delta < 0]
    gap = max(after["district_scores"].values()) - after["d_min"]
    risks.append(f"Разрыв между лучшим и слабейшим районом: {gap:.2f} балла.")
    strengths = [f"{name}: {INDICATORS[key]} {delta:+.2f}."
                 for delta, name, key in changes if delta > 0][:5]
    for synergy in result["synergies"]:
        effects = ", ".join(f"{INDICATORS[key]} {value:+.2f}" for key, value in synergy["effects"].items())
        strengths.append(f"Синергия {' + '.join(synergy['pair'])} в районе {synergy['district']}: "
                         f"{effects} (уже включено в результат).")
    return {
        "summary": f"План стоит {result['total_cost']} из 100. Score: {after['score']:.2f} "
                   f"({result['score_delta']:+.2f}). Критических показателей: {after['n_crit']}.",
        "strengths": strengths,
        "risks": risks,
        "recommendation": f"При следующем планировании проверьте меры для района {weakest}: "
                          f"его оценка {after['d_min']:.2f} — минимальная в городе. "
                          "Сравните новый набор с текущим перед выбором.",
    }


def compare(first, second):
    """Comparison arithmetic belongs to Python, never to the language model."""
    return {
        "score_delta": second["result"]["score"] - first["result"]["score"],
        "cost_delta": second["total_cost"] - first["total_cost"],
        "critical_delta": second["result"]["n_crit"] - first["result"]["n_crit"],
        "district_deltas": {name: second["districts"][name]["score_after"] - d["score_after"]
                            for name, d in first["districts"].items()},
    }
