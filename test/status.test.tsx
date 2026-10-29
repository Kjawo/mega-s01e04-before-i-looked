import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderToString } from 'hono/jsx/dom/server';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { StatusBoard } from '../src/views/status.js';

const config = { adapter: 'shim', installed: '2026-10-29T14:06:00+01:00', beatEverySeconds: 60, runsDir: 'runs' };

describe('status board', () => {
  it('shows the lane banner and the nights on disk', async () => {
    process.env.LANE_MARKER = 'TEST-MARKER';
    const res = await createApp(config).request('/');
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('TEST-MARKER');
    expect(html).toContain('2026-10-28');
  });

  it('links every night newest-first and shows event totals plus bad-line accounting', async () => {
    const runsDir = mkdtempSync(join(tmpdir(), 'rig-board-'));
    try {
      writeFileSync(join(runsDir, '2026-10-27.jsonl'), Array.from({ length: 7 }, (_, i) => JSON.stringify({
        at: `2026-10-27T0${i}:00:00+01:00`, job: `job-${i}`, status: 'ok', owner: null,
      })).join('\n') + '\n');
      writeFileSync(join(runsDir, '2026-10-28.jsonl'), [
        JSON.stringify({ at: '2026-10-28T08:00:00+01:00', job: 'a', status: 'ok', owner: 'Ada' }),
        JSON.stringify({ at: '2026-10-28T08:01:00+01:00', job: 'a', status: 'retry', owner: 'Ada' }),
        JSON.stringify({ at: '2026-10-28T08:02:00+01:00', job: 'b', status: 'fail', owner: null }),
        '{bad json',
      ].join('\n') + '\n');

      const res = await createApp({ ...config, runsDir }).request('/');
      const html = await res.text();
      expect(res.status).toBe(200);
      expect(html.indexOf('/digest/2026-10-28')).toBeLessThan(html.indexOf('/digest/2026-10-27'));
      expect(html).toContain('ok 1 · retry 1 · fail 1');
      expect(html).toContain('bad lines 1');
      expect(html).toContain('ok 7 · retry 0 · fail 0');
    } finally {
      rmSync(runsDir, { recursive: true, force: true });
    }
  });

  it('keeps a listed night and marks its data missing when the file disappears', () => {
    const html = renderToString(<StatusBoard status={{
      adapter: 'shim',
      installed: config.installed,
      lastBeat: null,
      nights: [{ night: '2026-10-28', digest: null }],
    }} />);
    expect(html).toContain('/digest/2026-10-28');
    expect(html).toContain('data missing');
    expect(html).not.toContain('ok 0 · retry 0 · fail 0');
  });

  it('health answers with the lane id', async () => {
    const res = await createApp(config).request('/health');
    expect(await res.json()).toEqual({ ok: true, lane: 'lane-07' });
  });
});
