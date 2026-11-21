# Roster files

The game ships with a fictional league. Real-player rosters come from the community as JSON
files that players load with **Load roster file…**. We never ship or host real-player files.

- `fictional-template.json`: a full league in the roster format. Copy it to start your own.
  Regenerate with `pnpm roster:template`.
- The format is defined and validated by `packages/shared/src/roster-schema.ts`. Every file
  is untrusted: a bad file shows readable errors and never touches your current save.
- Each team needs at least one goalie. Ratings are 1–99; keys are listed in `docs/RATINGS.md`.
- The first team in the file starts as your team.
- A team may carry `"colors": { "primary": "#rrggbb", "secondary": "#rrggbb" }`. The match
  viewer draws its discs in them (a dark colour is lightened to show on the dark ice, and the
  away side wears its secondary when the two primaries are close). Without it a team gets
  colours derived from its id.
