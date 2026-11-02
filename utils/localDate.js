export function resolveTimezone(header) {
  if (!header || Array.isArray(header)) return 'UTC';
  try {
    Intl.DateTimeFormat(undefined, { timeZone: header });
    return header;
  } catch {
    return 'UTC';
  }
}

export function todayInTimezone(timeZone, now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

export function addDays(dateStr, days) {
  const [year, month, day] = dateStr.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
}

export function daysBetween(earlier, later) {
  const [y1, m1, d1] = earlier.split('-').map(Number);
  const [y2, m2, d2] = later.split('-').map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
}

/** Consecutive focus days ending today, or yesterday if today is still open. */
export function currentStreakFromDates(activeDates, today) {
  const active = new Set(activeDates);
  const yesterday = addDays(today, -1);
  let cursor = active.has(today) ? today : active.has(yesterday) ? yesterday : '';
  let streak = 0;
  while (cursor && active.has(cursor)) {
    streak += 1;
    cursor = addDays(cursor, -1);
  }
  return streak;
}

export function longestStreakFromDates(activeDates) {
  const sorted = [...new Set(activeDates)].sort();
  let best = 0;
  let run = 0;
  let previous = '';
  for (const date of sorted) {
    run = previous && daysBetween(previous, date) === 1 ? run + 1 : 1;
    if (run > best) best = run;
    previous = date;
  }
  return best;
}
