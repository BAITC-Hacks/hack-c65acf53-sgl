"""Проверки правил и численных результатов: python -m unittest -v."""

import json
import unittest
from unittest.mock import patch

from city_simulator import (
    CitySimulator, DISTRICTS, District, MEASURES, PlanValidationError,
    Selection, WEIGHTS,
)


def plan(*items):
    """Короткая запись тестового плана; строка означает городскую меру."""
    return [Selection(item) if isinstance(item, str) else Selection(*item) for item in items]


class CitySimulatorTests(unittest.TestCase):
    def setUp(self):
        self.sim = CitySimulator()

    def assert_invalid(self, selections, code):
        with self.assertRaises(PlanValidationError) as caught:
            self.sim.simulate(selections)
        self.assertIn(code, {issue.code for issue in caught.exception.issues})

    def test_configuration(self):
        self.assertEqual(len(DISTRICTS), 5)
        self.assertEqual(len(MEASURES), 14)
        self.assertAlmostEqual(sum(WEIGHTS.values()), 1)
        self.assertAlmostEqual(sum(d.population_share for d in DISTRICTS.values()), 1)
        for district in DISTRICTS.values():
            self.assertEqual(set(district.indicators), set(WEIGHTS))

    def test_specification_example(self):
        result = self.sim.verify_example()
        self.assertEqual(result["total_cost"], 95)
        self.assertEqual(result["remaining_budget"], 5)
        self.assertAlmostEqual(result["result"]["score"], 56.54307)
        self.assertAlmostEqual(result["result"]["d_avg"], 58.0776)
        self.assertAlmostEqual(result["result"]["d_min"], 52.9625)
        self.assertAlmostEqual(result["baseline"]["score"], 52.55768)
        self.assertAlmostEqual(result["score_delta"], 3.98539)
        self.assertEqual(result["baseline"]["n_crit"], 2)
        self.assertEqual(result["result"]["n_crit"], 0)
        nura = result["districts"]["Нура"]
        for key, value in {"S1": 48, "S2": 43.75, "B1": 67.5, "B2": 51.75, "C2": 54.375}.items():
            self.assertAlmostEqual(nura["after"][key], value)
        self.assertAlmostEqual(result["districts"]["Сарыарка"]["after"]["E2"], 48.75)

    def test_exactly_five(self):
        for count in (0, 4, 6):
            with self.subTest(count=count):
                self.assert_invalid([{"measure_id": "M12"}] * count, "count")

    def test_budget_boundary(self):
        exact = plan(("M3", "Есиль"), ("M7", "Нура"), ("M8", "Нура"), "M12", ("M10", "Нура"))
        self.assertEqual(self.sim.simulate(exact)["total_cost"], 100)
        over = plan(("M3", "Есиль"), ("M7", "Нура"), ("M8", "Нура"), ("M4", "Алматы"), ("M10", "Нура"))
        self.assert_invalid(over, "budget")

    def test_duplicate_across_districts(self):
        selections = plan(("M10", "Нура"), ("M10", "Есиль"), "M12", "M6", ("M9", "Нура"))
        self.assert_invalid(selections, "duplicate")

    def test_direction_limit(self):
        selections = plan(("M7", "Нура"), ("M8", "Нура"), ("M9", "Нура"), ("M10", "Нура"), "M12")
        self.assert_invalid(selections, "direction_limit")

    def test_global_incompatibility(self):
        for district in ("Нура", "Есиль"):
            selections = plan(("M1", "Нура"), ("M3", district), ("M9", "Нура"), ("M10", "Нура"), "M12")
            self.assert_invalid(selections, "incompatible")

    def test_local_incompatibilities(self):
        for first, second, other in (("M4", "M7", "M14"), ("M5", "M13", ("M9", "Нура"))):
            with self.subTest(pair=(first, second)):
                same = plan((first, "Нура"), (second, "Нура"), ("M10", "Нура"), "M12", other)
                self.assert_invalid(same, "incompatible")
                same[1] = Selection(second, "Есиль")
                self.assertTrue(self.sim.simulate(same)["valid"])

    def test_invalid_input_shapes(self):
        for value in (None, "M12", {}, 5):
            with self.subTest(value=value):
                self.assert_invalid(value, "plan_type")
        for value, code in ((None, "selection_type"), ({}, "measure_id"),
                            ({"measure_id": []}, "measure_id"),
                            ({"measure_id": "M99"}, "measure_id"),
                            ({"measure_id": "M12", "cost": 0}, "unknown_fields")):
            selections = self.sim.example_plan()
            selections[3] = value
            self.assert_invalid(selections, code)

    def test_district_required_and_must_be_known(self):
        for district in (None, "город", "Неизвестный", "", [], 1):
            selections = self.sim.example_plan()
            selections[0] = {"measure_id": "M7", "district": district}
            self.assert_invalid(selections, "district")

    def test_city_district_forbidden(self):
        for district in ("Нура", "город", "", []):
            selections = self.sim.example_plan()
            selections[3]["district"] = district
            self.assert_invalid(selections, "city_district")
        selections[3]["district"] = None
        self.assertTrue(self.sim.simulate(selections)["valid"])

    def test_city_effect_in_every_district(self):
        result = self.sim.simulate(self.sim.example_plan())
        for district in result["districts"].values():
            self.assertEqual(district["delta"]["C2"], 4.375)

    def test_all_synergies_unscaled_and_local(self):
        cases = (
            ("M1", "M2", "T1", [("M10", "Алматы"), "M12", ("M9", "Есиль")], 9.5),
            ("M10", "M12", "B1", [("M9", "Есиль"), "M6", "M14"], 12.5),
            ("M5", "M6", "E2", [("M10", "Алматы"), "M12", ("M9", "Есиль")], 12.25),
        )
        for first, second, key, others, delta in cases:
            with self.subTest(pair=(first, second)):
                result = self.sim.simulate(plan((first, "Нура"), second, *others))
                self.assertEqual(result["districts"]["Нура"]["synergy_effects"][key], 2)
                self.assertAlmostEqual(result["districts"]["Нура"]["delta"][key], delta)
                for name in DISTRICTS:
                    if name != "Нура":
                        self.assertEqual(result["districts"][name]["synergy_effects"][key], 0)

    def test_absent_synergy_and_negative_effect(self):
        selections = plan(("M1", "Нура"), ("M11", "Нура"), ("M9", "Есиль"), "M12", "M14")
        result = self.sim.simulate(selections)
        self.assertEqual(result["synergies"], [])
        self.assertEqual(result["districts"]["Нура"]["delta"]["T1"], 2.75)
        self.assertEqual(self.sim.scaled_effects("M11")["T1"], -1.75)

    def test_clip_after_combining_effects(self):
        selections = plan(("M1", "Нура"), ("M11", "Нура"), ("M9", "Есиль"), "M12", "M14")
        # При 98: clip(98 + 4.5 - 1.75) = 100. Последовательный clip дал бы 98.25.
        districts = {name: District(d.population_share, dict(d.indicators)) for name, d in DISTRICTS.items()}
        districts["Нура"].indicators["T1"] = 98
        with patch("city_simulator.DISTRICTS", districts):
            result = self.sim.simulate(selections)
        self.assertEqual(result["districts"]["Нура"]["after"]["T1"], 100)
        self.assertEqual(result["districts"]["Нура"]["delta"]["T1"], 2)
        districts["Нура"].indicators["T1"] = 0
        selections[0] = Selection("M4", "Нура")
        with patch("city_simulator.DISTRICTS", districts):
            result = self.sim.simulate(selections)
        self.assertEqual(result["districts"]["Нура"]["after"]["T1"], 0)

    def test_critical_threshold_is_strict(self):
        indicators = {name: dict.fromkeys(WEIGHTS, 40.0) for name in DISTRICTS}
        self.assertEqual(self.sim.calculate_scores(indicators)["n_crit"], 0)
        indicators["Нура"]["T1"] = 39.999
        indicators["Нура"]["T2"] = 39
        self.assertEqual(self.sim.calculate_scores(indicators)["n_crit"], 2)

    def test_independent_runs_and_order(self):
        selections = self.sim.example_plan()
        result = self.sim.simulate(selections)
        reversed_result = self.sim.simulate(list(reversed(selections)))
        self.assertEqual(result["districts"], reversed_result["districts"])
        result["districts"]["Нура"]["after"]["T1"] = 0
        self.assertEqual(self.sim.simulate(selections)["districts"]["Нура"]["after"]["T1"], 55)
        self.assertEqual(selections, self.sim.example_plan())

    def test_prompt_contains_result_and_report_contract(self):
        result = self.sim.verify_example()
        prompt = self.sim.build_report_prompt(result)
        self.assertEqual(json.loads(prompt["messages"][1]["content"]), result)
        self.assertEqual(set(prompt["report_schema"]["required"]),
                         {"summary", "strengths", "risks", "recommendation"})
        json.dumps(prompt, ensure_ascii=False, allow_nan=False)


if __name__ == "__main__":
    unittest.main()
