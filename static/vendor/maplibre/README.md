MapLibre GL JS 5.6.2
==================

Locally vendored upstream CSP distribution from https://unpkg.com/maplibre-gl@5.6.2/.
See LICENSE.txt for upstream and bundled dependency licenses.

- maplibre-gl-csp.js
- maplibre-gl-csp-worker.js
- maplibre-gl.css

Refresh with: python tools/fetch_map_assets.py
Runtime: no CDN JavaScript and no frontend build pipeline.
The worker must be served as JavaScript; map-adapter.js sets its local URL.
