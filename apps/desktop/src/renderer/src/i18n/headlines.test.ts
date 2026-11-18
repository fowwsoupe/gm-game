import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { en } from './en';
import { fr } from './fr';

const SIM = join(__dirname, '../../../../../../packages/sim/src');

/**
 * Every `event.*` key in the sim's sources: written as a literal, or built as `event.${h.key}`
 * from a game highlight (`{ key: 'hatTrick', playerId, ... }`, see advance.ts).
 */
function simKeys(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((f) => {
    const path = join(dir, f.name);
    if (f.isDirectory()) return simKeys(path);
    if (!f.name.endsWith('.ts') || f.name.endsWith('.test.ts')) return [];
    const src = readFileSync(path, 'utf8');
    return [
      ...[...src.matchAll(/'(event\.[a-zA-Z]+)'/g)].map((m) => m[1]!),
      ...[...src.matchAll(/\{ key: '([a-zA-Z]+)', playerId/g)].map((m) => `event.${m[1]}`),
    ];
  });
}

describe('news headlines', () => {
  it('every headline the sim posts has English and French text', () => {
    const keys = [...new Set(simKeys(SIM))];
    expect(keys.length).toBeGreaterThan(5);
    expect(keys).toEqual(expect.arrayContaining(['event.hatTrick', 'event.shutout']));
    for (const key of keys) {
      expect(en, key).toHaveProperty([key]);
      expect(fr, key).toHaveProperty([key]);
    }
  });
});
