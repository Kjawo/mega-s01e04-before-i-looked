import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { readNight } from '../src/digest/read.js';

const night = '2026-10-28';
const base = { at: '2026-10-28T23:00:02+01:00', job: 'job', owner: 'rook', status: 'ok' };
const tempDirs: string[] = [];

function fixture(text: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'rig-reader-'));
  tempDirs.push(dir);
  writeFileSync(join(dir, `${night}.jsonl`), text);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('readNight', () => {
  it('reads the unchanged real night with independent expected rows and event totals', () => {
    const runs = new URL('../runs/', import.meta.url);
    const file = new URL(`${night}.jsonl`, runs);
    const hash = () => createHash('sha256').update(readFileSync(file)).digest('hex');
    const before = hash();
    const digest = readNight(fileURLToPath(runs), night);
    expect(digest).toEqual({
      night, counts: { ok: 10, retry: 4, fail: 1 }, badLines: 1,
      rows: [
        { job: 'digest/render', owner: null, runs: 1, retries: 0, failures: 0, lastStatus: 'ok', lastError: null, firstAt: '2026-10-29T05:41:09+01:00', lastAt: '2026-10-29T05:41:09+01:00' },
        { job: 'fixtures/refresh', owner: 'rook', runs: 4, retries: 3, failures: 0, lastStatus: 'ok', lastError: 'upstream 503', firstAt: '2026-10-29T01:30:00+01:00', lastAt: '2026-10-29T01:37:00+01:00' },
        { job: 'lane/sync', owner: 'rook', runs: 8, retries: 1, failures: 0, lastStatus: 'ok', lastError: 'lock held', firstAt: '2026-10-28T23:00:06+01:00', lastAt: '2026-10-29T05:00:04+01:00' },
        { job: 'notes/backup', owner: 'lane-07', runs: 1, retries: 0, failures: 1, lastStatus: 'fail', lastError: 'quota exceeded', firstAt: '2026-10-29T04:00:01+01:00', lastAt: '2026-10-29T04:00:01+01:00' },
        { job: 'rig/rotate-logs', owner: 'lane-07', runs: 1, retries: 0, failures: 0, lastStatus: 'ok', lastError: null, firstAt: '2026-10-28T23:00:02+01:00', lastAt: '2026-10-28T23:00:02+01:00' },
      ],
    });
    expect(hash()).toBe(before);
  });

  it('keeps file order, latest owner including null, recovered failures and latest supplied error', () => {
    const records = [
      { ...base, status: 'fail', error: 'first failure' },
      { ...base, at: '2026-10-28T20:00:00.125-04:30', status: 'retry', error: 'new error' },
      { ...base, at: '2026-10-28T19:00:00Z', owner: null },
    ];
    const result = readNight(fixture(records.map(record => JSON.stringify(record)).join('\r\n')), night);
    expect(result).toEqual({
      night, counts: { ok: 1, retry: 1, fail: 1 }, badLines: 0,
      rows: [{ job: 'job', owner: null, runs: 3, retries: 1, failures: 1, lastStatus: 'ok', lastError: 'new error', firstAt: base.at, lastAt: '2026-10-28T19:00:00Z' }],
    });
  });

  it('keeps a supplied empty error string', () => {
    const text = [{ ...base, error: 'old' }, { ...base, error: '' }, base].map(record => JSON.stringify(record)).join('\n');
    expect(readNight(fixture(text), night)?.rows[0].lastError).toBe('');
  });

  it('handles prototype-like names and sorts with JavaScript string comparison', () => {
    const jobs = ['é', 'toString', '__proto__', 'a', 'constructor', 'Z'];
    const text = [...jobs, '__proto__'].map(job => JSON.stringify({ ...base, job })).join('\n');
    const result = readNight(fixture(text), night);
    expect(result?.rows.map(row => row.job)).toEqual(['Z', '__proto__', 'a', 'constructor', 'toString', 'é']);
    expect(result?.rows.find(row => row.job === '__proto__')?.runs).toBe(2);
    expect(result?.counts).toEqual({ ok: 7, retry: 0, fail: 0 });
  });

  it('counts invalid JSON, field types, missing fields and timestamps without dropping subsequent events', () => {
    const invalid: unknown[] = [
      null, [], 42, 'text', {},
      { ...base, job: null }, { ...base, status: 'pending' }, { ...base, owner: 1 },
      { at: base.at, job: base.job, status: 'ok' },
      { ...base, error: null }, { ...base, error: false },
      { ...base, at: 42 }, { ...base, at: '2026-10-28T23:00:00' },
      { ...base, at: '2026-02-30T23:00:00Z' }, { ...base, at: '2026-10-28T24:00:00Z' },
      { ...base, at: '2026-10-28T23:60:00Z' }, { ...base, at: '2026-10-28T23:00:00+25:00' },
      { ...base, at: '2026-10-28T23:00:00Z\n' },
    ];
    const text = ['{broken', ...invalid.map(value => JSON.stringify(value)), JSON.stringify(base)].join('\n') + '\n';
    const result = readNight(fixture(text), night);
    expect(result?.badLines).toBe(19);
    expect(result?.rows).toHaveLength(1);
    expect(result?.counts).toEqual({ ok: 1, retry: 0, fail: 0 });
  });

  it.each([
    ['', 0], ['\n', 1], ['\n\n', 2], [' \t', 1], ['\r\n', 1],
    [JSON.stringify(base) + '\n', 0],
    [JSON.stringify(base) + '\n\n \t\n' + JSON.stringify(base) + '\n', 2],
  ])('counts record boundaries in %j as %i invalid lines', (text, badLines) => {
    expect(readNight(fixture(text), night)?.badLines).toBe(badLines);
  });

  it('distinguishes an empty night from a missing file or directory', () => {
    const dir = fixture('');
    expect(readNight(dir, night)).toEqual({ night, rows: [], counts: { ok: 0, retry: 0, fail: 0 }, badLines: 0 });
    expect(readNight(dir, '2026-10-29')).toBeNull();
    expect(readNight(join(dir, 'missing'), night)).toBeNull();
  });

  it.each(['../2026-10-28', '..\\2026-10-28', '/2026-10-28', '2026-1-1', '2026-02-29', '2026-04-31', '2026-13-01', '2026-00-10', '2026-10-28\n'])('rejects an invalid night %j before accessing files', invalidNight => {
    expect(readNight('\0', invalidNight)).toBeNull();
  });

  it('accepts leap days and propagates unrelated filesystem errors', () => {
    const dir = fixture(JSON.stringify({ ...base, at: '2024-02-29T00:00:00Z' }));
    writeFileSync(join(dir, '2024-02-29.jsonl'), '');
    expect(readNight(dir, '2024-02-29')?.night).toBe('2024-02-29');
    expect(readNight(dir, night)?.badLines).toBe(0);
    expect(() => readNight('\0', night)).toThrow();
  });
});
