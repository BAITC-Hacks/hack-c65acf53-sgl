"""Integration tests against a real local HTTP server and a mocked LLM transport."""
import json
import os
import threading
import unittest
from http.client import HTTPConnection
from http.server import ThreadingHTTPServer
from unittest.mock import patch, MagicMock

from app import Handler, catalog
from city_simulator import CitySimulator
from presentation import compare, explain, INDICATORS
from reports import generate_report, validate_report


class WebTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join()

    def request(self, path, body=None, headers=None, raw=None):
        connection = HTTPConnection("127.0.0.1", self.server.server_port, timeout=5)
        try:
            method = "GET" if body is None and raw is None else "POST"
            payload = raw if raw is not None else json.dumps(body) if body is not None else None
            connection.request(method, path, body=payload, headers=headers or {"Content-Type": "application/json"})
            response = connection.getresponse()
            content = response.read()
            return response.status, content, dict(response.getheaders())
        finally:
            connection.close()

    def test_catalog_and_static_assets(self):
        status, content, _ = self.request("/api/catalog")
        self.assertEqual(status, 200)
        self.assertEqual(len(json.loads(content)["measures"]), 14)
        self.assertEqual(len(catalog()["indicators"]), 10)
        for path in ("/", "/app.js", "/city-map.js", "/style.css"):
            status, content, headers = self.request(path)
            self.assertEqual(status, 200)
            self.assertGreater(len(content), 500)
            self.assertIn("Content-Security-Policy", headers)

    def test_valid_simulation(self):
        status, content, _ = self.request("/api/simulate", {"plan": CitySimulator.example_plan()})
        self.assertEqual(status, 200)
        value = json.loads(content)
        self.assertAlmostEqual(value["result"]["result"]["score"], 56.54307)
        validate_report(value["report"])
        self.assertEqual(len(value["appeals"]), 10)
        self.assertEqual(len(value["aftermath"]["citizen_reactions"]), 5)

    def test_map_assets_and_scoped_csp(self):
        """The CSP worker must be executable; no arbitrary workspace file serving."""
        for path in ("/theme.js", "/map-adapter.js", "/map-provider.js", "/game-geography.js", "/project-geometry.js", "/project-visualization.js",
                     "/vendor/maplibre/maplibre-gl-csp.js", "/vendor/maplibre/maplibre-gl-csp-worker.js"):
            status, content, headers = self.request(path)
            self.assertEqual(status, 200)
            self.assertIn("text/javascript", headers["Content-Type"])
            self.assertGreater(len(content), 100)
            policy = headers["Content-Security-Policy"]
            self.assertIn("worker-src 'self'", policy)
            self.assertIn("connect-src 'self' https://tiles.openfreemap.org;", policy)
            self.assertIn("script-src 'self';", policy)
        for path in ("/vendor/../app.py", "/vendor/maplibre/../../reports.py", "/.env"):
            self.assertEqual(self.request(path)[0], 404)

    def test_game_endpoints(self):
        plan = CitySimulator.example_plan()
        self.assertEqual(self.request("/api/validate", {"plan": plan})[0], 200)
        status, content, _ = self.request("/api/alternative", {"plan": plan})
        self.assertEqual(status, 200)
        self.assertTrue(json.loads(content)["available"])
        with patch.dict(os.environ, {}, clear=True):
            for path, body in [("/api/ai/appeals", {}), ("/api/ai/result", {"plan": plan}),
                               ("/api/ai/feedback", {"plan": plan, "answer": "Приоритет — Нура"})]:
                status, content, _ = self.request(path, body)
                self.assertEqual(status, 200)
                self.assertEqual(json.loads(content)["source"], "template")

    def test_invalid_plan_never_gets_score(self):
        status, content, _ = self.request("/api/simulate", {"plan": []})
        self.assertEqual(status, 422)
        self.assertNotIn("result", json.loads(content))

    def test_event_api_recomputes_facts_and_preserves_branch(self):
        plan = CitySimulator.example_plan()
        status, content, _ = self.request("/api/simulate", {"plan": plan})
        main = json.loads(content)["city"]
        self.assertEqual(main["branch"], "main")
        self.assertEqual(len(main["events"]), len({e["event_id"] for e in main["events"]}))
        status, content, _ = self.request("/api/events/context", {"plan": plan[:1], "value": 999})
        context = json.loads(content)
        self.assertEqual(status, 200)
        self.assertIsNone(context["final"])
        self.assertEqual(context["initial"]["advisor"]["priority"]["value"], 35)
        self.assertEqual(self.request("/api/events/context", {"plan": plan[:1], "stage": "final"})[0], 422)
        self.assertEqual(self.request("/api/events/context", {"plan": [], "branch": "forged"})[0], 400)
        self.assertEqual(self.request("/api/events/wording", {"event_ids": ["forged"]})[0], 400)
        with patch("event_wording.configured", return_value=False):
            status, content, _ = self.request("/api/events/wording", {"plan": plan, "stage": "final",
                "run_id": main["run_id"], "branch": main["branch"], "value": 999})
        response = json.loads(content)
        self.assertEqual(status, 200)
        self.assertEqual(response["run_id"], main["run_id"])
        self.assertTrue(all(i["source"] == "template" for i in response["items"]))
        status, content, _ = self.request("/api/alternative", {"plan": plan})
        alt = json.loads(content)["city"]
        self.assertEqual(alt["branch"], "alternative")
        self.assertNotEqual(alt["run_id"], main["run_id"])

    def test_comparison_uses_recalculated_plans(self):
        first = CitySimulator.example_plan()
        second = CitySimulator.example_plan()
        second[2]["district"] = "Есиль"
        status, content, _ = self.request("/api/compare", {"plan": second, "reference": first})
        self.assertEqual(status, 200)
        comparison = json.loads(content)["comparison"]
        self.assertLess(comparison["district_deltas"]["Нура"], 0)
        self.assertGreater(comparison["district_deltas"]["Есиль"], 0)
        self.assertEqual(comparison["cost_delta"], 0)

    def test_input_and_route_boundaries(self):
        for raw in ("{", "[]", "null"):
            self.assertEqual(self.request("/api/simulate", raw=raw)[0], 400)
        self.assertEqual(self.request("/api/simulate", raw="x" * 32769)[0], 413)
        self.assertEqual(self.request("/api/simulate", raw="{}", headers={"Content-Type": "text/plain"})[0], 415)
        self.assertEqual(self.request("/api/report", {}, headers={"Content-Type":"application/json", "Origin":"https://example.org"})[0], 403)
        self.assertEqual(self.request("/../reports.py")[0], 404)
        self.assertEqual(self.request("/api/unknown", {})[0], 404)

    def test_report_offline(self):
        with patch.dict(os.environ, {}, clear=True):
            status, content, _ = self.request("/api/report", {"plan": CitySimulator.example_plan()})
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(content)["source"], "calculation")


class ReportTests(unittest.TestCase):
    def setUp(self):
        self.result = CitySimulator().verify_example()

    def test_deterministic_explanation_and_equal_comparison(self):
        report = explain(self.result)
        validate_report(report)
        self.assertIn("95", report["summary"])
        self.assertIn("56.54", report["summary"])
        self.assertEqual(compare(self.result, self.result)["score_delta"], 0)

    def test_llm_success_sends_calculated_data(self):
        report = explain(self.result)
        fake = MagicMock()
        fake.__enter__.return_value.read.return_value = json.dumps({"choices": [{"message": {"content": json.dumps(report)}}]}).encode()
        with patch.dict(os.environ, {"LLM_API_KEY": "test-secret", "LLM_MODEL": "test-model"}, clear=True), patch("reports.urlopen", return_value=fake) as call:
            answer = generate_report(self.result, self.result)
        self.assertEqual(answer["source"], "ai")
        request = call.call_args.args[0]
        payload = json.loads(request.data)
        self.assertEqual(payload["response_format"]["json_schema"]["strict"], True)
        self.assertIn(INDICATORS["S1"], payload["messages"][0]["content"])
        self.assertEqual(json.loads(payload["messages"][2]["content"])["current_minus_reference"]["score_delta"], 0)
        self.assertNotIn("test-secret", json.dumps(answer))

    def test_llm_error_and_invalid_response_fall_back(self):
        invalid = [{"choices": []}, {"choices": [{"message": {"refusal": "no"}}]},
                   {"choices": [{"message": {"content": "{}"}}]}]
        with patch.dict(os.environ, {"LLM_API_KEY":"secret", "LLM_MODEL":"test"}, clear=True):
            with patch("reports.urlopen", side_effect=TimeoutError("secret-provider-error")):
                answer = generate_report(self.result)
                self.assertEqual(answer["source"], "calculation")
                self.assertNotIn("secret", json.dumps(answer))
            for value in invalid:
                fake = MagicMock()
                fake.__enter__.return_value.read.return_value = json.dumps(value).encode()
                with patch("reports.urlopen", return_value=fake):
                    self.assertEqual(generate_report(self.result)["source"], "calculation")

    def test_report_contract_rejects_wrong_types(self):
        for bad in (None, {}, {**explain(self.result), "risks": "text"},
                    {**explain(self.result), "summary": ""}, {**explain(self.result), "extra": 1}):
            with self.assertRaises(ValueError):
                validate_report(bad)


if __name__ == "__main__":
    unittest.main()
