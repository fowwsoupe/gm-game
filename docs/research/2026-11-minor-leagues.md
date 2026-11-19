# Minor, junior and European leagues: design brief (2026-11)

The roadmap's "Minor / junior / European leagues: light stats-only sim for prospects" (Phase 1
engines; FEATURE_SPEC asks for "light sims for minor/junior/European leagues" and "career stats
at every level"). Today every draft pick signs and joins his team's roster at 18 or 19. This
brief says what that costs, gives prospects somewhere to play off the roster, and splits the
work into four jobs. The [camp brief](2026-11-camp-deadline.md) left two minor-league moves
here: sending a junior back (job 4) and waivers (not in scope).

## What the real league does

- **Draft rights.** A team holds an unsigned pick's rights for a set time: from 2027, four years
  for a pick drafted at 18 and three for one drafted at 19 or older (the rules table in the
  [Sports GM research](2026-11-sports-gm-research.md#the-2026-27-rulebook-is-concrete-enough-to-code-today),
  from Sound of Hockey). Until he signs he keeps playing where he played (junior, college or a
  European men's league) and is on neither the team's roster nor its cap.
- **The minors.** A signed player can be sent to the team's minor-league affiliate. He leaves the
  23-man roster, and his cap hit stops counting except the part above the burial relief, $1.225M
  in 2026-27 (same table). A call-up is a real move: a demoted player must play a minor-league
  game first (same table, "no paper transactions").
- **Junior-age players.** A player drafted out of Canadian junior who is under 20 cannot play in
  the minors: he plays in the NHL or goes back to junior. This is general knowledge (the CHL-NHL
  agreement), not from a sourced report; check it before it becomes a ruleset number.
- **Comparing leagues.** Analysts translate scoring across leagues with NHL equivalency (NHLe):
  the share of a player's points rate that carries over to the NHL. The often-quoted factors are
  KHL 0.82, NCAA 0.41 and WHL 0.30, from 2014; current tables for 62 leagues exist but could not
  be extracted ([Sports GM research](2026-11-sports-gm-research.md#the-ml-stack-is-easy-the-data-licence-is-not)).
  The junior and European stat feeds forbid model training (Elite Prospects' terms, same
  section). This design needs no real lower-league data: lines are generated from ratings, and
  the factors are lab targets like any other ([ADR 0005](../adr/0005-calibrate-first.md)).

## What exists today

| Piece            | Status                                                                                                                                                                                                                                                                                                                |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Draft            | `draftPlayer` signs every pick to an entry-level deal on the spot (first-rounders with the most performance bonus allowed) and puts him on the roster; a pick his team cannot fit under the cap goes to free agency. Its `TODO(feature)`: draft rights and prospects kept off the roster                              |
| Rounds           | 2 (`NHL_2026.draft.rounds`). The ruleset says why: until prospects exist as a separate pool, only the picks that sign are drafted                                                                                                                                                                                     |
| Roster limit     | `maxActive: 23` stops AI re-signings and free-agent bids only; the draft and the cap-floor top-up go past it (`meetCapFloor`: "until prospects and minor leagues exist, every signed player counts as rostered"). The fictional league starts every team at 25. The V0.1 plan lists the 23-player maximum as not done |
| Who plays        | measured for this brief (seeds 1 and 101, AI teams, six seasons): from the fourth season a league carries 69-78 rostered players aged 20 or under, overall about 51 against 63.5 for all rostered players, and 53-66 of them play 10 games or more; 4 to 7 of 16 teams are over 23                                    |
| Development      | everyone develops by the same rules wherever he is; a team's development staff adds its edge to its own players (`orgReach`: all of it to 24, half from 30)                                                                                                                                                           |
| Prospect origin  | `generateProspect` makes a teamless 18-19 year old with no past (`TODO(M4)`: junior/Europe origins)                                                                                                                                                                                                                   |
| Draft board      | public range, the team's own read and a scout report; no stats                                                                                                                                                                                                                                                        |
| Career stats     | main-league regular seasons only (`stats.archived`, saved in `player_seasons`)                                                                                                                                                                                                                                        |
| Rookie award     | `awards.rookieMaxAge: 20`: the best scorer aged 20 or under                                                                                                                                                                                                                                                           |
| Filling a roster | a team short of a position signs a free agent, else a generated undrafted 18-19 year old on an entry deal (`fillRosters`; `meetCapFloor` overpays one, under a `shortcut:` comment)                                                                                                                                   |

So the main league is where teenagers learn the game: one roster spot in five goes to a player
twelve points under the typical one, and most of them dress.

## Design

A player can be in three places besides a main-league roster. The sport defines them (hockey:
junior, Europe, the minors) with their stat rates; the rules around them (rights, burial, the
junior age) are CBA data in the ruleset.

**Prospects: rights without a contract.** Every pick goes to his team's prospect pool unsigned,
in the league he came from (junior or Europe, drawn when the class is generated; a junior
prospect past the junior age plays in Europe). The pool is its own map in the league state
(`LeagueState.prospects`, kept like the draft class), not part of `players`, so nothing that
reads rosters, payrolls, lineups, trades or awards sees him until he signs, and none of that code
changes. He ages and develops each summer like everyone, with his team's development staff
(as now), so moving him off the roster does not change how he grows. His team's rights end
`draft.rightsYears` summers after the draft (4 at 18, 3 at 19 or older).

A human GM signs a prospect from the Roster screen any time outside the playoffs: an entry deal
at his age, with the usual cap check. A prospect whose rights end this summer is a To do in the
re-signing window, and one still unsigned when free agency opens joins the free agents. An AI GM
signs in the same window, on his read: a prospect who would make the roster now (read overall at
least the bar he re-signs his own players at, `typicalRating - RESIGN_SLACK`), or one whose
rights end and whose read potential clears that bar. The rest wait, or walk when their rights
end. A team short of a position signs a free agent first, then its best prospect there, then a
generated player.

**Lines: a season in a few numbers.** There are no games, schedules or standings below the main
league. When the regular season ends, every prospect gets one stat line in his league, and each
new draft class gets its draft-year line when it is announced. A line is what his ratings would
score over a main-league season at the sim's own rates, divided by his league's NHLe factor, then
drawn with noise: games, goals, assists and points for skaters; games and save % for goalies.
The main-league rates come from a small ratings-to-stats table fitted on the sim's seasons by
the tool that already fits stats to ratings (`pnpm ratings:fit`). A better player scores more on
average, the same player scores more in junior than in Europe, and lucky seasons happen.

Lines are public like any stat: the human sees them on the profile (a career row per league),
on the prospect list and on the draft board, next to his scouts' range. The line shows how good
he is now and the range is a read of what he may become, so a raw prospect with a high ceiling
can have a poor line. AI GMs keep deciding on their read of ratings, so lines change no AI
decision.

| League (hockey) | Who plays there                                                                  | NHLe factor                                                   | Games |
| --------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------- | ----- |
| Junior          | unsigned prospects up to the junior age (20), and signed ones under 20 sent back | 0.30 (the 2014 WHL figure)                                    | 68    |
| Europe          | unsigned prospects from Europe, and junior ones past the junior age              | 0.82 (the 2014 KHL figure: the strongest league, likely high) | 52    |
| Minors          | signed players sent to the team's farm team (job 4)                              | 0.45 (general knowledge, unsourced)                           | 72    |

The factors are starting values for the lab, never quoted as real until an updated table is in a
report. The game counts (CHL 68, a 52-game European league, AHL 72) and the goalies' save %
offsets by league are general knowledge or game numbers, unsourced.

**The minors: signed but off the roster.** A signed player can be sent to his team's farm team
and called back. He stays one of his team's players (contract, trades and re-signing all work as
now) with his league set (`Player.league`, absent for the main league). The lineup and every
roster count read only the players without one, so the 23-man limit can hold at last. The cap
counts a player in the minors at his cap hit above `cap.buriedRelief` ($1.225M, so an entry deal
counts nothing). A signed junior-age player from junior goes back to junior instead. A prospect
an AI team signs before he is ready starts on the farm team. AI teams send down whoever is over
23 (lowest read first), call up the best farm player at a position injuries leave short, and
send him back down when the injured player returns. Farm players get minors lines from job 2.

## Jobs (one PR each, in order)

1. **The prospect pool.** `LeagueState.prospects` (saved; a migration), `draft.rightsYears` in
   the ruleset, picks drafted into the pool with their league, development and the staff edge
   reaching the pool, the AI signing rule, rights running out to free agency, a team's own
   prospects as fill-ins before a generated player, a `prospect.sign` command, a Prospects list
   on the Roster screen (age, position, league, his team's read of his range, when the rights
   end) with a Sign button, the rights-ending To do; strings in `en.ts` and `fr.ts`. Few players
   20 or under will be left on rosters, so the rookie award moves to a player's first
   main-league season (aged 26 or under, the real limit, general knowledge), with today's age
   rule for players who joined before.
   _Done when:_ a test drafts a class into the pool with rights ending four summers on for an
   18-year-old and three for a 19-year-old, an AI team signs a ready prospect and lets an unready
   one walk when his rights end, and the human signs one with the command. A report-only lab
   line counts players 20 or under on rosters (69-78 a league today) and prospects a team. Lab
   before and after on seeds 1, 101 and 201 pasted in the PR, every long-run check in range or
   explained (the generator's `PROSPECT.potentialBase` is the drift knob it names).
2. **Lines.** The ratings-to-stats table, the hockey leagues with their factors and games (in
   `sports/hockey/`, behind a `SportModule` hook), lines for the pool when the regular season
   ends and for the draft class when it is announced, a save table of their own (one player can
   have a main-league and a lower-league line in the same season), the profile's career with a
   row per league, the last line on the Prospects list and the draft-year line on the draft
   board.
   _Done when:_ a test shows a better prospect outscoring a worse one on average, the same
   prospect scoring more in junior than in Europe, and the same seed giving the same lines; a
   report-only lab line (the best and the median junior points per game); the lab flat on seeds
   1, 101 and 201 (lines change nothing else).
3. **Prospects in trades.** Either side of a trade can include prospects; the value engine
   values one as the entry deal he would sign; an AI GM may add a prospect to balance a deal, as
   he adds a pick. The trade screen lists both teams' prospects.
   _Done when:_ a test values a prospect with a high read potential above a low one and a trade
   with one passes the same checks as any other; lab before and after on seeds 1, 101 and 201.
4. **The farm team.** `Player.league`, `cap.buriedRelief`, the junior-age rule, a `player.assign`
   command (send down, call up), the lineup and roster counts on main-league players only, the
   cap on buried hits, the AI send-down and injury call-up rules, minors lines; Send down and
   Call up on the Roster screen. The human's over-23 To do comes from the camp brief's job 1.
   _Done when:_ a test sends down an entry-level player (no cap charge) and a $2M one ($775K
   charged), sends a 19-year-old from junior back to junior, and has an AI team call up a centre
   while its centre is hurt and send him down when he is back; a new lab check, AI teams over 23
   at season start, at 0; lab before and after on seeds 1, 101 and 201.
   _Done._ The AI's summer counts (re-signing, bids, fill-ins) still include its farm players:
   on opening night everyone signed competes for the roster, so they count as candidates until
   then, and the 23-man limit holds from opening night. An injured player does not count against
   the limit, so his call-up fits; a call-up needs cap room before the cuts that follow it.

Not in scope: waivers (a player sent down is never claimed; a claim order, an AI claim rule and
the 24-hour window are a job of their own), the entry-level slide, college and its rights rule,
more draft rounds (still 2: the pool removes the ruleset's reason for 2, but more picks change
the talent supply and the pick value curve, so that is a balance job of its own), games,
standings or awards below the main league, the lower leagues' own players (only the draft class
and prospects a main-league team holds have lines), a development effect from the league or ice
time (no source measures one; the trained development model can add it), two-way pay,
emergency and post-deadline recalls, the 50-contract limit (unverified in the Sports GM
research), loans and undrafted European signings.
