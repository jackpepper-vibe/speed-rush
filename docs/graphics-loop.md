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
| 23 | `7c7f5cd` | **0.534** | 0.90 | 0.66 | — | pending |

**Iteration 22 is the first time the histogram bound has been met on
`compare.mjs`.** Cruise 0.535 and boost 0.506 against a bound of 0.55, with
roadside density 0.90 cruise and 1.00 boost, both inside 0.6-1.7. Frame mean
150.4 against the reference's 150.5.

**The probe passed too: 245/245 at iteration 22, with no resample warning** —
the first legitimate pass of the histogram gate, as distinct from iteration 20's
false one. Treat it as provisional until three runs agree; the confirmation runs
launched for it were void (see entry 23) and have to be redone.

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

5. **Nothing in frame reaches 224, and the sky cannot supply it.** The
   reference holds 9.4% of its pixels above that; we hold 0.0%. This is the
   largest single deficit left.

   **Three routes are now closed by measurement, so do not re-open them
   casually:** lifting the cloud crown at high cover (iteration 11, 0.684 ->
   0.715); the sun's flare, which did reach those bands and cost far more
   elsewhere (iteration 19, removing it gained 0.056); and lifting the cloud
   crown at low cover, re-tested on purpose at iteration 20 because the
   conditions had changed, which failed the same way (0.634 -> 0.668).

   The through-line in all three is one fact: **248-255 never moves off 0.0%
   whatever the dome does.** ACES asymptotes there. Anything that clips has to
   arrive after the tone map or be a small enough area that its own bloom
   carries it, and the dome is neither.

   What the reference's blown pixels actually are: sun on water, sun on a
   cumulus edge, sun on chrome. Two of those three we do not have the geometry
   for — see the scope question below — and that may be the honest answer here.
   If it is, say so rather than spending more iterations on the sky.

6. **Contrast is 0.82**, having crossed from 1.30 at iteration 7 and recovered
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
8. **Traffic silhouettes.** Boxes at mid-distance beside a lofted hero. target2
   does **not** adjudicate this — its traffic is small and distant. Play
   evidence only. A middle detail tier for near traffic is the likely answer.
9. **Roadside props still do not shadow the road**, even after iteration 11
   brought the sun down to 30 degrees. The barriers now rake across the
   carriageway, but the palms stand at roughly x=35 with the road edge near
   x=20, so a 1.7x-height shadow lands on the verge and stops. Either the palms
   move in or the sun's azimuth swings to throw along the road rather than
   across it. `quality.shadows` already gates the tier.
10. **Tyre smoke** as volume rather than a sprite sheet.
11. **Hero tail crease** and **nitro bloom haze**. No support from target2 — its
   hero is a matte classic coupe under no boost. Play observations only.

## Our coast has no coast

`state()` reports `coast` honestly and `BIOME.coast.ground` is a sandy
`0xd8c898`, but the biome renders as sand and palms with **no water, marina or
skyline**. The reference is an urban seaside boulevard. This is the largest
single divergence from the standard and it is not a defect — it is a scope
question about what the coast biome is meant to be. Raise it rather than
quietly building a marina.
