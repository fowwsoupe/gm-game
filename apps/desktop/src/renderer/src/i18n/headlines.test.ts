import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { en } from './en';
import { fr } from './fr';

const SIM = join(__dirname, '../../../../../../packages/sim/src');

/** Every `event.*` key written as a literal in the sim's sources (news headlines, highlight keys). */
function simKeys(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((f) => {
    const path = join(dir, f.name);
    if (f.isDirectory()) return simKeys(path);
    if (!f.name.endsWith('.ts') || f.name.endsWith('.test.ts')) return [];
    return [...readFileSync(path, 'utf8').matchAll(/'(event\.[a-zA-Z]+)'/g)].map((m) => m[1]!);
  });
}

describe('news headlines', () => {
  it('every headline the sim posts has English and French text', () => {
    const keys = [...new Set(simKeys(SIM))];
    expect(keys.length).toBeGreaterThan(5);
    for (const key of keys) {
      expect(en, key).toHaveProperty([key]);
      expect(fr, key).toHaveProperty([key]);
    }
  });
});
