# Long-run spread: why simulated leagues flatten (2026-11)

Over 20 simulated seasons the gap between strong and weak teams shrinks, and games drift toward
coin flips (balance lab, "known gap" checks). This report collects the real NHL benchmarks the
lab now uses and what the sim experiments found. No fix has shipped yet; this is the brief for one.

## Real NHL benchmarks

Counted from Wikipedia's season pages (playoff seeds and final standings, one page per season).
Standings for 2017-18 to 2025-26 were read through a page summary, not verbatim text; spot
checks against known records (Boston 135 points in 2022-23, Tampa Bay 128 in 2018-19,
Colorado 48 in 2016-17, Detroit 39 in 2019-20) all matched.

| Measure                           | Value                                          | Seasons            |
| --------------------------------- | ---------------------------------------------- | ------------------ |
| New playoff teams a year (of 16)  | 5.2 on average (32.5%), 3 to 7 in a season     | 2007 to 2026       |
| Team points %, year-to-year r     | 0.51 (SE 0.05); 0.46 without the COVID seasons | 2014-15 to 2025-26 |
| Team points %, SD within a season | 0.095 (0.077 to 0.122), 82-game seasons only   | 2014-15 to 2025-26 |

New playoff teams by season, 2007 to 2026: 5 5 5 6 3 4 5 5 7 5 7 7 5 5 7 4 5 3 5 6. This
replaces the "~5-7 of 16" in the [sports GM research](2026-11-sports-gm-research.md), which came
from one season. Relocations count as the same team; 2020 uses the 16 teams of the first round.

Season pages: [2006 playoffs](https://en.wikipedia.org/wiki/2006_Stanley_Cup_playoffs) to
[2026 playoffs](https://en.wikipedia.org/wiki/2026_Stanley_Cup_playoffs);
[2014-15 season](https://en.wikipedia.org/wiki/2014%E2%80%9315_NHL_season) to
[2025-26 season](https://en.wikipedia.org/wiki/2025%E2%80%9326_NHL_season).

## Where the sim stands

| Measure (sim years 10+)  | Sim (lab, seeds 1, 101, 201) | Real  |
| ------------------------ | ---------------------------- | ----- |
| Points %, year-to-year r | 0.46 to 0.48                 | 0.51  |
| Points %, SD             | 0.076 to 0.079               | 0.095 |
| New playoff teams a year | 30.4% to 31.7%               | 32.5% |

A season's points % SD mixes team quality with luck (about 0.05 over 82 games). Taking the luck
out, team quality varies about 0.059 in the settled sim against about 0.080 in the NHL, and it
carries over from one season to the next at about 0.87 against about 0.71. The settled sim is
too even and too stable at once. That is why raising the spread alone cuts playoff turnover.

A fresh league is the other way round: points % SD 0.102, a little wider than the NHL. The lab's
older "Team strength spread, years 10+ / year 0" check compares against that, so it overstates
the gap.

## What was tried

Each test plays 6 leagues for 16 to 18 seasons, seeds 1 to 6.

**Switching one mechanism off.** None explains the flattening. Spread, years 10+ over year 0:

| Switched off                      | Spread ratio |
| --------------------------------- | ------------ |
| Nothing (main)                    | 0.59         |
| Worst-first draft order           | 0.65         |
| Worst-first roster filling        | 0.57         |
| The re-sign roll (everyone stays) | 0.67         |
| AI free-agent offers              | 0.64         |
| AI trades                         | 0.60         |
| GM misreads (every GM perfect)    | 0.59         |

GM skill does not matter today: AI teams rarely choose, because free agents pick their team
and rosters fill by position.

**The price curve is the biggest lever.** Salary grows with rating above replacement (45) to the
power 1.5. Team strength grows about linearly, so under a hard cap the cheapest strong roster is
many mid-level players and every team builds the same one. With the payroll held level:

| Exponent | Spread ratio | Points % SD | r    | New playoff teams |
| -------- | ------------ | ----------- | ---- | ----------------- |
| 1.5      | 0.59         | 0.077       | 0.49 | 33.9%             |
| 1.2      | 0.64         | n/a         | n/a  | n/a               |
| 1.0      | 0.72         | 0.080       | 0.53 | 31.3%             |
| 0.8      | 0.74         | n/a         | n/a  | n/a               |

In the full lab (20 leagues x 20 years, three seed sets) exponent 1.0 lifts the spread ratio to
0.62-0.68 but drops playoff turnover to 28.1-29.1% and pushes the top team's titles past 5.

**Development luck.** Doubling yearly rating noise adds some spread (0.69). Raising goalie noise
from 2.5 to 4, with exponent 1.0, made goalie save % more repeatable (0.33-0.37 against a ceiling
of 0.30), not less: goalies spread further apart. It also left turnover at 27.9-29.3%.

## What a fix needs

Something that gives a team an edge that lasts a few years and then moves on: more spread and
less carry-over together. Candidates, none built yet:

- Front-office quality that decides outcomes (scouting, development staff), with staff turnover.
  This is Phase 2's front-office headline; the sim's GM skill does not reach outcomes today.
- A flatter price curve (exponent near 1.0) together with one of the above, so turnover holds.

Check any fix against the three real benchmarks above, on three seed sets (`--seed 101`,
`--seed 201`), not only the default run.
