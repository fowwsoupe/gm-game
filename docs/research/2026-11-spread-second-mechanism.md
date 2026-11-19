# Long-run spread: a second mechanism (2026-11)

Follows the [long-run spread brief](2026-11-long-run-spread.md) and the
[front office brief](2026-11-front-office.md). After the front office, the settled sim's points %
spread (years 10+) is 0.081-0.082 against the NHL's 0.095 (lab range 0.085-0.105). The front
office's tuning (PR #158) found development staff is the only lever that widens it, and past 3
points the edge lives on in the players after the staff leave: playoff turnover drops under 29%
and goalie save % gets too repeatable. A second mechanism has to add spread without adding
carry-over.

## The analysis

A season's points % SD mixes team quality with game luck (about 0.05 over 82 games). The
long-run brief found the settled sim's team quality varies too little (SD about 0.059 against
0.080) and carries over too much (about 0.87 a season against 0.71). Everything that lives in a
roster (players, their development, the staff that develops them) carries over, because rosters
do: most of a team's players are back next season. So any roster-side lever raises the spread and
the carry-over together; that is what PR #158 ran into.

What the sim lacks is the part of a team's quality that does not live in its roster: how a group
plays together in a given season (system fit, a room that works or does not, health of the right
players at the right time, a goalie's year). In the NHL it is why a team with the same roster can
swing 15 points from one season to the next. Write team quality as a lasting part `p` plus a
season part `e` drawn fresh each year:

- spread: `var(q) = var(p) + var(e)`, so it rises;
- carry-over: `r(q) = r(p) x var(p) / (var(p) + var(e))`, so it falls.

Both move the right way at once, which no roster-side lever can do. With main's numbers (points
% SD 0.081, r 0.51), a season part worth about 0.035-0.04 points % lifts the SD to about 0.088
and brings r to about 0.43, inside the NHL range (0.40-0.62; 0.46 without the COVID seasons).
Playoff turnover rises with it, which main needs (28.1-30.0%).

## The mechanism: season form

`Ruleset.season.form`: the SD, in rating points, of a team's form for one season. Each team draws
its form when the season starts (`season.started` carries it, a new league draws one too) and it
is added to every unit's attack and defence in every game, the same channel as the head coach.
Nothing carries over: next season is a fresh draw. The form is hidden like luck: the lab's
"favourite" checks still judge teams by their rosters alone. The "better team wins a best-of-7"
checks count it (with lines, chemistry and the coach): the benchmark judges a team by its true
strength that season.

Unverified game number, tuned in the lab: no public source measures this directly; it is fitted
to the long-run brief's three NHL benchmarks.

## Lab results

Full lab (20 leagues x 20 years, 100 single seasons), seeds 1, 101, 201. Main is `origin/main` at
9a15119. Columns: points % SD years 10+, points % r years 10+, new playoff teams, goalie SV% r.

| Form SD (points) | Seed 1                     | Seed 101                   | Seed 201                   | Mean                       |
| ---------------- | -------------------------- | -------------------------- | -------------------------- | -------------------------- |
| 0 (main)         | 0.081, 0.518, 29.0%, 0.292 | 0.082, 0.512, 28.1%, 0.311 | 0.081, 0.492, 30.0%, 0.294 | 0.081, 0.507, 29.0%, 0.299 |
| 2                | 0.083, 0.505, 31.2%, 0.306 | 0.083, 0.489, 31.2%, 0.294 | 0.083, 0.513, 29.6%, 0.314 | 0.083, 0.502, 30.7%, 0.305 |
| 3.5 (shipped)    | 0.083, 0.455, 32.3%, 0.295 | 0.087, 0.433, 31.2%, 0.285 | 0.087, 0.448, 31.6%, 0.300 | 0.086, 0.445, 31.7%, 0.293 |
| 4                | 0.088, 0.434, 34.1%, 0.302 | 0.087, 0.448, 32.9%, 0.311 | 0.085, 0.432, 30.6%, 0.303 | 0.087, 0.438, 32.5%, 0.305 |
| 4.5              | 0.088, 0.396, 33.5%, 0.288 | 0.089, 0.419, 33.9%, 0.267 | 0.088, 0.421, 32.9%, 0.284 | 0.088, 0.412, 33.4%, 0.280 |

**Shipped: 3.5.** Every one of the four benchmarks is in range on the mean of the three seeds,
and r (0.445) stays close to the NHL's 0.46 without the COVID seasons. The spread is in range on
seeds 101 and 201; seed 1 stays at 0.083, so the lab keeps the check's "known gap" label. 4.5
puts the spread in range on every seed but takes r to its floor (seed 1: 0.396). 4 sat between
them on spread and r, but its goalie SV% r came out at 0.305: goalie SV% r does not follow the
form (0.293 at 3.5, 0.305 at 4, 0.280 at 4.5; main 0.292-0.311), so that is seed noise around
the 0.30 ceiling main already sits on, not an effect; still, 4 failed the rule on its numbers.

What it does to the other checks:

- Favourite wins a single game, years 10+ (known gap): about flat (57.0-57.1% on main,
  56.6-57.1% at 3.5). Form is hidden from the roster-based favourite, so it adds wins the roster cannot see;
  the wider spread it brings cancels that out.
- Better team wins best-of-7, single seasons: noisy between rounds (main 62.6-66.4%; 60.3-63.9%
  at 4.5, 63.3-67.0% at 3.5). No trend.
- Better team wins best-of-7, years 10+: 60.4-61.8% on main, 60.0-61.6% at 3.5.
- Coach changes a team-season: 0.317-0.330 on main, 0.339-0.355 at 3.5 (range 0.25-0.40): a
  cold season costs more coaches their jobs.
- Top team's titles: 4.30-4.65 on main, 4.35-4.85 at 3.5. Money, injuries and payroll: flat.
- Team strength spread, years 10+ / year 0 (known gap): flat. It measures rosters, which form
  does not touch; with the points % SD now the benchmark, that check overstates the gap (see the
  long-run brief).

Small probes (6 leagues x 16 years) were too noisy to tune with: form 2 showed SD 0.087 and form
4 0.086 on one seed, where the full lab gave 0.083 and about 0.088.

## What was not tried

- Per-player season form (a goalie's or a shooter's year). It would also make goalie save % less
  repeatable, but it needs a stored value a player and a way into the shot model; the team form
  reaches the same benchmarks with one number a team.
- Raising development staff past 3 points together with form. Form leaves some room for it (r
  0.445 at 3.5 against a floor of 0.40), the next lever for the last of the spread; the real NHL's r of 0.51 with an SD of 0.095
  would need both a lasting and a season part larger than today.
- Showing form to the human (a word on the team page, news when a team runs hot or cold). Later,
  with the league pulse.

## Re-check on main after the later merges (2026-11-18)

Full lab on main at 8aab2e5 (form 3.5), seeds 1, 101, 201. Points % SD years 10+: 0.087, 0.086,
0.085 (the last prints 0.085 but sits just under the 0.085 floor, so it keeps the "known gap"
label); r 0.484, 0.467, 0.460; new playoff teams 30.9%, 31.6%, 31.3%. Seed 1 is no longer the
short one: the merges since the table above (AI trades, the assistant GM, extensions on Home)
moved the three seeds by up to 0.004 each way, more than the gap form 3.5 left on seed 1.

No change made. A seed-1 fix would be chasing noise that has already moved, and the only
candidate (form 4, probed above) costs about 0.01 of r and pushes goalie SV% r nearer the
0.30 ceiling (seed 1 is already at 0.314 on this run, out of range, a check form does not move).
The spread is in range on the mean (0.086) and on two of three seeds; seed 201 is the one to
watch if a later PR moves it.
