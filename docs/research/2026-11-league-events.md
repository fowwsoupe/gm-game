# League & events: design brief (2026-11)

The `sim/league` row of the engine table (calendar, team status, event engine, news). Most of it
already ships, spread over `advance.ts`, `sim/people` and `sim/owner`. This brief lists what is
left against FEATURE_SPEC's "Living league" section and splits it into small jobs. No new
"event engine" framework: each event keeps the pattern trade requests, holdouts and owner cards
already use (a start event, a talk or answer command, personality decides, news).

## What exists today

| Spec item            | Status                                                                                                                                              |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Calendar             | done (84 games, phases, playoffs, offseason)                                                                                                        |
| League pulse         | rule on points share alone (`league/status.ts`); `crisis` is a status no rule ever sets                                                             |
| Feed and news        | done (`news.posted` and the events behind it: trades, signings, long injuries, firings, streaks, slumps)                                            |
| Player events        | trade requests, holdouts and slumps done; disputes and breakouts missing                                                                            |
| Team events          | coach on the hot seat and the human's frustrated owner done (`sim/owner`); AI owners' frustration and AI fire sales are silent                      |
| Sim until it matters | stops on major moments, your series and trades, offers, and long injuries (`advance.ts`, `matters`); `stopOn` is only `never` or `major`, no filter |

## Jobs (one PR each, in order)

1. **A fuller league pulse.** `classifyTeams` reads playoff odds (already computed for the race
   nights), roster age and cap space, not only the points table, and sets `crisis`: a team
   with odds under 10% whose owner confidence is under the warning line, or that has lost 8 of
   its last 10. Status changes keep their `team.statusChanged` event and news.
   _Done when:_ a test league shows every status at the deadline, AI trade checks stay in range
   in the lab (statuses drive buyers and sellers), and the feed names teams entering crisis.
2. **Breakouts.** A player aged 23 or under who gains 5+ overall in one summer, or scores at a
   pace 50% above last season after 20 games, makes news; for your team it is a "talk extension
   now?" To do item (extension price rises with the breakout).
   _Done when:_ a test shows breakout news after a big summer jump and none for a veteran;
   about 1-3 a league-season in the lab (report only, unverified).
3. **Disputes.** A player whose role (ice time against his rating rank on the team) sits two
   lines below where he expects for 15 games, with low morale, asks for more ice time. A talk
   command (promise a role, ask for patience, put him on the block) and personality decide;
   a broken promise turns it into a trade request. AI teams settle them silently.
   _Done when:_ a test raises and settles one each way through commands; the lab's trade
   request rate stays in range.
4. **AI team events in the feed.** AI owners' confidence under the warning line posts "owner
   frustrated" news once a season; an AI seller in crisis at the deadline runs a fire sale
   (lists its top three players on expiring deals on the trade block, which AI trades already
   read) with news.
   _Done when:_ the lab shows a few fire sales a league-season and AI trade counts stay in range.
5. **A stop filter you control.** `stopOn` becomes a set of categories (your injuries, your
   offers, your players' events, league moves, milestones) saved in league options and set on
   the sim bar.
   _Done when:_ a test sims a month with each category on and off and stops exactly on those
   events; strings in `en.ts` and `fr.ts`.

Media questions after big moments are the media headline's, not this engine's. Minor and junior
leagues stay a separate brief.
