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

1. **Cloud cover and character.** The larger half of the sky gap. Day `clouds`
   is 0.28 in `Palettes.ts` and lays pale wisps across the whole dome; the
   reference has clear blue broken by one discrete cumulus bank, which is also
   where its 7.5% of blown highlights at 240-255 come from against our 1.1%.
   Say which half of the sky gap any gain came from: character is winnable,
   area is framing and is not.
2. **Cadence props scatter rather than placing sequentially**, so the verge
   railings read as separated runs where the reference's railing is continuous
   to the vanishing point. A `SceneryManager` placement change, not a geometry
   one.
3. **Contrast is 0.76**, having crossed from 1.30 — the frame is now flatter
   than the reference where it used to be harder. Watch it. Do not chase it
   with the grade, which is a shipping feature.
4. **Verge ground.** Uniform sand where the target has textured green.
   `GROUND_HALF_WIDTH` is 420 and `makeGroundTexture` repeats 38x5, so measure
   the texel density before assuming it is stretched flat.
5. **Traffic silhouettes.** Boxes at mid-distance beside a lofted hero. target2
   does **not** adjudicate this — its traffic is small and distant. Play
   evidence only. A middle detail tier for near traffic is the likely answer.
6. **Directional shadows** from roadside props, at the tiers that can afford
   them. The target throws long soft palm shadows across the road.
7. **Tyre smoke** as volume rather than a sprite sheet.
8. **Hero tail crease** and **nitro bloom haze**. No support from target2 — its
   hero is a matte classic coupe under no boost. Play observations only.

## Our coast has no coast

`state()` reports `coast` honestly and `BIOME.coast.ground` is a sandy
`0xd8c898`, but the biome renders as sand and palms with **no water, marina or
skyline**. The reference is an urban seaside boulevard. This is the largest
single divergence from the standard and it is not a defect — it is a scope
question about what the coast biome is meant to be. Raise it rather than
quietly building a marina.
