import { usePv } from './store';

export type Cue = 'horn' | 'buzz' | 'hum';

/** Sound hook. Off by default; the mute toggle in the preview bar flips it.
 *  ponytail: logs only. Wire real samples (arena hum, goal horn, phone buzz in free agency) here later. */
export function cue(name: Cue): void {
  if (!usePv.getState().sound) return;
  console.debug(`[preview sound] ${name}`);
}
