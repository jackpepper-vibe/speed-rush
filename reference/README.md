# Reference target

`tools/compare.mjs` scores the game's hero capture against **`target.jpg`** in
this directory.

The file is not in the repository and has to be put here by hand — it is a
screenshot of another game, kept locally as an art direction target and
deliberately not committed.

Without it, `compare.mjs` still runs and reports every self-contained metric
(edge density, luminance spread, specular response, silhouette smoothness). The
three comparative scores — histogram distance, roadside edge-density ratio and
contrast ratio — are reported as `no reference` and the corresponding probe
check is skipped rather than passed, so a missing file can never be mistaken
for a match.

Expected: `reference/target.jpg`, landscape, ideally around 16:9.
