# Reference target

`tools/compare.mjs` scores the game's hero capture against **`target1.png`** in
this directory.

The file is not in the repository and has to be put here by hand — it is a
screenshot of another game, kept locally as an art direction target and
deliberately not committed. `.gitignore` covers `reference/target*` so a routine
`git add -A` cannot sweep it into a push.

It is a **graphics-fidelity standard only**. Its framing, aspect, and on-screen
controls are not a spec: nothing about Speed Rush's camera, layout, or UI should
move to match it. What is being read off it is material quality, lighting,
scenery density, and model detail.

## The HUD gutters

`target1.png` is 1920x1080 and carries a full mobile touch HUD — dense columns
of dark icon tiles down both edges, a speedometer, a steering wheel, pedals.
Those tiles sit exactly where `compare.mjs` samples roadside detail (the outer
thirds of the upper half), and they are high-contrast UI, not scenery. Measured
raw, they inflate the reference's edge density and its dark-pixel share, so the
verge ratio reads far too low and the histogram distance too high — and closing
that gap would mean adding fake roadside clutter to chase an overlay.

Both images must therefore be cropped to the same central band, clear of the
gutters, before any profile is taken.

Expected: `reference/target1.png`, landscape, around 16:9.
