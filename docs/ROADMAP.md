# Roadmap

First roadmap for the GM game (NHL first). Full feature detail lives in
[FEATURE_SPEC.md](FEATURE_SPEC.md); architecture rules in [ARCHITECTURE.md](ARCHITECTURE.md).

**Goal of the first public release:** the full NHL game, Phase 1 and Phase 2 together: a
complete multi-season loop, polished (season, playoffs, draft, re-signing, free agency, next
season, for 20+ years without hitting a wall), plus the owner and finance layer, front office,
live draft and free-agency rooms, media, match viewer, cutscenes, sandbox and multiplayer.
Phase 3 (NBA, NFL) stays after release. Fewer features, each one finished.

Status: `[ ]` not started · `[~]` in progress · `[x]` done

## Next up (in order)

Ready jobs, each one PR. Pick from the top. Update this list in the PR that finishes a job.

Ready now (code can start):

1. Draft-room trades: the lottery is now drawn when the champion is crowned and round-one picks trade at their real slot (done); trading during the live draft (the Phase 2 draft room) done.
2. Contract bonuses and trade protection: done. Signing bonuses (CBA-capped share of the cap hit, liked by the player, never bought out) and no-trade clauses (ruleset age and per-team limit, trades refuse them). Performance bonuses done (first-round entry deals, paid at season end, overage on next season's cap). No-trade waivers done (ask a player to waive his clause for a trade; he answers by morale and personality).
3. Holdouts: done (opening day, greed and pay decide; a talk or the weeks end it). AI teams' core players hold out at half the human-team chance (about 4 a league-season); a win-now GM, or a good balanced one, extends him once his deal is in its last year and the raise fits next season's cap; a builder (or a weak balanced GM) puts him on the trade block for AI buyers.
4. Chemistry: personalities and leaders done (two settled leaders make the room whole; hot-headed, unprofessional players wear on it; lab flat). Builds fit done (a finisher with a creator on a line, an offensive with a home defenceman on a pair; mean-neutral, lab flat). Linemates done (games together by pair in the save; a line and pair that have played 20 games together gain up to a point, strangers lose one).
5. Re-injury risk: done (hurt earlier this season +30%, +3% per past injury, capped at 2x; injuries per team-season 7.9-8.1 to 8.2-8.5).
6. Player profile screen of its own and more face variety: done (open it from Leaders or the roster card).

Front office (also the lasting-team-edge fix): all jobs in
[research/2026-11-front-office.md](research/2026-11-front-office.md) done; the points % spread
gap narrowed (0.077-0.080 to 0.079-0.082); season form, a fresh team edge each season, takes it
to 0.085-0.087 on seeds 1, 101 and 201 (re-checked 2026-11-18; 201 is borderline) with r 0.46-0.48 and
playoff turnover 31-32% ([research/2026-11-spread-second-mechanism.md](research/2026-11-spread-second-mechanism.md)). League & events:
all five jobs of [research/2026-11-league-events.md](research/2026-11-league-events.md) done (the pulse ranks by playoff odds; a young team out of it rebuilds, an old bubble team with cap space buys; crisis on top).

Camp and a trade deadline that matters: both jobs of
[research/2026-11-camp-deadline.md](research/2026-11-camp-deadline.md) done (three weeks of camp;
the playoff run in rental value, daily talks in deadline week, a deadline recap, signings closed
after it).

Minor / junior / European leagues: brief in
[research/2026-11-minor-leagues.md](research/2026-11-minor-leagues.md); job 1, the prospect pool,
done (picks wait unsigned with their rights, AI GMs sign them when ready, the rookie award goes to
a first main-league season); job 2, lines, done (every prospect and the draft class get a season
in junior or Europe drawn from ratings at the sim's rates over an NHLe factor, with a career row
per league); job 3, prospects in trades, done (either side can include them, valued on the entry
deal each would sign; an AI buyer pays with one when no player or pick works); job 4, the farm
team, done (send down and call up, a buried hit counts only above the $1.225M relief, a junior
under 20 goes back to junior, AI teams cut to 23 on opening night and call up for injuries, minors
lines). All four jobs done.

Summer training, camp battles, international tournament: brief in
[research/2026-11-summer-training.md](research/2026-11-summer-training.md); summer training plans
and the international tournament are done; camp battles wait for the camp job above.

Free-agency bidding war and contract negotiation: all three jobs of
[research/2026-11-free-agency-bidding.md](research/2026-11-free-agency-bidding.md) done (the
bidding war, negotiation, the room and the pitch).

Needs a design first (a short brief in `docs/research/`, then jobs):

- Every other Phase 2 headline below.

## Queue (model · effort)

Work these in order; one PR each. Sonnet = UI or plumbing on existing engines, Opus = balance,
calibration or a new engine, Fable = the largest, least bounded jobs. Tick a line in its PR.

A. Leftovers (Sonnet 5.5, medium)

- [x] Assistant GM's return (delegation stays maybe)
- [ ] Steam Workshop for roster import (blocked: needs the real Steam App ID to test and publish)

B. Balance and calibration (Opus 5.5 unless noted)

- [x] Points % spread, seed 1 still short (high; compare seeds 1/101/201): in range on all three after the later merges, no tuning needed (years 10+ SD 0.097, 0.094, 0.097 on seeds 1/101/201 against 0.085-0.105, r 0.58, 0.57, 0.59; measured 2026-11-20 at 865bca1)
- [x] Lasting edges after the prospect pool (high; seeds 1/101/201): season form 4.5 and goalie sensitivity 0.0044 ([research](research/2026-11-spread-second-mechanism.md), 2026-11-20). On seeds 1/101/201/301/401, goalie SV% r went from 0.308-0.324 to 0.256-0.288 and turnover from 28.3-30.0% to 30.2-31.6%, both now in range on every seed; titles went from a 5.06 mean to 4.86 and best-of-7 years 10+ from 66.8% to 65.3%, and both are still just over on some seeds (titles 5.05/5.10 on 101/201, best-of-7 68.7% on 101 and 65.4% on 201), at about the seed noise
- [x] "Better team wins a best-of-7" back in range (high)
- [x] Trained stats-to-ratings and development models (xhigh, 2-3 PRs): stats to ratings v2 done (beats v1 on every key); development targets measured on NHL data (`ml/src/aging.py`, lab "Skater points/60 a year") and the aging curves fitted to them (all three age bands in range on seeds 1/101/201) done; penalty-kill time and penalty minutes in roster stats done (optional `pkToi` and `pim`, table v3 `specialTeams` fits: held-out forward `defense` R² 0.475 to 0.622, `physical` +0.03-0.04, no key worse; lab unchanged on seeds 1/101/201)
- [x] Playtest analysis (Sonnet 5.5, medium): `python3 -m ml.src.playtest <save>` reads a save's event log (no spec existed; the minimal analysis is in the script's docstring): user actions per season by kind, idle seasons, owner confidence start/end/low, frustrations, titles
- [x] Player traits and clustered builds (high; brief: [research/2026-11-player-traits.md](research/2026-11-player-traits.md); job 1: [clusters and trait evidence](research/2026-11-player-builds-evidence.md); job 2: skaters generated from the clusters, builds by nearest centre; job 3: play traits (net-front / perimeter, disciplined / undisciplined) from the id, on the player card, moving shot distance and who takes the penalty)

C. Design brief first, then jobs (Opus 5.5)

- [x] Minor / junior / European leagues (xhigh, 4-6 PRs)
- [x] Camp and a trade deadline that matters (high, 2-3 PRs)

D. Phase 2 headlines

- [x] Live draft room with trading (Opus, high, 3-4 PRs)
- [x] League news tab (Opus for storylines, Sonnet for UI; high; brief done: [research/2026-11-league-news.md](research/2026-11-league-news.md); the news tab, front-office faces and storylines done)
- [x] Free-agency bidding war and contract negotiation (Opus, xhigh; brief done: [research/2026-11-free-agency-bidding.md](research/2026-11-free-agency-bidding.md), jobs 1-3 done)
- [x] Media and press conferences, text (Sonnet, medium, 2-3 PRs)
- [~] Summer training, camp battles, international tournament (Opus, high, 3 PRs): brief, summer training plans and the international tournament done; camp battles wait for camp
- [x] Cutscenes (Sonnet, medium, 3 PRs)
- [ ] Match viewer (2D) with coach from the bench (Fable 5.2, xhigh, 6+ PRs)
- [x] League sandbox (Sonnet, high, 4 PRs)
- [x] Multiplayer step 1, hot-seat (Opus, high, 2 PRs)
- [ ] Multiplayer step 2, hosted online (Fable 5.2, max, 8+ PRs)

---

## Phase 0 — Foundation (now)

Builds the engines everything else depends on.

- [x] Monorepo, CI, Electron app shell, pure sim package, SQLite saves
- [x] Engine structure in `packages/sim` with lint-enforced boundaries
- [x] Multi-sport structure: shared engines + `SportModule` per sport (hockey only for now)
- [x] Model plug-in points (`Models`): goal, development, valuation
- [x] CBA ruleset as data (`sim/cba`): cap, contract rules, 84-game season
- [x] Data pipeline (`ml/`): NHL play-by-play and player seasons prototyped; junior/European, draft and contract inputs deferred past v0.1 (community rosters instead)
- [x] NHL-only held-out study done ([report](M1_PROTOTYPE_REPORT.md)); rating list v2 in code ([RATINGS.md](RATINGS.md)); `faceoffs` effect measured and calibrated (`ml/src/faceoffs.py`); M1 signed off on the NHL-only prototype
- [x] Hidden ratings (list v2) + stats-to-ratings model v1 (`ratingsFromStats`, fitted on the sim by `pnpm ratings:fit`, with uncertainty); a roster file can carry one season of stats instead of ratings and is rated from them on import
- [x] Line-by-line game sim (`sports/hockey/game.ts`) + "result only" mode; shot quality is a rules table behind `GoalModel` (`gm-xg-table`), tuned in the lab
- [x] Balance lab: league-health report (`pnpm lab`) with multi-year checks (talent drift, dynasties, cap, playoff turnover, goalie save % repeatability, faceoff effect, goals vs expected, points % spread and repeatability against real NHL seasons); green apart from the long-run known gaps it lists ([why](research/2026-11-long-run-spread.md))
- [x] Speed test in CI: day, season and year-20 budgets, plus year-20 screen data (standings, leaders, cap sheet)
- [x] Design system: tokens, team theming, Card, Button, PercentileBar, PlayerCard
- [x] Command layer + event log + single reducer (multiplayer-ready)
- [x] Translation-ready text (English + French)

## Phase 1 — v0.1 Early Access (the full loop)

Build order, owners and "done when" for each step: **[V0.1_PLAN.md](V0.1_PLAN.md)** (milestones M1–M9).

**Engines**

- [x] Players (`sim/players`): percentiles, builds (skaters by nearest real-player cluster, goalies by rule) and role tags, play traits (from the id, [brief](research/2026-11-player-traits.md)), injuries and injury history (shown on the player card), re-injury risk
- [x] Value (`sim/value`): per-team surplus value (can be negative), market value, pick value curve (rules-based, tuned in the lab)
- [x] People (`sim/people`): personalities (from the player id), free-agent priorities by age and personality, AI GM styles and skill, team plans, morale (shown on the player card; drives disputes, trade requests and no-trade waivers) done
- [~] Models and calibration (`ml/`, [ADR 0005](adr/0005-calibrate-first.md): ML only where a fit is needed): faceoff effect and goalie form measured on NHL data, stats-to-ratings v2 fitted on the sim (per-game and workload features, 120 leagues), development targets (aging by age band) measured on NHL data and the aging curves fitted to them, special-teams stats (PK time, penalty minutes) for stats to ratings done; playtest analysis done; "better team wins a best-of-7" back in range done
- [~] League & events (`sim/league`): calendar, team status (league pulse from playoff odds, roster age and cap space, crisis when a losing team's owner loses faith), event engine (trade requests, holdouts, disputes, breakouts in the summer and in season, AI owners' frustration, AI fire sales), news, a stop filter (saved with the league), a "talk extension" To do for your breakouts done
- [x] Minor / junior / European leagues: light stats-only sim for prospects (the prospect pool, lines in junior, Europe and the minors, prospects in trades, the farm team)

**Features**

- [x] Full season calendar: 84 games (divisions, conferences, back-to-backs) → playoffs → awards → draft → re-sign → FA done; camp done (three weeks before opening night: holdouts and the owner's meeting on its first day, the coach's camp report on its last); a trade deadline that matters done (rentals keep the playoff run's worth for buyers, AI talks daily in deadline week, offers expire at the deadline, a recap in the feed, free-agent signings closed after it except to fill a position minimum) (M6)
- [~] Trades v1: surplus value per team (status, rentals, negative contracts), anti-quantity, cap and position checks, AI explains itself, trade screen, AI-to-AI trades (both GMs must accept), retained salary, draft picks (next three drafts, value curve by projected slot) done, AI GMs pay with picks, trade block (listed players draw more AI offers; AI buyers call AI teams with listed players first, so fire-sale players move), top-N protected picks done
- [~] Contracts & cap: CBA checks, buyouts, cap sheet screen, cap advisor, offseason re-signing and in-season extensions, RFA rights with offer sheets the rights team can match, and compensation picks when it does not (NHL-style tiers by cap hit), done; signing bonuses, no-trade clauses and performance bonuses (overage carries to next season's cap) done
- [~] Free agency v1: free-agency window in the summer, offers with an interest meter (money, winning, role, term weighted by age), signings any time outside the playoffs, personalities (greed, ambition), AI offers, AI re-signing by loyalty and ambition, and loyalty (to his old team) and hometown pulls on the interest meter done
- [~] Draft v1: class announced after the playoffs with scouted potential ranges (AI sees the same ranges), your ranked list drives your picks, scout reports (best and weakest skills, ready or raw) done; lottery drawn before the draft so picks trade at their real slot done; the live draft room (Phase 2) done
- [x] Playoffs: bracket, NHL-style wild cards, honest momentum (per-game goalie form, calibrated), Playoff MVP, playoff cap; the cup is "Champion" until it is named
- [x] Awards, records, history (own award names, Playoff MVP included)
- [~] Living league: feed with names (trades, signings, extensions, long injuries, first pick), league pulse, playoff odds and power rating, sim until it matters (your team and league-wide moments only, with a stop filter on the sim bar), race nights (odds if you win or lose the next game), streak news, trade requests with a talk (personality decides), disputes over a role (an unhappy player, by his morale, kept down the lines asks for more: promise a role, ask for patience, or list him; a broken promise becomes a trade request), slump news (a top-6 skater 10 games without a point), breakout news (23 or younger, up 7+ overall in a summer), holdouts (underpaid, greedy core players; AI GMs extend or wait them out), the hot seat (coaches fired in-season and at the review; your owner warns you, then fires you at a review, and teams with a vacancy offer you a job), AI owners losing patience in the news (once a season per team), AI fire sales (best expiring players on the block, in the news) done
- [~] Chemistry: v1 from time together (visible on Lines, changes with every move, capped at ±1 rating point per unit) done; locker room (leaders and toxic personalities), builds fit and linemates done

**Screens**

- [~] Home hub: top strip (record, place, playoff odds, cap space, next game), To do that clears to zero, news, playoffs done (with a sim-to-date bar)
- [~] Roster & lines: roster screen with stats and player cards, Lines screen (your depth order sets lines, pairs and the starting goalie, used every game), drag-and-drop, PP/PK units and a goalie rotation rule (backup on back-to-backs, starter always but tired, or split) done
- [~] Player profile, stats & leaders, standings, team pages, game center: percentile player card, leaders, standings, game center done; career stats with totals, awards and moves history on the card, and a profile screen of its own, done
- [~] Generated faces: deterministic SVG face per player that greys and lines with age, on the player card; more variety (hair, facial hair, eyes, ears, scars) done; also on the roster, trade, draft, leaders and news-feed rows

**Rosters**

- [x] Fictional default league
- [~] Community roster import (versioned JSON, validated; ratings, or one season of stats to rate from) works; Steam Workshop remains for release prep

**Before launch**

- [ ] Partnership agreement (ownership, revenue split)
- [ ] Legal consult (licensing, company)
- [ ] Steam store page up early for wishlists; price; demo (Next Fest)

## Phase 2 — Part of the first release (one headline each)

- [x] Owner & finance: decision cards, pricing policy, fans, projects, owner meetings; owners and markets, the money ledger, fans and ticket pricing, confidence, meetings and cards, the Owner screen, projects and more cards, the head coach (salary, heat, AI firings in-season and at the review, the fire-or-keep card), and your job on the line (hot-seat warning, fired at a review, job offers, a "can be fired" option, AI GMs fired on confidence) (all 8 jobs in [the brief](research/2026-11-owner-finance.md))
- [~] Front office: scouting, analytics, medical, coaching, development staff. Department heads with a quality and a salary, coach quality in games, development staff (replacing GM skill), per-team draft reads, medical injury days, the staff market (leave, poaching, owner budgets), the Front Office screen with three candidates a season, tuned against the long-run benchmarks (all jobs of [the brief](research/2026-11-front-office.md); the price curve was tried and dropped), an assistant GM for human teams whose advice on Home (extend first, take or turn down an offer) is as accurate as his quality (the best-value free agent for your cap room, who would help on the top line, and a guess at a trade's answer), done; department returns (what each department added against an average one, on the Front Office screen) and firing a head without a replacement (an interim, severance) done; hired head coaches drawn from the owner-tilted market (coaching measured around the league's average coach) and medical scaling re-injury risk done; an analytics department (a fourth head; a weak one blurs what you see of other teams' players, a fixed amount per player, view only) done; his return (how far his read of your roster is off) done; delegation done (the one chore: with the Home toggle on, the assistant turns down the trade offers he advises against, on his read; taking an offer stays yours)
- [x] Live draft trade room: pick by pick, trade for any pick to come, AI teams trade up and call you on the clock, draft results with the picks that changed hands
- [x] League news tab, social-media style: a feed page of posts with the generated face of the player and of the AI GM (or coach, owner) in each one, built on the existing `news.posted` events and the news-feed faces. Storylines that run over weeks and seasons (a holdout becoming a trade, a breakout and his extension ask, a GM's fire sale, a contender clearing cap for a star, a rivalry, a coach on the hot seat), each told as a short thread of linked posts; generated GM faces; likes and follows only if they carry a use. Brief done: [research/2026-11-league-news.md](research/2026-11-league-news.md) (no likes or follows); the tab (All / Your team, insider and team accounts, a face on every post about a player, on Home too) done; front-office faces (AI GMs get a name; the fired coach, the GM leaving, the frustrated owner and the camp report post as themselves; owner, coach and GM faces on the team page) done; storylines (`storyOf` threads a holdout, a trade request, a breakout, a fire sale, an owner losing patience, a contender clearing room and a rivalry from the log on read; an AI GM shopping his holdout says so himself; a rematch of last season's playoff series is a rivalry renewed) done.
- [x] Free-agency live bidding war + full contract negotiation ([brief](research/2026-11-free-agency-bidding.md): the bidding war and negotiation (a hidden line by greed, his agent's counter, patience by temperament, re-signing through the meter) done; the room (the market board on the Free Agency screen: who is bidding, the leading interest, days to his decision, your standing, and the day's signings and raises) and the pitch (an offer can promise the top role at his position, 100 on the meter; not first at it a month into his first season, he opens a dispute) done)
- [x] Media & press conferences (text)
- [ ] Match viewer (2D) + coach from the bench
- [x] Cutscenes (trophy lift, draft pick, signing): trophy lift (a skippable full-screen Cup lift when your team wins, once per title) done; draft pick (a skippable cutscene when one of your picks lands during the session) done; signing (a skippable cutscene when you sign a free agent) done
- [~] Summer training, camp battles, international tournament: summer training plans (a focus per player on a human team reshapes his ratings at development, never past his ceiling) done; an international tournament every four years (a nation per player, six nations, two groups of three, semi-finals and a final, late in the summer on its own random stream; the champion and top scorer on History, your players' medals in your news) done
- [~] Hall of Fame, legends return as staff, awards named after legends: Hall of Fame (rule-based induction, History screen), awards named after legends (the first inducted goalie, defenceman and forward lend their surname to the goalie, defence and MVP awards from the next season, on History) and legends as staff (a Hall of Famer is one of a human team's candidates, one a team-season) done
- [x] League sandbox: expansion, relocation, identity editor, commissioner mode: identity editor (rename any team's city, name and abbreviation from its team page) and relocation (a franchise moves to a new city, name and market size from its team page; its fans cool) and expansion (once free agency is open a new team joins the smallest division and takes unprotected players from the others in an expansion draft; the ruleset sets the size limit, protected count and picks) and commissioner mode (move a player to any team or to free agency from his page, whatever the cap and trade rules say) done
- [x] Multiplayer step 1: shared save (hot-seat): several human GMs in one save (add a GM for another team from Home, the GM at the controls picked in the sidebar, every screen follows his team), turn hand-over (a curtain the next GM lifts himself), trades between human GMs needing both (sent as an offer the other GM answers from his seat) and each GM seeing through his own analytics department, done
- [ ] Multiplayer step 2: hosted online league over Steam

## Phase 3 — Long term

- [ ] NBA, then NFL, on the same engines
- [ ] Multi-sport ownership empire
- [ ] Always-on online leagues (only if players ask)

---

## Open decisions

Research behind these: [docs/research/2026-11-sports-gm-research.md](research/2026-11-sports-gm-research.md).

- [ ] **Data licensing (before launch):** NHL API and MoneyPuck are non-commercial;
      Hockey-Reference and Elite Prospects ban model training. Since [ADR 0005](adr/0005-calibrate-first.md) the only model
      trained on real data is development; everything else uses real data only for lab targets. Confirm with the lawyer that this
      use is fine, or ask the NHL and MoneyPuck for permission.
- [ ] **Incorporate and see a lawyer before any revenue** (Quebec image rights are strict;
      ship a fully fictional league; never host real-player or logo files).
- [ ] Pricing: research suggests $19.99 in Early Access, $24.99-29.99 at 1.0.

- [ ] Build order and who owns which engine
- [ ] Game name and championship cup name
- [x] Contract negotiation design ([brief](research/2026-11-free-agency-bidding.md))
- [ ] Steam launch plan: Early Access timing, price, demo, roadmap page
