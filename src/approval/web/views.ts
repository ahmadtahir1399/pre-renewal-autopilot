// Pure view functions: view model in, escaped HTML string out. No database, no clock, no I/O.
// Every dynamic value passes through escapeHtml (directly or via a component in html.ts).

import { describeField } from '../../compare/format.js';
import { formatLongDate } from '../../domain/dates.js';
import type { Flag, IsoDate, RenewalStatus, Severity, TermDiff } from '../../domain/types.js';
import type { SyncState } from '../../state/repo.js';
import type { AuditItem } from './auditView.js';
import { actionForm, escapeHtml, page, riskBadge, SEVERITY_WORDS, severityBadge } from './html.js';
import {
  attentionSentence,
  changeWord,
  decisionSentence,
  displayValue,
  fieldLabel,
  formatInstant,
  plural,
  sourcePages,
  statusLabel,
  weeksText,
} from './present.js';

// ---- view models --------------------------------------------------------------------------

export interface PageContext {
  runDate: IsoDate;
  approverName: string;
  fakeLlm: boolean;
  csrf: string;
  /** D-122: the page is served through the public origin, where uploads are refused: show no upload entry points. */
  uploadsHidden?: boolean;
  /** D-123: public demo open to everyone. */
  publicDemo?: boolean;
}

export interface DecisionView {
  action: 'approve' | 'skip';
  at: string;
  channel: string;
}

export interface CardView {
  packId: number;
  clientName: string;
  policyType: string;
  version: number;
  expiryDate: IsoDate;
  weeks: number;
  risk: Severity;
  diffs: TermDiff[];
  flagCount: number;
  status: RenewalStatus;
  decision: DecisionView | null;
  syncState: SyncState;
  /** Prompt 7: the pack came from uploaded documents (U-3 timing words + a source line). */
  uploaded?: boolean;
  /** Prompt 7, U-3: 'in 6 weeks' / 'in 5 days' / 'today' / 'expired 10 days ago' (uploaded packs only). */
  timing?: string;
  /** Prompt 7: the analysis job that prepared this pack. */
  uploadId?: number;
}

export interface NoticeView {
  clientName: string;
  policyType: string;
  reason: string | null;
  /** Prompt 7: /analysis/new?policy=<id> when uploads are enabled and a document is missing. */
  uploadHref?: string;
}

export interface ImportedView {
  clientName: string;
  policyType: string;
  expiryDate: IsoDate;
}

export interface ListView extends PageContext {
  waiting: CardView[];
  decided: CardView[];
  attention: NoticeView[];
  imported: ImportedView[];
  counts: { waiting: number; approved: number; skipped: number; attention: number };
  /** Prompt 7: show the 'Analyse documents' entry points. */
  uploadsEnabled?: boolean;
  /** Prompt 7: show the 'Create overview spreadsheet' form. */
  overviewEnabled?: boolean;
}

export interface PackView extends PageContext {
  card: CardView;
  flags: Flag[];
  insurerName: string;
  policyId: string;
  cycleKey: string;
  packStatus: 'active' | 'superseded';
  /** The case's current active pack (for a superseded page), or null. */
  activePack: { id: number; version: number } | null;
  done: string | null;
  audit: { items: AuditItem[]; hidden: number };
  createdAt: string;
  contentHash: string;
  inputHash: string;
  uploadsEnabled?: boolean;
}

// ---- shared bits ---------------------------------------------------------------------------

export function cardTitle(view: { clientName: string; policyType: string }): string {
  return `${view.clientName} - ${view.policyType}`;
}

function versionChip(version: number): string {
  return version > 1 ? `<span class="chip">v${escapeHtml(version)}</span>` : '';
}

function openLink(packId: number, context: string, size: 'md' | 'sm' = 'md'): string {
  return `<a class="btn ${size === 'sm' ? 'btn-ghost btn-sm' : 'btn-secondary'}" href="/pack/${Number(packId)}/open">Open .xlsx<span class="vh"> spreadsheet for ${escapeHtml(context)}</span></a>`;
}

function decisionText(decision: DecisionView | null, approverName: string, status: RenewalStatus): string {
  if (!decision) return statusLabel(status);
  return decisionSentence(decision.action, approverName, decision.at, decision.channel);
}

function syncProblem(card: CardView): string | null {
  if (card.decision?.action !== 'approve' || card.syncState === 'ok') return null;
  return card.syncState === 'copy_failed' ? 'Approved, but the drafts were not copied.' : 'Approved, but the renewal status was not updated.';
}

const RETRY = 'Nothing was sent. Run npm run retry-sync on this computer to finish.';

function statusPill(status: RenewalStatus | 'superseded'): string {
  const tone = status === 'approved' ? 'pill--success' : status === 'skipped' || status === 'superseded' ? '' : status === 'in_review' ? 'pill--info' : 'pill--warn';
  const label = status === 'superseded' ? 'Replaced' : statusLabel(status);
  return `<span class="pill ${tone}">${escapeHtml(label)}</span>`;
}

function sectionHead(id: string, title: string, count: number, intro?: string): string {
  return `<div class="section__head"><h2 class="section__title" id="${id}">${escapeHtml(title)}<span class="count">${escapeHtml(count)}</span></h2>${intro ? `<p class="section__intro">${escapeHtml(intro)}</p>` : ''}</div>`;
}

// ---- list page -----------------------------------------------------------------------------

function waitingRow(card: CardView, csrf: string): string {
  const title = cardTitle(card);
  const top = card.diffs[0];
  const change = top
    ? `<div class="row__change-line">${severityBadge(top.severity)}<span class="clamp">${escapeHtml(top.facts)}</span></div>`
    : '<div class="row__change-line"><span class="clamp muted">No changes found between the expiring policy and the renewal offer.</span></div>';
  const notes = [
    card.diffs.length > 1 ? plural(card.diffs.length - 1, 'more change', 'more changes') : null,
    card.flagCount > 0 ? `${plural(card.flagCount, 'item needs', 'items need')} your eye` : null,
  ].filter((note): note is string => note !== null);
  const meta = notes.length ? `<p class="row__note">${notes.map((n) => escapeHtml(n)).join('<span aria-hidden="true">, </span>')}</p>` : '';
  return `<li><article class="row" aria-labelledby="card-${card.packId}">
<div class="row__main"><h3 class="row__title" id="card-${card.packId}"><a href="/pack/${card.packId}">${escapeHtml(card.clientName)}</a>${versionChip(card.version)}${card.uploaded ? '<span class="chip">Uploaded</span>' : ''}</h3><p class="row__sub">${escapeHtml(card.policyType)}</p><p class="row__date">Renews ${escapeHtml(formatLongDate(card.expiryDate))}<span class="row__weeks">${escapeHtml(card.timing ?? weeksText(card.weeks))}</span></p></div>
<div class="row__risk">${riskBadge(card.risk)}</div>
<div class="row__change">${change}${meta}</div>
<div class="row__actions">${actionForm(card.packId, 'approve', csrf, 'Approve', title, 'sm')}${openLink(card.packId, title, 'sm')}${actionForm(card.packId, 'skip', csrf, 'Skip', title, 'sm')}</div>
</article></li>`;
}

function decidedRow(card: CardView, approverName: string): string {
  const title = cardTitle(card);
  const problem = syncProblem(card);
  return `<li><article class="row row--compact" aria-labelledby="card-${card.packId}">
<div class="row__main"><h3 class="row__title" id="card-${card.packId}"><a href="/pack/${card.packId}">${escapeHtml(card.clientName)}</a>${versionChip(card.version)}</h3><p class="row__sub">${escapeHtml(card.policyType)}</p></div>
<div class="row__risk">${statusPill(card.status)}</div>
<div class="row__change"><p class="row__decision">${escapeHtml(decisionText(card.decision, approverName, card.status))}</p>${problem ? `<p class="row__problem"><strong>${escapeHtml(problem)}</strong> ${escapeHtml(RETRY)}</p>` : ''}</div>
<div class="row__actions"><a class="btn btn-ghost btn-sm" href="/pack/${card.packId}">Details<span class="vh"> for ${escapeHtml(title)}</span></a>${openLink(card.packId, title, 'sm')}</div>
</article></li>`;
}

function noticeRow(notice: NoticeView, index: number): string {
  return `<li><article class="row row--notice" aria-labelledby="notice-${index}">
<span class="icon icon--warn" aria-hidden="true"></span>
<div class="row__main"><h3 class="row__title" id="notice-${index}">${escapeHtml(notice.clientName)}</h3><p class="row__sub">${escapeHtml(notice.policyType)}</p></div>
<div class="row__change"><p class="row__reason">${escapeHtml(attentionSentence(notice.reason))}</p><p class="row__note">No comparison was prepared. Please check the documents for this renewal by hand.</p>${notice.uploadHref ? `<p class="row__upload"><a href="${escapeHtml(notice.uploadHref)}">${notice.reason?.includes('image-only') ? 'Upload a readable copy' : 'Upload the missing document'}<span class="vh"> for ${escapeHtml(notice.clientName)}</span></a></p>` : ''}</div>
</article></li>`;
}

function importedRow(item: ImportedView, index: number): string {
  return `<li><article class="row row--compact" aria-labelledby="imported-${index}">
<div class="row__main"><h3 class="row__title" id="imported-${index}">${escapeHtml(item.clientName)}</h3><p class="row__sub">${escapeHtml(item.policyType)}</p></div>
<div class="row__risk">${statusPill('approved')}</div>
<div class="row__change"><p class="row__decision">Renews ${escapeHtml(formatLongDate(item.expiryDate))}. Already approved for this renewal cycle (imported from earlier records), so no pack was prepared.</p></div>
</article></li>`;
}

const RISK_ORDER: Severity[] = ['high', 'medium', 'low', 'info'];

/**
 * Prompt 8: the queue's risk at a glance. One square per waiting renewal, worst first, coloured by overall risk
 * (word + count beside it, so colour is never the only cue). Pure markup: no inline styles, so the CSP is unchanged.
 */
function riskUnits(waiting: CardView[]): string {
  if (waiting.length === 0) return '';
  const counts = RISK_ORDER.map((risk) => [risk, waiting.filter((c) => c.risk === risk).length] as const).filter(([, n]) => n > 0);
  const units = counts.map(([risk, n]) => `<span class="unit unit--${risk}"></span>`.repeat(n)).join('');
  const legend = counts
    .map(([risk, n]) => `<span class="units__item"><span class="unit unit--${risk}" aria-hidden="true"></span>${escapeHtml(n)} ${escapeHtml(SEVERITY_WORDS[risk].toLowerCase())}</span>`)
    .join('');
  return `<span class="units" aria-hidden="true">${units}</span><span class="units__legend">${legend}</span>`;
}

function kpis(view: ListView): string {
  const tile = (href: string, label: string, value: number, hint: string, tone = '', extra = '') =>
    `<li class="kpis__cell${tone ? ' kpis__cell--lead' : ''}"><a class="kpi${tone}" href="${href}"><span class="kpi__label">${escapeHtml(label)}</span><span class="kpi__value">${escapeHtml(value)}</span>${extra || `<span class="kpi__hint">${escapeHtml(hint)}</span>`}</a></li>`;
  return `<ul class="kpis" aria-label="Summary">${tile('#waiting', 'Waiting for your decision', view.counts.waiting, 'Nothing waiting', ' kpi--primary', riskUnits(view.waiting))}${tile('#decided', 'Approved', view.counts.approved, 'Drafts saved, nothing sent')}${tile('#decided', 'Skipped', view.counts.skipped, 'No changes made')}${tile('#attention', 'Needs attention', view.counts.attention, view.counts.attention ? 'Check documents by hand' : 'All clear')}</ul>`;
}

const OVERVIEW_CHOICES: Array<[string, string, boolean]> = [
  ['in_review', 'In review', true],
  ['approved', 'Approved', true],
  ['skipped', 'Skipped', false],
  ['needs_attention', 'Needs attention', false],
];

/** Prompt 7: the overview spreadsheet form (POST /exports; CSRF first; no script). */
function overviewForm(csrf: string): string {
  const boxes = OVERVIEW_CHOICES.map(
    ([value, label, checked]) => `<label class="choice"><input class="check" type="checkbox" name="status" value="${value}"${checked ? ' checked' : ''}> ${escapeHtml(label)}</label>`,
  ).join('');
  return `<section class="section" aria-labelledby="overview"><div class="section__head"><h2 class="section__title" id="overview">Overview spreadsheet</h2><p class="section__intro">One sheet listing every current renewal, its risk, flags and status, for a meeting or a print-out.</p></div>
<div class="card panel"><form class="form form--overview" method="post" action="/exports"><input type="hidden" name="csrf" value="${escapeHtml(csrf)}">
<fieldset class="choices"><legend class="field__label">Statuses to include</legend>${boxes}</fieldset>
<label class="choice"><input class="check" type="checkbox" name="include_manual" value="yes" checked> Include uploaded (manual) cases</label>
<div class="form__actions"><button type="submit" class="btn btn-secondary">Create overview spreadsheet</button></div></form></div></section>`;
}

/** Prompt 8: the screen's one finding, read first: how many waiting renewals are high risk and which renews soonest. */
function finding(waiting: CardView[]): string {
  if (waiting.length === 0) return '';
  const high = waiting.filter((c) => c.risk === 'high').length;
  const soonest = waiting.reduce((a, b) => (b.expiryDate < a.expiryDate ? b : a));
  const lead = high > 0 ? `${plural(high, 'high-risk renewal is', 'high-risk renewals are')} waiting` : 'No high-risk renewals are waiting';
  return `<p class="page-finding">${escapeHtml(lead)}. Soonest: <a href="/pack/${Number(soonest.packId)}">${escapeHtml(cardTitle(soonest))}</a>, renews ${escapeHtml(formatLongDate(soonest.expiryDate))}.</p>`;
}

export function renderListPage(view: ListView): string {
  const waiting = view.waiting.length
    ? `<div class="card card--flush"><div class="list-head" aria-hidden="true"><span>Renewal</span><span>Overall risk</span><span>Top change</span><span>Actions</span></div><ul class="rows">${view.waiting.map((card) => waitingRow(card, view.csrf)).join('')}</ul></div>`
    : '<div class="card empty"><span class="icon icon--done" aria-hidden="true"></span><div><p class="empty__title">Nothing is waiting for your decision.</p><p class="empty__text">New renewals appear here after the next morning run.</p></div></div>';
  const attention = view.attention.length
    ? `<section class="section" aria-labelledby="attention">${sectionHead('attention', 'Needs attention', view.attention.length, 'These renewals could not be compared automatically. There is nothing to approve until the documents are fixed.')}
<div class="card card--flush"><ul class="rows">${view.attention.map(noticeRow).join('')}</ul></div></section>`
    : '';
  const decidedCount = view.decided.length + view.imported.length;
  const decided = decidedCount
    ? `<section class="section" aria-labelledby="decided">${sectionHead('decided', 'Decided', decidedCount)}
<div class="card card--flush"><ul class="rows">${view.decided.map((card) => decidedRow(card, view.approverName)).join('')}${view.imported.map(importedRow).join('')}</ul></div></section>`
    : '';
  const actions = view.uploadsEnabled ? '<div class="page-head__actions"><a class="btn btn-secondary" href="/analysis/new">Analyse documents</a></div>' : '';
  const main = `<div class="page-head"><div><h1 class="page-title">Renewals</h1><p class="page-sub">Prepared overnight from the expiring policy and the renewal offer. Approve saves the drafts; nothing is ever sent.</p>${finding(view.waiting)}</div>${actions}</div>
${kpis(view)}
<section class="section" aria-labelledby="waiting">${sectionHead('waiting', 'Waiting for your decision', view.waiting.length, 'Highest risk first, then the soonest renewal.')}${waiting}</section>
${attention}${decided}${view.overviewEnabled ? overviewForm(view.csrf) : ''}`;
  return page(
    {
      title: 'Renewals for review',
      runDate: view.runDate,
      approverName: view.approverName,
      fakeLlm: view.fakeLlm,
      nav: { waiting: view.counts.waiting, attention: view.counts.attention, decided: decidedCount },
      ...(view.uploadsEnabled ? { uploadsNav: 'link' as const } : {}),
      ...(view.publicDemo ? { publicDemo: true } : {}),
    },
    main,
  );
}

// ---- pack page -----------------------------------------------------------------------------

interface BannerSpec {
  tone: 'done' | 'warn' | 'neutral';
  glyph: 'check' | 'dash' | 'diamond' | 'ring';
  title: string;
  lines: string[];
  link?: { href: string; text: string };
}

function banner(spec: BannerSpec, id: string): string {
  const lines = spec.lines.map((line) => `<p>${escapeHtml(line)}</p>`).join('');
  const link = spec.link ? `<p class="banner__link"><a href="${escapeHtml(spec.link.href)}">${escapeHtml(spec.link.text)}</a></p>` : '';
  return `<section class="banner banner--${spec.tone}" role="status" aria-labelledby="${id}"><span class="banner__icon" aria-hidden="true"><span class="banner__glyph glyph-${spec.glyph}"></span></span><div><h2 class="banner__title" id="${id}">${escapeHtml(spec.title)}</h2>${lines}${link}</div></section>`;
}

const BACK = { href: '/', text: 'Back to all renewals' };

function resultBanner(view: PackView): BannerSpec | null {
  const { card } = view;
  const decided = card.decision ? decisionText(card.decision, view.approverName, card.status) : null;
  const withDecision = (lines: string[]) => (decided ? [...lines, decided] : lines);
  const newest = view.activePack && view.activePack.id !== card.packId ? { href: `/pack/${view.activePack.id}`, text: `Open version ${view.activePack.version}` } : BACK;
  switch (view.done) {
    case 'approved':
      return { tone: 'done', glyph: 'check', title: 'Approved', lines: withDecision(['The drafts were saved under output/approved and the renewal status was updated. Nothing was sent.']), link: BACK };
    case 'approve_sync':
      return { tone: 'warn', glyph: 'diamond', title: 'Approved, but not finished', lines: withDecision([`Saving the drafts or updating the renewal status failed. ${RETRY}`]), link: BACK };
    case 'skipped':
      return { tone: 'neutral', glyph: 'dash', title: 'Skipped', lines: withDecision(['Nothing was saved and the data source was not changed.']), link: BACK };
    case 'already_done': {
      const word = card.decision?.action === 'skip' ? 'skipped' : card.decision?.action === 'approve' ? 'approved' : 'decided';
      return { tone: 'neutral', glyph: 'ring', title: `Already ${word}`, lines: withDecision(['Nothing changed. This renewal was decided earlier.']), link: BACK };
    }
    case 'superseded':
      return { tone: 'neutral', glyph: 'ring', title: 'Not done: this version was replaced', lines: ['Nothing changed. Decisions apply to the newest version only.'], link: newest };
    case 'wrong_state':
      return { tone: 'neutral', glyph: 'ring', title: 'Not done: this renewal is not waiting for a decision', lines: [`Nothing changed. Its status is ${statusLabel(card.status)}.`], link: BACK };
    case 'not_found':
      return { tone: 'neutral', glyph: 'ring', title: 'Not done', lines: ['That pack could not be found. Nothing changed.'], link: BACK };
    case 'not_allowed':
      return { tone: 'neutral', glyph: 'ring', title: 'Not done', lines: ['The action was not accepted (the service may be shutting down). Nothing changed. Try again in a moment.'], link: BACK };
    default:
      return null;
  }
}

function standingBanners(view: PackView, hasResult: boolean): BannerSpec[] {
  const { card } = view;
  const out: BannerSpec[] = [];
  if (view.packStatus === 'superseded') {
    const newest = view.activePack;
    out.push({
      tone: 'neutral',
      glyph: 'ring',
      title: newest ? `This is version ${card.version}. Version ${newest.version} replaced it.` : `This is version ${card.version}. A newer version replaced it.`,
      lines: ['This older version is kept for the record. Its spreadsheet can no longer be opened and it cannot be decided.'],
      ...(newest ? { link: { href: `/pack/${newest.id}`, text: `Open version ${newest.version}` } } : {}),
    });
  }
  const problem = syncProblem(card);
  if (problem && view.done !== 'approve_sync') out.push({ tone: 'warn', glyph: 'diamond', title: problem, lines: [RETRY] });
  if (!hasResult && card.decision && view.packStatus === 'active') {
    out.push(
      card.decision.action === 'approve'
        ? { tone: 'done', glyph: 'check', title: 'Approved', lines: [decisionText(card.decision, view.approverName, card.status)], link: BACK }
        : { tone: 'neutral', glyph: 'dash', title: 'Skipped', lines: [decisionText(card.decision, view.approverName, card.status)], link: BACK },
    );
  }
  return out;
}

function decisionPanel(view: PackView): string {
  const { card } = view;
  const title = cardTitle(card);
  let body: string;
  if (view.packStatus === 'superseded') {
    const newest = view.activePack;
    body = `<h2 class="panel__title" id="decision">Older version</h2><p class="panel__text">Decisions apply to the newest version only.</p>${newest ? `<div class="decision-actions"><a class="btn btn-primary" href="/pack/${newest.id}">Open version ${escapeHtml(newest.version)}</a></div>` : ''}`;
  } else if (card.status === 'in_review') {
    body = `<h2 class="panel__title" id="decision">Your decision</h2>
<ul class="checklist"><li>Approve saves the spreadsheet and both draft emails under output/approved and marks the renewal approved.</li><li>Skip records your decision and changes nothing else.</li><li>Nothing is ever sent to the client or the insurer.</li></ul>
<div class="decision-actions">${actionForm(card.packId, 'approve', view.csrf, 'Approve', title)}<div class="decision-actions__pair">${openLink(card.packId, title)}${actionForm(card.packId, 'skip', view.csrf, 'Skip', title)}</div></div>`;
  } else {
    body = `<h2 class="panel__title" id="decision">Decision</h2><p class="panel__text">${escapeHtml(decisionText(card.decision, view.approverName, card.status))}</p><div class="decision-actions">${openLink(card.packId, title)}</div>`;
  }
  return `<section class="pack__decision card panel" aria-labelledby="decision">${body}</section>`;
}

function changeRow(diff: TermDiff, index: number): string {
  const pages = sourcePages(diff);
  const source = pages.length ? pages.map((p) => `<span class="source-tag">${escapeHtml(p)}</span>`).join('') : '<span class="muted">Page not recorded</span>';
  return `<tbody class="change" id="change-${index + 1}">
<tr class="change__first"><th scope="row">${escapeHtml(fieldLabel(diff.field))}<span class="change__kind">${escapeHtml(changeWord(diff.change))}</span></th><td class="value" data-label="Expiring">${escapeHtml(displayValue(diff, 'expiring'))}</td><td class="value value--new" data-label="Renewal">${escapeHtml(displayValue(diff, 'renewal'))}</td><td data-label="Severity">${severityBadge(diff.severity)}</td><td class="source" data-label="Source">${source}</td></tr>
<tr class="change__explain"><td colspan="5">${escapeHtml(diff.facts)}</td></tr>
</tbody>`;
}

function changesTable(diffs: TermDiff[]): string {
  if (diffs.length === 0) return '<div class="empty empty--inset"><span class="icon icon--done" aria-hidden="true"></span><div><p class="empty__title">No differences found between the expiring policy and the renewal offer.</p></div></div>';
  return `<div class="table-wrap"><table>
<caption class="vh">What changed between the expiring policy and the renewal offer. Amounts in NZD.</caption>
<thead><tr><th scope="col">Item and change</th><th scope="col">Expiring</th><th scope="col">Renewal</th><th scope="col">Severity</th><th scope="col">Source</th></tr></thead>
${diffs.map(changeRow).join('\n')}
</table></div>`;
}

function flagList(flags: Flag[], diffs: TermDiff[]): string {
  if (flags.length === 0) return '<div class="empty empty--inset"><span class="icon icon--done" aria-hidden="true"></span><div><p class="empty__title">Nothing needs your eye.</p><p class="empty__text">Every change below is informational.</p></div></div>';
  const items = flags.map((flag) => {
    const index = diffs.findIndex((diff) => diff.field === flag.field);
    const link = index >= 0 ? `<a class="flag__link" href="#change-${index + 1}">Go to the change<span class="vh">: ${escapeHtml(describeField(flag.field))}</span></a>` : '';
    return `<li class="flag flag--${flag.severity === 'high' ? 'high' : flag.severity === 'medium' ? 'medium' : 'low'}">${severityBadge(flag.severity)}<div class="flag__body"><p class="flag__field">${escapeHtml(describeField(flag.field))}</p><p class="flag__msg">${escapeHtml(flag.message)}</p></div>${link}</li>`;
  });
  return `<ol class="flags">${items.join('')}</ol>`;
}

function activityPanel(audit: PackView['audit']): string {
  const items = audit.items.length
    ? `<ol class="timeline">${audit.items
        .map((item) => `<li><span class="timeline__what">${escapeHtml(item.what)}</span><span class="timeline__meta"><time${item.iso ? ` datetime="${escapeHtml(item.iso)}"` : ''}>${escapeHtml(item.when)}</time><span class="timeline__who">${escapeHtml(item.who)}</span></span></li>`)
        .join('')}</ol>`
    : '<p class="panel__text">No activity recorded yet.</p>';
  const hidden = audit.hidden > 0 ? `<p class="timeline__more">${escapeHtml(plural(audit.hidden, 'earlier event is', 'earlier events are'))} not shown. Run npm run audit for the full log.</p>` : '';
  return `<section class="pack__activity card panel" aria-labelledby="activity"><h2 class="panel__title" id="activity">Activity for this renewal</h2><p class="panel__text">From the audit log. Times in UTC.</p>${items}${hidden}</section>`;
}

function technicalDetails(view: PackView): string {
  const row = (label: string, value: string, mono = false) => `<dt>${escapeHtml(label)}</dt><dd${mono ? ' class="mono"' : ''}>${escapeHtml(value)}</dd>`;
  return `<details class="details"><summary>Technical details</summary><dl class="kv">
${row('Policy id', view.policyId)}${row('Renewal cycle', view.cycleKey)}${row('Pack', `#${view.card.packId}, version ${view.card.version}`)}${row('Prepared', formatInstant(view.createdAt))}${row('Saving after approval', view.card.syncState === 'ok' ? 'OK' : view.card.syncState === 'copy_failed' ? 'Drafts not copied' : 'Status not updated')}${row('Content hash', view.contentHash, true)}${row('Input hash', view.inputHash, true)}
</dl></details>`;
}

export function renderPackPage(view: PackView): string {
  const { card } = view;
  const title = cardTitle(card);
  const result = resultBanner(view);
  const banners = [...(result ? [result] : []), ...standingBanners(view, result !== null)].map((spec, i) => banner(spec, `banner-${i + 1}`)).join('');
  const head = `<div class="pack__head"><div class="page-head__title"><h1 class="page-title">${escapeHtml(card.clientName)}${versionChip(card.version)}</h1>${statusPill(view.packStatus === 'superseded' ? 'superseded' : card.status)}</div>
<p class="page-sub">${escapeHtml(card.policyType)}</p>
<dl class="meta"><div><dt>Renews</dt><dd>${escapeHtml(formatLongDate(card.expiryDate))} <span class="muted">(${escapeHtml(card.timing ?? weeksText(card.weeks))})</span></dd></div><div><dt>Insurer</dt><dd>${escapeHtml(view.insurerName)}</dd></div><div><dt>Changes</dt><dd>${escapeHtml(card.diffs.length)}</dd></div><div><dt>Overall risk</dt><dd>${riskBadge(card.risk)}</dd></div>${card.uploaded ? `<div><dt>Source</dt><dd>Uploaded manually${card.uploadId ? ` (<a href="/analysis/${Number(card.uploadId)}">analysis ${Number(card.uploadId)}</a>)` : ''}</dd></div>` : ''}</dl>
${banners}</div>`;
  const body = `<div class="pack__body">
<section class="card panel" aria-labelledby="eye"><h2 class="panel__title" id="eye">Needs your eye<span class="count">${escapeHtml(view.flags.length)}</span></h2>${flagList(view.flags, card.diffs)}</section>
<section class="card card--flush panel-gap" aria-labelledby="changes"><div class="card__header"><h2 class="panel__title" id="changes">All changes<span class="count">${escapeHtml(card.diffs.length)}</span></h2><p class="panel__text">Expiring policy compared with the renewal offer. Amounts in NZD.</p></div>${changesTable(card.diffs)}</section>
${technicalDetails(view)}</div>`;
  const main = `<div class="pack">${head}${decisionPanel(view)}${body}${activityPanel(view.audit)}</div>`;
  return page({ title, runDate: view.runDate, approverName: view.approverName, fakeLlm: view.fakeLlm, crumbs: [title], ...(view.uploadsEnabled ? { uploadsNav: 'link' as const } : {}), ...(view.publicDemo ? { publicDemo: true } : {}) }, main);
}

// ---- error pages ---------------------------------------------------------------------------

export type ErrorKind = 400 | 403 | 404 | 405 | 413 | 500 | 503 | 'spreadsheet' | 'uploads_local_only' | 'expired';

const ERRORS: Record<ErrorKind, { status: number; title: string; text: string; back: boolean }> = {
  400: { status: 400, title: 'Request not understood', text: 'The request could not be read. Nothing changed.', back: true },
  403: {
    status: 403,
    title: 'Sign-in link needed',
    text: 'This page needs your sign-in link. Open the link printed in the terminal where serve is running; it signs this browser in. If serve was restarted, use the new link it printed.',
    back: false,
  },
  // D-137: the public demo never shows the sign-in page; a refused request there is an out-of-date page.
  expired: {
    status: 403,
    title: 'This page was out of date',
    text: 'Nothing changed. The public demo restarts every night, so the page you used had expired. Reload the page and try again.',
    back: true,
  },
  404: { status: 404, title: 'Page not found', text: 'There is nothing at this address.', back: true },
  405: { status: 405, title: 'Not accepted here', text: 'That kind of request is not accepted at this address. Nothing changed.', back: true },
  413: { status: 413, title: 'Request too large', text: 'The request was too large to read. Nothing changed.', back: true },
  500: { status: 500, title: 'Something went wrong', text: 'The page could not be shown. Nothing changed. Check the terminal where serve is running.', back: true },
  503: { status: 503, title: 'Not accepting actions right now', text: 'The approval service is starting up or shutting down. Nothing changed. Try again in a moment.', back: true },
  spreadsheet: { status: 404, title: 'Spreadsheet not available', text: 'This spreadsheet cannot be opened. It may belong to an older version that was replaced, or the pack does not exist.', back: true },
  uploads_local_only: {
    status: 403,
    title: 'Uploads work on this computer only',
    text: 'Analysing documents stores files on this computer and sends their text to the AI provider, so it is only available on the computer running serve (http://127.0.0.1). Approving and opening packs still works here.',
    back: true,
  },
};

export function errorStatus(kind: ErrorKind): number {
  return ERRORS[kind].status;
}

/** Fixed text only: nothing from the request is ever reflected. */
export function renderErrorPage(kind: ErrorKind): string {
  const spec = ERRORS[kind];
  const main = `<div class="card error"><span class="error__code">${spec.status}</span><h1 class="page-title">${escapeHtml(spec.title)}</h1><p class="error__text">${escapeHtml(spec.text)}</p>${spec.back ? '<p><a class="btn btn-secondary" href="/">Back to all renewals</a></p>' : ''}</div>`;
  return page({ title: spec.title, fakeLlm: false, minimal: true }, main);
}
