// Pure views for the upload door (Prompt 7, U3): the upload page and the analysis job page.
// Same rules as views.ts: view model in, escaped HTML out; no script, no inline style, no external resource.
// Document-derived text (values, quotes, exclusion titles) is hostile: escaped, truncated, full text only inside
// a <details> disclosure, never interpreted.

import { EXCLUSION_LABELS, formatAmount } from '../../compare/format.js';
import { formatLongDate, isValidIsoDate } from '../../domain/dates.js';
import type { ExtractedTerms, Fact, Severity } from '../../domain/types.js';
import type { ExtractionWarning } from '../../documents/verifyQuotes.js';
import { POLICY_TYPE_LABELS } from '../../outputs/labels.js';
import type { UploadErrorCode } from '../../uploads/errors.js';
import type { UploadMode, UploadSide, UploadStatus } from '../../uploads/model.js';
import type { AuditItem } from './auditView.js';
import { escapeHtml, page, riskBadge } from './html.js';
import { formatInstant, plural } from './present.js';
import type { PageContext } from './views.js';

export const FAKE_UPLOAD_NOTE = 'Fake mode: only known sample documents can be analysed.';
export const CONSENT_TEXT = 'These documents are made-up. Their contents are sent to the AI provider.';
export const MAX_QUOTE_SHOWN = 120;

// ---- view models --------------------------------------------------------------------------

export interface UploadLimitsView {
  maxMb: number;
  maxPages: number;
  dailyLimit: number;
  retentionDays: number;
}

export interface PolicyOption {
  id: string;
  label: string;
  /** The side the data source is missing, if any (listed first and marked). */
  missing: UploadSide | null;
}

export interface RecentJobView {
  id: number;
  createdAt: string;
  mode: UploadMode;
  subject: string;
  status: UploadStatus;
}

export interface UploadFormValues {
  policy?: string;
  client_name?: string;
  contact_name?: string;
  contact_email?: string;
  broker?: string;
}

export interface UploadPageView extends PageContext {
  limits: UploadLimitsView;
  /** Live mode with LLM settings, or fake mode. */
  aiConfigured: boolean;
  policies: PolicyOption[];
  brokers: Array<{ id: string; name: string }>;
  /** Attach form: preselected (validated) policy id from ?policy= or the rejected submission. */
  selectedPolicy: string | null;
  /** Which form a rejection belongs to (the message is shown there). */
  errorFor: UploadMode | null;
  error: string | null;
  values: UploadFormValues;
  recent: RecentJobView[];
  usedToday: number;
}

export interface StoredDocView {
  side: UploadSide;
  displayName: string;
  sizeBytes: number;
  pageCount: number;
  deletedAt: string | null;
}

export interface FactsSide {
  source: 'upload' | 'data_source';
  terms: ExtractedTerms;
  warnings: ExtractionWarning[];
  /** D-120: facts confirmed by the targeted second reading. */
  repairedFields?: string[];
}

export interface JobPackView {
  id: number;
  title: string;
  risk: Severity;
  flagCount: number;
  diffCount: number;
  version: number;
  statusLabel: string;
  active: boolean;
}

export interface JobPageView extends PageContext {
  id: number;
  mode: UploadMode;
  status: UploadStatus;
  subject: string;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  failureCode: UploadErrorCode | null;
  failureMessage: string | null;
  tokensIn: number;
  tokensOut: number;
  documents: StoredDocView[];
  /** Attach mode: the side read from the data source instead of an upload. */
  dataSourceSide: UploadSide | null;
  facts: Partial<Record<UploadSide, FactsSide>>;
  pack: JobPackView | null;
  /** 'unchanged_skip' etc. from the audit (null while running or on failure). */
  outcome: string | null;
  audit: { items: AuditItem[]; hidden: number };
  /** Seconds for the self-refresh while running; null when finished. */
  refreshSeconds: number | null;
}

// ---- shared bits ---------------------------------------------------------------------------

const STATUS_WORDS: Record<UploadStatus, string> = {
  received: 'Received',
  validating: 'Checking the files',
  extracting: 'Reading the documents',
  comparing: 'Comparing the terms',
  done: 'Done',
  failed: 'Stopped',
  rejected: 'Not accepted',
};

const RUNNING: ReadonlySet<UploadStatus> = new Set(['received', 'validating', 'extracting', 'comparing']);

export function jobStatusPill(status: UploadStatus): string {
  const tone = status === 'done' ? 'pill--success' : status === 'failed' || status === 'rejected' ? 'pill--warn' : 'pill--info';
  return `<span class="pill ${tone}">${escapeHtml(STATUS_WORDS[status] ?? 'Unknown')}</span>`;
}

function chromeFor(view: PageContext, title: string, crumbs: string[], extra: { refreshSeconds?: number | null; current?: boolean } = {}) {
  return {
    title,
    runDate: view.runDate,
    approverName: view.approverName,
    fakeLlm: view.fakeLlm,
    ...(view.fakeLlm && !view.uploadsHidden ? { fakeExtra: FAKE_UPLOAD_NOTE } : {}),
    crumbs,
    ...(view.uploadsHidden ? {} : { uploadsNav: extra.current ? ('current' as const) : ('link' as const) }),
    ...(view.publicDemo ? { publicDemo: true } : {}),
    ...(extra.refreshSeconds ? { refreshSeconds: extra.refreshSeconds } : {}),
  };
}

function errorBanner(message: string, id: string): string {
  return `<section class="banner banner--warn" role="alert" aria-labelledby="${id}"><span class="banner__icon" aria-hidden="true"><span class="banner__glyph glyph-diamond"></span></span><div><h3 class="banner__title" id="${id}">Not accepted</h3><p>${escapeHtml(message)}</p><p>Nothing was analysed and nothing was sent. Check the form and try again.</p></div></section>`;
}

function hidden(name: string, value: string): string {
  return `<input type="hidden" name="${name}" value="${escapeHtml(value)}">`;
}

function textField(id: string, name: string, label: string, value: string | undefined, options: { required?: boolean; type?: 'text' | 'email'; hint?: string; autocomplete?: string } = {}): string {
  const hint = options.hint ? `<span class="field__hint" id="${id}-hint">${escapeHtml(options.hint)}</span>` : '';
  return `<div class="field"><label class="field__label" for="${id}">${escapeHtml(label)}${options.required ? '' : ' <span class="field__optional">(optional)</span>'}</label>${hint}<input class="input" type="${options.type ?? 'text'}" id="${id}" name="${name}" maxlength="100"${options.required ? ' required' : ''}${options.autocomplete ? ` autocomplete="${options.autocomplete}"` : ''}${value ? ` value="${escapeHtml(value)}"` : ''}${options.hint ? ` aria-describedby="${id}-hint"` : ''}></div>`;
}

function fileField(id: string, name: UploadSide, label: string, hint: string, required: boolean): string {
  return `<div class="field"><label class="field__label" for="${id}">${escapeHtml(label)}${required ? '' : ' <span class="field__optional">(optional)</span>'}</label><span class="field__hint" id="${id}-hint">${escapeHtml(hint)}</span><input class="file" type="file" id="${id}" name="${name}" accept=".pdf,application/pdf" aria-describedby="${id}-hint"${required ? ' required' : ''}></div>`;
}

function consentField(id: string): string {
  return `<div class="field field--check"><input class="check" type="checkbox" id="${id}" name="consent" value="yes" required><label for="${id}">${escapeHtml(CONSENT_TEXT)}</label></div>`;
}

// ---- upload page ---------------------------------------------------------------------------

function limitsText(limits: UploadLimitsView): string {
  return `PDF only, up to ${limits.maxMb} MB and ${limits.maxPages} pages each.`;
}

function attachForm(view: UploadPageView): string {
  const options = view.policies
    .map((policy) => {
      // The marker comes FIRST so a narrow select never cuts it off.
      const marker = policy.missing ? `${policy.missing === 'renewal' ? 'Renewal' : 'Expiring'} document missing: ` : '';
      const selected = view.selectedPolicy === policy.id ? ' selected' : '';
      return `<option value="${escapeHtml(policy.id)}"${selected}>${escapeHtml(`${marker}${policy.label}`)}</option>`;
    })
    .join('');
  const error = view.errorFor === 'attach' && view.error ? errorBanner(view.error, 'attach-error') : '';
  return `<section class="card panel upload" aria-labelledby="attach-title"><h2 class="panel__title" id="attach-title">Add a missing document to an existing policy</h2>
<p class="panel__text">Choose the policy, then upload the document the morning run could not find. The other document comes from the policy records as usual.</p>${error}
<form class="form" method="post" action="/analysis" enctype="multipart/form-data">${hidden('csrf', view.csrf)}${hidden('mode', 'attach')}
<div class="field"><label class="field__label" for="attach-policy">Policy</label><span class="field__hint" id="attach-policy-hint">Policies with a missing document are listed first.</span><select class="input" id="attach-policy" name="policy" required aria-describedby="attach-policy-hint">${options}</select></div>
${fileField('attach-expiring', 'expiring', 'Expiring policy (PDF)', 'Only if the expiring document is the one missing.', false)}
${fileField('attach-renewal', 'renewal', 'Renewal offer (PDF)', limitsText(view.limits), false)}
${consentField('attach-consent')}
<div class="form__actions"><button type="submit" class="btn btn-primary">Analyse the document</button></div></form></section>`;
}

function newForm(view: UploadPageView): string {
  const brokers = view.brokers
    .map((broker) => `<option value="${escapeHtml(broker.id)}"${view.values.broker === broker.id ? ' selected' : ''}>${escapeHtml(broker.name)}</option>`)
    .join('');
  const values = view.errorFor === 'new' ? view.values : {};
  const error = view.errorFor === 'new' && view.error ? errorBanner(view.error, 'new-error') : '';
  return `<section class="card panel upload" aria-labelledby="new-title"><h2 class="panel__title" id="new-title">Analyse a new policy</h2>
<p class="panel__text">For a policy that is not in the records yet. Upload both documents; the insurer, policy number, type and expiry date are read from them, never guessed.</p>${error}
<form class="form" method="post" action="/analysis" enctype="multipart/form-data">${hidden('csrf', view.csrf)}${hidden('mode', 'new')}
${textField('new-client', 'client_name', 'Client name', values.client_name, { required: true, autocomplete: 'organization', hint: 'Up to 100 characters.' })}
<div class="form__row">${textField('new-contact', 'contact_name', 'Contact name', values.contact_name, { autocomplete: 'name' })}${textField('new-email', 'contact_email', 'Contact email', values.contact_email, { type: 'email', autocomplete: 'email', hint: 'Synthetic addresses only (@example.com).' })}</div>
<div class="field"><label class="field__label" for="new-broker">Broker</label><select class="input" id="new-broker" name="broker" required>${brokers}</select></div>
<div class="form__row">${fileField('new-expiring', 'expiring', 'Expiring policy (PDF)', limitsText(view.limits), true)}${fileField('new-renewal', 'renewal', 'Renewal offer (PDF)', limitsText(view.limits), true)}</div>
${consentField('new-consent')}
<div class="form__actions"><button type="submit" class="btn btn-primary">Analyse both documents</button></div></form></section>`;
}

function recentList(recent: RecentJobView[]): string {
  if (recent.length === 0) return '<div class="empty empty--inset"><span class="icon icon--done" aria-hidden="true"></span><div><p class="empty__title">No analyses yet.</p><p class="empty__text">Uploaded documents and their results appear here.</p></div></div>';
  const rows = recent
    .map(
      (job) =>
        `<li><a class="recent__item" href="/analysis/${Number(job.id)}"><span class="recent__main"><span class="recent__title">${escapeHtml(job.subject)}</span><span class="recent__meta">Analysis ${Number(job.id)}, ${escapeHtml(job.mode === 'attach' ? 'missing document' : 'new policy')}, ${escapeHtml(formatInstant(job.createdAt))}</span></span>${jobStatusPill(job.status)}</a></li>`,
    )
    .join('');
  return `<ul class="recent">${rows}</ul>`;
}

const NEXT_STEPS = [
  'The files are checked first: PDF only, size and page limits, no password, readable text (scans are not supported).',
  'The documents are read with the same checked-quote reader as the morning run, then compared in plain code.',
  'If the insurer, policy number, type or expiry date cannot be read with confidence, nothing is prepared: it is never guessed.',
  'You get the usual pack (spreadsheet and two draft emails) to Approve or Skip. Nothing is ever sent to anyone.',
];

export function renderUploadPage(view: UploadPageView): string {
  const notConfigured = !view.aiConfigured
    ? `<section class="banner banner--warn" role="status" aria-labelledby="ai-title"><span class="banner__icon" aria-hidden="true"><span class="banner__glyph glyph-diamond"></span></span><div><h2 class="banner__title" id="ai-title">AI reading is not configured</h2><p>AI reading is not configured on this computer, so real documents cannot be analysed. Set LLM_PROVIDER, LLM_API_KEY and LLM_MODEL in .env, or start serve with --fake-llm to try the sample documents.</p></div></section>`
    : '';
  const forms = view.aiConfigured ? `<div class="upload-grid">${attachForm(view)}${newForm(view)}</div>` : '';
  const main = `<div class="page-head"><div><h1 class="page-title">Analyse documents</h1><p class="page-sub">Upload an expiring policy and a renewal offer to get the same comparison, spreadsheet and draft emails the morning run prepares. Synthetic documents only.</p></div></div>
<dl class="meta"><div><dt>Files</dt><dd>${escapeHtml(limitsText(view.limits))}</dd></div><div><dt>Analyses today</dt><dd>${escapeHtml(`${view.usedToday} of ${view.limits.dailyLimit}`)}</dd></div><div><dt>Stored PDFs kept</dt><dd>${escapeHtml(plural(view.limits.retentionDays, 'day', 'days'))}</dd></div></dl>
${notConfigured}
<section class="card panel panel-gap" aria-labelledby="next-title"><h2 class="panel__title" id="next-title">What happens next</h2><ul class="checklist">${NEXT_STEPS.map((step) => `<li>${escapeHtml(step)}</li>`).join('')}</ul></section>
${forms}
<section class="section" aria-labelledby="recent-title"><div class="section__head"><h2 class="section__title" id="recent-title">Recent analyses<span class="count">${escapeHtml(view.recent.length)}</span></h2></div><div class="card card--flush">${recentList(view.recent)}</div></section>`;
  return page(chromeFor(view, 'Analyse documents', ['Analyse documents'], { current: true }), main);
}

// ---- job page ------------------------------------------------------------------------------

type StepState = 'done' | 'current' | 'waiting' | 'stopped';
const STEP_LABELS = ['Received', 'Checked the files', 'Read the documents', 'Compared the terms', 'Prepared the pack'] as const;
const STEP_WORDS: Record<StepState, string> = { done: 'Done', current: 'In progress', waiting: 'Waiting', stopped: 'Stopped' };
const STEP_GLYPH: Record<StepState, string> = { done: 'check', current: 'ring', waiting: 'dash', stopped: 'diamond' };
const READ_STAGE_FAILURES: ReadonlySet<string> = new Set(['timed_out', 'extraction_failed', 'identity_unreadable', 'type_not_supported', 'type_disagreement', 'document_mismatch', 'interrupted']);

export function stepStates(status: UploadStatus, failureCode: string | null, started: boolean): StepState[] {
  const reached: Record<UploadStatus, number> = { received: 0, validating: 1, extracting: 2, comparing: 3, done: 5, failed: -1, rejected: -1 };
  let stoppedAt = -1;
  if (status === 'rejected') stoppedAt = 1;
  if (status === 'failed') stoppedAt = !started ? 1 : READ_STAGE_FAILURES.has(failureCode ?? '') ? 2 : 3;
  const current = stoppedAt >= 0 ? stoppedAt : reached[status];
  return STEP_LABELS.map((_, index) => {
    if (stoppedAt >= 0) return index < stoppedAt ? 'done' : index === stoppedAt ? 'stopped' : 'waiting';
    if (index < current) return 'done';
    return index === current ? 'current' : 'waiting';
  });
}

function progressList(view: JobPageView): string {
  const states = stepStates(view.status, view.failureCode, view.startedAt !== null);
  const items = STEP_LABELS.map(
    (label, index) => {
      const state = states[index] as StepState;
      return `<li class="step step--${state}"${state === 'current' ? ' aria-current="step"' : ''}><span class="step__glyph" aria-hidden="true"><span class="banner__glyph glyph-${STEP_GLYPH[state]}"></span></span><span class="step__label">${escapeHtml(label)}</span><span class="step__word">${escapeHtml(STEP_WORDS[state])}</span></li>`;
    },
  ).join('');
  return `<ol class="steps" aria-label="Progress">${items}</ol>`;
}

const FACT_FIELDS = ['insurerName', 'policyNumber', 'policyType', 'periodStart', 'periodEnd', 'annualPremium', 'excess', 'coverLimit'] as const;
type FactField = (typeof FACT_FIELDS)[number];
const FACT_LABELS: Record<FactField, string> = {
  insurerName: 'Insurer',
  policyNumber: 'Policy number',
  policyType: 'Policy type',
  periodStart: 'Period start',
  periodEnd: 'Period end',
  annualPremium: 'Annual premium (NZD)',
  excess: 'Excess (NZD)',
  coverLimit: 'Cover limit (NZD)',
};

const WARNING_WORDS: Record<string, string> = {
  quote_not_found: 'The quoted text was not found on that page, so this fact is treated as uncertain.',
  quote_missing: 'No quote was given, so this fact is treated as uncertain.',
  value_not_on_page: 'The value does not appear in the quoted text, so it is treated as uncertain.',
  date_unparseable: 'The date could not be checked against the page, so it is treated as uncertain.',
  date_mismatch: 'The date does not match the quoted text, so it is treated as uncertain.',
  page_out_of_range: 'The page number is not a page of this document.',
  invalid_exclusion_key: 'This exclusion did not match the fixed list.',
  period_inconsistent: 'The start and end dates do not make sense together, so they are treated as uncertain.',
  amount_implausible: 'This amount does not make sense next to the other amounts, so it is treated as uncertain.',
};

/** D-121: what the plain-code checks made of the AI reading, in counts only. */
export interface ReadingQuality {
  facts: number;
  confirmed: number;
  uncertain: number;
  notFound: number;
  repaired: number;
  exclusions: number;
}

export function readingQuality(facts: Partial<Record<UploadSide, FactsSide>>): ReadingQuality {
  const quality: ReadingQuality = { facts: 0, confirmed: 0, uncertain: 0, notFound: 0, repaired: 0, exclusions: 0 };
  for (const side of Object.values(facts)) {
    if (!side) continue;
    quality.exclusions += side.terms.keyExclusions.length;
    quality.repaired += side.repairedFields?.length ?? 0;
    for (const field of FACT_FIELDS) {
      const fact = side.terms[field] as Fact<unknown>;
      quality.facts++;
      if (fact.value === null) quality.notFound++;
      else if (fact.confidence !== 'low' && !side.warnings.some((w) => w.field === field)) quality.confirmed++;
      else quality.uncertain++;
    }
  }
  return quality;
}

function qualityPanel(view: JobPageView): string {
  const q = readingQuality(view.facts);
  if (q.facts === 0) return '';
  const all = q.confirmed === q.facts;
  const lines = [
    `<li class="q q--ok"><span class="q__num">${escapeHtml(q.confirmed)}<span class="q__of">/${escapeHtml(q.facts)}</span></span><span class="q__text">facts confirmed word for word on the page they came from</span></li>`,
    q.repaired > 0 ? `<li class="q q--ok"><span class="q__num">${escapeHtml(q.repaired)}</span><span class="q__text">${escapeHtml(q.repaired === 1 ? 'fact was' : 'facts were')} confirmed on a second, targeted reading</span></li>` : '',
    q.uncertain > 0 ? `<li class="q q--warn"><span class="q__num">${escapeHtml(q.uncertain)}</span><span class="q__text">uncertain ${escapeHtml(q.uncertain === 1 ? 'fact becomes' : 'facts become')} a "needs your eye" item, never a guess</span></li>` : '',
    q.notFound > 0 ? `<li class="q q--warn"><span class="q__num">${escapeHtml(q.notFound)}</span><span class="q__text">not found in the document (left empty)</span></li>` : '',
    `<li class="q"><span class="q__num">${escapeHtml(q.exclusions)}</span><span class="q__text">exclusions listed, each with its page</span></li>`,
  ].join('');
  const tokens = view.fakeLlm ? 'Fake mode: the answer keys stood in for the AI; the same checks ran.' : `AI usage: ${view.tokensIn} tokens in, ${view.tokensOut} tokens out (counts only).`;
  return `<section class="card panel quality${all ? ' quality--all' : ''}" aria-labelledby="quality"><h2 class="panel__title" id="quality">Reading check</h2><p class="panel__text">The AI only copies facts out of the documents. Plain code then checks every fact against the page it cites, and checks the facts against each other.</p><ul class="quality__list">${lines}</ul><p class="panel__note">${escapeHtml(tokens)}</p></section>`;
}

function factValue(field: FactField, fact: Fact<string | number>): string {
  if (fact.value === null) return 'Not found';
  if (typeof fact.value === 'number') return formatAmount(fact.value);
  if (field === 'policyType') return (POLICY_TYPE_LABELS as Record<string, string>)[fact.value] ?? 'Not supported';
  if ((field === 'periodStart' || field === 'periodEnd') && isValidIsoDate(fact.value)) return formatLongDate(fact.value);
  return fact.value;
}

function confidenceBadge(confidence: string): string {
  const safe = confidence === 'high' || confidence === 'medium' ? confidence : 'low';
  const word = safe === 'high' ? 'High' : safe === 'medium' ? 'Medium' : 'Low';
  return `<span class="conf conf-${safe}"><span class="conf__glyph" aria-hidden="true"></span>${word}<span class="vh"> confidence</span></span>`;
}

function truncated(text: string, max = MAX_QUOTE_SHOWN): string {
  const chars = Array.from(text);
  if (chars.length <= max) return `<q class="quote">${escapeHtml(text)}</q>`;
  return `<q class="quote">${escapeHtml(`${chars.slice(0, max).join('')}...`)}</q><details class="more"><summary>Show the full text</summary><p class="quote quote--full">${escapeHtml(text)}</p></details>`;
}

function factCell(field: FactField, side: FactsSide | undefined): string {
  if (!side) return '<td class="fact"><span class="muted">Not read</span></td>';
  const fact = side.terms[field] as Fact<string | number>;
  const warnings = side.warnings.filter((w) => w.field === field).map((w) => `<p class="fact__warn">${escapeHtml(WARNING_WORDS[w.code] ?? 'This fact could not be checked, so it is treated as uncertain.')}</p>`);
  const page = fact.sourcePage === null ? '<span class="muted">No page</span>' : `<span class="source-tag">Page ${escapeHtml(fact.sourcePage)}</span>`;
  const quote = fact.sourceQuote ? truncated(fact.sourceQuote) : '';
  const second = side.repairedFields?.includes(field) ? '<p class="fact__note">Confirmed on a second reading</p>' : '';
  return `<td class="fact"><p class="fact__value">${escapeHtml(factValue(field, fact))}</p><div class="fact__meta">${page}${confidenceBadge(fact.confidence)}</div>${quote}${second}${warnings.join('')}</td>`;
}

function exclusionsCell(side: FactsSide | undefined): string {
  if (!side) return '<td class="fact"><span class="muted">Not read</span></td>';
  if (side.terms.keyExclusions.length === 0) return '<td class="fact"><span class="muted">None listed</span></td>';
  const items = side.terms.keyExclusions
    .map((x) => `<li><span class="fact__value">${escapeHtml(EXCLUSION_LABELS[x.key] ?? 'Other')}</span> <span class="source-tag source-tag--inline">Page ${escapeHtml(x.sourcePage)}</span>${x.key === 'other' ? truncated(x.title, 80) : ''}</li>`)
    .join('');
  return `<td class="fact"><ul class="fact__list">${items}</ul></td>`;
}

function sourceNote(side: FactsSide | undefined): string {
  if (!side) return '';
  return side.source === 'data_source' ? 'From the policy records' : 'Uploaded';
}

function factsTable(view: JobPageView): string {
  const { expiring, renewal } = view.facts;
  const rows = FACT_FIELDS.map((field) => `<tr><th scope="row">${escapeHtml(FACT_LABELS[field])}</th>${factCell(field, expiring)}${factCell(field, renewal)}</tr>`).join('');
  return `<section class="card card--flush panel-gap" aria-labelledby="facts"><div class="card__header"><h2 class="panel__title" id="facts">Extracted facts</h2><p class="panel__text">Every fact with its page, the quoted text it was checked against, and how sure the reader was. Uncertain facts become "needs your eye" items; nothing is guessed.</p></div>
<div class="table-wrap"><table class="facts"><caption class="vh">Facts read from the expiring policy and the renewal offer</caption>
<thead><tr><th scope="col">Fact</th><th scope="col">Expiring policy <span class="th-note">${escapeHtml(sourceNote(expiring))}</span></th><th scope="col">Renewal offer <span class="th-note">${escapeHtml(sourceNote(renewal))}</span></th></tr></thead>
<tbody>${rows}<tr><th scope="row">Key exclusions</th>${exclusionsCell(expiring)}${exclusionsCell(renewal)}</tr></tbody></table></div></section>`;
}

function documentsPanel(view: JobPageView): string {
  const anyLeft = view.documents.some((d) => d.deletedAt === null);
  const deleted = view.documents.find((d) => d.deletedAt !== null);
  const rows = view.documents
    .map(
      (doc) =>
        `<li><span class="doc__side">${escapeHtml(doc.side === 'expiring' ? 'Expiring policy' : 'Renewal offer')}</span><span class="doc__name">${escapeHtml(doc.displayName)}</span><span class="doc__meta">${escapeHtml(`${plural(doc.pageCount, 'page', 'pages')}, ${formatSize(doc.sizeBytes)}`)}${doc.deletedAt ? `, deleted ${escapeHtml(formatInstant(doc.deletedAt))}` : ''}</span></li>`,
    )
    .join('');
  const fromRecords = view.dataSourceSide ? `<li><span class="doc__side">${escapeHtml(view.dataSourceSide === 'expiring' ? 'Expiring policy' : 'Renewal offer')}</span><span class="doc__name">From the policy records</span><span class="doc__meta">Not uploaded</span></li>` : '';
  const list = rows || fromRecords ? `<ul class="docs">${rows}${fromRecords}</ul>` : '<p class="panel__text">No files were stored.</p>';
  const action = anyLeft
    ? `<form method="post" action="/analysis/${Number(view.id)}/delete" class="form form--inline">${hidden('csrf', view.csrf)}<p class="panel__text">This removes the stored PDF files from this computer. The pack, the drafts and the audit trail are kept.</p><button type="submit" class="btn btn-secondary">Delete the uploaded PDFs</button></form>`
    : deleted
      ? `<p class="panel__text">The uploaded PDFs were deleted ${escapeHtml(formatInstant(deleted.deletedAt as string))}. The pack, the drafts and the audit trail are kept.</p>`
      : '';
  return `<section class="card panel" aria-labelledby="docs-title"><h2 class="panel__title" id="docs-title">Documents</h2>${list}${action}<p class="panel__note">Uploaded PDFs are never shown back in the browser. They are deleted automatically after the retention period.</p></section>`;
}

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(Math.round((bytes / (1024 * 1024)) * 10) / 10).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

const OUTCOME_LINES: Record<string, string> = {
  unchanged_skip: 'These are the same documents as before, so nothing changed. The existing pack is still the current one.',
  skipped_already_processed: 'This renewal was already approved or skipped, so no new pack was prepared. Nothing changed.',
};

const NEXT_TRY: Partial<Record<UploadErrorCode, string>> = {
  identity_unreadable: 'Check that you uploaded the policy schedule pages, then try again. If it keeps failing, prepare this renewal by hand.',
  type_not_supported: 'Only commercial property, public liability and business interruption policies can be analysed.',
  document_mismatch: 'Check that both documents belong to the chosen policy (same insurer, policy type and expiry date).',
  type_disagreement: 'Check that the expiring policy and the renewal offer are for the same kind of cover.',
  timed_out: 'Try again in a few minutes.',
  interrupted: 'Upload the documents again.',
  extraction_failed: 'Try again later.',
  unknown_in_fake_mode: 'Use one of the sample documents in samples/uploads, or run serve without --fake-llm and with AI settings.',
};

function resultSection(view: JobPageView): string {
  if (RUNNING.has(view.status)) {
    return `<section class="banner banner--neutral" role="status" aria-labelledby="result"><span class="banner__icon" aria-hidden="true"><span class="banner__glyph glyph-ring"></span></span><div><h2 class="banner__title" id="result">Working on it</h2><p>${escapeHtml(STATUS_WORDS[view.status])}. This page refreshes itself every ${escapeHtml(view.refreshSeconds ?? 3)} seconds; you can also leave and come back.</p></div></section>`;
  }
  if (view.status === 'done' && view.pack) {
    const extra = view.outcome && OUTCOME_LINES[view.outcome] ? `<p>${escapeHtml(OUTCOME_LINES[view.outcome] as string)}</p>` : '<p>Nothing has been sent. Review it and Approve or Skip as usual.</p>';
    return `<section class="banner banner--done" role="status" aria-labelledby="result"><span class="banner__icon" aria-hidden="true"><span class="banner__glyph glyph-check"></span></span><div><h2 class="banner__title" id="result">The pack is ready</h2>${extra}<p class="banner__link"><a href="/pack/${Number(view.pack.id)}">Open the pack: ${escapeHtml(view.pack.title)}${view.pack.version > 1 ? ` (version ${escapeHtml(view.pack.version)})` : ''}</a></p></div></section>`;
  }
  const message = view.failureMessage ?? 'The analysis stopped. No pack was prepared.';
  const next = view.failureCode && NEXT_TRY[view.failureCode] ? `<p>${escapeHtml(NEXT_TRY[view.failureCode] as string)}</p>` : '';
  const title = view.status === 'rejected' ? 'Not accepted' : view.failureCode === 'interrupted' ? 'Interrupted' : 'No pack was prepared';
  return `<section class="banner banner--warn" role="status" aria-labelledby="result"><span class="banner__icon" aria-hidden="true"><span class="banner__glyph glyph-diamond"></span></span><div><h2 class="banner__title" id="result">${escapeHtml(title)}</h2><p>${escapeHtml(message)}</p>${next}<p class="banner__link"><a href="/analysis/new">Back to the upload page</a></p></div></section>`;
}

function packSummary(pack: JobPackView): string {
  return `<dl class="meta"><div><dt>Pack</dt><dd><a href="/pack/${Number(pack.id)}">${escapeHtml(pack.title)}</a></dd></div><div><dt>Overall risk</dt><dd>${riskBadge(pack.risk)}</dd></div><div><dt>Changes</dt><dd>${escapeHtml(pack.diffCount)}</dd></div><div><dt>Needs your eye</dt><dd>${escapeHtml(pack.flagCount)}</dd></div><div><dt>Status</dt><dd>${escapeHtml(pack.statusLabel)}</dd></div><div><dt>Spreadsheet</dt><dd>${pack.active ? `<a href="/pack/${Number(pack.id)}/open">Download .xlsx<span class="vh"> comparison spreadsheet</span></a>` : '<span class="muted">Replaced by a newer version</span>'}</dd></div></dl>`;
}

function activity(audit: JobPageView['audit']): string {
  const items = audit.items.length
    ? `<ol class="timeline">${audit.items.map((item) => `<li><span class="timeline__what">${escapeHtml(item.what)}</span><span class="timeline__meta"><time${item.iso ? ` datetime="${escapeHtml(item.iso)}"` : ''}>${escapeHtml(item.when)}</time><span class="timeline__who">${escapeHtml(item.who)}</span></span></li>`).join('')}</ol>`
    : '<p class="panel__text">No activity recorded yet.</p>';
  const more = audit.hidden > 0 ? `<p class="timeline__more">${escapeHtml(plural(audit.hidden, 'earlier event is', 'earlier events are'))} not shown. Run npm run audit for the full log.</p>` : '';
  return `<section class="card panel" aria-labelledby="activity"><h2 class="panel__title" id="activity">Activity for this analysis</h2><p class="panel__text">From the audit log. Times in UTC.</p>${items}${more}</section>`;
}

export function renderJobPage(view: JobPageView): string {
  const title = `Analysis ${view.id}`;
  const head = `<div class="job__head"><div class="page-head__title"><h1 class="page-title">${escapeHtml(title)}</h1>${jobStatusPill(view.status)}</div>
<p class="page-sub">${escapeHtml(view.subject)}. ${escapeHtml(view.mode === 'attach' ? 'Missing document for an existing policy.' : 'Both documents uploaded.')} Started ${escapeHtml(formatInstant(view.createdAt))}.</p>
${progressList(view)}${resultSection(view)}${view.pack ? packSummary(view.pack) : ''}</div>`;
  const facts = view.status === 'done' && (view.facts.expiring || view.facts.renewal) ? factsTable(view) : '';
  const quality = view.status === 'done' ? qualityPanel(view) : '';
  const tokens = quality
    ? quality
    : `<section class="card panel" aria-labelledby="usage"><h2 class="panel__title" id="usage">AI usage</h2><p class="panel__text">${escapeHtml(view.fakeLlm ? 'Fake mode: no AI was used.' : `${view.tokensIn} tokens in, ${view.tokensOut} tokens out (counts only).`)}</p></section>`;
  const main = `<div class="job">${head}<div class="job__body">${facts}${documentsPanel(view)}</div><div class="job__side">${tokens}${activity(view.audit)}</div></div>`;
  return page(chromeFor(view, title, ['Analyse documents', title], { refreshSeconds: view.refreshSeconds }), main);
}

// ---- overview spreadsheet pages (Stage U4) ------------------------------------------------

export interface ExportPageView extends PageContext {
  id: number;
  createdAt: string;
  rowCount: number;
  statuses: string[];
  includeManual: boolean;
  /** true when this request created it; false when the same content already existed. */
  created: boolean | null;
}

const STATUS_NAMES: Record<string, string> = { in_review: 'In review', approved: 'Approved', skipped: 'Skipped', needs_attention: 'Needs attention' };

export function renderExportPage(view: ExportPageView): string {
  const title = `Overview spreadsheet ${view.id}`;
  const statuses = view.statuses.map((s) => STATUS_NAMES[s] ?? 'Unknown').join(', ');
  const note =
    view.created === false
      ? '<p>Nothing had changed since the last overview with these filters, so the same spreadsheet is offered again.</p>'
      : '<p>Drafts only. Nothing has been sent. Synthetic data only.</p>';
  const main = `<div class="page-head"><div><h1 class="page-title">${escapeHtml(title)}</h1><p class="page-sub">Created ${escapeHtml(formatInstant(view.createdAt))}.</p></div></div>
<section class="banner banner--done" role="status" aria-labelledby="export-ready"><span class="banner__icon" aria-hidden="true"><span class="banner__glyph glyph-check"></span></span><div><h2 class="banner__title" id="export-ready">The overview spreadsheet is ready</h2>${note}<p class="banner__link"><a href="/exports/${Number(view.id)}/download">Download overview.xlsx</a></p></div></section>
<dl class="meta"><div><dt>Renewals listed</dt><dd>${escapeHtml(view.rowCount)}</dd></div><div><dt>Statuses</dt><dd>${escapeHtml(statuses)}</dd></div><div><dt>Uploaded cases</dt><dd>${escapeHtml(view.includeManual ? 'Included' : 'Left out')}</dd></div></dl>
<section class="card panel panel-gap" aria-labelledby="sheets"><h2 class="panel__title" id="sheets">What is inside</h2><ul class="checklist"><li>Overview: one row per renewal with its risk word, flags, top change, status and source.</li><li>Flags: every medium and high item across these renewals.</li><li>Notes: the run date, the filters used and how to read severity.</li></ul></section>
<p class="panel-gap"><a class="btn btn-secondary" href="/">Back to all renewals</a></p>`;
  return page(chromeFor(view, title, [title]), main);
}

export function renderNoCasesPage(view: PageContext): string {
  const main = `<div class="page-head"><div><h1 class="page-title">Overview spreadsheet</h1></div></div>
<section class="banner banner--neutral" role="status" aria-labelledby="no-cases"><span class="banner__icon" aria-hidden="true"><span class="banner__glyph glyph-ring"></span></span><div><h2 class="banner__title" id="no-cases">No cases match</h2><p>No renewal has one of the chosen statuses, so no spreadsheet was created. Choose other statuses and try again.</p><p class="banner__link"><a href="/#overview">Back to the overview form</a></p></div></section>`;
  return page(chromeFor(view, 'No cases match', ['Overview spreadsheet']), main);
}
