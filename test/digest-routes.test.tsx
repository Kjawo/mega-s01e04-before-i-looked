import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';

const night = '2026-10-28';
const tempDirs: string[] = [];

function appForNight(contents: string) {
  const runsDir = mkdtempSync(join(tmpdir(), 'rig-digest-routes-'));
  tempDirs.push(runsDir);
  writeFileSync(join(runsDir, `${night}.jsonl`), contents, 'utf8');

  return createApp({
    adapter: 'shim',
    installed: '2026-10-29T14:06:00+01:00',
    beatEverySeconds: 60,
    runsDir,
  });
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('digest routes', () => {
  it('serves matching, sorted HTML and JSON for a night with bad records', async () => {
    const app = appForNight([
      JSON.stringify({ at: '2026-10-28T21:00:00.125-04:30', job: 'zeta', status: 'retry', owner: 'runner' }),
      '{broken json',
      JSON.stringify({ at: '2026-10-28T22:00:00+01:00', job: 'a<&', status: 'fail', owner: 'runner', error: '<script>alert("x")</script>' }),
      '',
      JSON.stringify({ at: '2026-10-28T22:10:00+01:00', job: 'zeta', status: 'retry', owner: 'runner' }),
      JSON.stringify({ at: '2026-10-28T22:20:00+01:00', job: 'middle', status: 'ok', owner: null }),
      JSON.stringify({ at: '2026-10-28T22:30:00+01:00', job: 'zeta', status: 'retry', owner: 'runner' }),
      JSON.stringify({ at: '2026-10-28T22:40:00+01:00', job: 'a<&', status: 'ok', owner: null }),
      JSON.stringify({ at: '2026-10-28T22:50:00+01:00', job: 'zeta', status: 'fail', owner: 'runner', error: 'temporary failure' }),
      JSON.stringify({ at: '2026-10-28T23:00:00+05:45', job: 'zeta', status: 'ok', owner: 'runner' }),
      '',
    ].join('\n'));

    const [htmlResponse, jsonResponse] = await Promise.all([
      app.request(`/digest/${night}`),
      app.request(`/api/digest/${night}`),
    ]);

    expect(htmlResponse.status).toBe(200);
    expect(jsonResponse.status).toBe(200);
    const html = await htmlResponse.text();
    const digest: unknown = await jsonResponse.json();

    expect(digest).toEqual({
      night,
      counts: { ok: 3, retry: 3, fail: 2 },
      badLines: 2,
      rows: [
        {
          job: 'a<&', owner: null, runs: 2, retries: 0, failures: 1,
          lastStatus: 'ok', lastError: '<script>alert("x")</script>',
          firstAt: '2026-10-28T22:00:00+01:00', lastAt: '2026-10-28T22:40:00+01:00',
        },
        {
          job: 'middle', owner: null, runs: 1, retries: 0, failures: 0,
          lastStatus: 'ok', lastError: null,
          firstAt: '2026-10-28T22:20:00+01:00', lastAt: '2026-10-28T22:20:00+01:00',
        },
        {
          job: 'zeta', owner: 'runner', runs: 5, retries: 3, failures: 1,
          lastStatus: 'ok', lastError: 'temporary failure',
          firstAt: '2026-10-28T21:00:00.125-04:30', lastAt: '2026-10-28T23:00:00+05:45',
        },
      ],
    });

    expect(html).toContain('malformed lines: 2');
    expect(html).not.toContain('<script>alert("x")</script>');
    expect(html).toContain('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;');
    expect(html).toContain('a&lt;&amp;');
    expect(html).toContain('2026-10-28T21:00:00.125-04:30');
    expect(html).toContain('2026-10-28T23:00:00+05:45');
    expect(html).toContain('—');
    expect(html).toMatch(/<td class="warn">a&lt;&amp;<\/td>/);
    expect(html).toMatch(/<td class="warn">3<\/td>/);

    const firstJob = html.indexOf('a&lt;&amp;');
    const secondJob = html.indexOf('middle');
    const thirdJob = html.indexOf('zeta');
    expect(firstJob).toBeGreaterThan(-1);
    expect(firstJob).toBeLessThan(secondJob);
    expect(secondJob).toBeLessThan(thirdJob);
  });

  it('returns 404 from both routes when the night file is missing', async () => {
    const app = appForNight('');

    const [html, json] = await Promise.all([
      app.request('/digest/2026-10-29'),
      app.request('/api/digest/2026-10-29'),
    ]);

    expect(html.status).toBe(404);
    expect(json.status).toBe(404);
    expect(await json.json()).toEqual({ error: 'night not found' });
  });

  it('renders an existing empty night as nothing ran and returns empty rows in JSON', async () => {
    const app = appForNight('');

    const [html, json] = await Promise.all([
      app.request(`/digest/${night}`),
      app.request(`/api/digest/${night}`),
    ]);

    expect(html.status).toBe(200);
    expect((await html.text())).toContain('nothing ran');
    expect(json.status).toBe(200);
    expect(await json.json()).toEqual({
      night,
      counts: { ok: 0, retry: 0, fail: 0 },
      badLines: 0,
      rows: [],
    });
  });

  it.each([
    '/digest/not-a-date',
    '/api/digest/not-a-date',
    '/digest/%2E%2E%2Foutside',
    '/api/digest/%2E%2E%2Foutside',
  ])('rejects an invalid or traversal night at %s', async (path) => {
    const app = appForNight('');

    const response = await app.request(path);

    expect(response.status).toBe(404);
  });
});
