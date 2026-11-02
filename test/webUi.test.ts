// Prompt 6: approval page redesign. Pure view tests (hostile input, structure, severity words,
// audit whitelist) plus HTTP tests (stylesheet route, CSP, every page state, FAKE-LLM bar).
// No network: the server binds to 127.0.0.1 on a random port.

import { request } from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApprovalCore } from '../src/approval/actions.js';
import { auditItemsFor, summarizeAuditEvent } from '../src/approval/web/auditView.js';
import { SCRIPT_ASSETS } from '../src/approval/web/clientScripts.js';
import { FONT_ASSETS } from '../src/approval/web/fonts.js';
import { CONTENT_SECURITY_POLICY, escapeHtml } from '../src/approval/web/html.js';
import { generateToken, WebApprovalServer } from '../src/approval/web/server.js';
import { STYLESHEET, STYLESHEET_HASH, STYLESHEET_PATH } from '../src/approval/web/styles.js';
import { checkAllContrast, COLOR_TOKEN_NAMES, cssVarName, THEMES } from '../src/approval/web/tokens.js';
import {
  type CardView,
  type ErrorKind,
  type ListView,
  type PackView,
  renderErrorPage,
  renderListPage,
  renderPackPage,
} from '../src/approval/web/views.js';
import type { Flag, TermDiff } from '../src/domain/types.js';
import { createGroundTruthReader } from '../src/pipeline/readers.js';
import { runPipeline } from '../src/pipeline/runPipeline.js';
import type { AuditEvent } from '../src/state/audit.js';
import { setPackSyncState } from '../src/state/repo.js';
import { createDemo, type Demo, FIXTURES, MOTION_SCRIPTS, stripMotionScripts, TODAY, withModel } from './helpers.js';

// ---- the checks every rendered page must pass ----------------------------------------------

const CSRF = 'c'.repeat(64);

function headingLevels(html: string): number[] {
  return [...html.matchAll(/<h([1-6])[\s>]/g)].map((m) => Number(m[1]));
}

/** Structure, security and accessibility invariants for one rendered page. */
function assertPageRules(html: string, label: string): void {
  expect(html.startsWith('<!doctype html>'), label).toBe(true);
  expect(html, label).toMatch(/<html lang="en">/);
  expect(html, label).toMatch(/<title>[^<]{3,}<\/title>/);
  // Only the whitelisted motion scripts (D-125); no inline script or handlers, no inline styles, no <style>, no external anything.
  expect(html, label).toMatch(MOTION_SCRIPTS);
  expect(stripMotionScripts(html), label).not.toMatch(/<script/i);
  // Attributes are checked inside tags only: escaped text cannot open a tag, so it is harmless there.
  expect(html, label).not.toMatch(/<[^>]*\son[a-z]+\s*=/i);
  expect(html, label).not.toMatch(/<[^>]*\sstyle\s*=/i);
  expect(html, label).not.toMatch(/<style/i);
  expect(html, label).not.toMatch(/https?:\/\//i);
  for (const m of html.matchAll(/\s(?:href|src|action)="([^"]*)"/g)) {
    expect(m[1], `${label}: ${m[0]}`).toMatch(/^(\/|#)/);
  }
  // Landmarks, one h1, no skipped heading levels, skip link.
  expect(html, label).toContain('<header class="app-header">');
  expect(html, label).toContain('<main id="main"');
  expect(html, label).toContain('<footer class="app-footer">');
  expect(html, label).toContain('<a class="skip" href="#main">Skip to main content</a>');
  const levels = headingLevels(html);
  expect(levels.filter((l) => l === 1), `${label}: exactly one h1`).toHaveLength(1);
  expect(levels[0], `${label}: h1 first`).toBe(1);
  for (let i = 1; i < levels.length; i++) expect((levels[i] as number) - (levels[i - 1] as number), `${label}: heading jump`).toBeLessThanOrEqual(1);
  // Every button sits inside a POST form that carries the CSRF field.
  const forms = [...html.matchAll(/<form method="post" action="\/pack\/\d+\/(?:approve|skip)">(.*?)<\/form>/g)];
  for (const form of forms) expect(form[1], label).toMatch(/^<input type="hidden" name="csrf" value="[a-f0-9]+">/);
  expect(html.replace(/<form method="post"[^>]*>.*?<\/form>/g, ''), `${label}: button outside a form`).not.toMatch(/<button/);
  // Severity is never colour alone: every badge carries its word.
  const badges = html.match(/class="sev (?:risk )?sev-/g) ?? [];
  const worded = [...html.matchAll(/<span class="sev (?:risk )?sev-(high|medium|low|info)"><span class="sev-glyph" aria-hidden="true"><\/span>(?:<span class="risk__label">Overall risk: <\/span><strong>)?(High|Medium|Low|Info)/g)];
  expect(worded.length, `${label}: badges without a word`).toBe(badges.length);
  for (const m of worded) expect((m[2] as string).toLowerCase(), label).toBe(m[1]);
  // The stylesheet is the only resource.
  expect(html, label).toContain(`<link rel="stylesheet" href="${STYLESHEET_PATH}">`);
}

// ---- hostile view models ---------------------------------------------------------------------

const LONG = 'A'.repeat(10_000);
const HOSTILE = ['<script>alert(1)</script>', '" onmouseover="alert(1)', "' onfocus='alert(1)", 'javascript:alert(1)', 'safe\u202Eevil\u202C\u2066x\u2069', LONG];

function hostileDiff(text: string): TermDiff {
  return { field: `exclusion:other:${text}`, expiring: null, renewal: text, change: 'added', severity: 'medium', facts: `New exclusion "${text}".`, renewalPage: 4 };
}

function card(text: string, overrides: Partial<CardView> = {}): CardView {
  return {
    packId: 7,
    clientName: text,
    policyType: text,
    version: 2,
    expiryDate: '2027-01-25',
    weeks: 14,
    risk: 'high',
    diffs: [hostileDiff(text), { field: 'insurerName', expiring: text, renewal: `${text}2`, change: 'changed', severity: 'medium', facts: text, expiringPage: 1, renewalPage: 1 }],
    flagCount: 1,
    status: 'in_review',
    decision: null,
    syncState: 'ok',
    ...overrides,
  };
}

function hostileList(text: string): ListView {
  return {
    runDate: TODAY,
    approverName: text,
    fakeLlm: true,
    csrf: CSRF,
    waiting: [card(text)],
    decided: [card(text, { packId: 8, status: 'approved', decision: { action: 'approve', at: '2026-10-19T17:51:10.000Z', channel: text }, syncState: 'copy_failed' })],
    attention: [{ clientName: text, policyType: text, reason: text }],
    imported: [{ clientName: text, policyType: text, expiryDate: '2027-01-19' }],
    counts: { waiting: 1, approved: 1, skipped: 0, attention: 1 },
  };
}

function hostileEvent(type: string, text: string): AuditEvent {
  return {
    id: 1,
    at: '2026-10-19T17:51:10.000Z',
    type: type as AuditEvent['type'],
    runId: null,
    policyId: 'pol-s02',
    cycleKey: 'pol-s02:2027-01-25',
    actor: text,
    details: { from: text, to: text, overallRisk: text, kind: text, channel: text, result: text, error: text, reason: text, token: 'sk-abcdefghijklmnopqrstuvwxyz0123', path: '/etc/secret' },
  };
}

function hostilePack(text: string, overrides: Partial<PackView> = {}): PackView {
  const flags: Flag[] = [{ field: `exclusion:other:${text}`, severity: 'medium', message: text }];
  return {
    runDate: TODAY,
    approverName: text,
    fakeLlm: false,
    csrf: CSRF,
    card: card(text),
    flags,
    insurerName: text,
    policyId: text,
    cycleKey: 'pol-s02:2027-01-25',
    packStatus: 'active',
    activePack: { id: 7, version: 2 },
    done: null,
    audit: auditItemsFor(['status_changed', 'comparison_done', 'copy_failed', 'made_up_type'].map((t) => hostileEvent(t, text)), 'pol-s02:2027-01-25', text),
    createdAt: text,
    contentHash: text,
    inputHash: text,
    ...overrides,
  };
}

function assertEscaped(html: string, text: string, label: string): void {
  expect(html, label).not.toContain('<script>alert(1)</script>');
  expect(html, label).not.toMatch(/<[^>]*\son[a-z]+\s*=/i);
  expect(html, label).not.toContain('" onmouseover="');
  expect(html, label).not.toContain("' onfocus='");
  expect(html, label).not.toMatch(/(?:href|src|action)="javascript:/i);
  expect(html, label).not.toMatch(/[\u202A-\u202E\u2066-\u2069]/);
  if (text === LONG) expect(html, label).toContain(LONG);
}

describe('escaping (one helper, every view)', () => {
  it('escapeHtml neutralises markup, quotes and bidi controls', () => {
    expect(escapeHtml(`<a href="x" title='y'>&</a>`)).toBe('&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;');
    expect(escapeHtml('abc\u202Edef\u2066g\u2069')).toBe('abcdefg');
  });

  for (const text of HOSTILE) {
    const label = JSON.stringify(text.slice(0, 30));
    it(`list page escapes ${label}`, () => {
      const html = renderListPage(hostileList(text));
      assertEscaped(html, text, label);
      assertPageRules(html, `list ${label}`);
    });
    it(`pack page escapes ${label} in every state`, () => {
      const states: Array<Partial<PackView>> = [
        {},
        { done: 'approved', card: card(text, { status: 'approved', decision: { action: 'approve', at: '2026-10-19T17:51:10.000Z', channel: 'web' } }) },
        { done: 'already_done', card: card(text, { status: 'skipped', decision: { action: 'skip', at: text, channel: text } }) },
        { packStatus: 'superseded', activePack: { id: 12, version: 3 } },
        { done: 'approve_sync', card: card(text, { status: 'approved', decision: { action: 'approve', at: text, channel: 'web' }, syncState: 'status_sync_failed' }) },
      ];
      for (const state of states) {
        const html = renderPackPage(hostilePack(text, state));
        assertEscaped(html, text, label);
        assertPageRules(html, `pack ${label} ${JSON.stringify(Object.keys(state))}`);
      }
    });
  }

  it('error pages are fixed text and pass the page rules', () => {
    for (const kind of [400, 403, 404, 405, 413, 500, 503, 'spreadsheet'] as ErrorKind[]) assertPageRules(renderErrorPage(kind), `error ${kind}`);
  });
});

describe('audit panel (read-only, whitelisted)', () => {
  it('never renders raw details, secrets, errors, paths or long text', () => {
    const text = 'x'.repeat(5000);
    const items = ['status_changed', 'comparison_done', 'copy_failed', 'status_sync_failed', 'opened', 'evil_type'].map((t) => summarizeAuditEvent(hostileEvent(t, text), 'Alex Morrow'));
    const html = renderPackPage(hostilePack('ok', { audit: { items, hidden: 0 } }));
    for (const banned of ['sk-abcdef', 'xxxxxxxxxx', '/etc/secret', '{', 'token']) expect(html.split('Activity for this renewal')[1]).not.toContain(banned);
    expect(items.map((i) => i.what)).toEqual([
      'Status changed',
      'Comparison done',
      'Saving the approved drafts failed (nothing was sent). Run npm run retry-sync',
      'Updating the renewal status failed (nothing was sent). Run npm run retry-sync',
      'Comparison spreadsheet opened',
      'Recorded event',
    ]);
    for (const item of items) expect(item.what.length).toBeLessThanOrEqual(160);
    expect(items[0]?.who).toBe('Unknown');
  });

  it('summarises known details in plain words', () => {
    const event: AuditEvent = { id: 1, at: '2026-10-19T17:49:59.120Z', type: 'status_changed', runId: 'r', policyId: 'pol-s02', cycleKey: 'k', actor: 'broker:web', details: { from: 'in_review', to: 'approved' } };
    expect(summarizeAuditEvent(event, 'Alex Morrow')).toEqual({ iso: '2026-10-19T17:49:59.120Z', when: '19 October 2026, 17:49 UTC', what: 'Status changed from In review to Approved', who: 'Alex Morrow (web page)' });
    const done: AuditEvent = { ...event, type: 'comparison_done', actor: 'system', details: { overallRisk: 'high', diffs: 1, flags: 1 } };
    expect(summarizeAuditEvent(done, 'x').what).toBe('Comparison done: overall risk High, 1 change, 1 flag');
  });

  it('degrades gracefully with no events and keeps only the pack cycle', () => {
    const html = renderPackPage(hostilePack('ok', { audit: { items: [], hidden: 0 } }));
    expect(html).toContain('No activity recorded yet.');
    const other = { ...hostileEvent('opened', 'x'), cycleKey: 'pol-s02:2026-01-25' };
    expect(auditItemsFor([other], 'pol-s02:2027-01-25', 'x').items).toEqual([]);
  });
});

describe('FAKE-LLM bar (views)', () => {
  it('appears when fake mode is on and not when it is off', () => {
    const on = renderListPage({ ...hostileList('ok'), fakeLlm: true });
    const off = renderListPage({ ...hostileList('ok'), fakeLlm: false });
    expect(on).toContain('<div class="mode-bar" role="note">');
    expect(on).toContain('come from the answer keys, not from live AI reading of the documents');
    expect(off).not.toContain('mode-bar');
    expect(renderPackPage(hostilePack('ok', { fakeLlm: true }))).toContain('class="mode-bar"');
    expect(renderPackPage(hostilePack('ok', { fakeLlm: false }))).not.toContain('class="mode-bar"');
  });
});

describe('stylesheet and tokens', () => {
  it('has no @import, no external reference, and url() only for the whitelisted self-hosted fonts', () => {
    expect(STYLESHEET).not.toMatch(/@import/i);
    expect(STYLESHEET).not.toMatch(/https?:|\/\/[a-z]/i);
    const urls = [...STYLESHEET.matchAll(/url\(\s*"?([^")]*)"?\s*\)/gi)].map((m) => m[1]);
    expect(urls.length).toBe(FONT_ASSETS.size);
    for (const url of urls) expect(FONT_ASSETS.has(url as string), url).toBe(true);
    for (const path of FONT_ASSETS.keys()) expect(path).toMatch(/^\/assets\/fonts\/[a-z0-9-]+\.[a-f0-9]{12}\.woff2$/);
    expect(STYLESHEET_PATH).toBe(`/assets/app.${STYLESHEET_HASH}.css`);
  });

  it('is light mode only: no dark colour scheme', () => {
    expect(STYLESHEET).not.toMatch(/prefers-color-scheme/);
    expect(STYLESHEET).toContain('color-scheme:light;');
  });

  it('defines every colour token and passes the contrast thresholds', () => {
    for (const token of COLOR_TOKEN_NAMES) expect(STYLESHEET).toContain(`${cssVarName(token)}:${THEMES.light[token]};`);
    const failures = checkAllContrast().filter((r) => !r.pass);
    expect(failures).toEqual([]);
  });
});

// ---- over HTTP --------------------------------------------------------------------------------

let demo: Demo;
let server: WebApprovalServer;
let port: number;
let token: string;

interface Reply {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  text: string;
}

function http(method: string, urlPath: string, headers: Record<string, string> = {}, body?: string): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, method, path: urlPath, headers: { Host: `127.0.0.1:${port}`, ...headers } }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, text: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

async function startServer(fakeLlm?: boolean): Promise<void> {
  token = generateToken();
  const core = createApprovalCore({ db: demo.db, clock: demo.clock, dataSource: demo.dataSource, outputDir: demo.outputDir, allowedTelegramChatIds: [] });
  server = new WebApprovalServer({ db: demo.db, clock: demo.clock, dataSource: demo.dataSource, port: 0, token, approverName: 'Alex Morrow', today: () => TODAY, ...(fakeLlm === undefined ? {} : { fakeLlm }) });
  port = await server.start(core.handleAction);
}

async function login(): Promise<string> {
  const reply = await http('GET', `/?t=${encodeURIComponent(token)}`);
  return String(reply.headers['set-cookie'] ?? '').split(';')[0] ?? '';
}

async function csrfFrom(cookie: string): Promise<string> {
  return /name="csrf" value="([a-f0-9]+)"/.exec((await http('GET', '/', { Cookie: cookie })).text)?.[1] ?? '';
}

const post = (urlPath: string, cookie: string, csrf: string) =>
  http('POST', urlPath, { Cookie: cookie, Origin: `http://127.0.0.1:${port}`, 'Content-Type': 'application/x-www-form-urlencoded' }, `csrf=${csrf}`);

describe('over HTTP with fake-LLM data', () => {
  beforeEach(async () => {
    demo = await createDemo();
    await startServer();
  });
  afterEach(async () => {
    await server.stop();
    demo.cleanup();
  });

  it('serves the stylesheet with the right headers, without a session, and 304 on a matching ETag', async () => {
    const css = await http('GET', STYLESHEET_PATH);
    expect(css.status).toBe(200);
    expect(css.headers['content-type']).toBe('text/css; charset=utf-8');
    expect(css.headers['x-content-type-options']).toBe('nosniff');
    expect(css.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(css.headers.etag).toBe(`"${STYLESHEET_HASH}"`);
    expect(css.text).toBe(STYLESHEET);
    expect((await http('GET', STYLESHEET_PATH, { 'If-None-Match': `"${STYLESHEET_HASH}"` })).status).toBe(304);
    expect((await http('GET', '/assets/app.000000000000.css')).status).toBe(404);
    expect((await http('GET', STYLESHEET_PATH, { Host: 'evil.example' })).status).toBe(403);
  });

  it('serves only the whitelisted font files, with font headers, without a session', async () => {
    for (const [path, asset] of FONT_ASSETS) {
      const reply = await http('GET', path);
      expect(reply.status).toBe(200);
      expect(reply.headers['content-type']).toBe('font/woff2');
      expect(reply.headers['x-content-type-options']).toBe('nosniff');
      expect(reply.headers['cache-control']).toBe('public, max-age=31536000, immutable');
      expect(reply.headers.etag).toBe(`"${asset.hash}"`);
      expect(Number(reply.headers['content-length'])).toBe(asset.body.length);
      expect((await http('GET', path, { 'If-None-Match': `"${asset.hash}"` })).status).toBe(304);
    }
    for (const evil of ['/assets/fonts/ibm-plex-sans-latin-wght.woff2', '/assets/fonts/../../package.json', '/assets/fonts/OFL.txt', '/assets/fonts/x.000000000000.woff2']) {
      // Refused either way: 404 inside /assets/, 403 when ".." normalises the path out of /assets/ (no session).
      const reply = await http('GET', evil);
      expect([403, 404], evil).toContain(reply.status);
      expect(reply.headers['content-type'], evil).toBe('text/html; charset=utf-8');
    }
  });

  it('serves only the whitelisted motion scripts, as JavaScript, without a session, and 304 on a matching ETag', async () => {
    expect(SCRIPT_ASSETS.size).toBe(4);
    for (const [path, asset] of SCRIPT_ASSETS) {
      expect(path).toMatch(/^\/assets\/js\/(boot|gsap|scrolltrigger|motion)\.[a-f0-9]{12}\.js$/);
      const reply = await http('GET', path);
      expect(reply.status).toBe(200);
      expect(reply.headers['content-type']).toBe('text/javascript; charset=utf-8');
      expect(reply.headers['x-content-type-options']).toBe('nosniff');
      expect(reply.headers['cache-control']).toBe('public, max-age=31536000, immutable');
      expect(reply.headers.etag).toBe(`"${asset.hash}"`);
      expect(Number(reply.headers['content-length'])).toBe(asset.body.length);
      expect((await http('GET', path, { 'If-None-Match': `"${asset.hash}"` })).status).toBe(304);
      expect((await http('POST', path)).status).toBe(405);
    }
    for (const evil of ['/assets/js/motion.js', '/assets/js/gsap.000000000000.js', '/assets/js/../../package.json', '/assets/js/client/boot.js']) {
      const reply = await http('GET', evil);
      expect([403, 404], evil).toContain(reply.status);
      expect(reply.headers['content-type'], evil).toBe('text/html; charset=utf-8');
    }
  });

  it('sends exactly the approved CSP on every kind of response', async () => {
    const expected = "default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'none'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'";
    expect(CONTENT_SECURITY_POLICY).toBe(expected);
    const cookie = await login();
    for (const reply of [await http('GET', '/', { Cookie: cookie }), await http('GET', STYLESHEET_PATH), await http('GET', '/'), await http('GET', '/nope', { Cookie: cookie })]) {
      expect(reply.headers['content-security-policy']).toBe(expected);
    }
  });

  it('renders every state as a valid page: list, in review, approved, already done, skipped, sync failed, superseded, errors', async () => {
    const cookie = await login();
    const csrf = await csrfFrom(cookie);
    const s02 = demo.packFor('pol-s02');
    const s05 = demo.packFor('pol-s05');
    const list = await http('GET', '/', { Cookie: cookie });
    assertPageRules(list.text, 'list');
    expect(list.text).toContain('class="mode-bar"'); // demo data came from the fake-LLM reader
    expect(list.text).toContain('The renewal document is missing.'); // pol-s07 notice, plain words
    expect(list.text).toContain('One of the documents is a scanned image with no readable text.'); // pol-s08
    expect(list.text).not.toContain('pol-s07'); // client name, not the policy id
    expect(list.text).toContain('Already approved for this renewal cycle'); // pol-s12, seeded

    const inReview = await http('GET', `/pack/${s02.id}`, { Cookie: cookie });
    assertPageRules(inReview.text, 'pack in review');
    expect(inReview.text).toContain('Renewal page');
    expect(inReview.text).toContain('Activity for this renewal');
    expect(inReview.text).toContain('Status changed from Drafted to In review');

    await post(`/pack/${s02.id}/approve`, cookie, csrf);
    for (const done of ['approved', 'already_done']) {
      const page = await http('GET', `/pack/${s02.id}?done=${done}`, { Cookie: cookie });
      assertPageRules(page.text, `pack ${done}`);
      expect(page.text).not.toContain(`/pack/${s02.id}/approve`);
      expect(page.text).toContain('Approved by Alex Morrow on 18 October 2026 at 18:00 UTC (web page)');
    }
    expect((await http('GET', `/pack/${s02.id}?done=already_done`, { Cookie: cookie })).text).toContain('Already approved');
    expect((await http('GET', `/pack/${s02.id}`, { Cookie: cookie })).text).toContain('>Approved (version 1)<');

    const again = await post(`/pack/${s02.id}/approve`, cookie, csrf);
    expect(again.headers.location).toBe(`/pack/${s02.id}?done=already_done`);

    await post(`/pack/${s05.id}/skip`, cookie, csrf);
    const skipped = await http('GET', `/pack/${s05.id}?done=skipped`, { Cookie: cookie });
    assertPageRules(skipped.text, 'pack skipped');
    expect(skipped.text).toContain('Skipped by Alex Morrow');

    setPackSyncState(demo.db, s02.id, 'status_sync_failed');
    const failed = await http('GET', `/pack/${s02.id}`, { Cookie: cookie });
    assertPageRules(failed.text, 'pack sync failed');
    expect(failed.text).toContain('Approved, but the renewal status was not updated.');
    expect((await http('GET', '/', { Cookie: cookie })).text).toContain('Approved, but the renewal status was not updated.');

    const s04 = demo.packFor('pol-s04');
    await runPipeline({ today: TODAY, dryRun: false, deps: demo.pipelineDeps({ reader: withModel(createGroundTruthReader(FIXTURES), 'model-2') }) });
    const old = await http('GET', `/pack/${s04.id}`, { Cookie: cookie });
    assertPageRules(old.text, 'pack superseded');
    expect(old.text).toContain('Version 2 replaced it.');
    expect(old.text).not.toContain(`/pack/${s04.id}/open`); // Open is refused for old versions, so no dead link
    expect(old.text).not.toContain(`/pack/${s04.id}/approve`);

    const missing = await http('GET', '/pack/999999', { Cookie: cookie });
    expect(missing.status).toBe(404);
    assertPageRules(missing.text, '404 pack');
    const nope = await http('GET', '/nope', { Cookie: cookie });
    expect(nope.status).toBe(404);
    assertPageRules(nope.text, '404 path');
    const forbidden = await http('GET', '/');
    expect(forbidden.status).toBe(403);
    assertPageRules(forbidden.text, '403');
    const method = await http('PUT', '/', { Cookie: cookie });
    expect(method.status).toBe(405);
    assertPageRules(method.text, '405');
    const openOld = await http('GET', `/pack/${s04.id}/open`, { Cookie: cookie });
    expect(openOld.status).toBe(404);
    assertPageRules(openOld.text, 'spreadsheet 404');
  });

  it('the list shows one Approve per waiting pack, highest risk first', async () => {
    const text = (await http('GET', '/', { Cookie: await login() })).text;
    expect(text.match(/>Approve</g)).toHaveLength(11);
    const waiting = text.split('id="attention"')[0] ?? '';
    const risks = [...waiting.matchAll(/class="sev risk sev-(\w+)"/g)].map((m) => m[1]);
    expect(risks).toEqual(['high', 'high', 'high', 'medium', 'medium', 'medium', 'low', 'info', 'info', 'info', 'info']);
  });
});

describe('APPROVAL_PUBLIC_ORIGIN (one extra HTTPS host/origin behind a TLS proxy)', () => {
  const PUBLIC = 'https://203-0-113-7.sslip.io';
  const PUBLIC_HOST = '203-0-113-7.sslip.io';
  let publicServer: WebApprovalServer;
  let publicPort: number;

  function req(method: string, urlPath: string, headers: Record<string, string>, body?: string): Promise<Reply> {
    return new Promise((resolve, reject) => {
      const r = request({ host: '127.0.0.1', port: publicPort, method, path: urlPath, headers }, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, text: Buffer.concat(chunks).toString('utf8') }));
      });
      r.on('error', reject);
      if (body !== undefined) r.write(body);
      r.end();
    });
  }

  beforeEach(async () => {
    demo = await createDemo();
    token = generateToken();
    const core = createApprovalCore({ db: demo.db, clock: demo.clock, dataSource: demo.dataSource, outputDir: demo.outputDir, allowedTelegramChatIds: [] });
    publicServer = new WebApprovalServer({ db: demo.db, clock: demo.clock, dataSource: demo.dataSource, port: 0, token, approverName: 'Alex Morrow', today: () => TODAY, publicOrigin: PUBLIC });
    publicPort = await publicServer.start(core.handleAction);
  });
  afterEach(async () => {
    await publicServer.stop();
    demo.cleanup();
  });

  it('still binds to 127.0.0.1 only, and prints a public sign-in link', () => {
    expect(() => new WebApprovalServer({ db: demo.db, clock: demo.clock, dataSource: demo.dataSource, port: 0, token, approverName: 'x', today: () => TODAY, publicOrigin: PUBLIC, host: '0.0.0.0' })).toThrow();
    expect(publicServer.publicLaunchUrl()).toBe(`${PUBLIC}/?t=${encodeURIComponent(token)}`);
  });

  it('accepts exactly the public host and origin; Secure cookie only when signing in through it', async () => {
    const viaPublic = await req('GET', `/?t=${encodeURIComponent(token)}`, { Host: PUBLIC_HOST });
    expect(viaPublic.status).toBe(303);
    const cookieHeader = String(viaPublic.headers['set-cookie']);
    expect(cookieHeader).toMatch(/^pra_session=[a-f0-9]{64}; HttpOnly; SameSite=Strict; Path=\/; Secure$/);
    const viaLoopback = await req('GET', `/?t=${encodeURIComponent(token)}`, { Host: `127.0.0.1:${publicPort}` });
    expect(String(viaLoopback.headers['set-cookie'])).not.toContain('Secure');

    const cookie = cookieHeader.split(';')[0] as string;
    const page = await req('GET', '/', { Host: PUBLIC_HOST, Cookie: cookie });
    expect(page.status).toBe(200);
    const csrf = /name="csrf" value="([a-f0-9]+)"/.exec(page.text)?.[1] ?? '';
    const s02 = demo.packFor('pol-s02');
    const form = { Host: PUBLIC_HOST, Cookie: cookie, 'Content-Type': 'application/x-www-form-urlencoded' };

    // Other hosts and origins are still refused (DNS rebinding, look-alike and downgraded origins).
    for (const host of ['evil.example', `${PUBLIC_HOST}:8443`, `x.${PUBLIC_HOST}`, '203-0-113-8.sslip.io']) {
      expect((await req('GET', '/', { Host: host, Cookie: cookie })).status, host).toBe(403);
    }
    for (const origin of ['http://203-0-113-7.sslip.io', 'https://203-0-113-7.sslip.io.evil.example', 'https://evil.example', 'null']) {
      expect((await req('POST', `/pack/${s02.id}/approve`, { ...form, Origin: origin }, `csrf=${csrf}`)).status, origin).toBe(403);
    }
    expect((await req('POST', `/pack/${s02.id}/approve`, form, `csrf=${csrf}`)).status).toBe(403); // no Origin at all
    expect((await req('POST', `/pack/${s02.id}/approve`, { ...form, Origin: PUBLIC }, 'csrf=bad')).status).toBe(403); // CSRF still required

    const ok = await req('POST', `/pack/${s02.id}/approve`, { ...form, Origin: PUBLIC }, `csrf=${csrf}`);
    expect(ok.status).toBe(303);
    expect(ok.headers.location).toBe(`/pack/${s02.id}?done=approved`);
  });

  it('without the setting, the public host is refused exactly as before', async () => {
    const plain = new WebApprovalServer({ db: demo.db, clock: demo.clock, dataSource: demo.dataSource, port: 0, token, approverName: 'x', today: () => TODAY });
    const plainPort = await plain.start(async () => ({ kind: 'not_allowed', packId: 0, message: '' }));
    try {
      const reply = await new Promise<number>((resolve, reject) => {
        const r = request({ host: '127.0.0.1', port: plainPort, method: 'GET', path: `/?t=${encodeURIComponent(token)}`, headers: { Host: PUBLIC_HOST } }, (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        });
        r.on('error', reject);
        r.end();
      });
      expect(reply).toBe(403);
      expect(plain.publicLaunchUrl()).toBeNull();
    } finally {
      await plain.stop();
    }
  });
});

describe('FAKE-LLM bar over HTTP', () => {
  afterEach(async () => {
    await server.stop();
    demo.cleanup();
  });

  async function liveDemo(): Promise<void> {
    demo = await createDemo({ runPipeline: false });
    const live = { ...createGroundTruthReader(FIXTURES), isFake: false, modelName: 'live-model' };
    await runPipeline({ today: TODAY, dryRun: false, deps: demo.pipelineDeps({ reader: live }) });
  }

  it('is absent when the data came from a non-fake run and serve has no --fake-llm', async () => {
    await liveDemo();
    await startServer();
    const cookie = await login();
    expect((await http('GET', '/', { Cookie: cookie })).text).not.toContain('mode-bar');
    expect((await http('GET', `/pack/${demo.packFor('pol-s02').id}`, { Cookie: cookie })).text).not.toContain('mode-bar');
  });

  it('is present when serve runs with --fake-llm, whatever produced the data', async () => {
    await liveDemo();
    await startServer(true);
    expect((await http('GET', '/', { Cookie: await login() })).text).toContain('class="mode-bar"');
  });
});
