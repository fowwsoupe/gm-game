# Front office: design brief (2026-11)

The second Phase 2 headline, and the fix the [long-run spread brief](2026-11-long-run-spread.md)
asks for: a team edge that lasts a few years and then moves on. Staff (scouting, development,
medical, the head coach) become people with a quality, paid from the ledger, hired from a
market, poached when they succeed. Their quality changes outcomes. The league stays fictional:
generated names only.

## What exists today

- `offseason/progression.ts` already gives AI teams an "organization" effect on development:
  up to +-2 rating points a year (`ORG_DEVELOPMENT`) from GM skill against the league's
  average, full to age 24, half from 30. GM skill stands in for the whole front office, human
  teams get nothing, and the effect lasts as long as the GM (tenure 4.2-4.65 seasons).
- `people/gm.ts`: GM skill also sets how far an AI GM misreads a player (SD 1 to 6 points),
  fixed per GM, team and player. The draft's public range (`offseason/draft.ts`, read SD 4,
  half-width 5) is the same for every team; AI GMs then add their misread.
- `sports/hockey/game.ts`: injury chance and length are constants (`INJURY_PER_GAME`,
  `INJURY_DAYS`, re-injury risk); no team changes them.
- `CoachProfile` (name, hired, salary, years) has no quality and no effect on games. His salary
  is the ledger's `costs.staff`; owners fire him on heat (`owner/index.ts`).
- `OwnerProfile.budget` (0-1) sets how far toward the cap the owner lets payroll go. Nothing
  else spends by owner.

## Real benchmarks

No public source gives NHL scouting, development or medical budgets, staff pay, or how much a
department moves results. The numbers below are game numbers, marked unverified, and tuned
against the long-run brief's three real benchmarks (points % year-to-year r 0.51, points % SD
0.095, 32.5% new playoff teams a year), which stay the measure of success. Head coach pay and
turnover come from the [owner & finance brief](2026-11-owner-finance.md).

## The model

### Staff

`Team.staff?: Partial<Record<Department, StaffProfile>>`, departments `scouting`,
`development`, `medical`. The head coach gains `quality` and is the fourth department in every
view (he keeps his own field and his hot-seat rules). A `StaffProfile` is `{ name, quality
(0-1), hired, salary }`. Absent: derived from the team id, like owners and coaches, so old saves
and roster files need nothing stored. `staffOf(team, dept, ctx)` in `sim/people`.

Salary follows quality: `frontOffice.salary.min` + quality^2 x (max - min), whole dollars, paid
in the ledger's `costs.staff` beside the coach. Unverified starting point: $0.4M to $2.5M a
department head (the department's whole cost, not one person).

### Effects (all in `Ruleset.frontOffice`, all measured against the league's average staff, so the league as a whole does not get better)

| Department  | Effect                                                                                                   | Replaces                          |
| ----------- | -------------------------------------------------------------------------------------------------------- | --------------------------------- |
| Development | +-`points` rating points a year at the extremes, same age reach as today; every team, human ones too     | GM skill in `ORG_DEVELOPMENT`     |
| Scouting    | this team's read SD of a prospect's potential, from `best` to `worst`; the human's range narrows with it | the GM misread on draft prospects |
| Medical     | injury days x (1 + `days` x (avg - q)); re-injury bonus x the same factor                                | nothing                           |
| Coaching    | +-`points` to the team's strength in games (hockey: added to every unit's rating, through `strengthFor`) | nothing                           |

The GM keeps his misread of established players (trades, signings): that is judgment, not staff.

### The market and turnover (what makes the edge move)

Every summer, after GM changes:

- Each department head leaves with `frontOffice.leave` chance (unverified 12%), plus a poaching
  chance for good staff on good teams: `poach` x quality x (team points % above .500, in SDs,
  if positive). A great development head on a contender is the likeliest to go.
- A vacancy is filled from a market: a fresh profile whose quality is drawn around what the
  owner spends, `0.5 + spend x (budget - 0.5)` with SD 0.2, clamped 0-1. Rich, winning-first
  owners hire better on average; they still miss.
- AI teams hire at once. The human's vacancies (and any department he wants to change) come with
  three candidates at different qualities and salaries; until he picks, the department is filled
  by an interim of quality 0.3.
- News: department heads poached or hired by the human team; league-wide only when a top-10%
  head moves.

A rich owner's team holds a better front office for years (more spread); poaching and luck move
its staff on (less carry-over). That is the pair the long-run brief asks for.

### What the human sees

The Front Office section (one of the five top sections in FEATURE_SPEC): each department's head,
quality as a word and a bar (poor, average, good, elite; the exact number is hidden like player
ratings), salary and seasons in the job, and its return last season (development: rating points
added to your players against an average staff; medical: games lost to injury against an average
staff; scouting: how far the range was off for your picks). Hire and fire from there.

## Ruleset data

```ts
frontOffice: {
  salary: {
    min: Dollars;
    max: Dollars;
  }
  development: {
    points: number;
  } // ORG_DEVELOPMENT today: 2
  scouting: {
    best: number;
    worst: number;
  } // read SD, rating points
  medical: {
    days: number;
  } // days factor at the extremes
  coaching: {
    points: number;
  } // strength in games
  leave: number; // yearly chance a head leaves
  poach: number; // extra chance for good staff on winning teams
  spend: number; // how far the owner's budget tilts hiring
  interim: number; // quality of an interim head
}
```

## What the balance lab should measure

- The three long-run benchmarks (they gate the fix): points % year-to-year r 0.40-0.62, points
  % SD 0.085-0.105, new playoff teams 29-36%, on seeds 1, 101 and 201. The known gap "no lasting
  team edge" should close.
- Department head tenure (report only, unverified), mean quality by owner budget tercile (rich
  above frugal), staff cost a team-season (inside the money checks, which must stay green).
- Injuries per team-season stay 7.9-8.5; goalie SV% r stays 0.12-0.30.

## Jobs (one PR each, in order)

1. **Staff and salaries.** `StaffProfile`, `Team.staff`, coach `quality`, `staffOf` derived from
   the id, `Ruleset.frontOffice.salary`, salaries in `costs.staff`, staff on the team page.
   _Done when:_ every team in a new league and an old save shows four department heads; the lab
   is unchanged apart from the money lines, which stay in range.
2. **Development staff.** The development head replaces GM skill in the organization effect,
   for every team.
   _Done when:_ a test shows an elite development head's young players gain more than a poor
   one's over five seasons; lab before and after on three seeds.
3. **The staff market.** Summer turnover, poaching, AI hiring by owner budget, news.
   _Done when:_ the long-run benchmarks are in range on seeds 1, 101 and 201 (tune
   `development.points`, `leave`, `poach`, `spend`), and mean quality rises with owner budget.
4. **Scouting and medical.** Per-team draft reads and the human's narrower range; injury days by
   medical quality.
   _Done when:_ tests show both effects; injuries per team-season stay in range.
5. **The coach in games.** Coach quality in team strength; hired coaches drawn from the market
   like other staff.
   _Done when:_ a test shows the effect; the single-game and best-of-7 checks stay in range.
6. **Front Office screen.** The section, the department returns, and the human's hire and fire
   commands (`staff.hire`, `staff.fire`) with three candidates per vacancy.
   _Done when:_ the screen reads only from a `GmApi` query, strings are in `en.ts` and `fr.ts`,
   and a test hires and fires through commands.
7. **The price curve.** Retry the salary exponent near 1.0 (`value/market.ts`) now that staff
   keep turnover up.
   _Done when:_ lab on three seeds says keep or drop it, with both reports in the PR.

Analytics (blurrier numbers when weak) and an assistant GM wait until this is in: they change
what the human sees, not outcomes.
