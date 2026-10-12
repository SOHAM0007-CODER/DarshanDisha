# Validation record

- All nine routing tests passed using `npm test`.
- All three algorithms were checked against an independent Floyd–Warshall oracle on a small graph and against one another on Pune routes under both distance and time objectives.
- Closed edges were excluded; an isolated destination returned no path.
- A* consistency was checked on every graph edge. Stored lengths round upward to preserve the geometric lower bound.
- All 120 five-stop orders were evaluated. Optional-stop detours, two accepted extras, traditional relative order and a same-start-and-destination case were checked.
- Browser flows checked: Dagdusheth route, accepted optional mandal, Festival Peak, fastest walking mode, algorithm replay/pause, lane closure, Marathi labels, custom map start, and walking guide.
- Responsive layouts checked at 1440, 390 and 320 CSS pixels. No body overflow was found; the itinerary strip intentionally scrolls.
- After caching the basemap and incrementally painting search traces, a desktop algorithm replay measured about 144 fps in the test browser's last 120-frame sample (device-dependent). The previous renderer measured about 43 fps.
- No browser console warnings or errors appeared during the final checks.
- Screenshots: `previews/darshan-desktop.jpg` and `previews/algorithm-lab.jpg`.

This validates the educational model. Crowd weights, closures and walking times are simulated; current festival access and actual darshan queues are not verified by these tests.
