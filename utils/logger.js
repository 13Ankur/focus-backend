/**
 * One-line JSON logs for payment, auth, and server failures.
 * Hostinger's log viewer can be filtered by "event".
 */
export function log(level, event, fields = {}) {
  const entry = {
    time: new Date().toISOString(),
    level,
    event,
    ...fields,
  };
  const line = JSON.stringify(entry);
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}
