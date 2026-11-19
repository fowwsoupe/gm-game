# League news tab: design brief (2026-11)

The Phase 2 headline "League news tab, social-media style" (ROADMAP, Living league). The feed
already exists: Home's feed card turns the newest events into lines (`describe` in
`screens/Home.tsx`), with a generated face when the event names one player. This brief says
what a tab of its own adds, what the storylines are, and splits it into three jobs. No new
event framework and no new table: posts are the events already in the log, threads are worked
out from them on read.

## What exists today

| Piece         | Status                                                                                                                                                                                                          |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Feed query    | `feed.list({ limit, minImportance })`: newest events from the `events` table, with names and ages of the players they name (`playerId`, or the drafted player)                                                  |
| Feed text     | `describe` in Home's `FeedCard`, one line per event kind, `news.posted` through its `headline` key and `params`; Home shows 10 lines at `notable` and up                                                        |
| `news.posted` | `headline`, `body`, `params` only: no player, so a breakout, slump, holdout standoff or award line gets no face (the card's own comment says so)                                                                |
| Faces         | `ui/Face.tsx`: seeded by a string, ages by a number; on the player card, roster, trade, draft, leaders and feed rows. Only players have one                                                                     |
| People        | head coach and department heads have a `name` (`CoachProfile`, `StaffProfile`); owners are derived from the team id (`ownerOf`); an AI GM is `style` and `skill`, no name                                       |
| Story moments | holdouts, trade requests, disputes, breakouts (and the extension ask), slumps, fire sales, AI owners' frustration, coaches and GMs fired, contenders making room, deadline recap all post news, each on its own |
| Minor news    | the fire sale is `minor`, so Home never shows it (game finals are `minor` too, which is why the feed reads at `notable`)                                                                                        |

So the league already says a lot, but as loose one-liners: nothing connects a holdout to the
trade that ends it, the people speaking have no face, and Home's ten lines are the only place
to read any of it.

## Design

**A post is an event the feed already describes.** The tab lists the same lines as Home's
card, as posts: an author (face, name, a handle), the date, the text. The `describe` switch
moves out of `Home.tsx` into one renderer module both screens use. Authors by default:
league events come from a league insider account (one fixed name and face); a team's own
moves (signings, extensions, the draft pick) from the team account (the team's colours, no
face). Two tabs: All, Your team (posts whose `teamIds` include a human team). The tab loads
300 events at `notable` (Home keeps 10); minor news the tab should show (the fire sale) moves
to `notable`, after checking the sim bar's stop filter does not start stopping on it.

**Every post names who it is about.** `news.posted` gains `playerId?` (the player the line is
about), set by every emitter that has a `player` param. The feed query already collects
`playerId`, so names, ages and faces follow with no other change, on Home too.

**People get faces.** An AI GM gets a `name`, drawn from the name pools when he is hired
(`team.gmChanged`) and, absent in old saves, derived from the team id like a coach's quality.
A post spoken by a person carries `by?: { role: 'gm' | 'coach' | 'owner'; name: string }`
(the name kept on the post, so a fired coach's last word keeps his face). The face is seeded
by the role and name; the age the face needs is a stable 40-70 from a hash of the name, not
stored (no birth year for staff, and nothing else reads it). The post's team colours come from
`teamIds[0]`.

**Storylines are threads worked out on read.** A story is a key (`holdout:<player>:<season>`,
`request:<player>`, `breakout:<player>:<season>`, `fireSale:<team>:<season>`,
`hotSeat:<team>:<season>`, `room:<team>:<season>`, `rivals:<a>:<b>`) and a set of rules: which
event opens it and which events continue or close it. A pure `storyOf(events)` in `sim/league`
(no state, tested on its own) maps a window of the log to `{ eventId: storyKey }`; `feed.list`
returns that map with the events. The tab shows each story once, at its newest post, with the
earlier posts above it as a short thread (oldest first, three shown, "n more" opens the rest).
A story opened before the loaded window shows only what is loaded. No story state is saved,
so no migration, and old saves thread their past too.

| Story                   | Opens on                                                           | Continues or closes on                                                                                               |
| ----------------------- | ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| Holdout to trade        | `player.holdoutStarted`                                            | the GM's answer (new post), `event.holdoutStands`, `holdoutEnded`, `contract.extended`, a `trade.completed` with him |
| Trade request           | `player.tradeRequested`                                            | `event.requestStands`, `event.noTradeRefused`, `tradeRequestEnded`, a `trade.completed` with him                     |
| Breakout and his ask    | `event.breakout`, `event.breakoutPace`                             | the extension ask or the AI GM's answer (new post), `contract.extended`, `contract.expired`                          |
| Fire sale               | `event.fireSale`                                                   | each `trade.completed` that season sending one of the listed players away                                            |
| Clearing cap for a star | `event.madeRoom`                                                   | the `player.signed` that follows it that summer, or `event.lostFreeAgent`                                            |
| Coach on the hot seat   | `event.ownerFrustrated` (AI) or the human's owner warning          | the owner's word (new post), `event.coachFired`, `event.gmFired`                                                     |
| Rivalry                 | a playoff series between two teams that also met the season before | each later series or regular-season game between them that the engine posts (new)                                    |

**New beats are the engine's work.** Most of a thread is events that exist; the gaps are the
people's answers. An AI GM answers a holdout or a trade request with the decision the engine
already makes (`aiHoldouts` extends or waits him out; a request is shopped or refused), posted
`by` the GM. An AI GM with a breakout on an expiring deal says whether he will extend him (the
extension engine decides, the post reports it). An AI owner whose confidence falls under the
warning line posts his word `by` the owner before any firing. A rematch of last season's
playoff series posts "a rivalry renewed" when it starts; last season's pairs are kept like
`seasonTrades` (a small list in the state and the save, replaced at each `series.started` of a
new playoffs). The posts report decisions the sim already makes: no rule, rating or AI choice
changes, so the lab stays flat.

**No likes, no follows.** Nothing in the sim would read a like, so it carries no use. A follow's
one use would be a filter, and Your team plus the sim bar's stop filter already cover the
players a human cares about; add follows when a playtest asks for them.

## Jobs (one PR each, in order)

1. **The news tab** (Sonnet, UI). `news.posted.playerId` in `packages/shared` and set by every
   emitter with a `player` param; `describe` moved into a renderer module shared with Home; the
   `news` screen in the nav with post cards (insider and team accounts, player faces), the All /
   Your team tabs, 300 events at `notable`; the fire sale at `notable`; strings in `en.ts` and
   `fr.ts`.
   _Done when:_ a sim test checks every `news.posted` with a `player` param carries `playerId`;
   the tab lists Home's lines and more, a breakout post shows his face on Home too; the lab is
   unchanged (news only).
2. **Faces for the front office** (Sonnet). `GmProfile.name` drawn at `team.gmChanged` and
   derived from the team id when absent; `news.posted.by`; the coach-fired, GM-fired, owner
   frustrated and camp report posts carry it; GM, coach and owner faces on posts and on the
   team page's front office rows.
   _Done when:_ a test gives a new GM a name and an old save's GM a stable one; a coach-fired
   post keeps the fired coach's name after the hire; a replay draws the same names; the lab is
   flat on seeds 1, 101 and 201 (a name draw moves the rng stream of the hire, nothing else).
3. **Storylines** (Opus, engine). `storyOf` in `sim/league` with the table's rules; `stories`
   on `feed.list`; the new beats (the AI GM's answer to a holdout, a request and a breakout's
   ask; the AI owner's word; the rivalry renewed, with last season's pairs in the state and
   the save); threads on the tab (en, fr).
   _Done when:_ a test runs a holdout that ends in a trade and gets one story of at least three
   posts with the GM's answer among them, a fire sale threads its trades, and a rematch posts a
   rivalry; `storyOf` gives the same keys on a replay; the lab is flat on seeds 1, 101 and 201,
   before and after pasted in the PR.

Not in scope: fan replies and reactions, player quotes and press clippings (the media headline
already asks questions after big moments), a league insider who leaks rumours before a trade,
images other than generated faces, push notifications, NBA and NFL feeds (the post card and
`storyOf` are sport-neutral; a sport adds its own stories later).
