// Server-rendered HTML building blocks for the approval page. No inline script and no event-handler
// attributes (the only scripts are the whitelisted, self-hosted motion files in clientScripts.ts, D-125),
// no external resources, no inline style attributes, no <style> blocks: all styling comes from the stylesheet route.
// Every dynamic string goes through escapeHtml (documents are untrusted). Pure functions only.

import { formatLongDate } from '../../domain/dates.js';
import { cleanText } from '../../domain/text.js';
import type { IsoDate, Severity } from '../../domain/types.js';
import { SCRIPT_TAGS } from './clientScripts.js';
import { PRELOAD_FONT_PATH } from './fonts.js';
import { STYLESHEET_PATH } from './styles.js';



/** THE escaping helper. Every dynamic value in every view passes through it. */
export function escapeHtml(value: unknown): string {
  // Control characters and bidi overrides are removed before escaping (Prompt 5 D-130, Prompt 7 D-110: one
  // shared helper, src/domain/text.ts).
  return cleanText(String(value))
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * The page's Content-Security-Policy. style-src 'self' allows ONLY the stylesheet served by this
 * server (no inline styles, no style attributes, no other origin); font-src 'self' allows only the
 * self-hosted font files. script-src 'self' (Prompt 8, D-125) allows ONLY the whitelisted motion scripts served by
 * this server: no inline script, no eval, no other origin.
 */
export const CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "font-src 'self'",
  "img-src 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
].join('; ');

export interface NavCounts {
  waiting: number;
  attention: number;
  decided: number;
}

export interface Chrome {
  /** <title> text (also escaped). */
  title: string;
  /** Run date pill in the top bar. Omitted on error pages. */
  runDate?: IsoDate;
  /** Approver card in the sidebar. Omitted on error pages. */
  approverName?: string;
  /** FAKE-LLM honesty bar. */
  fakeLlm: boolean;
  /** Breadcrumb trail after "Renewals"; empty = none. */
  crumbs?: string[];
  /** Counts shown next to the sidebar links (list page). */
  nav?: NavCounts;
  /** Error pages: no sidebar, centred content. */
  minimal?: boolean;
  /** Prompt 7: show the 'Analyse documents' link in the sidebar (only when uploads are enabled). */
  uploadsNav?: 'link' | 'current';
  /** Prompt 7: an extra sentence for the FAKE-LLM bar on the upload pages. */
  fakeExtra?: string;
  /**
   * Prompt 7: <meta http-equiv="refresh"> seconds while an analysis is running. Not script: the CSP has no
   * directive for it (verified by running it in a browser, see docs/UPLOADS.md).
   */
  refreshSeconds?: number;
  /** D-123: a public demo open to everyone (no sign-in): say so on every page. */
  publicDemo?: boolean;
}

export const PUBLIC_DEMO_NOTE = 'anyone with the link can use this demo, and it resets every night (New Zealand time). Use made-up documents only: uploaded text is sent to the AI provider.';

/** Shown after a bold "Demo mode:" whenever the data on screen came from the fake-LLM reader. */
export const FAKE_LLM_NOTE = 'the policy terms on this page come from the answer keys, not from live AI reading of the documents.';
export const PRODUCT_NAME = 'Pre-Renewal Autopilot';

/** 'Alex Morrow' -> 'AM'. Letters only, so nothing odd can reach the avatar. */
export function initials(name: string): string {
  const letters = name
    .split(/\s+/)
    .map((word) => /[A-Za-z]/.exec(word)?.[0] ?? '')
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
  return letters || '?';
}

const logo = `<a class="logo" href="/"><span class="logo__mark" aria-hidden="true">PA</span><span class="logo__name">${escapeHtml(PRODUCT_NAME)}</span></a>`;

function navLink(href: string, label: string, count: number | undefined, current: boolean): string {
  const badge = count === undefined ? '' : `<span class="nav__count">${escapeHtml(count)}</span>`;
  return `<li><a class="nav__item${current ? ' is-current' : ''}" href="${href}"${current ? ' aria-current="page"' : ''}><span>${escapeHtml(label)}</span>${badge}</a></li>`;
}

function sidebar(chrome: Chrome): string {
  const onList = chrome.nav !== undefined;
  const uploads = chrome.uploadsNav ? navLink('/analysis/new', 'Analyse documents', undefined, chrome.uploadsNav === 'current') : '';
  const nav = `<nav class="nav" aria-label="Main"><ul>${navLink('/', 'Renewals', chrome.nav?.waiting, onList)}${navLink('/#attention', 'Needs attention', chrome.nav?.attention, false)}${navLink('/#decided', 'Decided', chrome.nav?.decided, false)}${uploads}</ul></nav>`;
  const user =
    chrome.approverName !== undefined
      ? `<div class="user"><span class="avatar" aria-hidden="true">${escapeHtml(initials(chrome.approverName))}</span><span class="user__text"><span class="user__name">${escapeHtml(chrome.approverName)}</span><span class="user__role">Approver</span></span></div>`
      : '';
  return `<aside class="sidebar" aria-label="Product">${logo}${nav}<div class="sidebar__foot"><p class="sidebar__note"><strong>Concept project</strong><span>Synthetic data only. Drafts only: nothing is ever sent.</span></p>${user}</div></aside>`;
}

function topbar(chrome: Chrome): string {
  const crumbs = chrome.crumbs?.length
    ? chrome.crumbs.map((crumb, i, all) => (i === all.length - 1 ? `<li aria-current="page">${escapeHtml(crumb)}</li>` : `<li>${escapeHtml(crumb)}</li>`)).join('')
    : '';
  const trail = chrome.minimal ? logo : `<nav class="crumbs" aria-label="Breadcrumb"><ol><li><a href="/">Renewals</a></li>${crumbs}</ol></nav>`;
  const pills = chrome.runDate
    ? `<div class="topbar__meta"><span class="pill">Run ${escapeHtml(formatLongDate(chrome.runDate))}</span><span class="pill pill--accent"><span class="pill__dot" aria-hidden="true"></span>Drafts only</span></div>`
    : '';
  return `<header class="app-header"><div class="topbar">${trail}${pills}</div></header>`;
}

/** The full document. `main` is already-escaped HTML built by the view functions. */
export function page(chrome: Chrome, main: string): string {
  const extra = chrome.fakeExtra ? ` ${escapeHtml(chrome.fakeExtra)}` : '';
  const fake = chrome.fakeLlm ? `<div class="mode-bar" role="note"><strong>Demo mode:</strong> ${escapeHtml(FAKE_LLM_NOTE)}${extra}</div>` : '';
  const open = chrome.publicDemo ? `<div class="mode-bar mode-bar--public" role="note"><strong>Public demo:</strong> ${escapeHtml(PUBLIC_DEMO_NOTE)}</div>` : '';
  const refresh = chrome.refreshSeconds && Number.isInteger(chrome.refreshSeconds) && chrome.refreshSeconds > 0 ? `<meta http-equiv="refresh" content="${chrome.refreshSeconds}">` : '';
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light">${refresh}
<title>${escapeHtml(chrome.title)} - ${escapeHtml(PRODUCT_NAME)}</title><link rel="preload" href="${PRELOAD_FONT_PATH}" as="font" type="font/woff2" crossorigin><link rel="stylesheet" href="${STYLESHEET_PATH}">${SCRIPT_TAGS}</head>
<body><a class="skip" href="#main">Skip to main content</a>
<div class="shell${chrome.minimal ? ' shell--minimal' : ''}">${chrome.minimal ? '' : sidebar(chrome)}<div class="content">${open}${fake}${topbar(chrome)}
<main id="main" class="main">${main}</main>
<footer class="app-footer">Concept portfolio project. Synthetic data only. Drafts only: nothing is ever sent.</footer>
</div></div>
</body></html>`;
}

export const SEVERITY_WORDS: Record<Severity, string> = { high: 'High', medium: 'Medium', low: 'Low', info: 'Info' };

/** Unknown values fall back to 'info' so a bad stored value can never inject a class name. */
export function safeSeverity(value: string): Severity {
  return value === 'high' || value === 'medium' || value === 'low' || value === 'info' ? value : 'info';
}

/** Severity is ALWAYS word + shape + colour (docs/DESIGN.md section 5). */
export function severityBadge(severity: string): string {
  const safe = safeSeverity(severity);
  return `<span class="sev sev-${safe}"><span class="sev-glyph" aria-hidden="true"></span>${SEVERITY_WORDS[safe]}</span>`;
}

/** Overall risk. The "Overall risk:" label is visible in page headers and visually hidden in list rows. */
export function riskBadge(severity: string): string {
  const safe = safeSeverity(severity);
  return `<span class="sev risk sev-${safe}"><span class="sev-glyph" aria-hidden="true"></span><span class="risk__label">Overall risk: </span><strong>${SEVERITY_WORDS[safe]}</strong></span>`;
}

/**
 * Approve / Skip form. The hidden field markup is exactly what the server's CSRF check and the
 * tests expect: name="csrf" value="...". `context` names the renewal for screen readers.
 */
export function actionForm(packId: number, action: 'approve' | 'skip', csrf: string, label: string, context = '', size: 'md' | 'sm' = 'md'): string {
  // One filled primary per screen (the pack page's Approve). In list rows Approve is outlined in blue, Skip is a text button.
  const tone = action === 'skip' ? 'btn-ghost' : size === 'sm' ? 'btn-outline' : 'btn-primary';
  const style = `btn ${tone}${size === 'sm' ? ' btn-sm' : ''}`;
  const hidden = context ? `<span class="vh"> ${escapeHtml(context)}</span>` : '';
  return `<form method="post" action="/pack/${Number(packId)}/${action}"><input type="hidden" name="csrf" value="${escapeHtml(csrf)}"><button type="submit" class="${style}">${escapeHtml(label)}${hidden}</button></form>`;
}
