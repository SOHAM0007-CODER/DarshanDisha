# Validation record

- All 24 tests passed using `npm test` after A\* was removed (2026-10-15): eight routing tests, ten trace/replay tests and the animation tests.
- Both algorithms were checked against an independent Floyd–Warshall oracle on a small graph and against one another on Pune routes under both distance and time objectives.
- Closed edges were excluded; an isolated destination returned no path.
- All 120 five-stop orders were evaluated. Optional-stop detours, two accepted extras, traditional relative order and a same-start-and-destination case were checked.
- Browser flows checked: Dagdusheth route, accepted optional mandal, Festival Peak, fastest walking mode, algorithm replay/pause, lane closure, Marathi labels, custom map start, and walking guide.
- Responsive layouts checked at 1440, 390 and 320 CSS pixels. No body overflow was found; the itinerary strip intentionally scrolls.
- After caching the basemap and incrementally painting search traces, a desktop algorithm replay measured about 144 fps in the test browser's last 120-frame sample (device-dependent). The previous renderer measured about 43 fps.
- No browser console warnings or errors appeared during the final checks.
- Screenshots: `previews/darshan-desktop.jpg` and `previews/algorithm-lab.jpg`.

## 3D Algorithm Lab (2026-10-12)

- Replay tests confirmed: trace detail does not change any cost, path or operation count; compact traces account for every edge check (`skipped` + updates = checks) and stale heap entry; full traces record each one; Bellman–Ford ends with a pass that has no updates.
- Previous-step and scrubbing reconstruction matched a fresh forward replay at random and sequential positions for both algorithms on Pune and the teaching graph.
- The teaching graph agreed with a Floyd–Warshall oracle for every source, target and scenario. Dijkstra selected 11 nodes; Bellman–Ford needed 5 passes; Dijkstra met a stale heap entry.
- Headless Chrome checks (59/59) on the static `dist/` build with all non-local hosts blocked: lazy loading of Three.js from `vendor/three/`, orbit, pan, wheel zoom, keyboard rotate, Reset, Top-down, node picking, algorithm, leg and graph switching, step, previous, scrub, play, pause, reset, speed, cost-pillar toggle, heap disclosure, distance and crowd-aware time mode, unreachable and identical source/target cases, Marathi labels, WebGL context loss and restore, the flat fallback (`?flat3d`), reduced motion, and no horizontal overflow at 390 and 320 CSS pixels. No console errors or warnings, no failed requests, and no requests outside the local server.

This validates the educational model. Crowd weights, closures and walking times are simulated; current festival access and actual darshan queues are not verified by these tests.
