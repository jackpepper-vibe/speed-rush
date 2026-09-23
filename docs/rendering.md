# Rendering

How Speed Rush draws a frame, for anyone changing how it looks. The art target
is the late-2000s arcade racer look: a sunlit coastal boulevard, glossy cars,
dense palms, a painted sky. The coast by day is the reference condition, and
every other biome, phase and weather is built from the same systems.

## The frame

`SceneRig` owns the renderer, camera, lights, sky and environment map. Each
frame it places the sun relative to the car, moves the camera, and hands the
scene to `PostPipeline`.

`PostPipeline` (`render/post/`) draws the scene into a half-float target
multisampled at the tier's MSAA count. Then it runs a five-mip dual-filter bloom
and one final pass that does, in order:

- rain on the lens
- chromatic aberration
- radial speed blur
- bloom
- ACES tonemap
- sRGB encode
- grade and vignette

It replaced three.js's `EffectComposer`, which multisampled every ping-pong
target. That cost about 50 ms a frame on an integrated GPU.

Quality tiers (`Quality.ts`) are a device ladder, resolved once at startup.
`?quality=low|medium|high` pins a tier.

| | low | medium | high |
|---|---|---|---|
| shadows | off | 1024² | 2048² |
| bloom | off | on | on |
| MSAA | 0 | 4 | 4 |
| max pixel ratio | 1 | 1.5 | 1.5 |
| sky detail | gradient | 1 octave | 3 octaves |
| vehicle detail | reduced | full | full |
| scenery density | 0.45 | 0.75 | 1 |

## Light

`world/Palettes.ts` holds one palette per phase of the day. A palette sets:

- the sun's colour, intensity, elevation and azimuth
- the sky gradient and the hemisphere light
- fog colour and density
- exposure and cloud cover

The world blends between palettes as the day moves on.

By day the sun stands behind the camera's left shoulder (`sunAzimuth`), so the
car and the road ahead are lit from the front and shadows fall across the road.
A car lit from behind shows the camera its shaded side, and it read as a dark
cut-out whatever the materials did.

The environment map is a PMREM of the sky scene, rebuilt when the palette
changes. Its far plane (`ENV_FAR`) must exceed the sky dome's radius of 1400.
At three.js's default of 100 the environment is black, and every metal and
every clearcoat renders black with it.

Vehicles are also on `FILL_LAYER`. A weak fill light from the camera's side
lights them, so their shaded flanks never go fully black at night.

## Vehicles (`render/vehicles/`)

A car is one mesh with one material:

- `VehicleBuilder` gathers every part into a single geometry.
- Each vertex carries its `Surface` (`Surfaces.ts`): roughness, metalness,
  clearcoat, paint mask, lamp channel and glow.
- `VehicleMaterial` reads those attributes. It is a `MeshPhysicalMaterial`
  extended through `onBeforeCompile`.
- Wheels spin and steer in the vertex shader.
- Lamp lenses, grilles, louvres and number plates come from one canvas atlas
  (`VehicleAtlas.ts`).

Geometry is built once for each combination of design, detail level and plate,
and then shared. A vehicle owns only its material: paint, lamp levels and wheel
angle. Every vehicle shares one shader program, so twenty cars in traffic cost
twenty draw calls.

`BodyShell` lofts each body from rails: belt line, roof, half-width, rocker and
shoulder inset. It adds wheel arches, flares and a separate greenhouse. Each
design in `designs/` then adds its details: lamps, grilles, exhausts, wings,
mirrors and plates.

Nose and tail panels close the loft onto a horizontal spine across the middle
of the panel, not onto a single point. Every ring stays parallel to the
outline, so the panel is a regular grid, and its rows run level. The profile
across the rings is one smooth curve: a round of the fillet's radius, then a
dome of the bulge, highest on the centreline.

Grilles, intakes and inset lamps that sit on those panels are built with
`capInsert` (`designs/common.ts`). An inset is a patch that follows the panel
exactly, stands 4 mm proud of it, and has a lip turned back into the body.
Don't paint a bounded shape onto the panel's own quads with `paintOut`: its
edge lands wherever the grid does, and comes out stair-stepped. `paintOut` is
fine for full-width bands, such as a carbon diffuser or a lower valance,
because the panel's rows are level.

There are three detail levels:

| level | used for |
|---|---|
| `hero` | the player's car and the garage |
| `traffic` | vehicles on the road |
| `far` | parked cars, instanced |

The low tier builds each vehicle one level down (`setVehicleDetail`).

To add a car, write a `VehicleDesign` and register it in `designs/index.ts`.
A design has two parts: `body()`, which returns the rails, and `details()`,
which adds the parts. Then check it with `node tools/look.mjs --scenes cars`.

## Road and sea (`render/road/`)

Each road segment is one `RoadStrip`. Its vertices carry road coordinates:

- lateral offset from the centre line
- distance along the road, modulo 1000 m
- height
- a per-segment tag for verge style and street lamps

`RoadSurfaceMaterial` paints the whole cross-section from those coordinates:
asphalt, kerbs, pavement and the biome's verge. The lane markings are analytic
and antialiased, so they stay crisp at any distance. At night, segments that
have lamps get pools of lamplight.

`SeaMaterial` scrolls two wave normal maps in road coordinates. Mapped in world
coordinates, the water would travel with the camera rather than move past it.

## Scenery

`props/` holds palms, street lamps, railings, guardrails, saguaros and pines.

- Palms have curved trunks and 25–28 V-folded fronds cut from an alpha atlas.
- Foliage and railings are alpha-tested with alpha-to-coverage.
- Their mip chains preserve alpha coverage (`textures/CoverageMips.ts`). Plain
  mipmaps thin fronds and balusters to nothing a few dozen metres out.

Buildings are instanced boxes painted by the facade shader in
`buildings/BuildingMaterial.ts`:

- styles: riviera, hotel, modern and office
- shopfronts and awnings at street level
- chosen per instance from its colour
- windows lit at night

Parked cars are the `far` level of the traffic designs, instanced by the dozen.

## Sky (`SkyDome.ts`, `render/sky/`)

The dome is a gradient with a sun disc, stars, and a painted cumulus panorama.
The panorama (`CloudPainter.ts`) is a 4096×512 canvas drawn once at startup.
Clouds are lit by the sky's own brightness, so they dim at night rather than
glow. Storm overcast is noise laid over the top.

`HorizonHills` is a ring of low hills 1250 m out. It takes the fog colour and
closes the gap where the sea met the sky.

## Night

`NightLights.ts` is a small registry. Street lamps, lit windows and the road's
lamp pools subscribe with `onNight()` and follow the level the world sets.

## Effects

Tyre smoke and dust are a `BillboardField`: instanced camera-facing quads in one
draw call. Each quad is sized in metres, spins slowly, is lit from above, and
fades out near the lens.

The nitro flame is two nested open cones on each exhaust, drawn with
`effects/FlameMaterial`. The flame is white-hot at the nozzle, burns through
orange and fades to nothing at the tip. It softens towards its silhouette and
has turbulence running down it. Its brightness is held low enough that the
orange survives the tone curve rather than clipping to white.

Rain is `effects/RainStreaks`: one instanced quad per drop, each stretched along
the drop's motion relative to the car, so the streaks rake back from the
vanishing point at speed. Every streak is at least a pixel wide, and fades out
near the lens. The drops are moved entirely in the shader: a fixed place in a
box riding with the car, offset by how far rain has fallen and the road has
travelled.

## Checking your work

**Look at it.** Start `npm run dev`, then run `node tools/look.mjs`. The tool
captures the chase view in every biome, phase and weather worth checking, the
six player cars and the traffic line-up, on the machine's real GPU. It reports
nothing about the image; you read the frames.

`window.carRacer`, in `src/dev/DevHandle.ts`, is the dev handle for posing the
game. The main calls are `pinWorld({ biome, weather, phase })`, `startRun`,
`drive`, `place`, `layTraffic` and `snapshot`.

**Check it still works.** Run `npm run probe`. The probe is a functional
regression suite pinned to the low tier on SwiftShader, and its render-quality
block opens a second page at the high tier. It checks whether the game works,
not how it looks.

**Budget.** On the high tier at 1600×900 on an Intel Iris Xe, GPU-synchronised
medians are:

| scene | median | draw calls | triangles |
|---|---|---|---|
| coast, day | 23 ms | 193 | 1.17 M |
| coast, night | 22 ms | 196 | 1.19 M |
| city, day | 22 ms | 170 | 0.80 M |
| forest, day | 19 ms | 178 | 0.77 M |

The build before this renderer drew the same scenes in 950–1,430 draw calls.
