/**
 * Seeded random number generator (mulberry32). Every random event in the sim
 * goes through an Rng, so the same seed + same state always gives the same result.
 * That makes bugs reproducible and lets you test balance changes fairly.
 *
 * Store `rng.state` in the save file to resume exactly where you left off.
 */
export class Rng {
  state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  /** Float in [0, 1). */
  next(): number {
    let t = (this.state = (this.state + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Integer in [min, max], inclusive. */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  /** Normally distributed number (Box-Muller). */
  normal(mean = 0, sd = 1): number {
    const u = 1 - this.next(); // (0, 1]: log(0) is impossible
    return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * this.next());
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error('pick from empty array');
    return items[Math.floor(this.next() * items.length)] as T;
  }

  /** A shuffled copy (Fisher-Yates). */
  shuffle<T>(items: readonly T[]): T[] {
    const a = [...items];
    for (let i = a.length - 1; i > 0; i--) {
      const j = this.int(0, i);
      [a[i], a[j]] = [a[j]!, a[i]!];
    }
    return a;
  }

  /** Independent child stream, so adding randomness in one system doesn't shift another. */
  fork(label: string): Rng {
    let h = this.state ^ 0x9e3779b9;
    for (let i = 0; i < label.length; i++) h = Math.imul(h ^ label.charCodeAt(i), 0x01000193);
    return new Rng(h >>> 0);
  }
}
