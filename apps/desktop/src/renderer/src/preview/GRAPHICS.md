# Preview graphics

Nothing is drawn in code: no SVG or CSS faces, arenas, spotlights or banners. Images load from files; a missing file falls back to a dark textured frame (jersey number for people). The one exception is a diagram: the rink of the match view (`ui/Rink.tsx`, the app's own component), like the shot map.

| Use      | Component           | Lookup order                                                                                             |
| -------- | ------------------- | -------------------------------------------------------------------------------------------------------- |
| Portrait | `Face` / `Portrait` | `graphics/faces/<id>.png`, `graphics/placeholder-art/portraits/<id>.jpg`, frame with number              |
| Scene    | `SceneImage`        | `graphics/scenes/<slot>/<team or who>.jpg`, `graphics/placeholder-art/scenes/<slot>.jpg`, textured frame |
| Crest    | `TeamMark`          | `graphics/logos/<AB>.png`, flat monogram in team colours                                                 |

Scene slots: arenaExterior, arenaInterior, tunnelArrival, draftStage, warRoom, trainingCamp, roadTrip, awardsGala. Files live under `apps/desktop/src/renderer/public/`. `placeholder-art/` is gitignored; never commit real NHL logos or player photos.

Missing today: all portraits, all scenes, all logos. Crests are monograms.
