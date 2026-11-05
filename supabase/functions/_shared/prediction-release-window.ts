type MatchWindow = {
  prediction_opened_at?: string | null;
  prediction_opened_on?: string | null;
};

// The SQL guard enforces the same window on every write. Midnight is computed
// in the tournament timezone, including non-Brazilian tournaments.
export function releasedPredictionWindow(match: MatchWindow, day: string, scheduledAt: string, timezone: string) {
  if (!match.prediction_opened_at || match.prediction_opened_on !== day) return null;
  const nextDay = new Date(`${day}T00:00:00Z`);
  if (!Number.isFinite(nextDay.getTime())) return null;
  nextDay.setUTCDate(nextDay.getUTCDate() + 1);
  const utcMidnight = nextDay.getTime();
  let end = utcMidnight;
  for (let i = 0; i < 3; i++) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
    }).formatToParts(end);
    const p = Object.fromEntries(parts.map(part => [part.type, part.value]));
    const local = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second));
    end += utcMidnight - local;
  }
  const exact = Date.parse(scheduledAt);
  return {
    scheduledAt,
    opensAt: match.prediction_opened_at,
    closesAt: new Date(Number.isFinite(exact) ? Math.min(exact, end) : end).toISOString(),
  };
}
