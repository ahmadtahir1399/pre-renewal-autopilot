// The approval page stylesheet (docs/DESIGN.md). Served from its own route with a content hash in
// the URL (/assets/app.<hash>.css), so the CSP can stay at style-src 'self' with no inline styles.
// Rules: no @import, no external url(); the only url() values are the self-hosted font files (fonts.ts).
// Colours come only from tokens.ts. Light mode only.
// Look (Prompt 8, D-125): the taste skill's "ledger" structure in a light-blue identity. White cards with a
// 1px edge on a light blue ground, navy type in Geist, 8px cards and 6px controls, no shadows on anything at rest, no
// gradients. Brand blue marks actions (one filled primary per screen, blue-outlined row actions), links, focus, the
// current page and the main figure; the other hues are status (severity, approved, warnings). Motion lives in client/motion.js (GSAP); this file holds its CSS half.

import { createHash } from 'node:crypto';
import { FONT_FACE_CSS } from './fonts.js';
import { BLUE, COLOR_TOKEN_NAMES, cssVarName, GRAY, THEMES, type Theme } from './tokens.js';

function colorVars(theme: Theme): string {
  return COLOR_TOKEN_NAMES.map((token) => `${cssVarName(token)}:${theme[token]};`).join('');
}

function scaleVars(name: string, scale: Record<number, string>): string {
  return Object.entries(scale)
    .map(([step, value]) => `--${name}-${step}:${value};`)
    .join('');
}

const BASE_TOKENS = `
--font:"App Sans","Segoe UI",system-ui,-apple-system,"Helvetica Neue",Arial,sans-serif;
--font-mono:ui-monospace,"Cascadia Mono",Consolas,"Liberation Mono",monospace;
--fs-2xs:0.8125rem;--fs-xs:0.8125rem;--fs-sm:0.875rem;--fs-md:0.9375rem;--fs-lg:1rem;--fs-xl:1rem;--fs-2xl:1.5rem;--fs-3xl:1.5rem;--fs-kpi:1.875rem;
--space-1:4px;--space-2:8px;--space-3:12px;--space-4:16px;--space-5:20px;--space-6:24px;--space-7:32px;--space-8:48px;--space-9:64px;
--radius-xs:4px;--radius-sm:6px;--radius-md:6px;--radius-lg:8px;--radius-pill:999px;
--shadow-float:0 8px 24px -6px rgb(14 17 22 / 0.16),0 0 0 1px rgb(14 17 22 / 0.06);
--ease-out:cubic-bezier(0.22,1,0.36,1);
--dur-fast:140ms;
--sidebar-w:256px;--gutter:16px;--content-max:76rem;`;

const PRINT_TOKENS = `--bg:#FFFFFF;--surface:#FFFFFF;--surface-sunken:#FFFFFF;--surface-raised:#FFFFFF;--border:#8C8C8C;
--border-strong:#000000;--text:#000000;--text-muted:#333333;--link:#000000;--accent-tint:#FFFFFF;--accent-ink:#000000;
--warn-tint:#FFFFFF;--warn-ink:#000000;--warn-edge:#000000;--mode-bar-bg:#FFFFFF;--mode-bar-text:#000000;
--sev-high-tint:#FFFFFF;--sev-high-ink:#000000;--sev-high-glyph:#000000;--sev-medium-tint:#FFFFFF;--sev-medium-ink:#000000;
--sev-medium-glyph:#000000;--sev-low-tint:#FFFFFF;--sev-low-ink:#000000;--sev-low-glyph:#000000;--sev-info-tint:#FFFFFF;
--sev-info-ink:#000000;--sev-info-glyph:#000000;--success-tint:#FFFFFF;--success-ink:#000000;--success-edge:#000000;`;

const CHECK = 'polygon(12% 50%,0 63%,38% 100%,100% 24%,87% 11%,37% 73%)';

export const STYLESHEET = `/* Pre-Renewal Autopilot approval page. See docs/DESIGN.md. Font: Geist (OFL 1.1), self-hosted. */
${FONT_FACE_CSS}
:root{color-scheme:light;${colorVars(THEMES.light)}${scaleVars('blue', BLUE)}${scaleVars('gray', GRAY)}${BASE_TOKENS}}
@media (min-width:48rem){:root{--gutter:32px;}}

/* ---- base ---- */
*,*::before,*::after{box-sizing:border-box}
html{-webkit-text-size-adjust:100%;text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--text);font:400 var(--fs-sm)/1.55 var(--font);overflow-wrap:break-word;-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;font-synthesis:none}
::selection{background:var(--blue-100);color:var(--text)}
h1,h2,h3{margin:0;text-wrap:balance;font-weight:600;color:var(--text)}
p{margin:0;text-wrap:pretty}
strong{font-weight:600}
a{color:var(--link);text-decoration:none}
a:hover{color:var(--accent-hover);text-decoration:underline;text-decoration-thickness:1px;text-underline-offset:0.2em}
:focus-visible{outline:2px solid var(--focus);outline-offset:2px;border-radius:var(--radius-xs)}
.vh{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip-path:inset(50%);white-space:nowrap;border:0}
.muted{color:var(--text-muted)}
.skip{position:absolute;left:var(--space-4);top:-200px;z-index:20;background:var(--surface);color:var(--link);padding:var(--space-2) var(--space-4);border:2px solid var(--focus);border-radius:var(--radius-sm);font-weight:600}
.skip:focus{top:var(--space-2)}

/* ---- demo bars: one quiet notice line ---- */
.mode-bar{background:var(--mode-bar-bg);color:var(--mode-bar-text);border-bottom:1px solid var(--border);font-size:var(--fs-xs);line-height:1.5;padding:8px var(--gutter)}
.mode-bar strong{font-weight:600}
.mode-bar--public{background:var(--surface);color:var(--text)}

/* ---- app shell: open plane. The sidebar sits on the ground behind one hairline; no top bar chrome. ---- */
.shell{min-height:100vh}
@media (min-width:64rem){.shell{display:grid;grid-template-columns:var(--sidebar-w) minmax(0,1fr)}.shell--minimal{display:block}}
.sidebar{background:var(--sidebar-bg);color:var(--sidebar-text);display:flex;flex-direction:column;gap:var(--space-6);padding:var(--space-5) var(--space-3)}
@media (min-width:64rem){.sidebar{position:sticky;top:0;height:100vh;border-right:1px solid var(--sidebar-border)}}
.logo{display:inline-flex;align-items:center;gap:10px;color:var(--text);font-weight:600;font-size:var(--fs-sm);letter-spacing:-0.01em;line-height:1.25}
.logo:hover{color:var(--text);text-decoration:none}
/* The product's mark: two bars of different length, the expiring policy against the renewal offer. */
.logo__mark{position:relative;display:inline-block;width:28px;height:28px;flex:none;border-radius:var(--radius-sm);background:var(--accent);font-size:0;color:transparent}
.logo__mark::before,.logo__mark::after{content:"";position:absolute;left:7px;height:4px;border-radius:2px;background:var(--on-accent)}
.logo__mark::before{top:9px;width:14px}
.logo__mark::after{top:15px;width:9px;opacity:0.7}
.sidebar .logo{padding:var(--space-1) var(--space-2)}
.nav{position:relative;isolation:isolate}
.nav ul{display:flex;flex-direction:column;gap:2px;margin:0;padding:0;list-style:none}
.nav li{position:relative;z-index:1}
.nav__item{display:flex;align-items:center;justify-content:space-between;gap:var(--space-2);min-height:32px;padding:0 10px;border-radius:var(--radius-sm);color:var(--sidebar-muted);font-size:var(--fs-sm);font-weight:400;transition:background-color var(--dur-fast) ease-out,color var(--dur-fast) ease-out}
.nav__item:hover{background:var(--gray-50);color:var(--sidebar-text);text-decoration:none}
.nav__item.is-current{background:var(--sidebar-active);color:var(--sidebar-active-text);font-weight:500}
.nav__count{color:var(--sidebar-muted);font-size:var(--fs-xs);font-variant-numeric:tabular-nums}
.nav__item.is-current .nav__count{color:var(--sidebar-active-text)}
/* motion.js adds one neutral pill that slides behind the links; the links then drop their own fills. */
.nav__indicator{position:absolute;top:0;left:0;z-index:0;width:0;height:0;border-radius:var(--radius-sm);background:var(--sidebar-active);pointer-events:none;will-change:transform}
.nav.has-indicator .nav__item,.nav.has-indicator .nav__item:hover{background:transparent}
.sidebar__foot{margin-top:auto;display:grid;gap:var(--space-4)}
.sidebar__note{display:grid;gap:2px;padding:0 var(--space-2);font-size:var(--fs-xs);color:var(--sidebar-muted);line-height:1.5}
.sidebar__note strong{color:var(--sidebar-text);font-weight:500}
.user{display:flex;align-items:center;gap:10px;padding:var(--space-3) var(--space-2) 0;border-top:1px solid var(--sidebar-border)}
.avatar{display:inline-grid;place-items:center;width:28px;height:28px;flex:none;border-radius:50%;background:var(--accent-tint);color:var(--accent-ink);font-size:var(--fs-xs);font-weight:600}
.user__text{display:grid;line-height:1.35;min-width:0}
.user__name{font-size:var(--fs-sm);font-weight:500;color:var(--sidebar-text);overflow-wrap:anywhere}
.user__role{font-size:var(--fs-xs);color:var(--sidebar-muted)}
@media (max-width:63.99rem){
.sidebar{flex-direction:row;flex-wrap:wrap;align-items:center;gap:var(--space-2) var(--space-4);padding:var(--space-3) var(--gutter);border-bottom:1px solid var(--sidebar-border)}
.nav ul{flex-direction:row;flex-wrap:wrap}
.nav__item{min-height:40px}
.sidebar__foot{display:none}
}

.content{min-width:0;display:flex;flex-direction:column;min-height:100vh}
.app-header{background:transparent}
.topbar{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:var(--space-2) var(--space-4);max-width:var(--content-max);margin-inline:auto;padding:var(--space-5) var(--gutter) 0}
.crumbs ol{display:flex;flex-wrap:wrap;align-items:center;gap:var(--space-2);margin:0;padding:0;list-style:none;font-size:var(--fs-xs);color:var(--text-muted)}
.crumbs li+li::before{content:"/";margin-right:var(--space-2);color:var(--gray-400)}
.crumbs a{color:var(--text-muted)}
.crumbs a:hover{color:var(--text)}
.crumbs [aria-current]{color:var(--text);font-weight:500;overflow-wrap:anywhere}
.topbar__meta{display:flex;flex-wrap:wrap;align-items:center;gap:var(--space-4)}
.topbar__meta .pill{height:auto;padding:0;background:none;box-shadow:none;color:var(--text-muted);font-size:var(--fs-xs);font-weight:400}
.topbar__meta .pill--accent{color:var(--text)}
.topbar__meta .pill__dot{background:var(--success-edge)}
.main{flex:1;width:100%;max-width:var(--content-max);margin-inline:auto;padding:var(--space-6) var(--gutter) var(--space-9)}
.app-footer{max-width:var(--content-max);width:100%;margin-inline:auto;padding:var(--space-5) var(--gutter);border-top:1px solid var(--border);color:var(--text-muted);font-size:var(--fs-xs)}

/* ---- primitives ---- */
.pill{display:inline-flex;align-items:center;gap:6px;height:22px;padding:0 8px;border-radius:var(--radius-xs);background:var(--sev-info-tint);color:var(--sev-info-ink);font-size:var(--fs-xs);font-weight:500;white-space:nowrap;flex:none}
.pill--accent{background:var(--accent-tint);color:var(--accent-ink)}
.pill--success{background:var(--success-tint);color:var(--success-ink)}
.pill--info{background:var(--accent-tint);color:var(--accent-ink)}
.pill--warn{background:var(--warn-tint);color:var(--warn-ink)}
.pill__dot{width:6px;height:6px;border-radius:50%;background:currentColor}
.chip{display:inline-block;margin-left:var(--space-2);padding:0 6px;border:1px solid var(--border-strong);border-radius:var(--radius-xs);color:var(--text-muted);font-size:var(--fs-2xs);font-weight:500;line-height:1.5;vertical-align:2px}
.count{display:inline-block;margin-left:var(--space-2);color:var(--text-muted);font-size:var(--fs-sm);font-weight:400;font-variant-numeric:tabular-nums}
.card{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-lg)}
.card--flush{overflow:hidden}
.panel{padding:var(--space-5)}
.panel-gap{margin-top:var(--space-3)}
.panel__title{font-size:var(--fs-lg);font-weight:600;line-height:1.4}
.panel__text{margin-top:2px;font-size:var(--fs-xs);color:var(--text-muted)}
.card__header{padding:var(--space-4) var(--space-5);border-bottom:1px solid var(--border)}

.btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;height:36px;padding:0 14px;border:1px solid transparent;border-radius:var(--radius-sm);font:inherit;font-size:var(--fs-sm);font-weight:500;line-height:1;text-align:center;white-space:nowrap;text-decoration:none;cursor:pointer;transition:background-color var(--dur-fast) ease-out,border-color var(--dur-fast) ease-out,color var(--dur-fast) ease-out,transform 80ms ease-out}
.btn:hover{text-decoration:none}
.btn:active{transform:scale(0.98)}
.btn-sm{height:32px;padding:0 12px}
.btn-primary{background:var(--accent);border-color:var(--accent);color:var(--on-accent)}
.btn-primary:hover{background:var(--accent-hover);border-color:var(--accent-hover);color:var(--on-accent)}
.btn-secondary{background:var(--surface);border-color:var(--border-strong);color:var(--text)}
.btn-secondary:hover{background:var(--gray-25);border-color:var(--text);color:var(--text)}
.btn-outline{background:var(--surface);border-color:var(--accent-edge);color:var(--accent-hover)}
.btn-outline:hover{background:var(--accent-tint);border-color:var(--accent);color:var(--accent-hover)}
.btn-ghost{background:transparent;color:var(--text)}
.btn-ghost:hover{background:var(--gray-100);color:var(--text)}
.btn:disabled{cursor:not-allowed;opacity:0.55;transform:none}

/* severity: word + shape + colour, always */
.sev{--sev-tint:var(--sev-info-tint);--sev-ink:var(--sev-info-ink);--sev-glyph:var(--sev-info-glyph);display:inline-flex;align-items:center;gap:6px;height:22px;padding:0 7px 0 6px;border-radius:var(--radius-xs);background:var(--sev-tint);color:var(--sev-ink);font-size:var(--fs-xs);font-weight:500;white-space:nowrap;flex:none}
.sev-high{--sev-tint:var(--sev-high-tint);--sev-ink:var(--sev-high-ink);--sev-glyph:var(--sev-high-glyph)}
.sev-medium{--sev-tint:var(--sev-medium-tint);--sev-ink:var(--sev-medium-ink);--sev-glyph:var(--sev-medium-glyph)}
.sev-low{--sev-tint:var(--sev-low-tint);--sev-ink:var(--sev-low-ink);--sev-glyph:var(--sev-low-glyph)}
.sev-glyph{flex:none;display:inline-block;width:8px;height:8px;background:var(--sev-glyph)}
.sev-high .sev-glyph{width:9px;height:8px;clip-path:polygon(50% 0,100% 100%,0 100%)}
.sev-medium .sev-glyph{width:9px;height:9px;clip-path:polygon(50% 0,100% 50%,50% 100%,0 50%)}
.sev-low .sev-glyph{border-radius:50%}
.sev-info .sev-glyph{border-radius:50%;background:transparent;border:2px solid var(--sev-glyph)}
.risk .risk__label{font-weight:400}
.row .risk .risk__label,.meta .risk__label{position:absolute;width:1px;height:1px;margin:-1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}

/* icons drawn with CSS shapes (no fonts, no images) */
.icon{display:inline-grid;place-items:center;width:32px;height:32px;flex:none;border-radius:50%}
.icon::after{content:"";display:block;width:12px;height:12px;background:currentColor}
.icon--warn{background:var(--warn-tint);color:var(--warn-edge)}
.icon--warn::after{clip-path:polygon(50% 0,100% 100%,0 100%)}
.icon--done{background:var(--success-tint);color:var(--success-edge)}
.icon--done::after{width:14px;clip-path:${CHECK}}

/* ---- page header: a noun title, one sentence, the finding ---- */
.page-head{display:flex;flex-wrap:wrap;align-items:flex-end;justify-content:space-between;gap:var(--space-4)}
.page-head__title{display:flex;flex-wrap:wrap;align-items:center;gap:var(--space-2) var(--space-3)}
.page-title{font-size:var(--fs-3xl);font-weight:600;letter-spacing:-0.02em;line-height:1.25;overflow-wrap:anywhere}
.page-sub{margin-top:var(--space-1);color:var(--text-muted);font-size:var(--fs-sm);max-width:70ch}
.page-finding{margin-top:var(--space-3);font-size:var(--fs-md);color:var(--text);max-width:80ch}
.page-finding a{font-weight:500}

/* ---- summary strip: one card split by hairlines; the lead figure answers the screen's question ---- */
.kpis{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1px;margin:var(--space-6) 0 0;padding:0;list-style:none;background:var(--border);border:1px solid var(--border);border-radius:var(--radius-lg);overflow:hidden}
.kpis__cell--lead{grid-column:1 / -1}
@media (min-width:64rem){.kpis{grid-template-columns:2fr 1fr 1fr 1fr}.kpis__cell--lead{grid-column:auto}}
.kpis>li{min-width:0;background:var(--surface)}
.kpi{display:flex;flex-direction:column;gap:2px;height:100%;padding:var(--space-4) var(--space-5);color:var(--text);transition:background-color var(--dur-fast) ease-out}
.kpi:hover{background:var(--gray-25);color:var(--text);text-decoration:none}
.kpi__label{font-size:var(--fs-sm);color:var(--text-muted)}
.kpi__value{margin-top:var(--space-1);font-size:var(--fs-2xl);font-weight:500;letter-spacing:-0.02em;line-height:1.15;font-variant-numeric:tabular-nums}
.kpi--primary .kpi__value{font-size:var(--fs-kpi);color:var(--accent-ink)}
.kpi__hint{font-size:var(--fs-xs);color:var(--text-muted)}
/* The queue's risk as units: one square per waiting renewal, worst first. */
.units{display:flex;flex-wrap:wrap;gap:3px;margin-top:var(--space-3);max-width:26rem}
.unit{display:inline-block;width:12px;height:12px;flex:none;border-radius:2px;background:var(--sev-info-glyph)}
.unit--high{background:var(--sev-high-glyph)}
.unit--medium{background:var(--sev-medium-glyph)}
.unit--low{background:var(--sev-low-glyph)}
.unit--info{background:var(--blue-200)}
.units__legend{display:flex;flex-wrap:wrap;gap:2px var(--space-4);margin-top:var(--space-2);font-size:var(--fs-xs);color:var(--text-muted);font-variant-numeric:tabular-nums}
.units__item{display:inline-flex;align-items:center;gap:6px}
.units__item .unit{width:8px;height:8px}

/* ---- sections ---- */
.section{margin-top:var(--space-8)}
.section__head{display:flex;flex-wrap:wrap;align-items:baseline;justify-content:space-between;gap:var(--space-1) var(--space-4);margin-bottom:var(--space-3)}
.section__title{font-size:var(--fs-xl);font-weight:600;line-height:1.4}
.section__intro{color:var(--text-muted);font-size:var(--fs-xs)}

/* ---- data rows ---- */
.list-head{display:none}
.rows{margin:0;padding:0;list-style:none}
.rows>li+li{border-top:1px solid var(--gray-100)}
.row{display:grid;gap:var(--space-3) var(--space-5);padding:var(--space-4) var(--space-5);transition:background-color var(--dur-fast) ease-out}
.row:hover{background:var(--gray-25)}
.row__title{font-size:var(--fs-sm);font-weight:500;line-height:1.4;overflow-wrap:anywhere}
.row__title a{color:var(--text)}
.row__title a:hover{color:var(--link)}
.row__sub{font-size:var(--fs-xs);color:var(--text-muted)}
.row__date{margin-top:var(--space-1);font-size:var(--fs-xs);font-variant-numeric:tabular-nums}
.row__weeks{display:block;color:var(--text-muted)}
.row__change{min-width:0}
.row__change-line{display:flex;align-items:flex-start;gap:var(--space-2);font-size:var(--fs-sm)}
.row__change-line .sev{flex:none}
.clamp{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;line-clamp:2;overflow:hidden;overflow-wrap:anywhere;line-height:22px}
.row__note{margin-top:var(--space-1);font-size:var(--fs-xs);color:var(--text-muted)}
.row__decision{font-size:var(--fs-sm)}
.row__problem{margin-top:var(--space-2);font-size:var(--fs-xs);color:var(--warn-ink);background:var(--warn-tint);border-radius:var(--radius-xs);padding:var(--space-1) var(--space-2)}
.row__reason{font-size:var(--fs-sm);font-weight:500}
.row__actions{display:flex;flex-wrap:wrap;align-items:center;gap:var(--space-1)}
.row__actions form{margin:0}
.row--notice{grid-template-columns:auto minmax(0,1fr)}
.row--notice .row__change{grid-column:2}
@media (min-width:56rem){
.list-head{display:grid;grid-template-columns:minmax(12rem,1.15fr) 6.5rem minmax(14rem,2fr) auto;gap:var(--space-5);padding:var(--space-2) var(--space-5);border-bottom:1px solid var(--border);font-size:var(--fs-xs);color:var(--text-muted)}
.list-head span:last-child{width:15rem}
.row{grid-template-columns:minmax(12rem,1.15fr) 6.5rem minmax(14rem,2fr) auto;align-items:center}
.row__actions{width:15rem;justify-content:flex-end;flex-wrap:nowrap}
.row--compact .row__actions{width:auto}
.row--notice{grid-template-columns:auto minmax(12rem,1.15fr) minmax(14rem,2.4fr)}
.row--notice .row__change{grid-column:auto}
}

/* ---- empty states: keep the frame, one sentence ---- */
.empty{display:flex;align-items:center;gap:var(--space-3);padding:var(--space-5)}
.empty--inset{margin-top:var(--space-3);padding:var(--space-3) var(--space-4);border:1px dashed var(--border);border-radius:var(--radius-md)}
.empty__title{font-weight:500}
.empty__text{margin-top:2px;font-size:var(--fs-xs);color:var(--text-muted)}

/* ---- banners (result of an action) ---- */
.banner{display:flex;gap:var(--space-3);margin-top:var(--space-4);padding:var(--space-4);border:1px solid;border-radius:var(--radius-lg)}
.banner--done{background:var(--success-tint);color:var(--success-ink);border-color:var(--success-edge)}
.banner--warn{background:var(--warn-tint);color:var(--warn-ink);border-color:var(--warn-edge)}
.banner--neutral{background:var(--surface);color:var(--text);border-color:var(--border-strong)}
.banner__icon{display:inline-grid;place-items:center;width:28px;height:28px;flex:none;border-radius:50%;background:var(--surface);border:1px solid currentColor}
.banner--done .banner__icon{color:var(--success-ink)}
.banner--warn .banner__icon{color:var(--warn-edge)}
.banner__glyph{display:block;width:12px;height:12px;background:currentColor}
.glyph-check{clip-path:${CHECK}}
.glyph-dash{clip-path:inset(40% 0 40% 0)}
.glyph-diamond{clip-path:polygon(50% 0,100% 50%,50% 100%,0 50%)}
.glyph-ring{background:transparent;border:2px solid currentColor;border-radius:50%}
.banner__title{font-size:var(--fs-md);font-weight:600;line-height:1.4;color:inherit}
.banner p{margin-top:2px;font-size:var(--fs-sm);max-width:72ch}
.banner__link{margin-top:var(--space-2) !important}
.banner a{color:inherit;font-weight:500;text-decoration:underline;text-underline-offset:0.2em}

/* ---- pack page ---- */
.pack{display:grid;gap:var(--space-3)}
.pack__head,.pack__decision,.pack__body,.pack__activity{min-width:0}
@media (min-width:72rem){
.pack{grid-template-columns:minmax(0,1fr) 20rem;grid-template-rows:auto auto 1fr;grid-template-areas:"head head" "body decision" "body activity";align-items:start;column-gap:var(--space-3)}
.pack__head{grid-area:head;margin-bottom:var(--space-3)}.pack__decision{grid-area:decision}.pack__body{grid-area:body}.pack__activity{grid-area:activity}
}
.meta{display:flex;flex-wrap:wrap;gap:var(--space-4) var(--space-8);margin:var(--space-5) 0 0;padding:var(--space-4) var(--space-5);background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-lg)}
.meta dt{font-size:var(--fs-xs);color:var(--text-muted)}
.meta dd{margin:2px 0 0;font-size:var(--fs-md);font-weight:500;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}
.meta dd .muted{font-weight:400}
.checklist{display:grid;gap:var(--space-2);margin:var(--space-3) 0 0;padding:0;list-style:none;font-size:var(--fs-xs);color:var(--text-muted)}
.checklist li{position:relative;padding-left:20px}
.checklist li::before{content:"";position:absolute;left:1px;top:0.4em;width:11px;height:9px;background:var(--text-muted);clip-path:${CHECK}}
.decision-actions{display:grid;gap:var(--space-2);margin-top:var(--space-5)}
.decision-actions form{margin:0}
.decision-actions>form .btn,.decision-actions>.btn{width:100%;height:40px}
.decision-actions__pair{display:grid;grid-template-columns:1fr 1fr;gap:var(--space-2)}
.decision-actions__pair .btn,.decision-actions__pair form{width:100%}

.flags{display:grid;gap:0;margin:var(--space-3) 0 0;padding:0;list-style:none}
.flags>li+li{border-top:1px solid var(--gray-100)}
.flag{display:grid;grid-template-columns:auto minmax(0,1fr);gap:2px var(--space-3);align-items:start;padding:var(--space-3) 0}
.flag__field{font-weight:500;font-size:var(--fs-sm);overflow-wrap:anywhere;line-height:22px}
.flag__msg{margin-top:2px;font-size:var(--fs-xs);color:var(--text-muted);overflow-wrap:anywhere}
.flag__link{grid-column:2;font-size:var(--fs-xs);font-weight:500}

.table-wrap{overflow-x:auto}
table{width:100%;border-collapse:collapse;font-size:var(--fs-sm)}
thead th{padding:var(--space-2) var(--space-4);color:var(--text-muted);font-size:var(--fs-xs);font-weight:400;text-align:left;white-space:nowrap;border-bottom:1px solid var(--border)}
tbody th,tbody td{padding:var(--space-3) var(--space-4);text-align:left;vertical-align:top;overflow-wrap:break-word}
tbody th{font-weight:500;min-width:8rem}
thead th:first-child,tbody th{padding-left:var(--space-5)}
.change+.change{border-top:1px solid var(--gray-100)}
.change__first th,.change__first td{padding-bottom:var(--space-1)}
.change__kind{display:block;margin-top:2px;font-size:var(--fs-xs);font-weight:400;color:var(--text-muted)}
.change__explain td{padding:0 var(--space-4) var(--space-3) var(--space-5);color:var(--text-muted);font-size:var(--fs-xs);overflow-wrap:anywhere}
.change:target th,.change:target td{background:var(--accent-tint)}
.change:target .change__first th{box-shadow:inset 2px 0 0 var(--focus)}
.value{font-variant-numeric:tabular-nums;min-width:6rem}
.value--new{color:var(--text);font-weight:600}
.source{white-space:nowrap}
.source-tag{display:block;width:max-content;margin:0 0 2px;color:var(--text-muted);font-size:var(--fs-xs)}
@media (max-width:44rem){
table,thead,tbody,tr,th,td{display:block}
thead{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}
tbody th,tbody td{padding:var(--space-1) var(--space-5)}
.change{padding-block:var(--space-3)}
.change__explain td{padding:var(--space-1) var(--space-5) var(--space-2)}
.change td[data-label]::before{content:attr(data-label);display:block;font-size:var(--fs-xs);color:var(--text-muted)}
.source{white-space:normal}
}

.timeline{margin:var(--space-3) 0 0;padding:0;list-style:none}
.timeline li{position:relative;padding:0 0 var(--space-3) 18px}
.timeline li::before{content:"";position:absolute;left:3px;top:0.5em;width:7px;height:7px;border-radius:50%;background:var(--gray-400)}
.timeline li::after{content:"";position:absolute;left:6px;top:1.4em;bottom:0;width:1px;background:var(--border)}
.timeline li:last-child::after{display:none}
.timeline li:last-child::before{background:var(--accent)}
.timeline__what{display:block;font-size:var(--fs-xs);line-height:1.45;overflow-wrap:anywhere}
.timeline__meta{display:flex;flex-wrap:wrap;gap:0 var(--space-2);margin-top:1px;font-size:var(--fs-2xs);color:var(--text-muted)}
.timeline time{font-variant-numeric:tabular-nums}
.timeline__more{font-size:var(--fs-xs);color:var(--text-muted)}

details.details{margin-top:var(--space-3);background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-lg);padding:var(--space-3) var(--space-5)}
details.details summary{cursor:pointer;font-size:var(--fs-sm);color:var(--text-muted)}
details.details summary:hover,details.details[open] summary{color:var(--text)}
.kv{display:grid;grid-template-columns:max-content minmax(0,1fr);gap:var(--space-2) var(--space-5);margin:var(--space-3) 0 var(--space-2);font-size:var(--fs-xs)}
.kv dt{color:var(--text-muted)}
.kv dd{margin:0;overflow-wrap:anywhere}
.mono{font-family:var(--font-mono);font-size:var(--fs-2xs)}

/* ---- upload pages (Prompt 7): forms, progress steps, extracted facts ---- */
.upload-grid{display:grid;gap:var(--space-3);margin-top:var(--space-5)}
@media (min-width:72rem){.upload-grid{grid-template-columns:repeat(2,minmax(0,1fr));align-items:start}}
.upload .banner{margin-top:var(--space-4)}
.form{display:grid;gap:var(--space-4);margin-top:var(--space-4)}
.form--inline{margin-top:var(--space-3);gap:var(--space-3);justify-items:start}
.form__row{display:grid;gap:var(--space-4)}
@media (min-width:40rem){.form__row{grid-template-columns:repeat(2,minmax(0,1fr))}}
.form__actions{display:flex;flex-wrap:wrap;gap:var(--space-2)}
.field{display:grid;gap:6px;min-width:0}
.field__label{font-size:var(--fs-sm);font-weight:500;color:var(--text)}
.field__optional{font-weight:400;color:var(--text-muted)}
.field__hint{font-size:var(--fs-xs);color:var(--text-muted)}
.input{width:100%;min-height:38px;padding:7px 10px;background:var(--surface);color:var(--text);border:1px solid var(--border-strong);border-radius:var(--radius-sm);font:inherit;font-size:var(--fs-sm);transition:border-color var(--dur-fast) ease-out}
.input:hover{border-color:var(--text-muted)}
.input:focus-visible{outline:2px solid var(--focus);outline-offset:1px;border-color:var(--focus)}
.file{width:100%;padding:var(--space-2);background:var(--surface-sunken);color:var(--text);border:1px dashed var(--border-strong);border-radius:var(--radius-sm);font:inherit;font-size:var(--fs-xs)}
.file::file-selector-button{margin-right:var(--space-3);height:30px;padding:0 var(--space-3);background:var(--surface);color:var(--text);border:1px solid var(--border-strong);border-radius:var(--radius-sm);font:inherit;font-size:var(--fs-xs);font-weight:500;cursor:pointer}
.file:hover::file-selector-button{background:var(--gray-100)}
.file:focus-visible{outline:2px solid var(--focus);outline-offset:2px}
.field--check{grid-template-columns:auto minmax(0,1fr);align-items:start;gap:var(--space-2);padding:var(--space-3);background:var(--warn-tint);border-radius:var(--radius-sm);color:var(--text);font-size:var(--fs-xs)}
.check{width:16px;height:16px;margin:2px 0 0;accent-color:var(--accent)}
.panel__note{margin-top:var(--space-3);font-size:var(--fs-xs);color:var(--text-muted)}
.recent{margin:0;padding:0;list-style:none}
.recent>li+li{border-top:1px solid var(--gray-100)}
.recent__item{display:flex;align-items:center;justify-content:space-between;gap:var(--space-4);padding:var(--space-3) var(--space-5);color:var(--text);transition:background-color var(--dur-fast) ease-out}
.recent__item:hover{background:var(--gray-25);color:var(--text);text-decoration:none}
.recent__main{display:grid;gap:1px;min-width:0}
.recent__title{font-weight:500;font-size:var(--fs-sm);overflow-wrap:anywhere}
.recent__meta{font-size:var(--fs-xs);color:var(--text-muted)}
.job{display:grid;gap:var(--space-3)}
.job__head,.job__body,.job__side{min-width:0}
.job__side{display:grid;gap:var(--space-3);align-content:start}
@media (min-width:72rem){.job{grid-template-columns:minmax(0,1fr) 20rem;grid-template-areas:"head head" "body side";align-items:start;column-gap:var(--space-3)}.job__head{grid-area:head;margin-bottom:var(--space-3)}.job__body{grid-area:body}.job__side{grid-area:side}}
.job__body>.card:first-child{margin-top:0}
.job__body>.card+.card{margin-top:var(--space-3)}
/* Progress: one card split by hairlines, read left to right. */
.steps{display:grid;gap:1px;margin:var(--space-5) 0 0;padding:0;list-style:none;background:var(--border);border:1px solid var(--border);border-radius:var(--radius-lg);overflow:hidden}
@media (min-width:56rem){.steps{grid-template-columns:repeat(5,minmax(0,1fr))}}
.step{display:grid;grid-template-columns:auto minmax(0,1fr);column-gap:var(--space-3);align-items:center;padding:var(--space-3) var(--space-4);background:var(--surface)}
.step__glyph{position:relative;grid-row:span 2;display:inline-grid;place-items:center;width:24px;height:24px;border-radius:50%;border:1px solid var(--border-strong);background:var(--surface);color:var(--border-strong)}
.step__glyph .banner__glyph{width:10px;height:10px}
.step__label{font-size:var(--fs-sm);font-weight:500;line-height:1.3}
.step__word{font-size:var(--fs-xs);color:var(--text-muted)}
.step--done .step__glyph{background:var(--success-tint);border-color:var(--success-edge);color:var(--success-ink)}
.step--current .step__glyph{border-color:var(--accent);color:var(--accent)}
.step--current .step__word{color:var(--accent-ink)}
.step--current .step__glyph::after{content:"";position:absolute;inset:-4px;border-radius:50%;border:2px solid var(--accent);opacity:0}
.step--stopped{background:var(--warn-tint)}
.step--stopped .step__glyph{border-color:var(--warn-edge);color:var(--warn-edge)}
.step--stopped .step__word{color:var(--warn-ink)}
.docs{display:grid;gap:0;margin:var(--space-2) 0 0;padding:0;list-style:none}
.docs li{display:grid;gap:1px;padding:var(--space-3) 0}
.docs li+li{border-top:1px solid var(--gray-100)}
.doc__side{font-size:var(--fs-xs);color:var(--text-muted)}
.doc__name{font-weight:500;font-size:var(--fs-sm);overflow-wrap:anywhere}
.doc__meta{font-size:var(--fs-xs);color:var(--text-muted)}
.facts thead th{white-space:normal}
.th-note{display:block}
.fact{min-width:12rem}
.fact__value{font-weight:500;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}
.fact__meta{display:flex;flex-wrap:wrap;align-items:center;gap:var(--space-2);margin-top:4px}
.fact__meta .source-tag{display:inline-block;margin:0}
.source-tag--inline{display:inline-block;margin:0 0 0 4px}
.fact__warn{margin-top:4px;padding:2px var(--space-2);border-radius:var(--radius-xs);background:var(--warn-tint);color:var(--warn-ink);font-size:var(--fs-xs)}
.fact__list{display:grid;gap:4px;margin:0;padding:0;list-style:none}
.quote{display:block;margin-top:4px;color:var(--text-muted);font-size:var(--fs-xs);overflow-wrap:anywhere}
.quote--full{max-height:16rem;overflow:auto;white-space:pre-wrap}
.more{margin-top:4px;font-size:var(--fs-xs)}
.more summary{cursor:pointer;color:var(--link)}
.conf{--conf-tint:var(--sev-info-tint);--conf-ink:var(--sev-info-ink);display:inline-flex;align-items:center;gap:5px;height:20px;padding:0 6px;border-radius:var(--radius-xs);background:var(--conf-tint);color:var(--conf-ink);font-size:var(--fs-2xs);font-weight:500}
.conf-high{--conf-tint:var(--success-tint);--conf-ink:var(--success-ink)}
.conf-medium{--conf-tint:var(--sev-low-tint);--conf-ink:var(--sev-low-ink)}
.conf-low{--conf-tint:var(--warn-tint);--conf-ink:var(--warn-ink)}
.conf__glyph{width:7px;height:7px;background:var(--conf-ink)}
.conf-high .conf__glyph{width:9px;clip-path:${CHECK}}
.conf-medium .conf__glyph{border-radius:50%}
.conf-low .conf__glyph{clip-path:polygon(50% 0,100% 100%,0 100%)}
.page-head__actions{display:flex;flex-wrap:wrap;gap:var(--space-2)}
.row__upload{margin-top:var(--space-1);font-size:var(--fs-xs);font-weight:500}
.quality__list{display:grid;gap:0;margin:var(--space-3) 0 0;padding:0;list-style:none}
.quality__list>li+li{border-top:1px solid var(--gray-100)}
.q{display:grid;grid-template-columns:4rem minmax(0,1fr);align-items:baseline;gap:var(--space-3);padding:var(--space-3) 0}
.q__num{font-size:var(--fs-2xl);font-weight:500;letter-spacing:-0.02em;font-variant-numeric:tabular-nums;color:var(--text)}
.q__of{font-size:var(--fs-sm);color:var(--text-muted)}
.q__text{font-size:var(--fs-xs);color:var(--text)}
.q--ok .q__num{color:var(--success-ink)}
.q--warn .q__num{color:var(--warn-ink)}
.fact__note{margin-top:4px;font-size:var(--fs-xs);font-weight:500;color:var(--success-ink)}
.choices{display:flex;flex-wrap:wrap;gap:var(--space-2) var(--space-5);margin:0;padding:0;border:0}
.choices legend{margin-bottom:var(--space-2);padding:0}
.choice{display:inline-flex;align-items:center;gap:var(--space-2);font-size:var(--fs-sm)}
.form--overview{margin-top:0}

/* ---- error pages ---- */
.error{max-width:32rem;margin:var(--space-8) auto 0;padding:var(--space-7)}
.error__code{display:inline-block;margin-bottom:var(--space-2);color:var(--text-muted);font-size:var(--fs-sm);font-variant-numeric:tabular-nums}
.error .page-title{font-size:var(--fs-2xl)}
.error__text{margin:var(--space-3) 0 var(--space-5);color:var(--text-muted)}

/* ---- motion: the CSS half (client/motion.js is the GSAP half) ----
   boot.js sets .motion-pending on <html> before first paint (never under reduced motion); motion.js hands each
   region to GSAP and removes it in the same frame. If the scripts never run, the failsafe shows everything. */
.motion-pending[data-motion="first"] :is(.sidebar,.mode-bar,.app-header),.motion-pending .main{opacity:0;animation:pra-failsafe 0s linear 1.5s forwards}
@keyframes pra-failsafe{to{opacity:1}}
@keyframes pra-pulse{0%{opacity:0.7;transform:scale(0.85)}70%,100%{opacity:0;transform:scale(1.3)}}
@media (prefers-reduced-motion:no-preference){
html{scroll-behavior:smooth}
.step--current .step__glyph::after{animation:pra-pulse 1.8s var(--ease-out) infinite}
@view-transition{navigation:auto}
.sidebar{view-transition-name:sidebar}
::view-transition-old(root){animation:pra-vt-out 140ms ease-in both}
::view-transition-new(root){animation:pra-vt-in 240ms var(--ease-out) both}
}
@keyframes pra-vt-out{to{opacity:0}}
@keyframes pra-vt-in{from{opacity:0}}

@media (prefers-reduced-motion:reduce){*,*::before,*::after{transition:none !important;animation:none !important;scroll-behavior:auto !important}.btn:active{transform:none}}
@media (forced-colors:active){
.sev-glyph,.banner__glyph,.icon::after,.checklist li::before,.unit,.logo__mark::before,.logo__mark::after{forced-color-adjust:none;background:CanvasText}
.sev-info .sev-glyph,.glyph-ring{background:Canvas;border-color:CanvasText}
.sev,.banner,.card,.kpis,.pill,.chip,.meta,.steps{border:1px solid CanvasText}
.btn{border:1px solid ButtonText}
.nav__item.is-current{outline:2px solid Highlight}
.nav__indicator{display:none}
.conf,.step__glyph,.input,.file,.field--check{border:1px solid CanvasText}
.conf__glyph{forced-color-adjust:none;background:CanvasText}
.change:target th,.change:target td{outline:2px solid Highlight}
}
@media print{
:root{${PRINT_TOKENS}}
body{background:#FFFFFF;color:#000000;font-size:10pt}
.skip,.sidebar,.crumbs,.topbar__meta,.row__actions,.decision-actions,form,.btn,.flag__link,.app-footer,.list-head,.banner__link{display:none !important}
.shell{display:block}
.mode-bar{border:1px solid #000000}
.sev-glyph,.banner__glyph,.icon::after,.unit{-webkit-print-color-adjust:exact;print-color-adjust:exact}
.sev,.pill,.chip{border:1px solid #000000}
a{color:#000000;text-decoration:none}
.pack{display:block}
.pack__decision,.pack__activity,.pack__body{margin-top:var(--space-5)}
.card,.kpis,.meta,.banner,.steps{break-inside:avoid}
.card--flush{overflow:visible}
thead{display:table-header-group}
.change{break-inside:avoid}
.main{padding-block:var(--space-4);max-width:none}
@page{margin:14mm}
}
`;

/** First 12 hex chars of the stylesheet's sha256: changes whenever the CSS (or a font file) changes. */
export const STYLESHEET_HASH = createHash('sha256').update(STYLESHEET).digest('hex').slice(0, 12);
export const STYLESHEET_PATH = `/assets/app.${STYLESHEET_HASH}.css`;
