import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { request } from 'node:http';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApprovalCore } from '../src/approval/actions.js';
import { generateToken, WebApprovalServer, WebBindError } from '../src/approval/web/server.js';
import { renderErrorPage } from '../src/approval/web/views.js';
import { listAllAudit } from '../src/state/audit.js';
import { all, run } from '../src/state/db.js';
import { getCaseByCycleKey } from '../src/state/repo.js';
import { createDemo, type Demo, MOTION_SCRIPTS, stripMotionScripts, TODAY } from './helpers.js';

let demo: Demo;
let server: WebApprovalServer;
let token: string;
let port: number;

interface Reply {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: Buffer;
  text: string;
}

function http(method: string, urlPath: string, headers: Record<string, string> = {}, body?: string): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, method, path: urlPath, headers: { Host: `127.0.0.1:${port}`, ...headers } }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => {
        const buffer = Buffer.concat(chunks);
        resolve({ status: res.statusCode ?? 0, headers: res.headers, body: buffer, text: buffer.toString('utf8') });
      });
    });
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

async function login(): Promise<string> {
  const reply = await http('GET', `/?t=${encodeURIComponent(token)}`);
  const cookie = String(reply.headers['set-cookie'] ?? '').split(';')[0] ?? '';
  return cookie;
}

async function csrfFrom(cookie: string): Promise<string> {
  const page = await http('GET', '/', { Cookie: cookie });
  return /name="csrf" value="([a-f0-9]+)"/.exec(page.text)?.[1] ?? '';
}

function post(urlPath: string, cookie: string, csrf: string | null, origin: string | null = `http://127.0.0.1:${port}`) {
  const headers: Record<string, string> = { Cookie: cookie, 'Content-Type': 'application/x-www-form-urlencoded' };
  if (origin !== null) headers.Origin = origin;
  return http('POST', urlPath, headers, csrf === null ? '' : `csrf=${csrf}`);
}

beforeEach(async () => {
  demo = await createDemo();
  token = generateToken();
  const core = createApprovalCore({ db: demo.db, clock: demo.clock, dataSource: demo.dataSource, outputDir: demo.outputDir, allowedTelegramChatIds: [] });
  server = new WebApprovalServer({ db: demo.db, clock: demo.clock, dataSource: demo.dataSource, port: 0, token, approverName: 'Alex Morrow', today: () => TODAY });
  port = await server.start(core.handleAction);
});
afterEach(async () => {
  await server.stop();
  demo.cleanup();
});

describe('binding and authentication', () => {
  it('refuses any bind address except 127.0.0.1', () => {
    for (const host of ['0.0.0.0', 'localhost', '192.168.1.10', '::']) {
      expect(() => new WebApprovalServer({ db: demo.db, clock: demo.clock, dataSource: demo.dataSource, port: 0, token, approverName: 'x', today: () => TODAY, host })).toThrow(WebBindError);
    }
    expect(server.launchUrl()).toBe(`http://127.0.0.1:${port}/?t=${encodeURIComponent(token)}`);
  });

  it('wrong token: fixed 403 page, audited with the reason only', async () => {
    const reply = await http('GET', '/?t=not-the-token');
    expect(reply.status).toBe(403);
    // Prompt 6: the bare "Forbidden" text became a designed page with FIXED text. Still an exact match:
    // nothing from the request (token, path, query) can appear in it.
    expect(reply.text).toBe(renderErrorPage(403));
    expect(reply.text).not.toContain('not-the-token');
    const attempt = listAllAudit(demo.db).find((e) => e.type === 'unauthorised_attempt');
    expect(attempt?.details).toEqual({ reason: 'bad token', method: 'GET', path: '/' });
  });

  it('missing cookie: 403', async () => {
    expect((await http('GET', '/')).status).toBe(403);
    expect((await http('GET', '/pack/1')).status).toBe(403);
  });

  it('bad Host header (DNS rebinding): 403 even with a valid cookie', async () => {
    const cookie = await login();
    expect((await http('GET', '/', { Cookie: cookie, Host: 'evil.example:8787' })).status).toBe(403);
    expect((await http('GET', '/', { Cookie: cookie, Host: `localhost:${port}` })).status).toBe(200);
  });

  it('the token sets an HttpOnly, SameSite=Strict cookie and redirects to a clean URL', async () => {
    const reply = await http('GET', `/?t=${encodeURIComponent(token)}`);
    expect(reply.status).toBe(303);
    expect(reply.headers.location).toBe('/');
    const cookie = String(reply.headers['set-cookie']);
    expect(cookie).toMatch(/^pra_session=[a-f0-9]{64}; HttpOnly; SameSite=Strict; Path=\/$/);
  });

  it('sends strict security headers and no inline or third-party JavaScript', async () => {
    const page = await http('GET', '/', { Cookie: await login() });
    expect(page.status).toBe(200);
    const csp = String(page.headers['content-security-policy']);
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("form-action 'self'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toMatch(/unsafe-inline|unsafe-eval|https?:/);
    expect(page.headers['x-content-type-options']).toBe('nosniff');
    // same-origin, not no-referrer: under no-referrer real browsers send "Origin: null" on form POSTs (D-087).
    expect(page.headers['referrer-policy']).toBe('same-origin');
    expect(page.text).toMatch(MOTION_SCRIPTS);
    expect(stripMotionScripts(page.text)).not.toMatch(/<script/i);
    expect(page.text.match(/>Approve</g)).toHaveLength(11); // one card per pack
  });
});

describe('actions over HTTP', () => {
  it('POST needs a valid CSRF token AND a matching Origin', async () => {
    const cookie = await login();
    const csrf = await csrfFrom(cookie);
    const s02 = demo.packFor('pol-s02');
    expect((await post(`/pack/${s02.id}/approve`, cookie, null)).status).toBe(403);
    expect((await post(`/pack/${s02.id}/approve`, cookie, 'f'.repeat(64))).status).toBe(403);
    expect((await post(`/pack/${s02.id}/approve`, cookie, csrf, 'http://evil.example')).status).toBe(403);
    expect((await post(`/pack/${s02.id}/approve`, cookie, csrf, null)).status).toBe(403);
    expect((await post(`/pack/${s02.id}/approve`, cookie, csrf, 'null')).status).toBe(403); // what browsers send under no-referrer
    expect(getCaseByCycleKey(demo.db, 'pol-s02:2027-01-25')?.status).toBe('in_review');
    const reasons = listAllAudit(demo.db).filter((e) => e.type === 'unauthorised_attempt').map((e) => e.details.reason);
    expect(reasons).toEqual(['bad csrf token', 'bad csrf token', 'bad origin', 'bad origin', 'bad origin']);
    const origins = listAllAudit(demo.db).filter((e) => e.details.reason === 'bad origin').map((e) => e.details.origin);
    expect(origins).toEqual(['http://evil.example', '(none)', 'null']);
  });

  it('GET never changes state', async () => {
    const cookie = await login();
    const s02 = demo.packFor('pol-s02');
    expect((await http('GET', `/pack/${s02.id}/approve`, { Cookie: cookie })).status).toBe(404);
    expect((await http('GET', `/pack/${s02.id}/skip`, { Cookie: cookie })).status).toBe(404);
    await http('GET', `/pack/${s02.id}/open`, { Cookie: cookie });
    expect(getCaseByCycleKey(demo.db, 'pol-s02:2027-01-25')?.status).toBe('in_review');
    expect(all(demo.db, 'SELECT * FROM approvals')).toEqual([]);
  });

  it('full demo flow: approve pol-s02 -> overlay approved, files under output/approved, resolved card', async () => {
    const cookie = await login();
    const csrf = await csrfFrom(cookie);
    const s02 = demo.packFor('pol-s02');
    expect(existsSync(path.join(demo.outputDir, 'approved'))).toBe(false);
    const reply = await post(`/pack/${s02.id}/approve`, cookie, csrf);
    expect(reply.status).toBe(303);
    expect(reply.headers.location).toBe(`/pack/${s02.id}?done=approved`);
    expect(JSON.parse(readFileSync(demo.overlayPath, 'utf8')).statuses).toEqual({ 'pol-s02': 'approved' });
    for (const rel of [s02.paths.xlsx, s02.paths.clientEml, s02.paths.insurerEml]) {
      expect(existsSync(path.join(demo.outputDir, 'approved', ...rel.split('/')))).toBe(true);
    }
    const detail = await http('GET', `/pack/${s02.id}?done=approved`, { Cookie: cookie });
    // Prompt 6: same facts, new markup and the page's consistent date format.
    expect(detail.text).toMatch(/<h2 class="banner__title" id="banner-1">Approved<\/h2>/);
    expect(detail.text).toContain('The drafts were saved under output/approved and the renewal status was updated. Nothing was sent.');
    expect(detail.text).toMatch(/Approved by Alex Morrow on 18 October 2026 at 18:00 UTC \(web page\)/);
    expect(detail.text).not.toContain(`/pack/${s02.id}/approve`); // no buttons once decided
    // Second approve changes nothing.
    const again = await post(`/pack/${s02.id}/approve`, cookie, csrf);
    expect(again.headers.location).toBe(`/pack/${s02.id}?done=already_done`);
    expect(all(demo.db, 'SELECT * FROM approvals')).toHaveLength(1);
  });

  it('skip over HTTP', async () => {
    const cookie = await login();
    const csrf = await csrfFrom(cookie);
    const s05 = demo.packFor('pol-s05');
    const reply = await post(`/pack/${s05.id}/skip`, cookie, csrf);
    expect(reply.headers.location).toBe(`/pack/${s05.id}?done=skipped`);
    expect(getCaseByCycleKey(demo.db, 'pol-s05:2027-01-18')?.status).toBe('skipped');
    expect(existsSync(demo.overlayPath)).toBe(false);
  });

  it('Open streams the DB file as an attachment; request paths cannot pick another file', async () => {
    const cookie = await login();
    const s15 = demo.packFor('pol-s15');
    const reply = await http('GET', `/pack/${s15.id}/open?path=../../fixtures/data/clients.json`, { Cookie: cookie });
    expect(reply.status).toBe(200);
    expect(reply.headers['content-disposition']).toBe(`attachment; filename="comparison-pol-s15-v1.xlsx"`);
    expect(reply.body.equals(readFileSync(path.join(demo.outputDir, ...s15.paths.xlsx.split('/'))))).toBe(true);
    for (const evil of ['/pack/..%2F..%2Ffixtures/open', '/pack/1/../../etc/open', '/pack/abc/open', '/pack/1/open/../../x']) {
      expect((await http('GET', evil, { Cookie: cookie })).status).toBe(404);
    }
  });

  it('escapes hostile document text stored in a pack', async () => {
    const cookie = await login();
    const s13 = demo.packFor('pol-s13');
    const hostile = '<script>alert(1)</script>';
    const pack = { ...s13.pack };
    pack.diffs = [{ field: `exclusion:other:${hostile}`, expiring: null, renewal: hostile, change: 'added', severity: 'medium', facts: `New exclusion in the renewal that is not in the standard list: "${hostile}".`, renewalPage: 4 }];
    pack.flags = [{ field: `exclusion:other:${hostile}`, severity: 'medium', message: `${hostile} Needs human check.` }];
    run(demo.db, 'UPDATE packs SET pack_json = ? WHERE id = ?', JSON.stringify(pack), s13.id);
    for (const page of [await http('GET', '/', { Cookie: cookie }), await http('GET', `/pack/${s13.id}`, { Cookie: cookie })]) {
      expect(page.text).not.toContain('<script>');
      expect(page.text).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    }
  });

  it('the token never appears in any audit row, database or file after a full flow', async () => {
    await http('GET', '/?t=wrong');
    const cookie = await login();
    const csrf = await csrfFrom(cookie);
    await post(`/pack/${demo.packFor('pol-s01').id}/approve`, cookie, csrf);
    await http('GET', `/pack/${demo.packFor('pol-s15').id}/open`, { Cookie: cookie });
    expect(JSON.stringify(listAllAudit(demo.db))).not.toContain(token);
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = path.join(dir, name);
        if (statSync(full).isDirectory()) walk(full);
        else files.push(full);
      }
    };
    walk(demo.root);
    expect(files.length).toBeGreaterThan(50);
    for (const file of files) expect(readFileSync(file).includes(token), file).toBe(false);
  });
});
