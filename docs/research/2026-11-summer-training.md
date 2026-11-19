# Summer training, camp battles and an international tournament: design brief (2026-11)

The roadmap's Phase 2 headline "Summer training, camp battles, international tournament" (queue
D). FEATURE_SPEC asks for "summer training plans, camp battles, preseason; fictional
international tournament every four years" and says "training plans work within each skill's
hidden ceiling". This brief says what exists, designs the three pieces and splits them into
three jobs. The preseason itself (three camp weeks, holdouts and the owner's meeting on camp's
first day, the coach's camp report) is job 1 of the [camp brief](2026-11-camp-deadline.md); camp
battles here wait for it.

## What the real league does

- **Summer training.** Players train off the ice over the summer, mostly with their own
  trainers, on a program the team agrees with them; teams hold a development camp for their
  prospects in early July. A summer program changes what a player is good at more than how good
  he is: a veteran can add speed or strength, a young player rounds out a weakness.
- **Camp battles.** Most of a roster is set before camp; camp decides the last few spots (the
  12th forward, the 6th or 7th defenceman, the backup goalie), often between a veteran and a
  prospect, and the coach's read of camp decides who opens the season in the lineup.
- **Best-on-best tournaments.** NHL players played the Olympics in 2014 and again in 2026, the
  4 Nations Face-Off in February 2025 (a mid-season break), and the World Cup of Hockey in
  September 2016 (before camp, eight teams: two groups of four, semi-finals and a best-of-three
  final). A World Cup is planned for 2028.
- All of this is general knowledge, not from a sourced report: check the camp-spot and
  tournament details before any of them becomes a ruleset number. The tournament is fictional
  (FEATURE_SPEC): no Olympic, IIHF or World Cup names or marks, in line with the fictional-league
  path of the [Sports GM research](2026-11-sports-gm-research.md#launch-fictional-in-early-access-with-a-lawyer-on-retainer).

## What exists today

| Piece              | Status                                                                                                                                                                                                                                                       |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Development        | `developPlayers` (step 1 of the summer, `offseason/progression.ts`): the development model moves every rating by the same `delta + luck` plus 1 point of noise each, then the team's development staff adds whole points to every rating (`orgReach` by age) |
| Ceiling            | one hidden `potential` per player, the overall he closes on until his peak age; no ceiling per skill                                                                                                                                                         |
| Ratings            | hockey skaters: skating, shooting, passing, puckHandling, defense, physical, hockeyIq, faceoffs; goalies: reflexes, positioning, reboundControl, consistency. The game reads each one (units, strength), the offseason ranks by their average (`overall`)    |
| Personality        | `personalityOf(playerId)`, hashed from the id; `professionalism` is one of six traits                                                                                                                                                                        |
| Preseason          | in the calendar but never reached (the camp brief's job 1 opens it)                                                                                                                                                                                          |
| Depth              | `depthCharts` (the human GM's order, `lines.set`); AI teams and a GM who never set lines play by rating (`sport.lineup`). `roleGap` and disputes react to a player kept down the order                                                                       |
| Nationality        | none: players have no country, and names are drawn from one mixed pool                                                                                                                                                                                       |
| Games outside play | `sport.teamStrength` and `sport.simGame` take any players and any two ids, so a game between two picked rosters can be played without a schedule or a team                                                                                                   |

## Design

**Summer training plans: a focus, not a bonus.** A human GM can give each of his players one
summer focus, from a list the sport defines as groups of rating keys (hockey skaters: skating,
shooting, playmaking = passing + puckHandling + hockeyIq, defence = defense + physical, faceoffs;
goalies: reflexes, positioning = positioning + reboundControl). At `developPlayers`, after the
model and the staff, a player with a focus moves `training.points` rating points (ruleset, 2 to
start, a game number for the lab) onto the focus keys, taken evenly from his other keys, so his
`overall` and his value do not change: the plan reshapes a player, it does not make him better.
The share that lands is scaled like the staff's reach (`orgReach`: all of it to 24, half from 30)
and by `0.5 + professionalism` (he does all of his program, or half of it). The ceiling: a focus
key at or above his `potential` gains nothing (the points stay where they were), so a plan works
on a weakness, not on a sniper's shot. Plans are kept in the league state (`trainingPlans`, by
player, in the save's JSON meta like `depthCharts`), set with a `training.set` command (new
command and event kinds in `packages/shared` first), apply only while he is on a human team, and
last until changed. AI teams train balanced (no plans), so the lab cannot move. The player
profile gets the focus picker for your players, and the summer's result posts to your feed
("his summer on shooting: +2 shooting"), strings in `en.ts` and `fr.ts`.

**An international tournament every four years.** Each player gets a nation, hashed from his id
like his personality (`nationOf`, no save change), from shares the sport sets (hockey, in
`sports/hockey/`: Canada 0.35, USA 0.25, Sweden 0.12, Finland 0.10, Czechia 0.09, and Team World
0.09 for everyone else, a mixed team like the 2016 World Cup's Team Europe; game numbers, to check
against a sourced count). Six teams, because the fictional league has 16 teams and about 400
rostered players: at these shares the smallest nation has about 36 players, near two full
lineups. In a season where `season % international.every === 0` (ruleset, `every: 4`) the
tournament is played in late summer, in `finishRollover` before `season.started`: each nation
dresses its best healthy rostered players through `sport.lineup` (the lineup the game would
dress, so the sport decides how many and which positions; a nation short at a position borrows
Team World's best one left over), two groups of three play a round robin, the top two of each
cross in the semi-finals, then a one-game final (9 games). Games use `sport.teamStrength` and
`sport.simGame` on their own `rng.fork('international')`, so the league's games draw the same
numbers as before and are not stored in `results`. One event carries the outcome (season,
standings, champion, the top scorer as the tournament's best player), kept in a short history in
the save and shown on the History screen; the feed posts the champion, and your players' medals
make your news. No injuries, fatigue or morale from it yet.

**Camp battles: the coach's call for the last spots.** On camp's first day (after the camp brief's
job 1), for each position group the sport's lineup gives, the last player it dresses and the best
one it does not are in a battle when their `overall` is within `camp.battleGap` points (ruleset, 2).
On the last camp day the head coach reads each one's camp: `overall + youth x (potential -
overall) + noise`, with `youth` for players 23 or under (a coach gives the prospect with upside the
benefit of the doubt) and noise SD `(1 - quality) x camp.readSd`, the camp report's rule, so a
poor coach picks the wrong player more often. An AI team dresses his pick (it goes ahead of the
other in its depth order for opening night). For a human team the coach's pick is advice: the
camp report names each battle and his pick, and a To do opens until the GM has set his lines;
playing the loser over him is the GM's call, and `roleGap` and disputes already react to it.

## Jobs (one PR each, in order)

1. **Summer training plans.** The sport's focus groups (hockey in `sports/hockey/`), `training`
   in the ruleset, `trainingPlans` in the state and the save, the `training.set` command and its
   event, the focus step in `developPlayers`, the profile's picker and the summer news (en, fr).
   _Done when:_ a test develops twin players a summer apart, one with a shooting focus: his
   shooting is up against the balanced twin's and his overall is the same (within rounding); a
   focus key at his potential gains nothing; a plan on a player traded to an AI team does nothing.
   The lab is unchanged on seeds 1, 101 and 201 (AI teams have no plans).
2. **The international tournament.** `nationOf`, `international` in the ruleset, the tournament in
   `finishRollover`, its event and history in the save, the History screen card and the news
   (en, fr). _Done when:_ a test plays a tournament season with 6 teams, 6 group games, 2
   semi-finals and a final and one champion, the same on a replay, and none in the seasons between;
   the lab is unchanged on seeds 1, 101 and 201 (its own fork, no league games).
3. **Camp battles** (after the camp brief's job 1). The battles on camp's first day, the coach's
   read on the last, AI depth orders, the camp report's battle lines and the To do (en, fr).
   _Done when:_ a test sets up a battle within the gap and an elite coach picks the better player
   more often than a poor one; the lab's checks are flat on seeds 1, 101 and 201, before and after
   pasted in the PR (AI teams' last lineup spots can change).

Not in scope: exhibition games, professional tryouts, waivers and sending a junior back (the
[minor leagues brief](2026-11-minor-leagues.md)), nationality in names, flags or player profiles
beyond the nation, tournament injuries and fatigue, a mid-season tournament break, and a
tournament cutscene (the cutscenes headline).
