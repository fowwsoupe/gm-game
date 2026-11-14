import { writeFileSync } from 'node:fs';
import { defaultContext, exportHockeyRoster, Rng, START_SEASON } from '@gm/sim';

/**
 * Writes rosters/fictional-template.json: a full fictional league in roster-file format.
 * Community roster makers copy it and replace names and ratings.
 * Run: pnpm roster:template
 */
const league = defaultContext().sport.generateLeague(new Rng(2027).fork('league'));
const file = exportHockeyRoster(league, {
  season: START_SEASON,
  name: 'Fictional league (template)',
  author: 'GM Game',
});
const out = new URL('../../../rosters/fictional-template.json', import.meta.url);
writeFileSync(out, JSON.stringify(file, null, 2) + '\n');
console.log(`Wrote ${file.teams.length} teams, ${file.players.length} players to ${out.pathname}`);
