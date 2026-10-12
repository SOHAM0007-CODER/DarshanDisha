# Three-minute presentation

1. **The problem (20 seconds):** “During Ganeshotsav, people want to visit Pune’s five honoured Ganpati without wasting walking distance. Crowded lanes can also make a short route slower. Our model makes the chosen objective explicit.”
2. **The map (30 seconds):** Show the five highlighted mandals and start the walking animation. Explain that the offline map uses OSM street geometry, while crowd values and lane closures are simulated.
3. **Optional stops (30 seconds):** Choose Shaniwar Wada → Dagdusheth. A suggested Ganpati appears only if the calculated extra walk is small. Add it, then point to the recalculated itinerary. Queue time remains unknown.
4. **Crowds and closures (40 seconds):** Switch back to Manache Paach, select Festival Peak and Quickest in crowds. Explain why the selected route may be longer in metres but quicker under the scenario. Close a highlighted lane and show the new path.
5. **The algorithms (50 seconds):** Open Algorithm Lab, play and pause the search, and use Step. Compare three minimum costs on the same graph and stop order. Show the edge-check counts and explain that normalised replay speed is separate from compute time.
6. **Wrap up (10 seconds):** “The model helps visitors compare choices and helps students understand why the same shortest route can be found using different search strategies.”

# Answers for evaluation

- **Why three algorithms?** Dijkstra selects the nearest tentative node. Bellman–Ford repeatedly relaxes all directed edges. A* selects the smallest g+h, using a lower-bound estimate toward the goal.
- **Why Bellman–Ford if distances are positive?** It still computes the correct result and offers a useful comparison of operation counts. Real walking distance and this model’s travel-time costs are nonnegative.
- **Why is A* optimal?** Its straight-line heuristic never exceeds a mapped route’s geometric length. For time, dividing that distance by maximum walking speed gives a lower bound. Crowds only increase edge time.
- **How are five stops handled?** Each algorithm solves individual legs. A separate exact permutation search chooses the visit order from pairwise minimum costs. Five stops have 120 possible orders; the three path algorithms do not themselves solve the stop-order problem.
- **How is “on the way” determined?** Added cost = cost(start, optional stop) + cost(optional stop, destination) − cost(start, destination). For an itinerary, the model finds the best insertion leg. Acceptance is required before adding a stop.
- **Is crowd information live?** No. These are labelled classroom scenarios. Walking ETA excludes darshan queues because queue information is unavailable.
- **How are closures handled?** Closed edges are removed from the graph snapshot, and the route is recalculated in a Web Worker. An isolated destination returns “No walkable route”.
- **What is measured?** Real edge checks, distance updates, node selections/reach counts, and computation time. Counts are summed across all itinerary legs; a node can be counted again in a different leg.
- **What makes the animation smooth?** A cached map, incremental trace painting, requestAnimationFrame, continuous movement along route geometry, and computation outside the UI thread.

# Files to show

- `engine.mjs`: the three algorithms, crowd weights, optional-stop costs and exact order search.
- `tests/routing.test.mjs`: an independent shortest-path oracle and route invariants.
- `data/map.json`: offline street geometry and graph; see README for attribution.
- `PROJECT_PLAN.md`: the agreed project design.
