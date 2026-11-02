// LOCAL WEB APPROVAL PAGE (default channel, D-E). Built on Node's built-in http module (D-078).
// Reachable ONLY from this computer: it binds to 127.0.0.1 and nothing else.
// Security: Host check (DNS rebinding), random token -> HttpOnly SameSite=Strict session cookie,
// constant-time token comparison, CSRF token + Origin check on every POST, GET never changes
// state, strict CSP (scripts: only the whitelisted self-hosted motion files, D-125), every dynamic
// string escaped, file paths only from the DB.
// Presentation lives in views.ts (pure) + styles.ts (served at STYLESHEET_PATH); this file only
// gathers read-only data into view models and routes requests.

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { deriveOverallRisk } from '../../compare/compareTerms.js';
import type { DataSource } from '../../data/datasource.js';
import { daysBetween, type InstantClock } from '../../domain/dates.js';
import type { IsoDate, Severity } from '../../domain/types.js';
import { POLICY_TYPE_LABELS } from '../../outputs/labels.js';
import { type AuditDetails, createAuditLog, listAllAudit } from '../../state/audit.js';
import { all, type Db } from '../../state/db.js';
import { type CaseRow, getActivePack, getApprovalForPack, getCaseById, getPackById, listCases, type PackRow } from '../../state/repo.js';
import { weeksUntil } from '../cards.js';
import type { ActionHandler, ActionResult } from '../notifier.js';
import { type AnalyseUploadRequest, type AnalysisDeps, analyseUpload } from '../../uploads/analysisService.js';
import { messageFor, type UploadRejectionCode } from '../../uploads/errors.js';
import { RUNNING_UPLOAD_STATUSES, type UploadSide } from '../../uploads/model.js';
import { countAnalysesStartedOnLocalDay, getUpload, getUploadForPack, listStoredDocuments, listUploads, listUploadTerms, type UploadRow } from '../../uploads/repo.js';
import { deleteUploadFiles, type RetentionDeps } from '../../uploads/retention.js';
import { createOverview, exportFilePath, normaliseFilters, type OverviewDeps } from '../../outputs/overview.js';
import { getExport } from '../../uploads/repo.js';
import { auditItemsFor, uploadAuditItems } from './auditView.js';
import { isMultipart, maxUploadBodyBytes, readUploadForm } from './multipart.js';
import { timingText, statusLabel } from './present.js';
import { type FactsSide, type PolicyOption, renderExportPage, renderJobPage, renderNoCasesPage, renderUploadPage, type UploadFormValues, type UploadPageView } from './uploadViews.js';
import { SCRIPT_ASSETS, type ScriptAsset } from './clientScripts.js';
import { FONT_ASSETS, type FontAsset } from './fonts.js';
import { CONTENT_SECURITY_POLICY } from './html.js';
import { STYLESHEET, STYLESHEET_HASH, STYLESHEET_PATH } from './styles.js';
import {
  type CardView,
  type DecisionView,
  type ErrorKind,
  errorStatus,
  type ImportedView,
  type NoticeView,
  renderErrorPage,
  renderListPage,
  renderPackPage,
} from './views.js';

export const LOOPBACK = '127.0.0.1';
const COOKIE = 'pra_session';
const MAX_BODY = 4096;

export interface WebApprovalOptions {
  db: Db;
  clock: InstantClock;
  dataSource: DataSource;
  /** Must be 127.0.0.1; anything else is refused. */
  host?: string;
  /** 0 = pick a free port (tests). */
  port: number;
  token: string;
  approverName: string;
  today: () => IsoDate;
  /** serve --fake-llm: always show the FAKE-LLM bar (it also shows when a displayed pack came from a fake run). */
  fakeLlm?: boolean;
  /**
   * APPROVAL_PUBLIC_ORIGIN (validated https origin) of a TLS reverse proxy. Adds exactly ONE accepted Host
   * and Origin; the server still binds to 127.0.0.1 only. Sign-ins through it get a Secure cookie.
   */
  publicOrigin?: string;
  /**
   * D-123 PUBLIC_DEMO: no sign-in. A visitor without a session gets one on their first GET (CSRF, Origin and Host
   * checks stay on for every POST), uploads also work through the public origin, and every page says it is a public
   * demo that resets nightly. Off by default.
   */
  publicDemo?: boolean;
  /** Sessions kept in memory at most (default MAX_SESSIONS). */
  maxSessions?: number;
}

/** Sessions kept in memory at most; the oldest is dropped first (D-123: anyone can open one in a public demo). */
export const MAX_SESSIONS = 2000;

/** Prompt 7: what the upload pages need. Enabled by serve with enableUploads() once the dispatcher exists. */
export interface UploadsWebOptions {
  analysis: AnalysisDeps;
  retention: RetentionDeps;
  brokers: Array<{ id: string; name: string }>;
  retentionDays: number;
}

export class WebBindError extends Error {
  constructor(host: string) {
    super(`The approval page may only bind to ${LOOPBACK} (got "${host}")`);
    this.name = 'WebBindError';
  }
}

export function generateToken(): string {
  return randomBytes(24).toString('base64url');
}

/** Constant-time comparison (hashing first gives equal-length buffers). */
export function tokensMatch(given: string, expected: string): boolean {
  const a = createHash('sha256').update(given).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

/** 'https://203-0-113-7.sslip.io' -> '203-0-113-7.sslip.io' (port kept when not 443). Throws on anything but https. */
export function publicHostOf(origin: string): string {
  const url = new URL(origin);
  if (url.protocol !== 'https:' || url.origin !== origin) throw new Error(`Not a bare https origin: ${origin}`);
  return url.host;
}

function parseCookies(header: string | undefined): Map<string, string> {
  const map = new Map<string, string>();
  for (const part of (header ?? '').split(';')) {
    const index = part.indexOf('=');
    if (index > 0) map.set(part.slice(0, index).trim(), part.slice(index + 1).trim());
  }
  return map;
}

/** Fixed result keys for the ?done= redirect (no reflected text). */
const DONE_KEYS = new Set(['approved', 'approve_sync', 'skipped', 'already_done', 'superseded', 'wrong_state', 'not_found', 'not_allowed']);

function resultKey(result: ActionResult): string {
  if (result.kind === 'ok') {
    if (result.action === 'skip') return 'skipped';
    return result.message.startsWith('Approved. The drafts') ? 'approved' : 'approve_sync';
  }
  return result.kind;
}

const RISK_ORDER: Record<Severity, number> = { high: 0, medium: 1, low: 2, info: 3 };

export class WebApprovalServer {
  private server: Server | null = null;
  private handler: ActionHandler | null = null;
  private readonly sessions = new Map<string, { csrf: string; uploading?: boolean }>();
  private lastSessionId = '';
  private uploads: UploadsWebOptions | null = null;
  private exports: OverviewDeps | null = null;
  private boundPort = 0;
  private readonly audit;

  /** Host header value of the public origin (e.g. 203-0-113-7.sslip.io), or null when not configured. */
  private readonly publicHost: string | null;

  constructor(private readonly options: WebApprovalOptions) {
    const host = options.host ?? LOOPBACK;
    if (host !== LOOPBACK) throw new WebBindError(host);
    this.publicHost = options.publicOrigin ? publicHostOf(options.publicOrigin) : null;
    this.audit = createAuditLog(options.db, options.clock);
  }

  get port(): number {
    return this.boundPort;
  }

  /** A new session (oldest dropped beyond MAX_SESSIONS) and its cookie; Secure through the public HTTPS origin. */
  private newSessionCookie(req: IncomingMessage): string {
    const sid = randomBytes(32).toString('hex');
    this.sessions.set(sid, { csrf: randomBytes(32).toString('hex') });
    this.lastSessionId = sid;
    while (this.sessions.size > (this.options.maxSessions ?? MAX_SESSIONS)) {
      const oldest = this.sessions.keys().next().value;
      if (oldest === undefined) break;
      this.sessions.delete(oldest);
    }
    // Through the public HTTPS origin the cookie is Secure; on loopback http it cannot be.
    const secure = this.publicHost !== null && req.headers.host === this.publicHost ? '; Secure' : '';
    return `${COOKIE}=${sid}; HttpOnly; SameSite=Strict; Path=/${secure}`;
  }

  /** Prompt 7: turn on the upload pages (/analysis/...). Without this they answer 404. */
  enableUploads(options: UploadsWebOptions): void {
    this.uploads = options;
  }

  /** Prompt 7: turn on the overview spreadsheet form and the /exports routes. Without this they answer 404. */
  enableExports(deps: OverviewDeps): void {
    this.exports = deps;
  }

  /** In-flight analyses started from the page (tests wait on these). */
  readonly pendingAnalyses = new Set<Promise<unknown>>();

  /** The one URL with the token. Print it to the terminal ONLY (never to a logger, audit or file). */
  launchUrl(): string {
    return `http://${LOOPBACK}:${this.boundPort}/?t=${encodeURIComponent(this.options.token)}`;
  }

  /** The sign-in link through the public HTTPS origin, or null when none is configured. Terminal only. */
  publicLaunchUrl(): string | null {
    return this.options.publicOrigin ? `${this.options.publicOrigin}/?t=${encodeURIComponent(this.options.token)}` : null;
  }

  async start(handler: ActionHandler): Promise<number> {
    this.handler = handler;
    this.server = createServer((req, res) => {
      this.route(req, res).catch(() => {
        if (!res.headersSent) this.errorPage(res, 500);
        else res.end();
      });
    });
    await new Promise<void>((resolve, reject) => {
      this.server?.once('error', reject);
      this.server?.listen(this.options.port, LOOPBACK, () => resolve());
    });
    this.boundPort = (this.server.address() as AddressInfo).port;
    return this.boundPort;
  }

  async stop(): Promise<void> {
    this.handler = null;
    const server = this.server;
    this.server = null;
    if (!server) return;
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections?.();
    });
  }

  private headers(res: ServerResponse): void {
    res.setHeader('Content-Security-Policy', CONTENT_SECURITY_POLICY);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // 'same-origin', NOT 'no-referrer' (D-087): under no-referrer, browsers send "Origin: null" on
    // our own form POSTs, so the Origin check refused every real click. same-origin still sends
    // nothing to any other site (and the page has no external links or resources).
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Cache-Control', 'no-store');
  }

  /** Designed error page with FIXED text (nothing from the request is reflected). */
  private errorPage(res: ServerResponse, kind: ErrorKind): void {
    this.headers(res);
    res.writeHead(errorStatus(kind), { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(renderErrorPage(kind));
  }

  private forbid(res: ServerResponse, reason: string, req: IncomingMessage): void {
    // Details: reason, method, PATH (never the query string, so never the token) and, for an
    // Origin refusal, the Origin value the browser sent (helps diagnose; never secret).
    const pathname = (req.url ?? '/').split('?')[0]?.slice(0, 100) ?? '/';
    const details: AuditDetails = { reason, method: req.method ?? '', path: pathname };
    if (reason === 'bad origin') details.origin = String(req.headers.origin ?? '(none)').slice(0, 80);
    this.audit.recordAudit({ type: 'unauthorised_attempt', actor: 'broker:web', details });
    // D-137: in the public demo nobody has a sign-in link, so never show that page there.
    this.errorPage(res, this.options.publicDemo ? 'expired' : 403);
  }

  private allowedHost(value: string | undefined): boolean {
    return value === `${LOOPBACK}:${this.boundPort}` || value === `localhost:${this.boundPort}` || (this.publicHost !== null && value === this.publicHost);
  }

  private allowedOrigin(value: string | undefined): boolean {
    return (
      value === `http://${LOOPBACK}:${this.boundPort}` ||
      value === `http://localhost:${this.boundPort}` ||
      (this.options.publicOrigin !== undefined && value === this.options.publicOrigin)
    );
  }

  /** The stylesheet: immutable, content-hashed URL; served without a session (it holds no data). */
  private stylesheet(req: IncomingMessage, res: ServerResponse): void {
    const etag = `"${STYLESHEET_HASH}"`;
    this.headers(res);
    const cache = { 'Cache-Control': 'public, max-age=31536000, immutable', ETag: etag };
    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304, cache);
      res.end();
      return;
    }
    res.writeHead(200, { ...cache, 'Content-Type': 'text/css; charset=utf-8' });
    res.end(STYLESHEET);
  }

  /** A whitelisted font file (exact path match from FONT_ASSETS; nothing from the request touches the disk). */
  private font(font: FontAsset, req: IncomingMessage, res: ServerResponse): void {
    const etag = `"${font.hash}"`;
    this.headers(res);
    const cache = { 'Cache-Control': 'public, max-age=31536000, immutable', ETag: etag };
    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304, cache);
      res.end();
      return;
    }
    res.writeHead(200, { ...cache, 'Content-Type': 'font/woff2', 'Content-Length': String(font.body.length) });
    res.end(font.body);
  }

  /** A whitelisted motion script (exact path match from SCRIPT_ASSETS, D-125; nothing from the request touches the disk). */
  private script(script: ScriptAsset, req: IncomingMessage, res: ServerResponse): void {
    const etag = `"${script.hash}"`;
    this.headers(res);
    const cache = { 'Cache-Control': 'public, max-age=31536000, immutable', ETag: etag };
    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304, cache);
      res.end();
      return;
    }
    res.writeHead(200, { ...cache, 'Content-Type': 'text/javascript; charset=utf-8', 'Content-Length': String(script.body.length) });
    res.end(script.body);
  }

  private async route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!this.allowedHost(req.headers.host)) return this.forbid(res, 'bad host header', req);
    const url = new URL(req.url ?? '/', `http://${LOOPBACK}:${this.boundPort}`);

    if (url.pathname.startsWith('/assets/')) {
      if (req.method === 'GET' && url.pathname === STYLESHEET_PATH) return this.stylesheet(req, res);
      const font = req.method === 'GET' ? FONT_ASSETS.get(url.pathname) : undefined;
      if (font) return this.font(font, req, res);
      const script = req.method === 'GET' ? SCRIPT_ASSETS.get(url.pathname) : undefined;
      if (script) return this.script(script, req, res);
      return this.errorPage(res, req.method === 'GET' ? 404 : 405);
    }

    // First visit: /?t=<token> -> session cookie -> clean URL.
    if (req.method === 'GET' && url.pathname === '/' && url.searchParams.has('t')) {
      if (!tokensMatch(url.searchParams.get('t') ?? '', this.options.token)) {
        if (!this.options.publicDemo) return this.forbid(res, 'bad token', req);
        // D-137: an old shared link (?t= from before a restart) just opens the demo.
        this.headers(res);
        res.writeHead(303, { Location: '/' });
        res.end();
        return;
      }
      const cookie = this.newSessionCookie(req);
      this.headers(res);
      res.writeHead(303, { 'Set-Cookie': cookie, Location: '/' });
      res.end();
      return;
    }

    let session = this.sessions.get(parseCookies(req.headers.cookie).get(COOKIE) ?? '');
    if (!session && this.options.publicDemo && req.method === 'GET') {
      // D-123: open demo. The cookie rides on this very response; every POST still needs it plus a CSRF token.
      res.setHeader('Set-Cookie', this.newSessionCookie(req));
      session = this.sessions.get(this.lastSessionId) as { csrf: string };
    }
    if (!session) return this.forbid(res, 'missing or invalid session', req);

    if (url.pathname === '/analysis' || url.pathname.startsWith('/analysis/')) return this.routeAnalysis(req, res, url, session);
    if (url.pathname === '/exports' || url.pathname.startsWith('/exports/')) return this.routeExports(req, res, url, session);

    const packMatch = /^\/pack\/(\d{1,9})(?:\/(open|approve|skip))?$/.exec(url.pathname);
    if (req.method === 'GET') {
      if (url.pathname === '/') return this.sendHtml(res, await this.renderIndex(session.csrf, this.showUploads(req)));
      if (packMatch && !packMatch[2]) {
        const done = url.searchParams.get('done');
        const html = await this.renderPack(Number(packMatch[1]), session.csrf, done && DONE_KEYS.has(done) ? done : null, this.showUploads(req));
        return html === null ? this.errorPage(res, 404) : this.sendHtml(res, html);
      }
      if (packMatch && packMatch[2] === 'open') return this.open(Number(packMatch[1]), res);
      return this.errorPage(res, 404);
    }
    if (req.method === 'POST') {
      if (!packMatch || (packMatch[2] !== 'approve' && packMatch[2] !== 'skip')) return this.errorPage(res, 404);
      if (!this.allowedOrigin(req.headers.origin)) return this.forbid(res, 'bad origin', req);
      const body = await readBody(req);
      if (body === null) return this.errorPage(res, 413);
      const csrf = new URLSearchParams(body).get('csrf') ?? '';
      if (!tokensMatch(csrf, session.csrf)) return this.forbid(res, 'bad csrf token', req);
      if (!this.handler) return this.errorPage(res, 503);
      const packId = Number(packMatch[1]);
      const result = await this.handler({ action: packMatch[2], packId, actor: 'broker:web', channel: 'web' });
      this.headers(res);
      res.writeHead(303, { Location: `/pack/${packId}?done=${resultKey(result)}` });
      res.end();
      return;
    }
    return this.errorPage(res, 405);
  }

  // ---- Prompt 7: upload and analysis pages ------------------------------------------------

  private async routeAnalysis(req: IncomingMessage, res: ServerResponse, url: URL, session: { csrf: string; uploading?: boolean }): Promise<void> {
    if (!this.uploads) return this.errorPage(res, 404);
    // Uploads send document text to the AI provider and store files here: this computer only (D-109).
    if (!this.options.publicDemo && this.publicHost !== null && req.headers.host === this.publicHost) return this.errorPage(res, 'uploads_local_only');
    const jobMatch = /^\/analysis\/(\d{1,9})(?:\/(delete))?$/.exec(url.pathname);
    if (req.method === 'GET') {
      if (url.pathname === '/analysis/new') return this.sendHtml(res, await this.renderUploadPageFor(session.csrf, { policy: url.searchParams.get('policy') }));
      if (jobMatch && !jobMatch[2]) {
        const html = await this.renderJobPageFor(Number(jobMatch[1]), session.csrf);
        return html === null ? this.errorPage(res, 404) : this.sendHtml(res, html);
      }
      return this.errorPage(res, url.pathname === '/analysis' ? 405 : 404);
    }
    if (req.method !== 'POST') return this.errorPage(res, 405);
    if (url.pathname === '/analysis') return this.handleUpload(req, res, session);
    if (jobMatch && jobMatch[2] === 'delete') return this.handleDeleteFiles(Number(jobMatch[1]), req, res, session);
    return this.errorPage(res, 404);
  }

  /** Discard the rest of a refused body, answer, and close the connection shortly after the answer. */
  private closeAfter(req: IncomingMessage, res: ServerResponse): void {
    res.setHeader('Connection', 'close');
    req.resume();
    res.on('finish', () => {
      const timer = setTimeout(() => req.destroy(), 1000);
      timer.unref();
    });
  }

  private async handleUpload(req: IncomingMessage, res: ServerResponse, session: { csrf: string; uploading?: boolean }): Promise<void> {
    const uploads = this.uploads as UploadsWebOptions;
    // Host and the session cookie were checked by route(); the Origin check comes BEFORE any body byte is read.
    if (!this.allowedOrigin(req.headers.origin)) {
      this.closeAfter(req, res);
      return this.forbid(res, 'bad origin', req);
    }
    if (!isMultipart(req.headers['content-type'])) {
      this.closeAfter(req, res);
      return this.errorPage(res, 400);
    }
    const formLimits = { maxFileBytes: uploads.analysis.limits.maxBytes };
    const declared = Number(req.headers['content-length']);
    if (Number.isFinite(declared) && declared > maxUploadBodyBytes(formLimits)) {
      this.closeAfter(req, res);
      return this.sendUploadRejection(res, session.csrf, 413, 'too_large', null, {});
    }
    if (session.uploading) {
      this.closeAfter(req, res);
      return this.sendUploadRejection(res, session.csrf, 429, 'busy', null, {});
    }
    session.uploading = true;
    try {
      const form = await readUploadForm(req, formLimits, (token) => tokensMatch(token, session.csrf));
      if (form.kind === 'aborted') return;
      if (form.kind === 'csrf') {
        this.closeAfter(req, res);
        return this.forbid(res, 'bad csrf token', req);
      }
      if (form.kind === 'too_large') {
        this.closeAfter(req, res);
        return this.sendUploadRejection(res, session.csrf, 413, 'too_large', null, {});
      }
      if (form.kind === 'bad_request') {
        this.closeAfter(req, res);
        return this.errorPage(res, 400);
      }
      if (form.kind === 'duplicate_side') {
        this.closeAfter(req, res);
        return this.sendUploadRejection(res, session.csrf, 400, 'duplicate_side', null, {});
      }
      const mode = form.fields.mode === 'attach' || form.fields.mode === 'new' ? form.fields.mode : null;
      const values: UploadFormValues = {
        ...(form.fields.policy ? { policy: form.fields.policy } : {}),
        ...(form.fields.client_name ? { client_name: form.fields.client_name } : {}),
        ...(form.fields.contact_name ? { contact_name: form.fields.contact_name } : {}),
        ...(form.fields.contact_email ? { contact_email: form.fields.contact_email } : {}),
        ...(form.fields.broker ? { broker: form.fields.broker } : {}),
      };
      if (!mode) return this.sendUploadRejection(res, session.csrf, 400, 'invalid_input', null, values);
      const files: AnalyseUploadRequest['files'] = {};
      for (const side of ['expiring', 'renewal'] as const) {
        const file = form.files[side];
        if (file) files[side] = { bytes: file.bytes, clientFilename: file.filename };
      }
      let resolveStarted: (job: UploadRow) => void = () => {};
      const started = new Promise<UploadRow>((resolve) => {
        resolveStarted = resolve;
      });
      const request: AnalyseUploadRequest = {
        mode,
        ...(mode === 'attach' && values.policy ? { policyId: values.policy } : {}),
        ...(mode === 'new'
          ? {
              newPolicy: {
                clientName: values.client_name ?? '',
                brokerId: values.broker ?? '',
                ...(values.contact_name ? { contactName: values.contact_name } : {}),
                ...(values.contact_email ? { contactEmail: values.contact_email } : {}),
              },
            }
          : {}),
        files,
        consent: form.fields.consent === 'yes',
        actor: 'broker:web',
        onStarted: (job) => resolveStarted(job),
      };
      const running = analyseUpload(request, uploads.analysis);
      const tracked = running.catch(() => undefined).finally(() => this.pendingAnalyses.delete(tracked));
      this.pendingAnalyses.add(tracked);
      const first = await Promise.race([running.then((result) => ({ kind: 'finished' as const, result })), started.then((job) => ({ kind: 'started' as const, job }))]);
      const job = first.kind === 'started' ? first.job : first.result.job;
      if (first.kind === 'finished' && first.result.job.status === 'rejected') {
        const code = first.result.job.failureCode as UploadRejectionCode | null;
        return this.sendUploadRejection(res, session.csrf, rejectionStatus(code), code, mode, values, first.result.message);
      }
      this.headers(res);
      res.writeHead(303, { Location: `/analysis/${job.id}` });
      res.end();
    } finally {
      session.uploading = false;
    }
  }

  private async sendUploadRejection(
    res: ServerResponse,
    csrf: string,
    status: number,
    code: UploadRejectionCode | null,
    mode: 'attach' | 'new' | null,
    values: UploadFormValues,
    message?: string,
  ): Promise<void> {
    const text = message ?? (code ? messageFor(code) : 'The form could not be read.');
    const html = await this.renderUploadPageFor(csrf, { policy: values.policy ?? null, errorFor: mode ?? 'new', error: text, values });
    this.headers(res);
    res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  }

  private async handleDeleteFiles(jobId: number, req: IncomingMessage, res: ServerResponse, session: { csrf: string }): Promise<void> {
    const uploads = this.uploads as UploadsWebOptions;
    if (!this.allowedOrigin(req.headers.origin)) return this.forbid(res, 'bad origin', req);
    const body = await readBody(req);
    if (body === null) return this.errorPage(res, 413);
    const csrf = new URLSearchParams(body).get('csrf') ?? '';
    if (!tokensMatch(csrf, session.csrf)) return this.forbid(res, 'bad csrf token', req);
    const result = deleteUploadFiles(uploads.retention, jobId, 'broker:web');
    if (!result.found) return this.errorPage(res, 404);
    this.headers(res);
    res.writeHead(303, { Location: `/analysis/${jobId}` });
    res.end();
  }

  // ---- Prompt 7 U4: overview spreadsheet -------------------------------------------------

  private pageContext(csrf: string, req: IncomingMessage) {
    return {
      runDate: this.options.today(),
      approverName: this.options.approverName,
      fakeLlm: this.options.fakeLlm === true,
      csrf,
      ...(this.showUploads(req) ? {} : { uploadsHidden: true }),
      ...(this.options.publicDemo ? { publicDemo: true } : {}),
    };
  }

  /** D-122: upload entry points appear only when uploads are enabled AND the request did not come through the public origin. */
  private showUploads(req: IncomingMessage): boolean {
    return this.uploads !== null && (this.options.publicDemo === true || !(this.publicHost !== null && req.headers.host === this.publicHost));
  }

  private async routeExports(req: IncomingMessage, res: ServerResponse, url: URL, session: { csrf: string }): Promise<void> {
    if (!this.exports) return this.errorPage(res, 404);
    const match = /^\/exports\/(\d{1,9})(?:\/(download))?$/.exec(url.pathname);
    if (req.method === 'GET') {
      if (!match) return this.errorPage(res, url.pathname === '/exports' ? 405 : 404);
      const id = Number(match[1]);
      if (match[2] === 'download') return this.downloadExport(id, res);
      const record = getExport(this.options.db, id);
      if (!record) return this.errorPage(res, 404);
      const statuses = Array.isArray(record.filters.statuses) ? record.filters.statuses.map(String) : [];
      return this.sendHtml(
        res,
        renderExportPage({ ...this.pageContext(session.csrf, req), id: record.id, createdAt: record.createdAt, rowCount: record.rowCount, statuses, includeManual: record.filters.includeManual !== false, created: url.searchParams.get('done') === 'existing' ? false : null }),
      );
    }
    if (req.method !== 'POST' || url.pathname !== '/exports') return this.errorPage(res, req.method === 'POST' ? 404 : 405);
    if (!this.allowedOrigin(req.headers.origin)) return this.forbid(res, 'bad origin', req);
    const body = await readBody(req);
    if (body === null) return this.errorPage(res, 413);
    const form = new URLSearchParams(body);
    if (!tokensMatch(form.get('csrf') ?? '', session.csrf)) return this.forbid(res, 'bad csrf token', req);
    const statuses = form.getAll('status');
    if (statuses.length === 0) return this.sendHtml(res, renderNoCasesPage(this.pageContext(session.csrf, req)));
    const filters = normaliseFilters({ statuses, includeManual: form.get('include_manual') === 'yes' });
    const result = await createOverview({ filters, runDate: this.options.today(), actor: 'broker:web' }, this.exports);
    if (result.kind === 'empty') return this.sendHtml(res, renderNoCasesPage(this.pageContext(session.csrf, req)));
    this.headers(res);
    res.writeHead(303, { Location: `/exports/${result.record.id}${result.kind === 'existing' ? '?done=existing' : ''}` });
    res.end();
  }

  /** The path comes from the database by export id and must resolve inside OUTPUT_DIR/overview; never from the request. */
  private downloadExport(id: number, res: ServerResponse): void {
    const found = this.exports ? exportFilePath(this.exports, id) : null;
    if (!found) {
      this.errorPage(res, 404);
      return;
    }
    const safeName = `overview-${found.record.relativePath.split('/')[1] ?? 'export'}-${found.record.contentHash.slice(0, 12)}.xlsx`.replace(/[^a-z0-9.-]/gi, '');
    this.headers(res);
    res.writeHead(200, {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${safeName}"`,
    });
    createReadStream(found.absolutePath).pipe(res);
  }

  private uploadWasFake(uploadId: number | null): boolean {
    if (uploadId === null) return false;
    return listAllAudit(this.options.db).some((event) => event.type === 'analysis_started' && event.details.uploadId === uploadId && event.details.fakeLlm === true);
  }

  private async subjectFor(job: UploadRow): Promise<string> {
    if (!job.policyId) return job.mode === 'new' ? 'New policy' : 'Unknown policy';
    const labels = await this.policyLabels(job.policyId);
    return labels ? `${labels.clientName} - ${labels.policyType}` : job.mode === 'new' ? 'New policy' : 'Unknown policy';
  }

  private async attachOptions(): Promise<PolicyOption[]> {
    const options: PolicyOption[] = [];
    for (const policy of await this.options.dataSource.listPolicies()) {
      const client = await this.options.dataSource.getClient(policy.clientId);
      const paths = await this.options.dataSource.getDocumentPaths(policy.id);
      const missing: UploadSide | null = !paths.renewal ? 'renewal' : !paths.expiring ? 'expiring' : null;
      options.push({ id: policy.id, label: `${client?.name ?? 'Unknown client'} - ${POLICY_TYPE_LABELS[policy.type]} (renews ${policy.expiryDate})`, missing });
    }
    return options.sort((a, b) => (a.missing ? 0 : 1) - (b.missing ? 0 : 1) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }

  private async renderUploadPageFor(
    csrf: string,
    input: { policy: string | null; errorFor?: 'attach' | 'new'; error?: string; values?: UploadFormValues },
  ): Promise<string> {
    const uploads = this.uploads as UploadsWebOptions;
    const { db } = this.options;
    const policies = await this.attachOptions();
    // ?policy= only PRESELECTS an option, and only one that exists in the list.
    const selectedPolicy = input.policy && policies.some((p) => p.id === input.policy) ? input.policy : null;
    const recent = [];
    for (const job of listUploads(db, 10)) recent.push({ id: job.id, createdAt: job.createdAt, mode: job.mode, subject: await this.subjectFor(job), status: job.status });
    const view: UploadPageView = {
      runDate: this.options.today(),
      approverName: this.options.approverName,
      // D-123: the upload page is about the UPLOAD reader, which may be live while the demo data is fake.
      fakeLlm: uploads.analysis.knownDocuments !== undefined,
      ...(this.options.publicDemo ? { publicDemo: true } : {}),
      csrf,
      limits: {
        maxMb: Math.round(uploads.analysis.limits.maxBytes / (1024 * 1024)),
        maxPages: uploads.analysis.limits.maxPages,
        dailyLimit: uploads.analysis.dailyLimit,
        retentionDays: uploads.retentionDays,
      },
      aiConfigured: uploads.analysis.reader !== null,
      policies,
      brokers: uploads.brokers,
      selectedPolicy,
      errorFor: input.errorFor ?? null,
      error: input.error ?? null,
      values: input.values ?? {},
      recent,
      usedToday: countAnalysesStartedOnLocalDay(db, this.options.clock.now(), uploads.analysis.timeZone),
    };
    return renderUploadPage(view);
  }

  private async renderJobPageFor(jobId: number, csrf: string): Promise<string | null> {
    const { db } = this.options;
    const job = getUpload(db, jobId);
    if (!job) return null;
    const docs = listStoredDocuments(db, job.id);
    const facts: Partial<Record<UploadSide, FactsSide>> = {};
    for (const row of listUploadTerms(db, job.id)) facts[row.side] = { source: row.source, terms: row.terms, warnings: row.warnings, repairedFields: row.repairedFields };
    const pack = job.packId ? getPackById(db, job.packId) : undefined;
    const caseRow = pack ? getCaseById(db, pack.caseId) : undefined;
    const card = pack && caseRow ? await this.cardFor(pack, caseRow) : null;
    const events = listAllAudit(db);
    const finished = events.filter((e) => e.type === 'analysis_finished' && e.details.uploadId === job.id).at(-1);
    const outcome = typeof finished?.details.outcome === 'string' ? finished.details.outcome : null;
    const running = (RUNNING_UPLOAD_STATUSES as readonly string[]).includes(job.status);
    const uploadedSides = new Set(docs.map((d) => d.side));
    const dataSourceSide = job.mode === 'attach' && job.startedAt ? (['expiring', 'renewal'] as const).find((side) => !uploadedSides.has(side)) ?? null : null;
    return renderJobPage({
      runDate: this.options.today(),
      approverName: this.options.approverName,
      fakeLlm: this.uploadWasFake(job.id),
      ...(this.options.publicDemo ? { publicDemo: true } : {}),
      csrf,
      id: job.id,
      mode: job.mode,
      status: job.status,
      subject: await this.subjectFor(job),
      createdAt: job.createdAt,
      startedAt: job.startedAt,
      finishedAt: job.finishedAt,
      failureCode: job.failureCode,
      failureMessage: job.failureMessage,
      tokensIn: job.tokensIn,
      tokensOut: job.tokensOut,
      documents: docs.map((d) => ({ side: d.side, displayName: d.displayName, sizeBytes: d.sizeBytes, pageCount: d.pageCount, deletedAt: d.deletedAt })),
      dataSourceSide,
      facts,
      pack:
        pack && card
          ? {
              id: pack.id,
              title: `${card.card.clientName} - ${card.card.policyType}`,
              risk: card.card.risk,
              flagCount: card.card.flagCount,
              diffCount: card.card.diffs.length,
              version: pack.version,
              statusLabel: pack.status === 'superseded' ? 'Replaced by a newer version' : statusLabel(card.card.status),
              active: pack.status === 'active',
            }
          : null,
      outcome,
      audit: uploadAuditItems(events, job, pack?.pack.cycleKey ?? null, this.options.approverName),
      refreshSeconds: running ? 2 : null,
    });
  }

  private sendHtml(res: ServerResponse, html: string): void {
    this.headers(res);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  }

  private async open(packId: number, res: ServerResponse): Promise<void> {
    if (!this.handler) return this.errorPage(res, 503);
    const result = await this.handler({ action: 'open', packId, actor: 'broker:web', channel: 'web' });
    if (result.kind !== 'ok' || !result.xlsxPath) return this.errorPage(res, 'spreadsheet');
    const pack = getPackById(this.options.db, packId) as PackRow;
    const safeName = `comparison-${pack.pack.policyId.replace(/[^a-z0-9-]/gi, '')}-v${pack.version}.xlsx`;
    this.headers(res);
    res.writeHead(200, {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${safeName}"`,
    });
    createReadStream(result.xlsxPath).pipe(res);
  }

  // ---- read-only data gathering for the views --------------------------------------------

  private decisionFor(packId: number): DecisionView | null {
    const approval = getApprovalForPack(this.options.db, packId);
    if (!approval) return null;
    return { action: approval.action === 'skip' ? 'skip' : 'approve', at: String(approval.at), channel: String(approval.channel) };
  }

  /** True when serve has --fake-llm, or when any of these packs was written by a fake-LLM run. */
  private isFakeMode(packs: readonly PackRow[]): boolean {
    // D-123: an uploaded pack is fake only if ITS analysis was; pipeline packs follow serve --fake-llm or their run.
    if (packs.some((pack) => pack.inputSource === 'upload' && this.uploadWasFake(getUploadForPack(this.options.db, pack.id)?.id ?? null))) return true;
    const pipelinePacks = packs.filter((pack) => pack.inputSource !== 'upload');
    if (this.options.fakeLlm && (packs.length === 0 || pipelinePacks.length > 0)) return true;
    const runIds = [...new Set(pipelinePacks.map((p) => p.runId).filter((id): id is string => id !== null))];
    if (runIds.length === 0) return false;
    const rows = all(this.options.db, `SELECT details FROM audit_events WHERE type = 'run_started' AND run_id IN (${runIds.map(() => '?').join(', ')})`, ...runIds);
    return rows.some((row) => {
      try {
        return (JSON.parse(String(row.details)) as AuditDetails).fakeLlm === true;
      } catch {
        return false;
      }
    });
  }

  private async cardFor(pack: PackRow, caseRow: CaseRow): Promise<{ card: CardView; insurerName: string } | null> {
    const policy = await this.options.dataSource.getPolicy(pack.pack.policyId);
    const client = policy ? await this.options.dataSource.getClient(policy.clientId) : undefined;
    if (!policy || !client) return null;
    return {
      insurerName: policy.insurerName,
      card: {
        packId: pack.id,
        clientName: client.name,
        policyType: POLICY_TYPE_LABELS[policy.type],
        version: pack.version,
        expiryDate: policy.expiryDate,
        weeks: weeksUntil(this.options.today(), policy.expiryDate),
        risk: deriveOverallRisk(pack.pack.diffs, pack.pack.flags),
        diffs: pack.pack.diffs,
        flagCount: pack.pack.flags.length,
        status: caseRow.status,
        decision: this.decisionFor(pack.id),
        syncState: pack.syncState,
        ...(pack.inputSource === 'upload'
          ? { uploaded: true, timing: timingText(daysBetween(this.options.today(), policy.expiryDate)), ...uploadIdOf(getUploadForPack(this.options.db, pack.id)) }
          : {}),
      },
    };
  }

  private async policyLabels(policyId: string): Promise<{ clientName: string; policyType: string; expiryDate: IsoDate } | null> {
    const policy = await this.options.dataSource.getPolicy(policyId);
    const client = policy ? await this.options.dataSource.getClient(policy.clientId) : undefined;
    if (!policy || !client) return null;
    return { clientName: client.name, policyType: POLICY_TYPE_LABELS[policy.type], expiryDate: policy.expiryDate };
  }

  private async renderIndex(csrf: string, showUploads = this.uploads !== null): Promise<string> {
    const { db } = this.options;
    const waiting: CardView[] = [];
    const decided: CardView[] = [];
    const attention: Array<NoticeView & { policyId: string }> = [];
    const imported: ImportedView[] = [];
    const activePacks: PackRow[] = [];
    const counts = { waiting: 0, approved: 0, skipped: 0, attention: 0 };
    for (const caseRow of listCases(db)) {
      if (caseRow.status === 'approved') counts.approved++;
      if (caseRow.status === 'skipped') counts.skipped++;
      const pack = getActivePack(db, caseRow.id);
      if (pack) {
        activePacks.push(pack);
        const data = await this.cardFor(pack, caseRow);
        if (!data) continue;
        if (caseRow.status === 'in_review') waiting.push(data.card);
        else if (caseRow.status === 'approved' || caseRow.status === 'skipped') decided.push(data.card);
        continue;
      }
      const labels = await this.policyLabels(caseRow.policyId);
      if (!labels) continue;
      if (caseRow.status === 'needs_attention') {
        const uploadHref = showUploads && caseRow.origin === 'data_source' ? `/analysis/new?policy=${encodeURIComponent(caseRow.policyId)}` : undefined;
        attention.push({ ...labels, reason: caseRow.attentionReason, policyId: caseRow.policyId, ...(uploadHref ? { uploadHref } : {}) });
      }
      else if (caseRow.status === 'approved') imported.push(labels);
    }
    waiting.sort((a, b) => RISK_ORDER[a.risk] - RISK_ORDER[b.risk] || (a.expiryDate < b.expiryDate ? -1 : a.expiryDate > b.expiryDate ? 1 : a.packId - b.packId));
    decided.sort((a, b) => ((a.decision?.at ?? '') < (b.decision?.at ?? '') ? 1 : (a.decision?.at ?? '') > (b.decision?.at ?? '') ? -1 : a.packId - b.packId));
    attention.sort((a, b) => (a.policyId < b.policyId ? -1 : a.policyId > b.policyId ? 1 : 0));
    counts.waiting = waiting.length;
    counts.attention = attention.length;
    return renderListPage({
      runDate: this.options.today(),
      approverName: this.options.approverName,
      fakeLlm: this.isFakeMode(activePacks),
      csrf,
      waiting,
      decided,
      attention: attention.map(({ policyId: _policyId, ...notice }) => notice),
      imported,
      counts,
      ...(showUploads ? { uploadsEnabled: true } : {}),
      ...(this.exports ? { overviewEnabled: true } : {}),
      ...(this.options.publicDemo ? { publicDemo: true } : {}),
    });
  }

  /** null = no such pack (the caller answers 404). */
  private async renderPack(packId: number, csrf: string, done: string | null, showUploads = this.uploads !== null): Promise<string | null> {
    const { db } = this.options;
    const pack = getPackById(db, packId);
    const caseRow = pack ? getCaseById(db, pack.caseId) : undefined;
    if (!pack || !caseRow) return null;
    const data = await this.cardFor(pack, caseRow);
    if (!data) return null;
    // D-122: through the public origin the "analysis N" link would lead to a refusal page, so it is left out.
    if (!showUploads) delete data.card.uploadId;
    const active = getActivePack(db, caseRow.id);
    return renderPackPage({
      runDate: this.options.today(),
      approverName: this.options.approverName,
      fakeLlm: this.isFakeMode([pack]),
      csrf,
      card: data.card,
      flags: pack.pack.flags,
      insurerName: data.insurerName,
      policyId: pack.pack.policyId,
      cycleKey: pack.pack.cycleKey,
      packStatus: pack.status,
      activePack: active ? { id: active.id, version: active.version } : null,
      done,
      audit: auditItemsFor(this.audit.listAudit(pack.pack.policyId), pack.pack.cycleKey, this.options.approverName),
      createdAt: pack.createdAt,
      contentHash: pack.contentHash,
      inputHash: pack.inputHash,
      ...(showUploads ? { uploadsEnabled: true } : {}),
      ...(this.options.publicDemo ? { publicDemo: true } : {}),
    });
  }
}

async function readBody(req: IncomingMessage): Promise<string | null> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) return null;
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function uploadIdOf(job: UploadRow | undefined): { uploadId?: number } {
  return job ? { uploadId: job.id } : {};
}

/** Typed door rejections -> HTTP status of the re-rendered upload page. */
export function rejectionStatus(code: UploadRejectionCode | null): number {
  if (code === 'too_large') return 413;
  if (code === 'not_a_pdf') return 415;
  if (code === 'daily_limit_reached' || code === 'busy') return 429;
  return 400;
}
