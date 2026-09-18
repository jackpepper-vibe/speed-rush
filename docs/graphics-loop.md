# Graphics loop state

Durable state for the iterative graphics work against `reference/target2.jpg`.
Kept in the repository because the loop runs long enough that conversation
context is summarised, and a delta reported against a number nobody can still
see is not a measurement.

Update the tables below each iteration. Do not delete history — a change that
moved a score the wrong way is the most useful row in the file.

## The standard

`reference/target2.jpg`, 620x400, resolved through `tools/reference.mjs`.
Gitignored and never committed. A coastal boulevard: palms, marina, cruise
ship, hazy city skyline, turquoise sea, long soft shadows, a yellow classic
coupe trailing tyre smoke.

It is a **fidelity standard only**. Framing, aspect, resolution and the
driving state in it are not a spec.

## How it is measured

`tools/profile.mjs` is the one profiler both `compare.mjs` and `probe.mjs` use.
Analysis runs at 620 wide, each image keeping its own aspect so pixels stay
square, with a matched 3x3 box pre-filter over both. Both tools render a second
analysis frame natively at that width so neither image is downsampled on the
way in — `compare.mjs` prints both resample ratios and they must read
`1.00x / 1.00x`.

`compare.mjs` scores two poses and prints both:

- **boost** — the hero pose, 323 km/h with nitro. Carries the speed grade:
  vignette 0.64, contrast 1.23.
- **cruise** — 140 km/h, no nitro. The grade sits near its neutral end.

target2 shows an unboosted car, so **cruise is the fair row for it**. Both are
printed so the choice is never made after seeing the numbers.

## Scores

High tier, cruise row, unless stated.

| iter | commit | hist | verge | contrast | bright | probe |
|------|--------|------|-------|----------|--------|-------|
| base | — | 1.192 | 0.48 | 1.67 | 0.37 | 244/245 |
| 1 | `fc86ec7` | 1.153 | 0.48 | 1.62 | 0.45 | 244/245 |
| 2 | `035d2d6` | 1.111 | 0.68 | 1.48 | 0.25 | 244/245 |
| 3 | `aa4ffd5` | 1.139 | 0.60 | 1.30 | 0.90 | **243/245** |
| 4 | `181c7df` | 1.109 | 0.70 | 1.31 | 0.89 | 243/245 |
| 5 | `a5ea7e5` | 1.103 | 0.81 | — | — | 244/245 |
| 6 | `41b89ef` | 1.093 | 0.86 | 1.30 | 0.93 | 244/245 |
| 7 | `cbf3714` | **0.706** | 0.80 | 0.77 | 0.94 | **243/245** |
| 8 | `89590bf` | 0.723 | 0.88 | 0.78 | 0.94 | 244/245 |
| 9 | `330c014` | 0.696 | 0.93 | 0.76 | — | 244/245 |
| 10 | `d6e56ef` | **0.684** | 0.99 | 0.76 | 0.47 | 244/245 |
| 11 | `f041d54` | **0.629** | 0.93 | 0.82 | 0.42 | 244/245 |
| 12 | `16236c5` | 0.631 | 0.94 | 0.82 | 0.41 | 244/245 |
| 13 | `c111267` | 0.642 | 0.87 | 0.78 | — | 244/245 |
| 14 | `3e7d6c6` | 0.734 | 0.75 | — | — | 244/245 |
| 15 | `165f73a` | 0.734 | 0.75 | — | — | 244/245 |

| 16 | `069aefc` | 0.734 | 0.75 | 0.75 | 0.42 | 244/245 |
| 17 | `7c413aa` | **0.703** | 0.73 | 0.73 | 0.37 | 244/245 |
| 18 | `75d3f61` | **0.690** | 0.72 | 0.74 | 0.37 | 244/245 |
| 19 | `93f1997` | **0.634** | 0.79 | 0.72 | 0.11 | 244/245 |
| 20 | `a6b888e` | **0.615** | 0.79 | 0.71 | 0.11 | 244/245* |
| 21 | `a538ecd` | 0.615 | 0.79 | 0.71 | 0.11 | 244/245 |
| 22 | `dfb2c24` | **0.535** | 0.90 | 0.65 | 0.05 | **245/245** |
| 23 | `7c7f5cd` | **0.534** | 0.90 | 0.66 | — | **245/245 x3** |
| 24 | `ab8e7ca` | **0.532** | 0.91 | 0.66 | — | **245/245** |
| 25 | `258623c` | 0.532 | 0.91 | 0.66 | — | **246/246** |
| 26 | `00cde83` | **0.531** | 1.03 | **0.77** | — | **246/246** |
| 27 | `ff85bdc` | 0.531 | 1.03 | 0.77 | 0.06 | 246/246 |
| 28 | `b25c41d` | 0.531 | 1.03 | 0.77 | 0.06 | 246/246 |
| 29 | `72b2740` | 0.531 | 1.03 | 0.77 | 0.06 | 246/246 |
| 30 | `57726ae` | 0.531 | 1.03 | 0.77 | 0.06 | 246/246 |
| 31 | `7775fe0` | 0.531 | 1.03 | 0.77 | 0.06 | 246/246 |
| 32 | `dc3d4c8` | 0.531 | 1.03 | 0.77 | 0.06 | **247/247** |
| 33 | `2852c63` | **0.517** | 1.06 | 0.78 | 0.06 | 247/247 |
| 34 | `PENDING` | **0.485** | 1.05 | 0.82 | 0.06 | 247/247 |

From iteration 25 the probe has **246** checks, not 245. The new one asserts
that something beside the road darkens it.

**Iteration 22 is the first time the histogram bound has been met on
`compare.mjs`.** Cruise 0.535 and boost 0.506 against a bound of 0.55, with
roadside density 0.90 cruise and 1.00 boost, both inside 0.6-1.7. Frame mean
150.4 against the reference's 150.5.

### Both bounds are met, confirmed

At `7c7f5cd` the probe returns **245/245 on three consecutive runs**, on a
frozen tree, with no resample warning and no capture failure on any of them.

- histogram **0.534** cruise, **0.512** boost, against `<= 0.55`
- roadside density **0.90** cruise, **1.01** boost, against `0.6 - 1.7`

Neither threshold was ever moved. The licence to re-derive them was declined at
iteration 1 and never used; the gap closed from 1.192 to 0.534 by art.

Worth being exact about what this is not. It is a **luminance-distribution**
match, not a match of content. The frame still has no water, no marina and no
skyline, and it still holds 0.0% of its pixels above luminance 224 where the
reference holds 10.5% — two large errors that happen to sit either side of the
L1 and partly cancel. The bound being met is a floor on fidelity, not a
ceiling, and the queue below is not finished.

\* Iteration 20's probe actually printed **245/245**, and it was a false pass.
See entry 21. The probe's honest reading at that code state is 0.563.

The probe's own reading of the same bound is now **0.579** and falling with it.
The boost row at iteration 20 reads **0.564**. The 0.55 bound has stopped being
theoretical.

From iteration 17 on, a single run is enough: both harnesses are exactly
reproducible, and repeated runs return the same digits.

**Iteration 15 did not achieve what it claimed, and the claim was published
before the evidence was in.** Three probe runs at `165f73a` returned 0.662,
0.696, 0.662. The gate is still not reproducible. The commit message and the
entry below were written off a single run; the two confirmation runs landed
afterwards and contradicted them. `compare.mjs` *is* reproducible — four
identical runs at iteration 14, re-confirmed since. `probe.mjs` is not.

**Iteration 14 is a re-baseline, not a regression.** It changed no art. It
stopped the render loop advancing the world behind the harness's back, which
moved the pose every score above it was measured at. 0.642 and 0.734 are the
same art at two different stretches of road; only the second one is the stretch
the harness actually asked for. **Do not compare any number below this line with
any number above it.** Deltas within each era remain valid.

**Iteration 11's number is a mean of three runs.** The same code state measured
0.615, 0.650 and 0.622 — a spread of 0.035, where earlier iterations had been
treated as repeatable to about 0.005.

**Iteration 12 closed most of it, and iteration 13 corrected the claim.**
Seeding the textures took the spread from 0.035 to about 0.013. It did not take
it to zero. Iteration 12 reported three consecutive identical runs and read that
as proof of determinism; iteration 13 ran the *same commit* four times and got
0.632, 0.624, 0.632, 0.637. Three identical samples out of a distribution with
two or three modes is luck, not a proof, and three is too few to tell the
difference. **Every number in this table is a single sample unless it says
otherwise, and carries about ±0.013.** Read no delta below 0.02 as real.

**Iteration 14 closed it, and the cause was not the resize.** `GameLoop`'s
requestAnimationFrame loop ticks the simulation off the wall clock, and it never
stopped while the harness was between calls — every `page.evaluate` round trip
was tick time nobody asked for, so a capture landed a whole number of unplanned
ticks past the pose that was requested. That is why the scores were discrete
rather than Gaussian: a tick is a quantum. `compare.mjs` now calls
`setAutoAdvance(false)` before it drives, and four consecutive runs return
identical scores.

The lesson is worth keeping: **discrete repeated values are a race, Gaussian
scatter is noise, and the two want different fixes.** Iteration 12 chased this
as noise and seeded the textures, which was a real fix for a real 0.035 of
spread but left the race untouched — and then read three lucky samples as proof
the job was done.

Iteration 10 also measured two states that were **not** kept, because the band
dump is the only thing that explains the one that was:

| state | change | hist | bright ratio |
|-------|--------|------|--------------|
| 010b | narrow cover + zenith clear + cloud top `*1.18` | 0.718 | 1.19 |
| 010c | as 010b but cloud top `*1.55` | 0.891 | 2.04 |
| 010d | narrow cover + zenith clear only — **kept** | 0.684 | 0.47 |

Low tier at iteration 5: verge 0.59 cruise, 0.54 boost. The probe reads this
metric roughly 0.16 above what `compare.mjs --quality low` reads for it at the
same code state, so the two are not interchangeable.

Bounds: histogram <= 0.55, roadside density 0.6 to 1.7. **Never widened.** The
one-time licence to re-derive them on the target swap was declined at iteration
1, because the measurement repair moved the numbers barely at all and
re-deriving could only have meant loosening them to fit an unclosed gap.

## What has been done

1. `fc86ec7` — one shared profiler, native-width analysis frames, matched
   pre-filter. Found the resample asymmetry was **not** what held the scores
   down: verge moved 0.48 -> 0.47 across the whole repair.
2. `035d2d6` — score boost and cruise separately. The speed grade turned out to
   suppress the **verge** metric by a third (0.48 -> 0.68) and the histogram
   barely at all (-0.045), the opposite way round from the guess.
3. `aa4ffd5` — pinned day phase was rendering halfway to dusk. `applyLook` used
   `indexOf(phase) + 0.5`, which lands `frac` at 0.5 and blends a dead 50/50 of
   two palettes, while `state()` reported `day`. Fixed to `indexOf(phase)`.
   Mean 115 -> 148 against the reference's 150, dark pixels 19% -> 0.33%
   against its 0.9%. Histogram went 0.028 the **wrong** way: L1 is
   shape-sensitive, and the reference holds 29.7% of its pixels in two bins at
   lum 144-159 where we hold 2.6%.
4. `181c7df` — coast lamp standard. The phase fix had dropped roadside-density
   to 0.58 by removing a disguise: half-dusk light threw orange contrast across
   the verge that was being counted as roadside detail.
5. `a5ea7e5` — `PropKind.cadence` exempts regularly-spaced street furniture
   from `quality.sceneryDensity`, lamp count 26 -> 48. Recovered the probe to
   244/245. Ladder cost at low tier: draw calls 621 -> 621, triangles
   125386 -> 127762.

6. `41b89ef` — this state file. No art change.
7. Asphalt albedo `#3c3f47` -> `#6e7382`. The road is the largest single area
   in frame and it was rendering into lum 48-95 while the reference keeps 29.7%
   of its pixels in two bins at 144-159. Landed by measurement: texture
   luminance 130 overshot into 168-183, the response is about 1.5 rendered
   units per unit of texture luminance, and 115 lands the road in the
   reference's peak. Histogram **1.093 -> 0.706**, the largest single move of
   the loop. Cost: contrast ratio went 1.30 to 0.77, so the frame is now
   slightly flatter than the reference where it used to be harder.

8. `89590bf` — verge railings. The asphalt change had dropped roadside-density
   to 0.59: the red-and-white shoulder stripes sit inside the verge sample
   region, and raising the carriageway from luminance 72 to 150 halved their
   contrast against it. The edge energy the metric counted there was
   road-to-stripe. Recovered with a dark iron railing rather than by darkening
   the road back, which would have traded a 0.387 histogram gain for a 0.06
   verge one. Verge 0.80 -> 0.88 high, 0.59 -> 0.65 low; histogram gave back
   0.017. Low tier cost: draw calls 621 -> 622, triangles 127762 -> 133522.

   Incomplete: cadence kinds are placed by the same seeded scatter as
   everything else, so the railings land as separated runs. The reference's
   railing is continuous to the vanishing point. Fixing that is a
   SceneryManager placement change — sequential placement for cadence kinds —
   not a geometry one.

9. Day `skyBottom` `0xa8ccec` -> `0x7fb0e0`. The sky excess was not the zenith:
   `skyTop` was already a deep `0x1e5fbe` at luminance 88, but a chase camera
   sits on the horizon so the lower dome fills the frame and the zenith barely
   appears. `skyBottom` rendered at 199, right inside the 200-223 pile.
   Histogram 0.726 -> 0.696. That gain is entirely the **character** half of
   the sky gap, not the area half — the area half is framing and unreachable.
   Modest because cloud cover, not gradient, is what fills most of our sky:
   day `clouds` is 0.28 and lays pale wisps across the whole dome, where the
   reference has clear blue with one discrete cumulus bank. That is the next
   sky lever.

10. Cloud **cover**, not cloud character. Two edits to the `CLOUD_DETAIL > 0`
    block: the coverage window narrowed from `0.60..0.80 - uClouds` to
    `0.64..0.74 - uClouds`, and a second fade `1 - smoothstep(0.30, 0.66, dir.y)`
    added so cloud stops well below the zenith. Histogram 0.696 -> 0.684, verge
    0.93 -> 0.99. Free at every tier: two smoothsteps, no new octaves.

    **The cloud's brightness is not a free parameter, and that is the finding.**
    The queue called for blown cumulus tops at 240-255, where the reference
    holds 7.5% against our 1.1%. Two attempts at it both went the wrong way —
    `*1.18` gave 0.718, `*1.55` gave 0.891 — and the band dump says the reason
    is structural, not a matter of finding the right multiplier. The dome is
    what the environment map is built from, so raising the cloud raises the
    exposure of *the whole scene*: at `*1.55` the 144-151 band fell 8.7% -> 5.8%
    and the dark end emptied entirely, both away from the reference, while the
    clouds themselves only crawled from 208-215 into 216-231. **248-255 never
    moved off 0.2-0.3% at any multiplier** — tone mapping asymptotes there, so
    the reference's clipped 3.7% in the top bin is not reachable by brightening
    anything in the dome.

    So the sky gap splits three ways, not two: cover is winnable and was won;
    area is framing and is not; **character is reachable only by decoupling the
    cloud's rendered value from the env-map value it contributes**, which is a
    SceneRig change, not a palette one. Queued as its own item.

11. Day `sunElevation` `0.85` -> `0.30`, and asphalt albedo `#6e7382` ->
    `#7a8090` to re-land under it. Two edits, one lever — the second exists
    only to hold what the first disturbed, the same shape as iteration 8.

    The sun stood 54 degrees up, so every roadside shadow fell in a puddle
    under the thing that cast it: the props were lit and nothing they stood on
    knew they were there. The reference throws palm shadows clear across a
    four-lane carriageway, which needs a sun near 30. Only the angle moved —
    the day palette keeps its noon colour, its noon intensity and its noon
    exposure, so this is geometry, not a warm grade sneaking in.

    Lowering it alone measured **0.865**, much worse, and the band dump said
    exactly why: a grazing sun took the carriageway with it, and the largest
    single area in frame fell out of the reference's peak at 144-159 (22.7% ->
    9.4%) down into 104-135. **Every summary statistic improved while the L1
    got worse** — mean 167 -> 156 against the reference's 150, std 36.7 -> 44.3
    against its 49.3, contrast 0.76 -> 0.90. The albedo is the thing that made
    the difference, and the lesson generalises: *an albedo is only ever landed
    against an illumination*. Iteration 7's `#6e7382` was correct for a
    54-degree sun and for nothing else.

    Re-landed by iteration 7's own method: `#808697` gave 0.643, `#7a8090` gave
    0.615, `#747a8a` gave 0.752. The well is narrow — six units of texture
    luminance below the landing costs 0.14 — but the first two are inside the
    noise band and should not be read as ranked.

12. All five canvas texture makers seeded. `makeRoadTexture`,
    `makeRoadWearTexture`, `makeGroundTexture` and `makeBuildingTexture` drew
    their grain from `Math.random()`; they now each take a fixed stream from
    `TEXTURE_SEED`. Three consecutive comparison runs went from 0.615/0.650/
    0.622 to **0.632/0.632/0.632**.

    Fixed constants, deliberately not the world seed: two runs at different
    seeds should differ in their traffic and their scenery, not in the
    aggregate of their asphalt. Also deliberately not drawn from `ctx.rng` —
    pulling from the shared stream during texture build would shift every draw
    made after it, so a change to the road's grain would silently relay out the
    traffic. One stream per maker, so adding a `next()` to one cannot move
    another's grain.

    No art change and no score change beyond the noise it removed. It is here
    because the spread had grown wider than most of the gains being booked
    against it, which makes every number a guess dressed as a measurement.

13. Cadence kinds are **laid, not scattered**. `PropKind.cadence` carries the
    along-road pitch instead of a boolean; `SceneryManager` places those kinds
    sequentially on a grid anchored to the band origin, half the instances to
    each verge, and turns each one's local +X to face the road instead of
    yawing it at random. `railingGeo` was re-authored to span Z so that one
    facing rule serves both kinds — it swings a lamp's arm over the carriageway
    and leaves a railing running along the verge. Railing posts went from two
    per eight-unit section to one every two units. Lamp pitch 20, railing pitch
    8, both divisors of `BAND_LENGTH`.

    The documented gap is closed: the railing is one unbroken line to the
    vanishing point, as the reference's is, and the lamps keep an even rhythm
    with their heads over the traffic.

    **It cost the verge metric and that is worth stating plainly.** Roadside
    density 0.94 -> 0.87, a 0.07 move well outside the 0.013 noise floor, while
    the histogram went 0.631 -> 0.642, which is inside it and should be read as
    a wash. The metric was rewarding the clutter: 120 randomly yawed sections at
    random depths overlapping each other produce more edge energy per unit area
    than one clean line does, and the clean line is what the reference has.
    Denser posts recovered some of it (0.85 -> 0.87 across the same runs) but
    not all. **This is a case where the target and the metric disagree**, the
    target was followed, and the metric stays comfortably inside its 0.6-1.7
    bound. Triangles 343323 -> 349083 at high tier.

    Two false starts, both from the placement being written before its
    conventions were read: lamp pitch 30 left a third of the lamps parked off
    the end of the draw distance (verge 0.82), and the first `ahead` subtracted
    `distance` where the scatter beside it anchors on `base`, which double-counts
    what `reposition` already applies.

14. `Game.setAutoAdvance`, and `compare.mjs` calling it before it drives. No
    art change; this is the measurement finally becoming a measurement.

    `step` and `drive` consult no clock and are deterministic by construction.
    The requestAnimationFrame loop beside them is neither, and nothing had ever
    stopped it: while the harness sat in a `page.evaluate` round trip or a
    `setViewportSize`, the loop went on ticking the world off the wall clock.
    Every capture therefore landed some whole number of unplanned ticks past
    the pose the script asked for, and the number depended on how busy the
    machine was. Four consecutive runs now return identical scores where the
    same commit previously returned 0.632, 0.624, 0.632, 0.637.

    **It re-bases every score above it.** Histogram reads 0.734 and verge 0.75
    at the corrected pose against 0.642 and 0.87 at the drifted one — the same
    art, a different stretch of road, and only the second is the stretch that
    was requested. Nothing regressed; the ruler moved.

    What this cost: iteration 12 read three identical samples as proof of
    determinism and they were luck. Three samples cannot distinguish a fixed
    value from a two-moded distribution, and the shape of the residual was
    saying so the whole time — **discrete repeated values are a race, Gaussian
    scatter is noise.** Iteration 12's texture seeding was a real fix for a real
    0.035; it just was not this.

15. `probe.mjs` calls `setAutoAdvance(false)` too, once, after the boot-context
    settle. The gate had the same drift the comparison did, hidden behind a
    partial fix: the probe already overrode `requestAnimationFrame` and
    `performance.now` so that every timestep was exactly 1/60, which made the
    step *size* deterministic and left the step *count* alone. Native rAF still
    fires on real vsync, so the number of frames landing between two evaluate
    round trips is a function of machine load, and each one ticked the world.

    Placed after the settle rather than before: headless Chromium loses and
    restores the WebGL context during boot, and the restore needs frames to
    happen in. Stopping the loop first would have traded a measurement bug for
    a dead renderer.

    Gate held at 244/245 across all three runs. **But it did not make the probe
    reproducible, and this entry originally said it had.** That was written
    from one run; three runs give 0.662, 0.696, 0.662. Necessary, not
    sufficient. See queue item 2 for where to look next, and note the process
    failure as much as the technical one: iteration 14 established that three
    samples are the minimum to claim determinism, and this iteration published
    the claim off one.

16. The probe's analysis capture waits for the renderer to have actually
    resized. No art change.

    Iteration 15's diagnosis was wrong and this records the correction. The
    suspicion was that boot frames drifted the simulation before the loop was
    stopped. They cannot: `startRun` calls `managers.resetAll()`, which zeroes
    `road.distance`, so nothing before a scenario survives into it. A direct
    test settles it — stop the loop, wait two seconds of wall clock, read the
    distance: it moves 0.000. **The simulation was already deterministic after
    iteration 15. The frame was not.**

    The swing was 0.034, which is larger than most art changes this loop has
    booked, and far too large for a one-tick pose difference. That was the
    clue. `SceneRig.onResize` reads `window.innerWidth` off an asynchronous
    resize event; the probe called `setViewportSize`, drove a single beat and
    captured, with nothing proving the handler had run. When it had not, the
    capture was a 960-wide frame scored against a 620-wide reference. The pose
    was identical every run; the frame size was not.

    Now it polls the canvas until the drawing buffer reflects the new size
    before driving the beat, and the analysis height is derived from the hero
    page's real viewport rather than from a hardcoded 1000x560 that did not
    match the 960x540 the page was created at — the old code also restored the
    viewport to a size the page never had.

    The resample ratios are now reported to `environment` when they are not
    1.00x, which is how `compare.mjs` has always guarded this. Reported, not
    checked: a harness fault reading as an art failure is the confusion this
    whole section exists to stop, and the pass count stays 245.

    **Confirmed: three runs, 0.661, 0.661, 0.661, no resample warning on any
    of them.** Both harnesses are now reproducible — `compare.mjs` since
    iteration 14, `probe.mjs` since this one. The measurement is no longer what
    limits this loop's resolution.

    Two process notes worth keeping, since between them they cost four
    iterations. Iteration 12 called a race noise and fixed a different real
    problem. Iteration 15 published a determinism claim off one sample. The
    rule that would have caught both: **three samples minimum, and read the
    shape — discrete repeated values are a race, scatter is noise.** And when a
    swing is larger than the art changes you have been booking, suspect the
    instrument before the art.

17. Day `clouds` `0.28` -> `0.07`. Histogram **0.734 -> 0.703**, the first art
    gain since the measurement work began at iteration 12.

    Iteration 10 narrowed the coverage *window* so the cloud that remained read
    as discrete banks rather than a veil. That was the right shape at the wrong
    quantity — cover still ran across most of the dome. The reference is clear
    blue broken by one bank. Lowering cover trades the 184-231 excess, which is
    the largest single block of the residual at 28% against the reference's 7%,
    for deep blue at 160-175, a band we are short in: the rare lever that pays
    on both sides rather than moving mass from one error to another.

    Stopped at 0.07 rather than going lower on purpose. 0.03 measures 0.698, a
    further 0.005, and it thins the sky past what the target holds. **The
    target has a cumulus bank and so should we**; 0.005 is not worth buying
    with a sky the standard does not have.

    **A wrong turn first, kept here because it corrects a belief this file had
    been carrying.** The coast ground was darkened `0xd8c898` -> `0xa29672` on
    the reasoning that a large pale verge was feeding the bright excess. It
    measured 0.770, much worse, and the band dump said why: **the verge was
    never in the bright bands at all.** It sits at 160-175, which is a band the
    reference wants *more* of, and darkening pushed it into 128-143 where we
    already hold 17% against the reference's 10%. The bright pile is sky and
    fog haze, not ground. Reverted.

    That also answers queue item 5's caution: the ground is **not** stretched
    flat. `repeat.set(38, 5)` across 840 units is one 256px tile per 22 units.
    Whatever is wrong with the verge, it is not texel density, and it is not
    tone either.

18. Day `fogColor` `0x9fc4e8` -> `0x7d9cc0`. Histogram 0.703 -> 0.690.

    Fog colour is not a mood setting: it is the luminance every distant pixel
    converges to, and a road game looking down a long straight puts a great
    many pixels there. At 0x9fc4e8 that was 191, inside the 184-231 block that
    is over half the remaining error. Moved into the reference's own peak at
    144-159, which is also the band we are shortest in, so the same pixels stop
    being wrong twice. Landed by measurement: 0x6a88ae (luminance 133) went
    back the other way to 0.693, so 152 is about the floor.

    **It only took 2pp off that block — 25.9 -> 23.8 — and the shortfall is the
    useful part of this iteration.** Fog was not the bulk of it. Reading the
    frame back shows what is: a very large pale wash across the upper left and
    along the whole horizon, which is the sun's glow halo and the bloom built
    on top of it. `target2` has no sun in frame and no flare. That is now the
    top queue item, with numbers.

19. The sun became a sun instead of a flare. `uSunSize` `0.996` -> `0.9991`
    (five degrees across down to about two and a half) and the corona
    `pow(sun, 26) * 0.3` -> `pow(sun, 80) * 0.22`. Histogram **0.690 -> 0.634**,
    the largest art gain since iteration 7, and verge came with it, 0.72 -> 0.79.

    The disc was ten times the angular size of the real sun at 2.4x the horizon
    colour — far over the bloom threshold — so `UnrealBloomPass` had a large
    bright area to spread rather than a small one, and it put a white wash over
    the upper sky and the whole horizon band. The corona beside it was still at
    half strength thirteen degrees out. Bloom is not the problem; what you feed
    it is. A small bright thing blooms as a glint, a large one as a fogged lens.

    The 184-239 excess went 23.5 -> 16.5pp, and 168-175 landed exactly on the
    reference at 5.6%. Landed by measurement: `pow(sun, 160) * 0.18` scores
    0.632, two thousandths better, and was **not** taken — it buys that by
    removing more of the brightness the reference genuinely has.

    **The cost is real and is now the clearest thing in the residual.** Bright
    pixels went 0.37 -> 0.11 against the reference's 1.0, and bands 224-255 are
    now flat zero against its 9.4%. We removed the only thing in frame that was
    reaching them. That is the right trade — the flare was wrong and was
    costing far more at 184-223 than it paid above 224 — but it means the
    highlight problem is no longer disguised.

20. Asphalt albedo `#7a8090` -> `#7e8495`, re-landed a second time. Histogram
    0.634 -> 0.615.

    Iteration 19 took the sun's flare out and about six luminance off the whole
    frame with it, which un-landed the carriageway: it had slipped below the
    reference's peak into 128-143, where we held 8.8pp too much against a 6.2pp
    shortfall in the peak itself. Same lesson as iteration 11, arriving from
    the other direction — **this value tracks the illumination, and anything
    that changes how much light is in the scene un-lands it.** Worth expecting
    now rather than rediscovering: check the road after every lighting change.
    The well is narrow as before, texture luminance 128 -> 0.634, 132 -> 0.615,
    136 -> 0.648.

    **The iteration's other half is a negative result, taken deliberately.**
    Queue item 5 asked for highlights, and the obvious candidate was the cloud
    crown that iteration 11 failed to lift. Conditions had genuinely changed —
    cover was 0.28 then and is 0.07 now, and iteration 19 had established that
    bloom is fine as long as what you feed it is small — so it was re-tested
    rather than assumed. It failed again: 0.634 -> 0.668. The lift does reach
    224-239 (0.0% -> 2.9%, 2.6%) and bright-pixel ratio recovers 0.11 -> 0.79,
    but 200-223 inflates from 13.3pp to 24.5pp of excess, 144-151 falls as the
    environment lift brightens everything, and **248-255 stays at 0.0% exactly
    as it did at iteration 11** — the ACES asymptote does not care how small
    the bright area is.

    So the dome route to highlights is now falsified at both high and low
    cover. Reverted. See queue item 5, rewritten.

21. The probe waits on the canvas's **drawing buffer**, not on its CSS width,
    and then asserts the width of the frame it captured. No art change.

    **Iteration 20's probe reported 245/245 — the histogram gate passing — and
    it was false.** The resample line added at iteration 16 caught it: `1.55x
    capture`, which is 960/620. The frame scored was the full hero viewport
    downsampled onto the analysis canvas.

    That failure mode is the dangerous one and is worth stating in full. **A
    capture at the wrong size does not fail loudly; it scores better.**
    Downsampling is a low-pass, and a blurred frame sits closer to any
    histogram than a sharp one. A harness fault therefore arrives disguised as
    an art result, in the flattering direction, on the one check that decides
    whether this whole loop is finished.

    The wait was wrong in a way worth remembering: it polled
    `canvas.clientWidth`, which is CSS layout and updates the instant the
    viewport changes, and `canvas.width > 0`, which is true of every canvas
    ever made. Neither has anything to do with whether `SceneRig.onResize` ran.
    Only `renderer.setSize` writes the drawing buffer, so comparing that buffer
    against its own previous value is the test that means something. The
    capture's decoded width is then asserted directly, with retries, because a
    wait that proves a precondition is still not the same as checking the
    thing you are about to measure.

    Honest reading at iteration 20's code state: **0.563**, against the 0.55
    bound — confirmed on three runs, 0.563 each, no resample warning on any.
    The gate did not pass. It is **0.013 away**, which is the closest this loop
    has been, and close enough that the next art change could decide it.

22. Day `skyBottom` `0x7fb0e0` -> `0x4a80bc`. Histogram **0.615 -> 0.535**, the
    largest single move since iteration 7, and the first reading under the 0.55
    bound.

    Iteration 9 had already established the principle and simply had not taken
    it far enough: a chase camera sits on the horizon, so the lower dome fills
    the frame and `skyBottom` — not `skyTop` — is what the player looks at. It
    moved 0xa8ccec to 0x7fb0e0 then and stopped. With cloud down to 0.07
    (iteration 17), fog landed (18) and the flare gone (19), the gradient was
    all that was left holding up the 184-223 block, and that block was still
    +19.6pp of a total residual near 35pp.

    Landed properly this time, by fitting the well rather than stepping until
    it got worse: texture-space luminance 169 -> 0.615, 140 -> 0.565,
    121 -> 0.535, 107 -> 0.614. 0x5286c2 at 127 measures 0.534, a thousandth
    better, and was not taken — 0x4a80bc holds roadside density at 1.00 boost
    and puts the frame mean at 150.4 against the reference's 150.5, and a
    thousandth is not worth either of those.

    Everything moved together, which is the sign of a real fix rather than a
    traded error: verge 0.79 -> 0.90, mean 160.5 -> 150.4, and the boost row
    0.564 -> 0.506.

    **Two costs, both real.** Bright-pixel ratio fell 0.11 -> 0.05 and contrast
    0.71 -> 0.65, so the frame is flatter and dimmer at the top end than it was.
    The highlight deficit at queue item 5 is now the dominant error by a wide
    margin, and contrast has been drifting since iteration 7 without ever being
    addressed. **And the road is very likely un-landed again** — this took ten
    luminance out of the scene, exactly the situation iteration 20 said to
    expect. Check it next.

23. `hemiIntensity` `0.82` -> `0.68`. Histogram 0.535 -> 0.534, contrast
    0.65 -> 0.66, dark pixels up. Small, and the iteration's value is mostly in
    two things it disproved.

    The hemisphere light is what fills shadow, so its intensity is the depth of
    every shadow in frame. At 0.82 the frame held 3.4% of its pixels below
    luminance 88 against the reference's 9.9%, and contrast had drifted since
    iteration 7 with nothing done about it. Landed by measurement: 0.82 ->
    0.535, 0.68 -> 0.534, 0.60 -> 0.547, 0.50 -> 0.564. Past about 0.65 it
    stops buying darks and starts dragging mid-tones into a band that is
    already over-full — **the histogram turns around while the contrast ratio
    keeps improving.** The two metrics disagree there and the bound governs.

    **The road was not un-landed, and iteration 20's rule needs narrowing.**
    Iteration 22 predicted it would be, having taken ten luminance out of the
    frame. Measured: 132 -> 0.535, 140 -> 0.538, 124 -> 0.635. It was already
    landed. The rule "any lighting change un-lands the road" is too broad —
    what un-lands it is a change to the light *reaching the road*, like the sun
    angle at iteration 11 or the flare removal at 19, which was a large
    additive source bleeding over the whole frame through bloom. `skyBottom`
    mostly changes what the sky's own pixels are. Keep checking after lighting
    changes, it is cheap; stop expecting it to move every time.

    **A process failure, mine, recorded because it cost two probe runs.** The
    confirmation runs for iteration 22's gate pass were launched in the
    background and then source files were edited while they were in flight.
    The probe reads live modules through vite, so those runs were measuring a
    moving target; they returned nothing and exited non-zero. **Do not edit
    source while a probe is running.** Commit the state first, then measure it.

24. Palms brought to the kerb, `offset` `[3, 34]` -> `[1, 16]`, and the sun's
    shadow camera given the `updateProjectionMatrix()` it never had. Histogram
    0.534 -> 0.532, verge 0.90 -> 0.91.

    The palms now form an avenue along the road the way the reference's do
    instead of standing back across the verge. Small gain, and it reads much
    closer.

    **The shadow bug is the finding, and it is not fixed.** Chasing why no
    roadside prop has ever shadowed the road turned up a real one:
    `SceneRig` sets the sun's shadow frustum to +/-90 with near 1 and far 320,
    and never calls `updateProjectionMatrix()` on it. An `OrthographicCamera`
    bakes its projection in its constructor and three.js builds that one as
    (-5, 5, 5, -5); assigning the fields afterwards changes the fields and
    nothing else. So the sun has been casting into a ten-unit box around the
    car for the whole life of this file.

    **Fixing it changed nothing — the frame is byte-identical.** So that was a
    real latent bug sitting behind a second one, and the second is still
    unfound. Kept anyway: it is correct, it is free, and leaving a known-broken
    frustum in place to be rediscovered later is worse.

    What is now established, so the next attempt does not re-walk it: shadows
    are enabled at the high tier (`shadows: true`, 2048 map), the renderer's
    `shadowMap.enabled` follows it, scenery meshes set `castShadow` at creation,
    and the road and ground both set `receiveShadow`. The palms are now within
    a couple of units of the tarmac and the sun is at 30 degrees, so geometry
    and angle are not the obstacle either. The dark patch under the hero is
    `contactShadow`, a decal, not a cast shadow — do not read it as evidence
    the shadow path works. **The probe has no check that anything casts a
    shadow onto the road**, which is how this survived 245 checks; adding one
    would have caught it and is the obvious companion fix.

25. `render/roadside-casts-onto-road`, and a `setShadows` toggle for it to work
    through. No art change.

    **It passes, which means iteration 24 was wrong.** Shadows do reach the
    road: turning the shadow map off raises the road's mean luminance by
    **2.34** on the left strip and **4.89** on the right. They were there the
    whole time and too faint to see, and "I cannot see it in the screenshot"
    got written into this file as "nothing casts onto the road". That is the
    lesson worth keeping — **a negative read off an image is a hypothesis, not
    a measurement**, and this loop has a measuring tool for exactly this.

    Measured by difference on purpose. One frame cannot distinguish a cast
    shadow from the prop's own dark geometry, from a texture, or from the
    contact decal under the hero; two frames with nothing changed but the
    shadow map can. Threshold 1.5 luminance, comfortably under the 2.34 the
    weaker strip actually delivers, so the check fails when the path breaks
    rather than when the art is merely soft.

    The real gap is strength, not existence. The reference throws hard dark
    bands across the carriageway; 2 to 5 luminance is invisible. The fill light
    is the obvious suspect — it casts no shadow by design, so it lights
    shadowed tarmac at full strength — but it exists to stop the hero reading
    as a black cut-out, which is a documented decision and not one to undo
    casually. That is the next art item.

    Iteration 24's `updateProjectionMatrix()` fix is also re-read by this: it
    was inert because the frustum was never the blocker either. It stays,
    still correct.

26. The camera-side `fill` light confined to the vehicles by layer, and the sun
    raised `3.6` -> `4.6` to put the level back. Histogram 0.532 -> 0.531,
    **contrast 0.66 -> 0.77**, roadside density 0.91 -> 1.03, dark pixels
    0.49% -> 2.49%.

    This is the answer to why iteration 25 measured roadside shadows at two to
    five luminance. The fill exists for one reason, stated in its own comment
    since long before this loop: a chase camera means the only face of a car
    ever pointed at the player is the face permanently turned away from the
    sun. Being a plain directional light it lit everything else too — every
    square metre of tarmac, at better than half the sun's intensity, **casting
    no shadow.** The sun cut shadows and the fill filled them straight back in.
    `FILL_LAYER` confines it to cars. It costs nothing per pixel; it is a bit
    in a mask.

    On its own it measured **0.658**, well over the bound, because taking that
    much light out darkened the whole world and not just the shadows — mean
    fell to 141.9 against the reference's 150.5. The level comes back through
    **the sun and not the hemisphere**, and that choice is the whole point: the
    sun is shadowed, so it restores the lit half of the frame and leaves the
    dark half dark, where the hemisphere would have refilled exactly what had
    just been won. Landed at 4.6 by measurement — 4.3 -> 0.534, 4.6 -> 0.531,
    4.9 -> 0.567.

    Everything improved together and the histogram barely moved, which is the
    honest summary: this iteration bought **contrast and shadow**, not L1. The
    frame now has a lit side and a dark side on every object in it, the
    roadside ratio sits at 1.03 against a target of 1.00, and std went 37.1 ->
    41.4 against the reference's 49.3.

    Also corrected here: the comment iteration 24 left on `updateProjectionMatrix`
    claimed no prop had ever shadowed the road. Iteration 25 disproved that and
    the comment was still asserting it.

27. No art change. Queue item 5 — the highlight deficit — **closed as
    unreachable through the sky**, with the fourth and fifth mechanisms
    measured and the reason finally isolated.

    Two things were tried, both on the reasoning that the previous failures had
    been about *how* the crown was lifted rather than whether it could be.

    **A plateau instead of a ramp.** Iterations 11 and 20 both scaled the crown
    colour and both piled cloud into 200-223 on the way up. A linear
    interpolant from shadow to crown spends most of its range in the middle, so
    lifting the top drags a broad smear of mid-values with it; a real
    overexposed cumulus is a flat sheet of white with the shading confined to
    the underside. Compressing the interpolant to `smoothstep(0.30, 0.62, …)`
    gives that shape. With the gain it measured **0.751**. Without the gain,
    the shape alone measured **0.541** — worse on L1 than 0.531, better on
    contrast (0.77 -> 0.79), brightness (0.06 -> 0.13) and std (41.4 -> 42.2),
    and it **did not fill 224+**. Not taken: it trades the bound for character
    and does not buy the thing it was for.

    **The environment split, reinstated.** Iteration 11 built it and reverted
    it as an abstraction justified only by a false hypothesis. By this point
    the coupling had looked like the binding constraint four times over, which
    seemed to change the case. It does not. With `envMesh` carrying gain 1 and
    the visible dome carrying 1.34, the result is **0.751 and mean 165.73 — the
    same to the digit as the coupled version.** The environment map was never
    the cause. Reverted again, and this time the conclusion is not "unproven"
    but "measured twice, false twice."

    **What is actually in the way is framing, and it is the same wall the file
    has flagged since iteration 9.** Our cloud is a large fraction of the frame,
    so brightening it moves the frame's mean and fills 200-223 long before
    anything reaches 224. The reference affords 10.5% of blown pixels because
    its bank is bright *and small relative to its frame* — its frame is mostly
    road. Ours is 1.78:1 with sky across the top; theirs is 1.55:1 with a low
    camera. No change to the sky's colour or shading can produce a small bright
    region in a frame where the sky is large.

    So: **the honest answer is the one queue item 5 asked for in advance.** The
    blown highlights need geometry that is bright and small — sun on water, sun
    on chrome — and two of the three the reference uses are things this biome
    does not have. That is the scope question at the end of this file, not an
    art lever. Stop spending iterations on the sky.

28. Traffic detail joins the quality ladder. `QualitySettings.trafficDetail`,
    `'low'` at the low and medium rungs and `'high'` at the top, set once at
    composition through `setTrafficDetail` the same way `setHeroLod` already
    works. **No histogram change at all: 0.531 before and after.**

    Worth being straight about what this is. `buildTrafficCar` defaulted to
    `'low'` and nothing ever passed anything else, so traffic was not a low
    rung of a ladder — it was outside the ladder entirely, identical on a phone
    and on a workstation. The constraint has always been "traffic stays cheap
    and tiered"; it was cheap and it was not tiered. Now it is both.

    The gain is silhouette on near traffic — wheel segments 11 -> 20, brake
    calipers, arch liners, an extra loft ring — and **target2 cannot adjudicate
    it**, exactly as queue item 8 said: its traffic is small and distant. So
    this is play evidence, and the score confirms it by not moving.

    Cost, all of it on the top rung: triangles 349083 -> 373923 (+7%), draw
    calls 723 -> **963 (+33%)**, which is the calipers arriving as separate
    meshes. The low tier is byte-identical — 136402 tris, 622 draws, no context
    loss — measured rather than assumed.

    That draw-call jump is the thing to watch. It is affordable on the tier
    that already pays for shadows and bloom, and it would not be on either of
    the others. If traffic count ever rises, this is the first thing to
    reconsider.

29. `setDriftIntensity` on the dev handle. **No art change, and the art that
    was written for this iteration was reverted for being unverifiable.**

    Queue item 10 asked for tyre smoke as volume rather than a sprite sheet, and
    a layered-puff emitter was written for it: three billboards per emission
    spread in depth, longer lives, thinner per-particle opacity, the rate
    dropped to keep the pool population level. Then it would not render.

    The smoke could not be provoked. The drift cue fires only on the
    *transition* into a slip and `driftIntensity` decays at 3.2 a second, so the
    plume lives about a third of a second after an event the harness has no
    reliable way to cause. Driving lock-to-lock and sweeping twelve frames for
    the brightest tail measured **152.51 before the change and 152.54 after** —
    the effect never appeared in either build, and the two captures are the same
    image.

    So the handle went in, the same shape as `setShadows` at iteration 25, and
    with the drift pinned at 1 something finally shows behind the car. **It is
    still not the smoke.** Single-billboard and three-billboard captures come
    back at 149.18 and 149.25 and are again indistinguishable, which means the
    dark smear under the tail is the car's own cast shadow and the plume is
    still not reaching the frame. Something beyond `driftIntensity` gates it.

    The art was reverted. This loop's standard, learned the hard way at
    iterations 24 and 25, is that a read off an image is not a measurement; the
    same standard says an art change that cannot be shown to render is not one
    to ship. **What ships is the handle and the finding.**

    Also worth recording against the reference: target2 has a large tyre-smoke
    plume, and it is **not** a fidelity target. The doc's own standard section
    excludes the driving state in the reference from being a spec, and a
    burnout is a driving state. Tyre smoke is a play-evidence item and always
    was.

30. Tyre smoke shade `0.30-0.46` -> `0.58-0.76` linear. No change to any scored
    pose — smoke does not appear in the cruise or boost captures — so this is
    play evidence, measured by difference.

    **Iteration 29 was wrong about the cause and the tools to prove it already
    existed.** `EffectsManager.snapshot()` has always reported `smoke.liveCount`
    and `forceDrift` has always existed; iteration 29 added a redundant pin and
    concluded from images that the plume "does not reach the frame". It does.
    With drift held at 1 there are **206 live particles**, and toggling
    `setEffectVisible('smoke', …)` moves the tail region's mean by 1.51
    luminance. Not missing. Not dark — the dark smear under the car really was
    its cast shadow.

    **It was the same colour as the road.** Linear 0.30-0.46 arrives at about
    sRGB 148, and the carriageway now renders around 150. The comment defending
    that value argued "burnt rubber, closer to mid grey", and it was right when
    it was written — against tarmac at luminance 72. The road has been
    re-landed three times since, at iterations 7, 11 and 20, and nobody
    re-landed the smoke. **A value is only ever landed against what it sits
    on**, which is the asphalt lesson arriving from the other side.

    Raised, and the toggle delta goes 1.51 -> 2.40 with white puffs now plainly
    visible at the rear wheels where the frame previously showed nothing.

    The plume is still small and sparse — two clusters rather than the bank the
    reference throws. That is the volume item, and it is now **observable**,
    which it was not when iteration 29 tried to write it blind.

31. Tyre smoke given volume: three billboards per puff spread along the car's
    axis, lives 0.5-1.05s -> 0.9-1.7s, size 0.16-0.32 -> 0.18-0.48 growing 3.1x
    instead of 2.6x, per-particle opacity dropped from 0.46 to 0.30 because
    several now overlap, emission rate 260 -> 105 puffs so the pool stays
    inside capacity. **Toggle delta 2.40 -> 5.78.**

    This is iteration 29's design, which was sound and unshippable: it could not
    be measured then, and iteration 30 had to fix the colour before anything
    about the shape could be judged. Now it measures. Live particles 206 -> 313
    against a capacity of 700, and the smoke softens the road's edge energy
    under it, 38.12 -> 35.98, which is what an occluding mass should do and a
    flat stamp would not.

    Ladder: `ParticleField` is one draw call however many are alive, so this
    costs pool and fill and nothing else. High tier unchanged at 373923 tris
    and 963 draws; **low tier byte-identical at 136402 and 622, no context
    loss** — measured, not assumed. No scored pose moves, since smoke appears
    in neither capture.

    Still short of the reference: two plumes at the wheels rather than one
    merged bank. The next lever is lateral spread and cross-drift so the two
    sides meet behind the car, not more particles — 313 of 700 is not the
    constraint.

32. `render/tyre-smoke-reaches-the-frame`. The probe has **247** checks. No art
    change.

    The queue has been asking for this since iteration 29 walked into the gap it
    covers: drift pinned with `setDriftIntensity`, live count from
    `effects().smoke`, and the plume measured against itself by toggling
    `setEffectVisible`, because a bright patch behind a car could as easily be
    the road, the brake lights or the contact decal.

    **Then it was tested against the defect it was written for, and it did not
    bite.** Restoring iteration 29's dark shade left it passing. That is worth
    more than the check: under today's three-per-puff emitter the old shade
    measures **3.45**, where at iteration 29's single-billboard emitter it
    measured 1.51. **Volume and value land in the same number** — there is now
    enough smoke to register whatever colour it is.

    So the bar is set for presence, and the check's own comment says so rather
    than implying more. It would have caught iteration 29 exactly (1.51 against
    a bar of 2) and it will catch the plume vanishing. It will not catch the
    plume going the colour of the road again. Tightening it to about 4.5 would,
    and would then fail the first time someone legitimately trims the particle
    budget — a check calibrated to today's art is a check that punishes
    tomorrow's.

    The general point, since this loop keeps meeting it: **a check that has
    never been seen to fail is a hypothesis.** `roadside-casts-onto-road` at
    iteration 25 passed on first run too, and that told us something real. This
    one passing on first run told us nothing until it was deliberately broken.

33. **The coast has a coast.** Sea strips on the seaward side of the road, and a
    beach profile for the ground to meet them on. Histogram 0.531 -> 0.517, and
    for once that is beside the point: this is the first iteration in
    thirty-three to put something in the frame that was not there before.

    Two pieces. `RoadManager` builds a flat water strip per segment out to 1900
    units, one side only — water on both sides is a causeway, and the reference
    is a boulevard with a city behind it. And `groundReliefAt` now takes a
    beach: seaward of a coastal road the ground falls to -9 over 130 units
    instead of rising into hills.

    **The first attempt shipped nothing visible and the reason is worth
    keeping.** A sea laid at -2.4 beyond ground that runs to 420 is simply
    behind a hill — relief amplitude grows with distance from the road and is
    already +/-32 out there, so every ridge pierced the water and the ground
    hid the rest. Triangles and draw calls both went up and the frame was
    identical. Water needs somewhere to *be*, and that is a ground profile, not
    a plane laid on top of one.

    The shoreline is keyed on distance rather than a flag. `RoadStrip.setStart`
    re-samples relief at each row's own absolute distance every time a strip
    recycles, so a segment straddling a boundary gets both profiles and the
    beach begins exactly where the biome does — no pop, and nothing to
    crossfade.

    Cost: high tier 373923 -> 376731 tris, draws 963 -> 989. Low tier
    136402 -> 139210 and 622 -> 648, no context loss. The water is one material
    and the strips recycle with the road, so it allocates nothing per frame.

    Still thin: the sea reads as a band on the right rather than the open water
    the reference has, and there is no skyline or marina yet. Those are the
    rest of operator item 0.

34. **The coast has a city.** `SkylineManager`: one instanced draw of stepped
    tower blocks massing 225-400 units landward, standing on the far ground's
    own relief. Histogram 0.517 -> **0.485** cruise, 0.493 -> **0.453** boost,
    contrast 0.78 -> 0.82, verge 1.06 -> 1.05.

    Deliberately not a `SceneryManager` prop kind, and the reason is queue item
    2 rather than tidiness. `repopulate()` rewrites **every** instance when the
    car crosses a 120-unit band, which is invisible for scrub and fatal for a
    skyline — a city that re-rolls twice a second is exactly the pop the
    operator reported. Here every building's transform is a pure function of its
    **absolute cell index**, so advancing the anchor shifts the pool by one slot
    and changes nothing already on screen: one building leaves at the back, one
    arrives in the haze, the rest are bit-identical. That is the pattern the
    scattered prop kinds still need.

    Cells are filtered by the biome of the ground *they* stand on, not the
    ground under the car, so the city comes over the horizon and the boundary
    passes through it — the same rule the props follow, and a down payment on
    queue item 5.

    **Landed by measurement, and the two landings disagree in a way worth
    recording.** At 165-340 lateral the towers loom over the left verge as dark
    slabs: cruise 0.490 and **boost 0.421**, the best boost row this loop has
    seen, because a large dark mass is exactly what the frame is short of at the
    dark end. Pushed out to 225-400 it reads as the reference's hazy mid-distance
    skyline and measures cruise 0.485, boost 0.453. **The nearer version scores
    better on boost and the further one looks right**; cruise is the fair row
    for an unboosted target and it prefers the further one too, so the conflict
    is only on the row the target cannot adjudicate. Taken on the target.

    Cost: high tier 376731 -> 377451 tris and 963 -> **990 draws**, the +1 being
    the whole city. Casts no shadow and receives none — a building at three
    hundred out is outside the sun's +/-90 frustum, so asking for one would
    either produce nothing or coarsen every shadow that matters. Pool follows
    `sceneryDensity`, so the bottom rung pays less vertex and fill for the same
    single draw.

    Still to do in operator item 0: the marina and the cruise ship, which are
    the reference's only bright-and-small geometry and therefore the standing
    candidate for the 224+ deficit iteration 27 closed as unreachable through
    the sky.

### The measurement was noisier than it was — fixed at iteration 12

`makeRoadTexture` and `makeRoadWearTexture` both speckled with bare
`Math.random()`, reseeded on every page load and not tied to `--seed`. That was
tolerable under a 54-degree sun, where the roughness map barely showed. Under a
grazing one it is most of what the carriageway does with the light, so the
run-to-run spread on the histogram went from roughly 0.005 to **0.035** — wider
than most of the art gains this loop has booked.

Nothing about the art was wrong; the frame was stable and the *measurement* was
not. See entry 12 below.

## The residual is now the sky, and most of it is framing

With the road landed, the remaining L1 of 0.706 breaks down as:

| band | reference | ours | gap |
|------|-----------|------|-----|
| 200-223 | 3.1% | 29.3% | **+26pp** |
| 144-151 | 18.8% | 9.9% | -9pp |
| 240-255 | 7.5% | 1.1% | -6.4pp |

The 200-223 excess is our sky, and it is two things stacked. Part is framing:
our capture is 1.78:1 with sky across the top 45%, the reference is 1.55:1 with
a low camera and road filling most of the frame. That part no art change can
reach. Part is character: the reference's sky is a deeper blue at the zenith
with bright blown highlights on sea and cloud at 240-255, where ours is a flat
pale band. That part **is** art, and it is the next lever.

## Known limitation, not yet decided

The histogram check sits at ~1.10 against a 0.55 bound and a large part of the
residual is **framing** — what fraction of the frame is sky versus road. The
reference is 1.55:1 with a low camera and road filling most of the frame; our
capture is 1.78:1 with sky across the top 45%. The brief rules framing out of
scope for the art, so this bound may be unreachable by any art change.

This is a scope call for the operator. Do not resolve it by moving the
threshold.

## Queue

### Raised by the operator after iteration 32

These came from watching the game rather than the scorecard, and they outrank
everything below. The verdict that prompted them is worth keeping verbatim:
after twelve hours and thirty-two iterations, **"I really don't notice much
difference."** That was correct. Every art change to that point was tonal — sky,
fog, asphalt, sun angle, cloud cover, smoke colour — and none of them put
anything new in the frame. About a third of the iterations were measurement
plumbing. The histogram fell 1.192 -> 0.531 and both bounds were met while the
world stayed the same empty highway. **A metric that can improve by half while
the content is untouched is not a plan; it is a thermometer.** Work these first.

0. **Build the coast.** The standing scope question at the bottom of this file,
   now answered by the operator: yes. Sea to the seaward side with a real
   horizon line, city skyline massing in the mid-distance, marina between. This
   is the largest divergence from the standard and the only remaining change
   that is obvious in motion rather than in a histogram. Tiered like everything
   else.

1. **Traffic vehicles are not good enough.** Iteration 28 tiered their detail;
   it did not make them better models. Boxy silhouettes, flat paint.

2. **City buildings pop in.** They arrive in a block every couple of seconds
   rather than coming over the horizon. Almost certainly `SceneryManager`:
   `BAND_LENGTH` is 120 units, which at speed is about that interval, and
   `repopulate()` rewrites every instance on a band crossing — so the whole
   visible set re-rolls at once. Note iteration 13 made cadence kinds
   world-anchored, which is exactly the fix pattern; the scattered kinds still
   re-roll.

3. **The gutter is a free lane.** You can drive the shoulder or chicane and miss
   every obstacle. Gameplay, not graphics, but it is in the loop now.

4. **Pickups are plain coloured boxes.**

5. **Biome transitions are abrupt.** City to desert to city with no blending of
   what is actually standing beside the road. The palette crossfades; the props
   do not, beyond the boundary rule added earlier.

### Earlier queue, from the fidelity work


1. ~~**Decouple the cloud's rendered value from its env-map contribution.**~~
   **Done and reverted at iteration 11. Do not retry it as stated.** The
   decoupling was built — `SkyDome` holding two materials that agree on every
   uniform but a highlight gain, `envMesh` for the PMREM pass, `mesh` for the
   camera — and it worked as designed. It did not help, because the env map was
   never the binding constraint:

   | gain | histogram | mean |
   |------|-----------|------|
   | 1.0 (no lift) | 0.684 | 167 |
   | 1.35 | 0.715 | — |
   | 2.6 | 1.096 | 199 |

   Monotone, so there is no window to search. **`UnrealBloomPass` re-couples
   what the env split decoupled**: at threshold 0.82 it takes every cloud pixel
   and spreads it over the whole frame, road included, which is why the mean
   still climbed to 199 with the environment dome pinned at 1. The gain did
   finally put pixels in 248-255 (0.1% -> 1.6%), so the top bin is reachable —
   it just costs more elsewhere than it buys.

   The deeper reason is that we are chasing the wrong end of the histogram.
   Our frame is already **brighter** than the reference — mean 167 against 150
   — so any highlight we add moves the mean further away. The reference affords
   its 7.5% of blown pixels because it also holds 9.0% below luminance 88 where
   we hold 3.2%, and that dark mass is buildings, a marina, a shadowed
   foreground: geometry we do not have. **Highlights are not purchasable
   separately from darks.** Iteration 11 spent its change on the dark end
   instead and the histogram moved 0.684 -> 0.629.

   The code was reverted rather than kept at gain 1.0: an abstraction whose
   only justification is a hypothesis that measured false is dead weight, and
   it is twenty lines to restore if a later iteration needs it.

2. ~~**Close the probe's measurement race.**~~ **Done at iteration 16**, after
   iteration 15 fixed the wrong thing. Both harnesses are reproducible: four
   identical `compare.mjs` runs, three identical `probe.mjs` runs. **From here,
   back to art** — the measurement no longer limits what this loop can resolve.
3. ~~**Cadence props scatter rather than placing sequentially.**~~ **Done at
   iteration 13.** They are laid on a world-anchored grid facing the road, and
   the railing is continuous to the vanishing point.
4. ~~**The sun's glow halo.**~~ **Done at iteration 19**, histogram 0.690 ->
   0.634. What follows is the record of what it was. After iteration 18
   the 184-231 block still holds 23.8pp of excess against a total residual of
   about 35pp, and it is not cloud (iteration 17) and not fog (iteration 18).
   It is the halo: `SkyDome` adds `uHorizon * pow(max(sun, 0), 26.0) * 0.3` for
   a roughly 25-degree corona, and `uHorizon * smoothstep(uSunSize, 1.0, sun) *
   2.4` for the disc — which is bright enough that `UnrealBloomPass` at
   threshold 0.82 then spreads it across a quarter of the frame.

   **The target settles this one: `target2` has no sun in frame and no flare.**
   Ours has a wash covering the upper left and the whole horizon band. Treat
   the corona exponent and the 0.3 as the dial, and watch the disc's 2.4
   separately since that is what feeds bloom. Not the same call as the speed
   grade — that is a shipping feature the brief protects, and this is art in
   the dome.

5. ~~**Nothing in frame reaches 224.**~~ **Closed at iteration 27 as
   unreachable through the sky.** Five mechanisms measured and failed: crown
   lift at high cover (11), the sun's flare (19, removing it *gained* 0.056),
   crown lift at low cover (20), a flattened plateau (27), and the environment
   split reinstated (27, identical to the digit — the env map was never the
   cause). The wall is framing: our cloud is a large fraction of the frame, so
   brightening it fills 200-223 and moves the mean long before anything reaches
   224, where the reference's bank is bright *and small* because its frame is
   mostly road. The blown pixels need geometry that is bright and small — sun
   on water, sun on chrome — which is the scope question at the end of this
   file, not an art lever.
6. **Contrast is 0.77**, having crossed from 1.30 at iteration 7, bottomed at
   0.65 and recovered
   from 0.76 at iteration 10. The lower sun is what recovered it — raking light
   is what puts a light and a dark side on the same object. Still flatter than
   the reference. Do not chase it with the grade, which is a shipping feature.
7. **Verge ground — but not its tone, and not its texel density.** Iteration 17
   measured both and both are already right: the ground renders at 160-175,
   which is a band the reference wants more of, not less, and `repeat.set(38, 5)`
   across 840 units is one tile per 22 units. Darkening it measured 0.770
   against 0.734. What is left of this item is *species* — the target's verge is
   textured green, ours is smooth sand — and that is a texture and prop
   question, not a colour one. Do not darken it.
8. ~~**Traffic silhouettes.**~~ **Done at iteration 28** — traffic now follows
   the quality ladder instead of sitting outside it. No score change; target2
   cannot adjudicate it. Historic note: Boxes at mid-distance beside a lofted hero. target2
   does **not** adjudicate this — its traffic is small and distant. Play
   evidence only. A middle detail tier for near traffic is the likely answer.
9. ~~**Roadside shadows are far too faint.**~~ **Done at iteration 26** — the
   fill light was the cause and is now confined to the vehicles. Contrast
   0.66 -> 0.77, dark pixels 0.49% -> 2.49%. Historic note:
   brought the sun down to 30 degrees. The barriers now rake across the
   carriageway, but the palms stand at roughly x=35 with the road edge near
   x=20, so a 1.7x-height shadow lands on the verge and stops. Either the palms
   move in or the sun's azimuth swings to throw along the road rather than
   across it. `quality.shadows` already gates the tier.
10. **Tyre smoke reads as two plumes, not one bank.** Iterations 30 and 31 took
    it from invisible to a toggle delta of 5.78. What is left is that the left
    and right wheels throw separate columns where the reference has a single
    mass behind the car. Lateral spread and cross-drift, not more particles —
    313 live of 700 is not the constraint. Measure by difference with
    `setDriftIntensity(1)` and `setEffectVisible('smoke', …)`; `effects().smoke`
    gives the live count. The probe check on that delta landed at iteration 32
    — but it guards presence, not colour, and the entry there explains why.
11. **Hero tail crease** and **nitro bloom haze**. No support from target2 — its
   hero is a matte classic coupe under no boost. Play observations only.

## Our coast has no coast

`state()` reports `coast` honestly and `BIOME.coast.ground` is a sandy
`0xd8c898`, but the biome renders as sand and palms with **no water, marina or
skyline**. The reference is an urban seaside boulevard. This is the largest
single divergence from the standard and it is not a defect — it is a scope
question about what the coast biome is meant to be. Raise it rather than
quietly building a marina.
