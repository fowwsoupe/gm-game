# Preview design: "Front office at night, broadcast on the wall"

Open at `#/preview` (dev: `pnpm dev`, then add `#/preview` to the renderer URL). Mock data only. Nothing here talks to the sim, `window.gm` or the database.

## Idea

You are the GM of an organisation, sitting in a dark office with the game on the wall. The desk is dense and quiet. The wall gets loud on the days that matter. Direction B's desk and dossier, plus broadcast graphics (huge numbers, condensed caps, hairlines), plus Football Manager's rule that a good table beats ten cards.

## Tokens

| Token    | Value                                                                              | Use                                                    |
| -------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------ |
| Surfaces | `#121315` `#18191c` `#202226`, hairline `#2b2d31`                                  | Graphite panels, 1px lines, no shadows                 |
| Ink      | `#ece7dd` / `#aaa69d` / `#6f6c66`                                                  | Warm off-white, two greys                              |
| Team     | fill (buttons, jersey tint) and text step (key numbers); swap team in dev bar      | Accent only: active tab, key number, primary button    |
| Display  | Barlow Condensed 500-700, caps, 0.95 line height                                   | Headlines, OVR, cap space, clock, jersey numbers       |
| Text     | IBM Plex Sans 400-600, tabular numerals                                            | Tables, copy. Both fonts bundled (Electron is offline) |
| Scale    | 11 label (caps, +0.14em) / 14 body / 17 item / 24 section / 48-96 hero / 300 clock | Weight contrast, not size steps                        |
| Space    | 4px base; 8, 12, 18, 28, 40. Gaps are uneven on purpose: hero 40, rows 8           | Hierarchy                                              |
| Radius   | 2px buttons and tags, 0 everywhere else                                            | Square, board-like                                     |
| Texture  | SVG grain at 7%, faint board scratches, arena light falloff on hero and draft      | Atmosphere, never blocks input                         |
| Motion   | 200ms `linear()` spring; number roll 520ms; intros 1.9s, skippable                 | Event days only get the long ones                      |

## Event theme layer

One `data-phase` attribute. It changes imagery, accent, header strip and motion. Layout and navigation are identical in every phase.

- **Regular**: graphite, team accent, restrained.
- **Opener**: bright white-ice surfaces, dark ink, "New season" title card.
- **Deadline**: red accent, breaking ticker, big countdown, shorter transitions.
- **Free agency**: near black, amber accent, "On the phone" plus stacking offers.
- **Playoffs**: darkest, team colour only, the bracket is the hero and the regular-season table is gone.
- **Draft**: arena dark, spotlight, 300px clock, skippable reveal card (screen 3).

## Faces

No code-drawn faces or silhouettes. A portrait is an image file (see GRAPHICS.md); with none, a dark textured frame shows the jersey number. Superseded in round 4.

## Rejected, and why

- **shadcn/ui**: not installed, and shadcn is on your ban list. Motion (framer-motion) is installed and used for layout animation between screens; plain CSS and a 20-line number roller cover the rest.
- **Real NHL players**: you asked for realistic mock rosters, but the repo's policy is a fully fictional league. Names are invented, cities are real.
- **Card grids for Home**: replaced by one headline, three numbers, a "Needs you" list and two tables.
- **Radar charts and bar charts in the drawer**: a six-row ratings list with big numbers reads faster than a polygon.
- **Dimming the screen behind the drawer**: the roster stays readable so you can pick the next row with arrow keys.
- **Sound**: hook only (`cue()`), muted, logs to console. No audio assets yet.
- **Fabricated urgency**: with no open items Home says "Nothing needs you today".

## Where it is weak (honest)

- Market, Scout, League and Calendar are stubs. Standings beyond the Atlantic snapshot do not exist yet.
- The Needs buttons have no keyboard path; only Space, 1-6, arrows, T, E and the palette do.
- Continue never blocks on an open Need here. The real game must decide whether it should.
- Cap space moves on trades but not on extensions (those start next season).
- Strings are inline English, not i18n, and styles bypass the app tokens. Fine for a prototype, wrong for shipping.
- Grain and the spring easing are untested on low-end GPUs.

## Five journeys

Count = clicks or key presses; typing a word counts once.

| Journey                            | Fastest path                                                                      | Count                            |
| ---------------------------------- | --------------------------------------------------------------------------------- | -------------------------------- |
| 1. Find a player, open his profile | `Cmd+K`, type `lind`, `Enter`                                                     | 3 (peek: 0, hover)               |
| 2. Respond to a contract demand    | Home, Needs: "Accept $7.20M x 5". Counter: Counter, `+0.25` once, Offer           | 1 to accept, 3 to counter        |
| 3. Propose a trade from the roster | Right-click row, "Propose trade", Propose. Keys: `2`, arrows to row, `T`, `Enter` | 3 clicks (keys: 3 plus arrows)   |
| 4. Check standings                 | Home is the landing screen: the Atlantic table is already there                   | 0 (full league table: not built) |
| 5. Sim to the next game            | `Space`                                                                           | 1                                |

## Round 2 additions

Trade is a real table (chips, value meter, NMC and cap blocks; the valuation is a mock model, not the sim). Home content follows the phase.
Sim ends on a result card. League, Calendar, Market and Scout are plain tables. Draft has a pick run, last-10s pulse and compare (X).
Still weak: the portrait is a placeholder silhouette, the draft run is scripted, Metropolitan and market rows are invented.

## Round 4: the frame and the decision design

Identity unchanged (condensed display type, huge numbers, dark broadcast palette, team colours, Needs you, trade table, phase themes).

### What was taken from each reference

`design-refs/` (moodboard, moments, placeholder-art) does not exist in this checkout, so **nothing was taken from any reference image**. The round-4 brief and Football Manager's structure were the only inputs: inbox-driven flow, profile with grouped 1-20 attributes against a position average, role-fit stars, scouting fog. When the folder appears, add one line per file here. `design-refs/` and `public/graphics/placeholder-art/` are gitignored.

### Canvas

- Fixed 1920x1080, scaled to fit by `min(w/1920, h/1080)`, black letterbox. Nothing scrolls; overflow becomes a tab, a scrolling panel or the next disclosure level.
- Rows: 56px top bar, content, 36px dev bar (preview only). Content is one hero plus two or three panels.
- A full-bleed scene sits behind every non-draft screen, blurred 10px and dimmed 70% (`SceneImage`); no image = dark textured frame.

### Decision-design rules

1. Lead with the conclusion ("Close to fair, frees $5.1M", "Top-pair D"); numbers are one click away.
2. Every stat carries a judgment (tone, arrow, short label) and a comparison (position average tick, replaced player, last season).
3. Three levels: glance (tile, row) -> peek (drawer) -> full (Expand).
4. Context picks the facts: trade = cap now and next season plus line impact; profile = role fit and contract value; lines = tier and line rating.
5. Staff say it in plain words (scout, coach, cap manager).
6. Highlight only exceptions: injured, day to day, slump, contract year.
7. Scouting fog: attributes are ranges until scouted 3/3; potential is always a range.
8. Rating has two modes (dev bar "Rating"): role-fit stars with a tier label (default), or OVR.

### Screens

Home (matchup hero, Needs you, wire, next three), Player profile (drawer, expands), Trade evaluation (verdict, cap, line impact, GM reactions), Lines board (4 lines, 3 pairs, goalies, scratches; drag to swap). Other phases moved onto the canvas. Match view (dev bar "Match", Esc closes): the app's rink on one game the sim played, saved as `match.fixture.json`; the home side wears the picked team, the away side the next one; "Reduced" motion makes the discs jump from event to event.

### Fixed

Missing spaces before surnames, one deadline countdown, ghost team text over the draft prospect, draft black band, the 4-2 dash (now a text dash), the playoff goalie label.

### Not done or unverified

Peek and menu use clientX/Y, which may be offset under the scale transform. The tile-to-profile shared-element transition is not visually verified. Market, Scout and League are still plain tables. Every portrait, scene and jersey is missing (no art supplied).
