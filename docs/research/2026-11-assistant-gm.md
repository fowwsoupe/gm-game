# Assistant GM: design (2026-11)

The last staff role the [front office brief](2026-11-front-office.md) left open ("an assistant
GM waits until this is in: it changes what the human sees, not outcomes"). FEATURE_SPEC lists him
under Front office. This report says what he does for the human in this game and how his
quality matters. No public source measures what a real assistant GM is worth; every number here
is a game number, unverified.

## What exists today

- Home's To do (`sim/src/dashboard.ts`): every item comes from the rules (re-signings after the
  final, trade offers waiting, trade requests, disputes, holdouts, injuries, short positions,
  over the cap, the deadline). It says what needs a decision, not what to decide.
- Trade offers (`trades/ai.ts`, `aiOffers`): an AI GM offers one of his players for one of yours,
  built so he wins the trade as he reads the players. Whether you win it is the question.
- Re-signing (`offseason/resign.ts`): a flat ask per expiring player; after the final it is now
  or never, and cap room rarely covers everyone.
- Free agency (`offseason/signing.ts`), lines (the Lines screen) and the draft (scouting already
  narrows the human's range) have their own screens.
- Player ratings are hidden from the human. An AI GM sees players through his misread
  (`people/gm.ts`, `seenBy`): SD from 1 rating point (skill 1) to 6 (skill 0), fixed per GM and
  player.

## What he does

He advises; the human still decides everything. His advice sits on Home's To do, next to the
item it is about, so it costs no new screen:

| When                         | Advice                                       | His read                                          |
| ---------------------------- | -------------------------------------------- | ------------------------------------------------- |
| Re-signings open (the final) | "Extend {player} first"                      | the expiring player he rates best (overall)       |
| A trade offer waits          | "Take {give} for {get}" or "Turn down ..."   | surplus value in against out, the value engine    |
| Free agency (later)          | "Best value for your cap room: {player}"     | surplus value at the ask, within cap room         |
| Lines (done)                 | "{player} would help on the top line"        | the lines engine on his read                      |
| A trade you build            | "They will likely say no" before you propose | the other team's answer on his read of your offer |

## How his quality matters

He is a department head like the others (`StaffProfile`: name, quality, hired, salary), hired
from the Front Office screen with three candidates a season, paid from `frontOffice.salary`
in `costs.staff`, and he leaves or is hired away in the summer like the others.

His quality is how well he reads players, on the same scale as an AI GM's misread: SD
1 + (1 - quality) x 5 rating points, fixed per assistant and player, so a poor one keeps being
wrong about the same players until you replace him. In a league of fictional players with
hidden ratings that is the whole job: an elite assistant's advice is nearly always right; a
poor one's is right on the obvious calls and a coin flip on the close ones (the test: across
625 one-for-one offers, elite 97% right, poor 84%).

## AI teams have none

An AI GM decides on his own read; an assistant would change nothing he does. Giving AI teams
one would only add a salary to their ledgers (moving the lab's money lines) and add draws to
the staff market. So the assistant is a department of human teams only
(`departmentsOf(team)`); AI teams' numbers do not change.

## Jobs

1. **Advice on Home (this PR).** The assistant GM as a fourth department for human teams
   (salary, market, Front Office screen); "extend first" on re-signings and take or turn down
   on each trade offer, as accurate as his quality.
   _Done when:_ a test shows an elite assistant right more often than a poor one; the lab is
   unchanged (no AI team has one).
2. **Free agency and your own trades.** The best value signing for your cap room (done: the
   free agent with the most surplus on a deal at his ask that fits, on his read); his guess at
   the other team's answer before you propose (done: the trade screen shows it, the same evaluation on his read of every player). Lines advice is done: once you set your own
   order, the bench player who beats a top-line player of his position on his read.
3. **His return (done).** How far his read of your players' overall is off the truth, on average,
   on the Front Office screen with the other department returns, so a poor one shows himself.
4. **Delegation (done for offers: the toggle on Home turns down what he advises against; filling positions and lines still maybe).** Let him handle chores you opt into (fill a short position with the
   cheapest legal signing, set lines after injuries), on his read.
