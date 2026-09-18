# GAME GRAPHICS SPECIFICATION & VISUAL ROADMAP

Durable state and feature execution roadmap against target art reference (`reference/target2.jpg`).
This file governs autonomous execution. Claude Code must read this document at the start of every session to identify the highest-priority visual gap and build concrete 3D assets and features.

---

## 1. Execution Protocol & Safety Rules

- **Execution Mode:** Autonomous Feature Sprints (Max 3 to 5 iterations per session).
- **Core Objective:** Build missing visual elements (3D geometry, environment meshes, particle effects, UI HUD) rather than tweaking shader values or color variables.
- **Visual Standard:** `reference/target2.jpg` (Coastal boulevard: palms, marina, cruise ship, hazy city skyline, turquoise sea, long soft shadows, yellow classic coupe).
- **Hard Constraints:**
  - **Never run infinite loops without stopping.** Maximum 5 iterations per execution call.
  - **Do NOT tweak metrics or histograms.** Visual quality is validated exclusively by rendered Playwright screenshots.
  - **One Major Feature Per Pass:** Every iteration MUST add a brand-new, clearly visible asset, mesh, or structural feature. Micro-edits (e.g., changing a hex code, adjusting a 0.01 opacity) are strictly forbidden.

---

## 2. Visual Feature Backlog (Priority Order)

Claude Code MUST work on these features strictly in the order listed below. Do not move to the next item until the preceding feature is visibly rendered and confirmed via Playwright screenshots.

### Priority 1: Environment & Horizon (The Coast)
1. **Distant City Skyline:** Render 3D geometric buildings along the horizon band with soft atmospheric fog.
2. **The Marina & Sea:** Render turquoise ocean water geometry to the side of the road with a static 3D cruise ship model in the background.
3. **Palm Tree Geometry:** Replace generic roadside blocks/posts with distinct 3D palm tree meshes casting long soft shadows across the road.

### Priority 2: Traffic & Entity Models
4. **Hero Car Fidelity:** Add detailed LOD geometry, tire smoke particle trails, and glossy reflection passes to the player vehicle.
5. **Traffic Vehicles:** Replace placeholder colored-box traffic with distinct 3D car/truck chassis models.
6. **Pickups & Collectibles:** Replace plain colored boxes with animated, rotating 3D pickup meshes.

### Priority 3: Road Details & Polish
7. **Roadside Architecture:** Render continuous curb guardrails, street lamp posts, and clean biome transitions.
8. **Drivable Gutters & Chicane Edge:** Add textured curb/gutter geometry with distinct red/white rumble striping.

---

## 3. Autonomous Iteration Loop Command

When executing an iteration, Claude Code MUST follow this exact loop:

```bash
1. READ: Identify the top unfinished item in Section 2 (Visual Feature Backlog).
2. IMPLEMENT: Write or update the necessary 3D meshes, WebGL render logic, or assets to build that feature.
3. TEST & CAPTURE: Launch the local server and run Playwright to capture a full-resolution screenshot (`tests/screenshots/iteration_N.png`).
4. VISUAL INSPECTION: Inspect the PNG screenshot using image capabilities. Ask:
   - "Is the new 3D feature/asset clearly visible in the frame?"
   - "Does it render without crashing the WebGL context or freezing the loop?"
5. COMMIT: If visible and functional, commit code (`git commit -m "feat(graphics): Add [Feature Name]"`).
6. REPORT: Log the added feature in the Execution Log below and proceed to the next backlog item.
```

---

## 4. Execution Log

### Iteration 44 — The Marina & Sea (backlog item 2)

**Backlog state on entry.** Items 1 and 3–8 were already built and visibly
rendering: skyline, palms, lamps, railings, rumble striping, traffic bodies,
pickup bodies and the kerbside rank of parked cars. Item 2 was the top
unfinished one, and unfinished in a specific way — the sea, the beach profile
and `MarinaManager` were all written, correct, and placing instances. None of
it had ever appeared in a frame.

**The finding.** `SHORE_INNER` was shared with the landward hills'
`RELIEF_INNER` at 96, putting the first sand 96 units out and the waterline at
145. At a 62° field of view lateral 145 only enters the frame past 300 units
ahead, where `FogExp2` at 0.0034 has already taken 65% of it. A 2400-wide
capture caught the water as a turquoise sliver at the extreme right; the 16:9
frame the game is played in caught none of it. The field reported four vessels
placed every time it was asked.

**Built this pass.**

- **The coast brought into frame.** Seaward relief given its own inner radius
  and ramp (24 / 22 against the hills' 96 / 110), so the beach starts just
  outside the railing and the waterline lands around 32 — a shoreline running
  from the lower right of the frame to the vanishing point. Ground columns
  gained five laterals through the ramp so the shoreline is a curve rather than
  a straight edge between two samples; sea columns re-spaced from 20 outwards
  and started *under* the sand so the waterline is decided by the ground.
- **`CruiseShipManager`** — a new `CellField`, and the backlog item's named
  asset. Nine boxes: a low hull tapering through two steps to the bow, three
  tiers of cabin decks stepping in and up, a bridge set forward, a funnel aft.
  What was there before was `MarinaManager` scaling its yacht hull by six,
  which is defensible while both are fog and stops being so the moment either
  can be resolved. `MarinaManager` keeps the moorings and lost its ship class.
- **Two-tone geometry.** `mergeBoxes` takes an optional colour per part and
  bakes a `color` attribute. A liner in one colour is a white shape against
  white haze; the dark hull under white decks is the division that survives the
  fog, and one `instanceColor` per instance cannot express it.
- **Props stand on the ground.** `SceneryManager` was the last rank still
  placing at road height, which was safe only while relief began further out
  than anything was planted. It now samples `groundReliefAt`, and declines any
  seaward prop whose footprint would reach past `BEACH_DRY_LIMIT`.

**What the loop got wrong three times, recorded because it cost the most.**
Boulders and scrub kept rendering offshore while every number said they were
ashore. Three rounds of margin on a *sampled* test moved the number and not the
picture — because the test read `groundReliefAt` and the picture read the ground
*mesh*, which interpolates linearly between columns six units apart across a
smoothstep, and a chord under a convex curve lies below it. `BEACH_DRY_LIMIT`
now solves the crossing against the same columns and the same interpolation the
mesh uses, at the swell's trough. Sampling a surface is not the same as asking
where it goes.

**New test seams.** `setSeaVisible` on the dev handle — whether a prop is on wet
sand or ten units offshore is not a question a capture can answer while the
water is drawn over it. `scenery()` additionally reports `maxSeawardEdge` and
`inSea`, the latter an independent check rather than a restatement of the cull.

**Verification.** `tests/screenshots/iter_44.png` — sea, beach, shoreline and a
liner on the water, with `iter_44_before.png` for the same road before the pass
and `iter_44_ship.png` a closeup of the hull. `npm run build` clean;
`npm run probe` 247/247 checks, 34/34 cues.

**Next:** item 4, Hero Car Fidelity.
