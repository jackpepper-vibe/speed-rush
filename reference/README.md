# Reference target

`tools/compare.mjs` and `tools/probe.mjs` score the game's hero capture against
an art-direction reference. Both resolve it through `tools/reference.mjs`, in
this order:

1. `--reference <path>` on the command line
2. `SPEEDRUSH_REFERENCE` in the environment
3. the default, **`reference/target2.jpg`**

There is no globbing and no newest-file-wins: the tools score the image that
was named, so the probe can never end up measuring a different picture than the
comparison. Swapping the standard means changing `DEFAULT_REFERENCE` in one
place.

The images are not in the repository and have to be put here by hand — they are
screenshots of other games, kept locally as art direction targets and
deliberately not committed. `.gitignore` covers `reference/target*` so a routine
`git add -A` cannot sweep one into a push.

## What a target is, and is not

A **graphics-fidelity standard only**. Framing, aspect, and any on-screen
controls are not a spec: nothing about Speed Rush's camera, layout, or UI
should move to match one. What is read off it is material quality, lighting,
atmosphere, scenery density, and model detail.

## Scoring caveats, per target

All analysis happens on a common 480x270 canvas, which makes two things matter
about whichever image is in use:

- **Aspect.** A reference that is not ~16:9 is squashed to fit, and anisotropic
  scaling inflates whatever gradients run along the compressed axis. Crop to the
  capture's aspect before profiling.
- **Pixel scale and compression.** The capture is 1600x900 and loses a lot of
  high-frequency detail on the way down to 480 wide. A small or heavily
  JPEG-compressed reference loses much less, and blocking artifacts add edge
  energy of their own. Both effects push the measured verge ratio the same way,
  and chasing the gap means adding detail to answer a compression artifact.

`target2.jpg` is 620x400 (1.55:1) and JPEG-compressed, so both caveats apply to
it: the histogram distance is the trustworthy comparative score, and the edge
ratios are advisory until the capture is brought to a comparable pixel scale.

`target1.png` is 1920x1080 and clean, but carries a full mobile touch HUD whose
icon columns sit exactly where `compare.mjs` samples roadside detail. It needs
both images cropped to the same central band, clear of the gutters.
