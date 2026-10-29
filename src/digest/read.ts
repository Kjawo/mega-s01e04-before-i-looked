import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DigestRow, ReadNight, RunEvent, StatusCounts } from './types.js';

function isNight(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function isTimestamp(value: unknown): value is string {
  return typeof value === 'string'
    && value.trim() === value
    && /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(value)
    && isNight(value.slice(0, 10));
}

function isEvent(value: unknown): value is RunEvent {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const event = value as Record<string, unknown>;
  return isTimestamp(event.at)
    && typeof event.job === 'string'
    && (event.status === 'ok' || event.status === 'retry' || event.status === 'fail')
    && (event.owner === null || typeof event.owner === 'string')
    && (!Object.hasOwn(event, 'error') || typeof event.error === 'string');
}

/** Parse at the boundary; only validated events reach aggregation. */
function parseEvent(line: string): RunEvent | null {
  try {
    const value: unknown = JSON.parse(line);
    return isEvent(value) ? value : null;
  } catch {
    return null;
  }
}

export const readNight: ReadNight = (runsDir, night) => {
  if (!isNight(night)) return null;

  let source: string;
  try {
    source = readFileSync(join(runsDir, `${night}.jsonl`), 'utf8');
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
    throw error;
  }

  const lines = source === '' ? [] : source.split(/\r?\n/);
  if (source.endsWith('\n')) lines.pop();
  const rows = new Map<string, DigestRow>();
  const counts: StatusCounts = { ok: 0, retry: 0, fail: 0 };
  let badLines = 0;

  for (const line of lines) {
    const event = parseEvent(line);
    if (!event) {
      badLines++;
      continue;
    }

    counts[event.status]++;
    const row = rows.get(event.job) ?? {
      job: event.job,
      owner: event.owner,
      runs: 0,
      retries: 0,
      failures: 0,
      lastStatus: event.status,
      lastError: null,
      firstAt: event.at,
      lastAt: event.at,
    };
    row.owner = event.owner;
    row.runs++;
    if (event.status === 'retry') row.retries++;
    if (event.status === 'fail') row.failures++;
    row.lastStatus = event.status;
    if (event.error !== undefined) row.lastError = event.error;
    row.lastAt = event.at;
    rows.set(event.job, row);
  }

  return {
    night,
    counts,
    badLines,
    rows: [...rows.values()].sort((a, b) => a.job < b.job ? -1 : a.job > b.job ? 1 : 0),
  };
};
