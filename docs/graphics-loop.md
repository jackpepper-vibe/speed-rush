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

**Iteration 11's number is a mean of three runs, and that is new.** The same
code state measured 0.615, 0.650 and 0.622 — a spread of 0.035, where earlier
iterations were treated as repeatable to about 0.005. See "The measurement is
noisier than it was" below before reading any delta smaller than 0.04 as real.

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

### The measurement is noisier than it was

`makeRoadTexture` and `makeRoadWearTexture` both speckle with bare
`Math.random()`, reseeded on every page load and not tied to `--seed`. That was
tolerable under a 54-degree sun, where the roughness map barely showed. Under a
grazing one it is most of what the carriageway does with the light, so the
run-to-run spread on the histogram went from roughly 0.005 to **0.035**.

Nothing about the art is wrong here — the frame is stable, the *measurement*
is not. Until those two textures draw from the seeded `Random`, a single
comparison run cannot resolve a change smaller than about 0.04, and iterations
should quote a mean of three. Queued as item 2, ahead of any art, because every
number below it depends on it.

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

2. **Seed the road texture noise.** Measurement integrity, and it now blocks
   everything behind it — see "The measurement is noisier than it was". Not an
   art change and it will not move a score; it makes the scores mean something.
3. **Cadence props scatter rather than placing sequentially**, so the verge
   railings read as separated runs where the reference's railing is continuous
   to the vanishing point. A `SceneryManager` placement change, not a geometry
   one.
4. **Contrast is 0.82**, having crossed from 1.30 at iteration 7 and recovered
   from 0.76 at iteration 10. The lower sun is what recovered it — raking light
   is what puts a light and a dark side on the same object. Still flatter than
   the reference. Do not chase it with the grade, which is a shipping feature.
5. **Verge ground.** Uniform sand where the target has textured green.
   `GROUND_HALF_WIDTH` is 420 and `makeGroundTexture` repeats 38x5, so measure
   the texel density before assuming it is stretched flat.
6. **Traffic silhouettes.** Boxes at mid-distance beside a lofted hero. target2
   does **not** adjudicate this — its traffic is small and distant. Play
   evidence only. A middle detail tier for near traffic is the likely answer.
7. **Roadside props still do not shadow the road**, even after iteration 11
   brought the sun down to 30 degrees. The barriers now rake across the
   carriageway, but the palms stand at roughly x=35 with the road edge near
   x=20, so a 1.7x-height shadow lands on the verge and stops. Either the palms
   move in or the sun's azimuth swings to throw along the road rather than
   across it. `quality.shadows` already gates the tier.
8. **Tyre smoke** as volume rather than a sprite sheet.
9. **Hero tail crease** and **nitro bloom haze**. No support from target2 — its
   hero is a matte classic coupe under no boost. Play observations only.

## Our coast has no coast

`state()` reports `coast` honestly and `BIOME.coast.ground` is a sandy
`0xd8c898`, but the biome renders as sand and palms with **no water, marina or
skyline**. The reference is an urban seaside boulevard. This is the largest
single divergence from the standard and it is not a defect — it is a scope
question about what the coast biome is meant to be. Raise it rather than
quietly building a marina.
