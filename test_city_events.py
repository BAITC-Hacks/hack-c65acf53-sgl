"""Behavioral coverage for authoritative facts and the optional wording boundary."""
from copy import deepcopy
import unittest
from unittest.mock import patch

from city_simulator import CitySimulator, DISTRICTS
from city_events import (event_bundle, detect_issues, draft_plan, severity,
                         top_per_district, wording_items)
import event_wording


class EventTests(unittest.TestCase):
    def setUp(self):
        self.plan = CitySimulator.example_plan()
        self.result = CitySimulator().simulate(self.plan)
        self.bundle = event_bundle(self.plan, self.result, "run1")

    def test_ranking_inspects_current_matrix_and_is_deterministic(self):
        first = detect_issues()
        self.assertEqual(first, detect_issues())
        self.assertEqual(first[0]["id"], "nura:S2")
        modified = deepcopy(self.result)
        modified["districts"]["Есиль"]["after"]["C2"] = 10
        self.assertEqual(detect_issues(modified)[0]["id"], "yesil:C2")
        for issue in first:
            self.assertLess(issue["value"], 60)
            self.assertEqual(issue["value"], DISTRICTS[issue["district"]].indicators[issue["indicator"]])

    def test_baseline_small_grounded_and_fallbacks_for_all_categories(self):
        initial = event_bundle()
        self.assertEqual(len(initial["events"]), 10)
        self.assertEqual(len(top_per_district(initial["initial"]["issues"])), 10)
        for e in initial["events"]:
            self.assertEqual(e["quarter"], 0)
            self.assertEqual(e["source_basis"], "baseline")
            self.assertEqual(e["before"], e["value"])
            self.assertTrue(e["message"])
            self.assertTrue(e["is_synthetic"])
        self.assertEqual({i["category"] for i in initial["initial"]["issues"]},
                         {"transport", "ecology", "social", "safety", "services"})

    def test_activation_lag_plus_one_without_numerical_observations(self):
        activations = [e for e in self.bundle["events"] if e["event_type"] == "activation"]
        self.assertEqual(len(activations), 5)
        self.assertEqual({e["related_projects"][0]: e["quarter"] for e in activations},
                         {"M7": 4, "M8": 4, "M10": 2, "M12": 2, "M5": 4})
        for e in activations:
            self.assertFalse({"before", "value", "delta", "score"} & set(e))
        self.assertTrue(all(e["quarter"] in (0, 8) for e in self.bundle["events"] if "value" in e))

    def test_final_improvement_is_not_resolution_and_untouched_remain(self):
        e = next(e for e in self.bundle["events"] if e["quarter"] == 8 and e.get("issue_id") == "nura:S2")
        self.assertEqual((e["before"], e["value"], e["delta"]), (35, 43.75, 8.75))
        self.assertEqual(e["severity"], "high")
        self.assertIn("Проблема сохраняется", e["message"])
        issues = {i["id"]: i for i in self.bundle["final"]["issues"]}
        self.assertEqual(issues["nura:S2"]["severity"], "high")
        self.assertEqual(issues["almaty:T1"]["delta"], 0)
        self.assertEqual(issues["almaty:T1"]["severity"], "high")
        self.assertNotIn("nura:B1", issues)
        self.assertIn("nura:E1", self.bundle["final"]["map_issue_ids"])

    def test_thresholds(self):
        self.assertEqual([severity(v) for v in (39.99, 40, 49.99, 50, 59.99, 60)],
                         ["critical", "high", "high", "attention", "attention", "normal"])

    def test_reaction_links_include_synergy_partners(self):
        e = next(e for e in self.bundle["events"] if e.get("issue_id") == "nura:B1" and e["quarter"] == 8)
        self.assertEqual(e["related_projects"], ["M10", "M12"])
        self.assertEqual(len(e["project_names"]), 2)

    def test_net_clipped_final_deltas_and_negative_effect(self):
        plan = [{"measure_id": "M11", "district": "Нура"}, {"measure_id": "M9", "district": "Есиль"},
                {"measure_id": "M12"}, {"measure_id": "M14"}, {"measure_id": "M4", "district": "Есиль"}]
        result = CitySimulator().simulate(plan)
        bundle = event_bundle(plan, result)
        for e in bundle["events"]:
            if e["quarter"] == 8:
                actual = result["districts"][e["district"]]
                self.assertEqual(e["value"], actual["after"][e["indicator"]])
                self.assertEqual(e["delta"], actual["delta"][e["indicator"]])
        e = next(e for e in bundle["events"] if e.get("issue_id") == "nura:T1" and e["quarter"] == 8)
        self.assertEqual(e["trend"], "worsened")
        self.assertEqual(e["delta"], -1.75)

    def test_deduplication_stable_identity_and_history_unchanged(self):
        self.assertEqual(self.bundle, event_bundle(list(reversed(self.plan)), self.result, "run1"))
        events = self.bundle["events"]
        self.assertEqual(len(events), len({e["event_id"] for e in events}))
        initial = event_bundle(run_id="run1")
        self.assertEqual([e for e in events if e["quarter"] == 0], initial["events"])
        alternate = event_bundle(self.plan, self.result, "run1", "alternative")
        self.assertFalse({e["event_id"] for e in events} & {e["event_id"] for e in alternate["events"]})

    def test_partial_advisor_and_final_gain_use_actual_plan(self):
        plan = draft_plan(self.plan[:2])
        a = event_bundle(plan)["initial"]["advisor"]
        self.assertEqual(a["direction_counts"], {"Соцсфера": 2})
        self.assertEqual(a["recommendations"], ["M8", "M9"])
        self.assertNotIn(a["untouched"]["id"], ["nura:S1", "nura:S2"])
        self.assertIsNone(a["biggest_gain"])
        self.assertEqual(self.bundle["final"]["advisor"]["biggest_gain"]["district"], "Нура")

    def test_partial_plan_rejects_forged_identity_or_scope(self):
        for value in (None, {}, [{"measure_id": "M99"}], [{"measure_id": "M7"}],
                      [{"measure_id": "M12", "district": "Нура"}], [{"measure_id": "M12", "value": 99}]):
            with self.subTest(value=value), self.assertRaises(ValueError):
                draft_plan(value)


class WordingTests(unittest.TestCase):
    def setUp(self):
        event_wording._cache.clear()
        self.bundle = event_bundle()
        self.event = self.bundle["events"][0]
        self.ids = [self.event["event_id"]]

    def test_unavailable_and_transport_failure_keep_fallback(self):
        with patch("event_wording.configured", return_value=False), patch("event_wording.request_json") as request:
            response = event_wording.enrich(self.bundle, self.ids)
            request.assert_not_called()
        self.assertEqual(response["items"][0]["message"], self.event["message"])
        with patch("event_wording.configured", return_value=True), patch("event_wording.request_json", side_effect=OSError):
            self.assertEqual(event_wording.enrich(self.bundle, self.ids), response)

    def test_malformed_unsupported_text_and_numbers_are_rejected(self):
        good = {"event_id": self.ids[0], "message": self.event["allowed_messages"][1]}
        for value in (None, [], {}, {"items": []}, {"items": [good, good]},
                      {"items": [{**good, "value": 99}]}, {"items": [{**good, "event_id": "old"}]},
                      {"items": [{**good, "message": "Стало лучше у 100 жителей"}]},
                      {"items": [{**good, "message": "Все школы полностью разгружены."}]},
                      {"items": [{**good, "message": "x" * 501}]}):
            with self.subTest(value=value), patch("event_wording.configured", return_value=True), patch("event_wording.request_json", return_value=value):
                self.assertEqual(event_wording.enrich(self.bundle, self.ids)["items"][0]["source"], "template")

    def test_batch_cache_reuses_facts_across_runs_but_not_changed_facts(self):
        snapshot = deepcopy(self.bundle)
        def respond(messages, schema, name):
            import json
            events = json.loads(messages[1]["content"])
            return {"items": [{"event_id": e["event_id"], "message": e["allowed_messages"][1]} for e in events]}
        with patch("event_wording.configured", return_value=True), patch("event_wording.request_json", side_effect=respond) as request:
            response = event_wording.enrich(self.bundle)
            self.assertTrue(all(i["source"] == "ai" for i in response["items"]))
            self.assertEqual(request.call_count, 1)
            other = event_bundle(run_id="another", branch="alternative")
            event_wording.enrich(other)
            self.assertEqual(request.call_count, 1)
        self.assertEqual(self.bundle, snapshot)
        changed = {**self.event, "value": self.event["value"] + 1}
        self.assertNotEqual(event_wording.cache_key(changed), event_wording.cache_key(self.event))
        with patch("event_wording.PROMPT_VERSION", "next"):
            self.assertNotIn(event_wording.cache_key(self.event), event_wording._cache)

    def test_unknown_event_identity_never_reaches_ai(self):
        with self.assertRaises(ValueError):
            event_wording.enrich(self.bundle, ["old:main:q0:nura:S1"])


if __name__ == "__main__":
    unittest.main()
