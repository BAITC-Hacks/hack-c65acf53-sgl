"""Local web application: python app.py. Standard library only."""
import argparse
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

from city_simulator import CitySimulator, DISTRICTS, MEASURES, WEIGHTS, PlanValidationError
from presentation import INDICATORS, PROFILES, compare, explain
from reports import configured, generate_report
from city_game import appeals, aftermath, alternative
from game_ai import narrative
from city_events import event_bundle, draft_plan, identity
from event_wording import enrich

STATIC = Path(__file__).parent / "static"


def catalog():
    return {
        "indicators": INDICATORS, "weights": dict(WEIGHTS), "budget": 100,
        "districts": {name: {"population_share": d.population_share, "indicators": dict(d.indicators),
                             "profile": PROFILES[name]} for name, d in DISTRICTS.items()},
        "measures": {key: {"name": m.name, "direction": m.direction, "scope": m.scope,
                           "cost": m.cost, "lag": m.lag, "effects": dict(m.effects),
                           "scaled_effects": CitySimulator.scaled_effects(key)} for key, m in MEASURES.items()},
        "example": CitySimulator.example_plan(), "ai_available": configured(),
        "appeals": appeals(),
        "city": event_bundle(),
        "baseline": CitySimulator.calculate_scores({name: d.indicators for name, d in DISTRICTS.items()}),
    }


class Handler(BaseHTTPRequestHandler):
    def send(self, status, data, content_type="application/json; charset=utf-8"):
        body = json.dumps(data, ensure_ascii=False, allow_nan=False).encode("utf-8") if isinstance(data, (dict, list)) else data
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Content-Security-Policy", "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; worker-src 'self'; connect-src 'self' https://tiles.openfreemap.org; img-src 'self' data: blob: https://tiles.openfreemap.org; frame-ancestors 'none'; base-uri 'none'")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        path = urlsplit(self.path).path
        if path == "/api/catalog":
            return self.send(200, catalog())
        files = {"/": ("index.html", "text/html"), "/app.js": ("app.js", "text/javascript"),
                 "/city-map.js": ("city-map.js", "text/javascript"),
                 "/style.css": ("style.css", "text/css"),
                 "/theme.js": ("theme.js", "text/javascript"),
                 "/map-adapter.js": ("map-adapter.js", "text/javascript"),
                 "/map-provider.js": ("map-provider.js", "text/javascript"),
                 "/game-geography.js": ("game-geography.js", "text/javascript"),
                 "/city-pulse.js": ("city-pulse.js", "text/javascript"),
                 "/project-geometry.js": ("project-geometry.js", "text/javascript"),
                 "/project-visualization.js": ("project-visualization.js", "text/javascript"),
                 "/vendor/maplibre/maplibre-gl-csp.js": ("vendor/maplibre/maplibre-gl-csp.js", "text/javascript"),
                 "/vendor/maplibre/maplibre-gl-csp-worker.js": ("vendor/maplibre/maplibre-gl-csp-worker.js", "text/javascript"),
                 "/vendor/maplibre/maplibre-gl.css": ("vendor/maplibre/maplibre-gl.css", "text/css"),
                 "/vendor/maplibre/LICENSE.txt": ("vendor/maplibre/LICENSE.txt", "text/plain")}
        if path not in files:
            return self.send(404, {"error": "Не найдено"})
        filename, kind = files[path]
        self.send(200, (STATIC / filename).read_bytes(), kind + "; charset=utf-8")

    def do_POST(self):
        # Reject cross-origin browser writes, including paid report requests.
        origin = self.headers.get("Origin")
        if origin and origin != "http://" + self.headers.get("Host", ""):
            return self.send(403, {"error": "Недопустимый источник запроса"})
        path = urlsplit(self.path).path
        if path not in {"/api/simulate", "/api/compare", "/api/report", "/api/alternative", "/api/validate", "/api/ai/appeals", "/api/ai/result", "/api/ai/feedback", "/api/events/context", "/api/events/wording"}:
            return self.send(404, {"error": "Не найдено"})
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 < length <= 32768:
                # Drain a bounded, already declared small body before closing on Windows.
                # Otherwise closing with unread bytes can reset TCP before the 413 arrives.
                if 0 < length <= 65536:
                    self.connection.settimeout(3)
                    try:
                        self.rfile.read(length)
                    except OSError:
                        pass
                return self.send(413, {"error": "Размер запроса должен быть от 1 до 32768 байт"})
            if self.headers.get_content_type() != "application/json":
                return self.send(415, {"error": "Ожидается application/json"})
            body = json.loads(self.rfile.read(length))
            if not isinstance(body, dict):
                raise ValueError("Ожидается JSON-объект")
            sim = CitySimulator()
            if path in {"/api/events/context", "/api/events/wording"}:
                run_id, branch = identity(body.get("run_id"), body.get("branch", "main"))
                plan = draft_plan(body.get("plan", []))
                stage = body.get("stage", "baseline")
                if stage not in ("baseline", "final"):
                    raise ValueError("Неизвестное состояние")
                # Never trust client numeric facts. A final context requires a valid full plan.
                verified = sim.simulate(plan) if stage == "final" else None
                bundle = event_bundle(plan, verified, run_id, branch)
                return self.send(200, enrich(bundle, body.get("event_ids")) if path.endswith("wording") else bundle)
            if path == "/api/ai/appeals" and not body.get("plan"):
                return self.send(200, narrative("appeals"))
            if path == "/api/validate":
                selections = sim.validate_plan(body.get("plan"))
                return self.send(200, {"valid": True, "appeals": appeals(plan=[{"measure_id": s.measure_id, "district": s.district} for s in selections])})
            result = sim.simulate(body.get("plan"))
            if path == "/api/simulate":
                run_id, branch = identity()
                return self.send(200, {"result": result, "report": explain(result), "appeals": appeals(result), "aftermath": aftermath(result),
                                       "city": event_bundle(body["plan"], result, run_id, branch)})
            if path == "/api/alternative":
                value = alternative(body["plan"])
                if value["available"]:
                    run_id, branch = identity(branch="alternative")
                    value["city"] = event_bundle(value["plan"], value["result"], run_id, branch)
                return self.send(200, value)
            if path.startswith("/api/ai/"):
                answer = body.get("answer", "")
                if not isinstance(answer, str) or len(answer) > 3000:
                    raise ValueError("Ответ должен быть текстом до 3000 символов")
                return self.send(200, narrative(path.rsplit("/", 1)[1], result, answer))
            reference = sim.simulate(body["reference"]) if "reference" in body else None
            if path == "/api/compare":
                if reference is None:
                    raise ValueError("Не указан план для сравнения")
                return self.send(200, {"comparison": compare(reference, result), "reference": reference})
            self.send(200, generate_report(result, reference))
        except PlanValidationError as exc:
            self.send(422, exc.to_dict())
        except (ValueError, TypeError, UnicodeError) as exc:
            self.send(400, {"error": str(exc)})


def main():
    parser = argparse.ArgumentParser(description="Аким на 5 часов — веб-приложение")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", default=8000, type=int)
    args = parser.parse_args()
    with ThreadingHTTPServer((args.host, args.port), Handler) as server:
        print(f"Откройте http://{args.host}:{args.port} (Ctrl+C — остановить)", flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == "__main__":
    main()
