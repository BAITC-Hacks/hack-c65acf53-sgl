import json
import os
import unittest
from unittest.mock import patch

from city_game import appeals, alternative, aftermath, severity
from city_simulator import CitySimulator
from game_ai import narrative


class GameTests(unittest.TestCase):
    def test_severity_boundaries(self):
        for value, expected in [(0, "critical"), (39.99, "critical"), (40, "high"),
                                (49.99, "high"), (50, "medium"), (59.99, "medium"), (60, "normal")]:
            self.assertEqual(severity(value), expected)

    def test_two_real_issues_per_district(self):
        items = appeals()
        self.assertEqual(len(items), 10)
        nura = [a for a in items if a["district"] == "Нура"]
        self.assertEqual({a["indicator_code"] for a in nura}, {"S1", "S2"})
        self.assertTrue(all(a["severity"] == "critical" and a["is_synthetic"] for a in nura))

    def test_appeals_keep_identity_and_remaining_severity(self):
        result = CitySimulator().verify_example()
        before, after = appeals(), appeals(result)
        self.assertEqual([a["id"] for a in before], [a["id"] for a in after])
        school = next(a for a in after if a["id"] == "Нура-S1")
        self.assertEqual((school["before"], school["value"], school["status"], school["severity"]),
                         (38, 48, "improved", "high"))
        road = next(a for a in after if a["id"] == "Есиль-T1")
        self.assertEqual(road["status"], "unresolved")

    def test_partial_plan_can_mark_appeal_planned(self):
        items = appeals(plan=[{"measure_id": "M7", "district": "Нура"}])
        self.assertEqual(next(a for a in items if a["id"] == "Нура-S1")["status"], "planned")
        self.assertEqual(next(a for a in items if a["id"] == "Нура-S2")["status"], "new")

    def test_alternative_is_one_valid_replacement_with_real_score(self):
        plan = CitySimulator.example_plan()
        response = alternative(plan)
        self.assertTrue(response["available"])
        self.assertGreater(response["checked"], 0)
        self.assertEqual(sum(a != b for a, b in zip(plan, response["plan"])), 1)
        verified = CitySimulator().simulate(response["plan"])
        self.assertEqual(response["result"], verified)
        self.assertEqual(response["comparison"]["score_delta"], verified["result"]["score"] - 56.54307)
        self.assertEqual(plan, CitySimulator.example_plan())

    def test_press_and_reactions_are_linked_to_actual_indicators(self):
        result = CitySimulator().verify_example()
        story = aftermath(result)
        self.assertEqual(len(story["citizen_reactions"]), 5)
        for item in story["citizen_reactions"]:
            for key in item["linked_indicators"]:
                self.assertIn(key, result["districts"][item["district"]]["after"])
        question = story["press_question"]
        self.assertIn(question["district"], question["question"])

    def test_ai_failure_keeps_game_running(self):
        result = CitySimulator().verify_example()
        with patch.dict(os.environ, {"LLM_API_KEY": "test", "LLM_MODEL": "test"}, clear=True), patch("game_ai.request_json", side_effect=TimeoutError):
            for kind in ("appeals", "result", "feedback"):
                response = narrative(kind, result, "Мой ответ")
                self.assertEqual(response["source"], "template")
                self.assertIn("notice", response)
        self.assertAlmostEqual(result["result"]["score"], 56.54307)

    def test_ai_only_changes_text_not_issue_metadata(self):
        original = appeals()
        payload = {a["id"]: "Новое синтетическое обращение" for a in original}
        with patch.dict(os.environ, {"LLM_API_KEY": "test", "LLM_MODEL": "test"}, clear=True), patch("game_ai.request_json", return_value=payload):
            response = narrative("appeals")
        self.assertEqual(response["source"], "ai")
        for before, after in zip(original, response["appeals"]):
            self.assertEqual({k:v for k,v in before.items() if k not in {"source", "message"}},
                             {k:v for k,v in after.items() if k not in {"source", "message"}})

    def test_ai_invalid_schema_falls_back(self):
        with patch.dict(os.environ, {"LLM_API_KEY": "test", "LLM_MODEL": "test"}, clear=True), patch("game_ai.request_json", return_value={"invented": 123}):
            self.assertEqual(narrative("appeals")["source"], "template")


if __name__ == "__main__":
    unittest.main()
