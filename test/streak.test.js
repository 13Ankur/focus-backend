import test from 'node:test';
import assert from 'node:assert/strict';
import { addDays, currentStreakFromDates, daysBetween, longestStreakFromDates } from '../utils/localDate.js';

test('a completed day today starts a 1-day streak', () => {
  assert.equal(currentStreakFromDates(['2026-11-02'], '2026-11-02'), 1);
});

test('yesterday still counts until today is missed', () => {
  assert.equal(currentStreakFromDates(['2026-11-01', '2026-10-31'], '2026-11-02'), 2);
});

test('a gap before yesterday clears the streak', () => {
  assert.equal(currentStreakFromDates(['2026-10-12'], '2026-11-02'), 0);
});

test('today continues a run and ignores an older gap', () => {
  assert.equal(currentStreakFromDates(['2026-10-01', '2026-11-01', '2026-11-02'], '2026-11-02'), 2);
});

test('longest run is kept separately from the current streak', () => {
  assert.equal(longestStreakFromDates(['2026-10-01', '2026-10-02', '2026-10-03', '2026-11-02']), 3);
  assert.equal(daysBetween('2026-11-01', '2026-11-02'), 1);
  assert.equal(addDays('2026-11-02', -1), '2026-11-01');
});
