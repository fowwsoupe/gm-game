/** Deterministic, sortable event id: season, day, then a sequence within the day. */
export function eventId(season: number, day: number, seq: number): string {
  return `ev_${season}_${String(day).padStart(3, '0')}_${String(seq).padStart(4, '0')}`;
}
