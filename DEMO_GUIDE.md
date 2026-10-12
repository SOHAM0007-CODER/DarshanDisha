# Three-minute presentation

1. **The problem (20 seconds):** “During Ganeshotsav, people want to visit Pune’s five honoured Ganpati without wasting walking distance. Crowded lanes can also make a short route slower. Our model makes the chosen objective explicit.”
2. **The map (30 seconds):** Show the five highlighted mandals and start the walking animation. Explain that the offline map uses OSM street geometry, while crowd values and lane closures are simulated.
3. **Optional stops (30 seconds):** Choose Shaniwar Wada → Dagdusheth. A suggested Ganpati appears only if the calculated extra walk is small. Add it, then point to the recalculated itinerary. Queue time remains unknown.
4. **Crowds and closures (40 seconds):** Switch back to Manache Paach, select Festival Peak and Quickest in crowds. Explain why the selected route may be longer in metres but quicker under the scenario. Close a highlighted lane and show the new path.
5. **The algorithms (50 seconds):** Open Algorithm Lab, play and pause the search, and use Step. Compare three minimum costs on the same graph and stop order. Show the edge-check counts and explain that normalised replay speed is separate from compute time.
6. **Wrap up (10 seconds):** “The model helps visitors compare choices and helps students understand why the same shortest route can be found using different search strategies.”

# Classroom demo: 3D Algorithm Lab (four minutes)

Open **Algorithm Lab → 3D Algorithm Lab**, choose **Teaching example**, keep **From A → To K** and **All lanes open**, and leave **Cost pillars** on. Use **Next ▶** (or the <kbd>]</kbd> key) rather than Play, so you can talk through each step. The panel on the right reads out every step, including the arithmetic.

1. **Greedy selection: Dijkstra (90 seconds).** Step through the first six events. A is selected, then each lane out of A is relaxed: the panel shows `candidate = g(A) + w`, compares it with the old `g(v) = ∞`, and a square pillar rises for each tentative node. Point to **Tentative priorities**: the next selection is always the lowest pillar. Say: “With nonnegative weights, no later path can reach the lowest tentative node more cheaply, so Dijkstra settles it for good.” The pillar turns round when it is settled. Keep stepping until **E** drops from 300 m to 297 m via C, and later until the panel says **Discard outdated heap entry for E**. The heap kept E’s 300 m entry; it is skipped because the true `g(E)` is now smaller.
2. **Repeated relaxation: Bellman–Ford (75 seconds).** Switch the algorithm. Step into pass 1: most checks say “g(u) is still ∞, so this lane cannot improve v yet”, because the lanes nearest K come first in the fixed edge order. Drag the scrubber to the end of pass 2, then pass 3. Pillars keep moving down as later passes find cheaper paths, which is why Bellman–Ford never calls a node settled. Scrub to the last **pass-end** step: “Pass 5 changed nothing: stop early”, well before the `V − 1 = 10` pass bound. Mention that this model has only nonnegative weights; it does not demonstrate negative-cycle detection.
3. **Heuristic search: A\* (60 seconds).** Switch to A\*. The dashed teal line is `h(u)`, the straight-line distance to K, which never overestimates. Open **Inspect a node** for B and read `f = g + h`. A\* picks the smallest `f`, not the smallest `g`, so J and I (behind A) never get selected. Compare the facts row: A\* selects 6 nodes, Dijkstra 11, for the same 495 m answer.
4. **Back to Pune (35 seconds).** Choose **Your Pune journey**, pick a leg, and play at a high speed. Explain that each leg is an independent search starting from `g(s) = 0`, that this is the same graph and run as the planner, and that this trace is **compact**: unsuccessful checks are grouped into the next step (the facts row gives the number). Replay time depends on recorded steps and the speed setting; it is not a runtime comparison. Compute time is measured separately.

Extra points if asked:

- Choose **K cut off (unreachable)**: Dijkstra and A\* empty their heaps and report the destination unreachable; Bellman–Ford finishes its passes with `g(K) = ∞`.
- Choose the same node for From and To: the minimum cost is 0 with no lanes.
- Turn off **Cost pillars**, or use **Top-down**, to compare with the flat map view.

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

- `engine.mjs`: the three algorithms, crowd weights, optional-stop costs and exact order search. `shortestPath` can record compact or full traces.
- `trace-player.mjs` and `lab3d.mjs`: deterministic replay of recorded events and the step explanations.
- `teaching-graph.mjs`: the 11-node teaching example.
- `tests/routing.test.mjs`: an independent shortest-path oracle and route invariants.
- `tests/trace-player.test.mjs`: trace accounting, replay reconstruction and teaching-graph checks.
- `data/map.json`: offline street geometry and graph; see README for attribution.
- `PROJECT_PLAN.md`: the agreed project design.
# Immersive presentation view

The teaching example animates each tested road in its checking direction and reveals the final route from start to destination. Adjust **Speed** from **0.1× to 2×** in 0.1 increments; 1× means one recorded step per second. Speed changes also affect transitions already in progress. Pause freezes the current transition, while Back, Reset and scrubbing reconstruct the requested state. Reduced-motion preferences disable the visual transitions.

For a first-time audience, select **Start guided example**. This opens the small graph with Dijkstra. Follow **1 Start → 2 Choose → 3 Compare → 4 Result**; chapter buttons seek to real recorded events. Explain that a road label is the cost of one road, while a node label is the best known total from the start. “?” means no route has been found yet. The orange ring marks the search's attention, and the final thick orange route is the recommended walk. Use **Next** to inspect every intermediate decision, and expand **See the code and exact numbers** for the pseudocode and queue. Then switch to **Your Pune journey** to apply the same idea to real streets.

In the 3D Algorithm Lab, choose **Fullscreen** to fill the display. Use **Hide explanation** for an unobstructed map, then **Show explanation** when discussing the current step. Replay and camera controls remain available. Use **Exit fullscreen** or Escape to return.

The default scene uses low junction markers, subtle raised building footprints, and a highlighted final route. Enable **Cost height** to show shorter, proportionally scaled cost pillars. Their heights represent tentative algorithm costs, not real building or terrain heights; the building relief is illustrative.
