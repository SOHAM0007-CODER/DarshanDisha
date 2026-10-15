# Manache Paach Darshan: Interactive Shortest-Path Simulator

## Project pitch

An interactive walking journey through Pune's historic peths. The visitor starts at a chosen location, visits the five Manache Ganpati mandals, and watches two shortest-path algorithms search the same pedestrian street graph. The experience combines a realistic map, festive visual design, route choices, and a clear explanation of why the algorithms reach the same minimum cost by different processes.

**One-sentence demo:** “Close a lane near a mandal, and watch Dijkstra and Bellman–Ford recalculate the darshan walk in real time.”

## Experience standard

The finished experience must answer four visitor questions immediately: **Where am I going? Which route should I take? Why was this route chosen? What changes if a lane is crowded?** It must also answer the academic question: **How did each of the two algorithms explore the graph before reaching the same optimum?**

The opening screen should be useful within seconds: choose a start and destination, see the route, then explore details. Keep the festive presentation rich but the route, controls, and explanations uncluttered. The Manache Paach journey remains the hero; other mandals are optional discoveries.

## Core experience

1. **Choose a journey.** Select a starting point, such as Shaniwar Wada, a parking area, or a custom map point. Select any mapped mandal, such as Dagdusheth, as the destination for a single-leg experiment, or choose “Visit all five.”
2. **Choose the order.** In the full journey, compare the traditional ceremonial order with the shortest walking order. Show the complete sequence and distance before starting.
3. **Choose an objective and scenario.** Compare shortest walking distance with quickest walking time under simulated crowds. Try normal, crowded, or closed-lane scenarios. Crowd and closure controls are explicitly labeled as simulated unless sourced from verified current information.
4. **Watch the search.** Dijkstra and Bellman–Ford run on identical graph data. Each has its own color and step-by-step playback, with synchronized or individual controls.
5. **Watch the walk.** A visitor marker follows the chosen path along actual street geometry, pauses at each mandal, and updates the completed-darshan checklist.
6. **Consider an optional stop.** If another mapped Ganpati can be visited with a small calculated detour, show the added metres and estimated minutes and ask whether the visitor wants to include it. Never add a stop automatically.
7. **Read the result.** Show total walking distance, estimated walking time, algorithm operations, and why the selected route won.

## The five required stops

- Shri Kasba Ganpati
- Tambdi Jogeshwari Ganpati
- Guruji Talim Ganpati
- Tulshibaug Ganpati
- Kesariwada Ganpati

The app should explain that the ceremonial order is a cultural reference. The route optimizer may choose a different visiting order when the user selects the shortest walking journey.

## Optional Ganpati discovery

Keep the five Manache Ganpati visually and functionally central: their markers are larger, their checklist is always visible, and “Visit all five” is the featured journey. Add a separate catalog of verified optional destinations. Initial candidates to map and verify include Shrimant Dagdusheth Halwai Ganpati, Hutatma Babu Genu Mandal, Shrimant Bhausaheb Rangari Ganpati, Akhil Mandai Mandal, and Jilbya Maruti Mandal. The user may choose one as a main destination or include it as an extra stop in a five-mandal journey.

**Example interaction:** The visitor selects a start point and Dagdusheth as the destination. The app first draws the shortest path. It then checks optional mandals against that *actual computed route*. If a stop qualifies, a card says: “Another Ganpati is close to your route. Add Hutatma Babu Genu? +___ m walking, +___ min estimated.” Buttons: **Add stop**, **Show on map**, **Skip**. The numbers come from the graph; they are never hard-coded. The suggested mandal depends on the chosen start point, crowd setting, closures, and route objective.

Do not define “on the way” by straight-line proximity alone. For start `S`, destination `T`, and candidate `G`, calculate the detour as `cost(S,G) + cost(G,T) - cost(S,T)` using shortest paths on the current graph. Rank candidates by smallest added cost, apply a small configurable detour threshold, and show at most two suggestions. If no candidate meets the threshold, show none. For a full itinerary, find the best insertion point for each optional stop and recalculate the complete route after the visitor accepts it. Keep optional additions limited to two in the demo so the itinerary remains easy to explain.

## Map and graph model

Use a small, curated **pedestrian graph** around the five mandals. Nodes represent actual walkable intersections, lane turns, crossings, entrances, and start points. Edges follow street or walkway geometry. Store each edge's length in metres, coordinates for drawing, and optional simulated crowd multiplier or closure state.

Use real map data as a starting point, then manually inspect the nearby lanes and mandal entrance locations. A visual line between two landmarks is not automatically a walkable edge. Do not route through buildings or across roads without a crossing. Keep the graph and scenario data bundled locally so the judged demo works without network access. Attribute OpenStreetMap if its data is used.

Offer two clearly defined objectives. **Shortest distance** assigns each edge its walking length. **Quickest walk in crowds** assigns each edge a nonnegative estimated time, based on walking length, simulated crowd slowdown, and crossing delay. The quickest route can be longer in metres if it avoids a congested lane. Freeze the scenario while an algorithm run is playing; recalculate from the start when the user changes it. A chosen mandal's estimated darshan queue can be added to the trip ETA, but label it separately from walking time. Queue estimates should not influence stop-order optimization unless an arrival-time queue model is implemented.

## Algorithm design

| Algorithm | Role in the demo | Animation | Expected result |
| --- | --- | --- | --- |
| Dijkstra | Baseline shortest path with nonnegative edge weights | Frontier grows from the start; nearest tentative node is selected | Minimum route cost |
| Bellman–Ford | Shows repeated edge relaxation | Scan edges in passes; labels improve until stable | Same minimum route cost |


**Single leg:** both algorithms solve exactly the same start-to-target query. Show their explored nodes, final route, final cost, node removals or passes, and edge relaxations. Measured milliseconds can be secondary because tiny graphs produce noisy timings.

**Visit all five:** first compute the shortest path and cost between every relevant pair of stops (and the chosen start) using the selected algorithm. Then evaluate the possible visiting orders and select the least-cost complete journey. With five stops there are only 5! = 120 orders, so exhaustive comparison is understandable and exact. Keep the order-selection step separate from the shortest-path algorithm in the explanation. If a fixed end point is added, include its final leg in every candidate's cost.

**Optional stop:** for a single-destination route, compare `S → T` with `S → G → T`. For the full journey, recompute the stop order after inserting accepted extras. Run the same two shortest-path algorithms on the resulting legs; explain that optional-stop selection is a separate routing decision.

## Interface and visual direction

- **Map as the main stage:** real street outlines, subtle building blocks, labeled lanes, five prominent mandal markers, and a clear walking path.
- **Festive palette:** deep indigo or midnight blue base, warm saffron and marigold highlights, restrained gold accents. Use readable text and avoid decorative effects over route labels.
- **Two viewing modes:** “Darshan Journey” for an immersive full walk and “Algorithm Lab” for a rigorous side-by-side comparison.
- **Algorithm playback:** play, pause, step forward, speed control, reset. Distinguish explored edges, current frontier, and final route with both color and line style.
- **Mandal cards:** name in Marathi and English, sequence number, arrival time, and completed status. Use verified photos only with permission; otherwise use original illustrations or simple motifs.
- **Route explanation:** short plain-language callouts such as “This lane is closed, so the route turns toward the next crossing.”
- **Crowd comparison:** place “shortest distance” and “quickest in crowds” routes on the same map with distinct line styles. Show why the quickest route avoided a slower lane.
- **Optional-stop cards:** show the extra walking distance and estimated time before asking “Add this Ganpati to your journey?” Keep “Skip” equally visible.
- **Accessibility:** keyboard-operable controls, high-contrast route mode, reduced-motion option, and no information conveyed by color alone.

### Information hierarchy

**Always visible:** selected destination or itinerary, recommended route, walking distance, estimated walking time, route objective, and a clear “simulated crowd” label when applicable. **One tap away:** alternative route, optional mandals and their detours, mandal details, street-by-street directions, and data-source information. **Algorithm Lab only:** frontier, distance labels, pseudocode step, graph metrics, and complexity explanation. This keeps the visitor experience understandable while still giving judges the full algorithm analysis.

Show the ETA as a breakdown: walking time + selected mandal queue assumptions = total estimated visit time. If queue data is unknown, say “queue time unavailable” instead of inventing a precise arrival time. For every recommendation, add one plain-language reason, such as “Saves 6 simulated minutes by avoiding the crowded lane near this crossing.”

### Animation quality specification

- Target smooth 60 fps playback on a typical presentation laptop, and keep controls responsive while a route is recalculated. Treat 60 fps as a quality target to measure, not a guaranteed claim.
- Precompute each algorithm's trace as events (`visit node`, `relax edge`, `update distance`, `finish`) and play those events at a controlled rate. The two algorithms can be paused, stepped, replayed, or synchronized without recomputing on every frame.
- Animate the visitor along the route geometry by travelled distance rather than jumping from node to node. Ease into stops and turns, and keep marker speed visually consistent at different map zoom levels.
- Draw explored edges and final paths in lightweight map layers. Update only the changed geometry or style; avoid redrawing the whole map and every interface card on each animation frame.
- Crossfade from the old route to a new route after a closure or crowd change. Keep the camera steady unless the user chooses “Follow journey”; avoid constant zooming and panning.
- Give each animation an adjustable speed. Respect reduced-motion settings with instant route display and step controls.
- Keep map assets and scenario data available offline. Test the presentation build on the actual laptop and projector resolution before submission.

### Helpful route output

After calculation, provide a concise route card with the stop sequence, walking distance, estimated walking time, optional queue assumptions, and a small list of turns or recognizable street landmarks. A user should be able to save or print a simple itinerary. When the suggested route changes, highlight the affected leg and state the reason. A closure that disconnects the destination must produce an understandable “No walkable route in this scenario” message.

## Realism without false claims

- Place mandals at verified entrance points, not approximate neighborhood centers.
- Use street names and walkable paths visible on the map.
- Treat crowd levels, queues, closures, and walking speeds as **simulation assumptions** unless a dated source is provided.
- Give simulated crowd presets intuitive names such as Quiet Morning and Festival Peak, plus a manual lane-crowd control for the judging demo. Do not present these as live measurements.
- Show source and data date in an “About this map” panel.
- Do not claim live crowd or traffic tracking.
- Provide a self-contained demo scenario so the project is reliable in a classroom or judging venue.

## Suggested demo sequence (about 3 minutes)

1. Open the festive landing view, point out the five mandals and real Pune lanes.
2. Choose a start point and a single destination. Run both algorithms in synchronized playback.
3. Show that the final distance matches but the search patterns and operation counts differ.
4. Select Dagdusheth as a destination. Show the shortest route and an optional nearby-Ganpati card with its calculated detour; accept it and watch the route update.
5. Turn on Festival Peak crowds. Compare the shortest-distance route with the quickest crowd-aware route, then close a lane and rerun.
6. Switch to “Visit all five”; compare ceremonial order with shortest-distance order.
7. Start the animated darshan walk and finish on a concise comparison panel.

## Build sequence

1. **Data and correctness:** verify mandal locations, build the pedestrian graph, implement the two algorithms, and test known routes and closures.
2. **Algorithm Lab:** add trace events, synchronized playback, comparison metrics, and path overlays.
3. **Full journey and optional stops:** implement pairwise shortest paths, 120-order comparison, traditional-order option, Dagdusheth destination, calculated detour suggestions, and visitor animation.
4. **Presentation finish:** visual theme, Marathi/English labels, sound toggle, motion settings, concise explanations, offline demo bundle.

## Acceptance checks

- Both algorithms return the same minimum cost on the same nonnegative graph and scenario.
- Every displayed route follows graph edges; no route cuts through a building or blocked lane.
- Closing an edge changes or invalidates a route as expected, including a clear “No route available” state.
- The shortest five-stop order is checked against all 120 valid orders.
- A suggested Ganpati's displayed detour equals the recalculated route difference; declining it leaves the route unchanged.
- In a crowd scenario, both algorithms agree on minimum estimated walking time, even when the time-optimal route differs from the distance-optimal route.
- Route playback moves continuously along street geometry, pause and step respond promptly, and the interface stays usable during recomputation.
- The first route result makes its objective, data assumptions, distance, and time visible without opening Algorithm Lab.
- A visitor can follow the route card without interpreting algorithm colors or graph terminology.
- The app remains usable when internet access is unavailable.

## References to verify during implementation

- Manache Paach names and ceremonial order: https://puneganpati.in/guides/manache-paach
- OpenStreetMap attribution and data license: https://www.openstreetmap.org/copyright
- MapLibre browser mapping documentation, if used for the visual map: https://maplibre.org/maplibre-gl-js/docs/
- Nearby-mandal candidates to verify on the pedestrian graph: https://ganpatipune.in/ganpati/dagdusheth-halwai-ganpati
