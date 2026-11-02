// npm run check:contrast
// Reads the approval page colour tokens (src/approval/web/tokens.ts, the same values the stylesheet
// is generated from) and computes the WCAG 2.x contrast ratio of every text/background and
// control/background pair in the light theme (light mode only). Exits 1 if any pair is below its threshold.
// Thresholds: text 4.5:1 (WCAG 1.4.3 AA), controls / focus / meaningful shapes 3:1 (WCAG 1.4.11).
// Decorative hairlines (not controls) are reported against a 1.2:1 visibility floor only.

import { STYLESHEET } from '../src/approval/web/styles.js';
import { checkAllContrast, COLOR_TOKEN_NAMES, cssVarName, THEMES, type ThemeName } from '../src/approval/web/tokens.js';

const out = (line = '') => process.stdout.write(`${line}\n`);

let failed = 0;
for (const token of COLOR_TOKEN_NAMES) {
  for (const theme of Object.keys(THEMES) as ThemeName[]) {
    if (!STYLESHEET.includes(`${cssVarName(token)}:${THEMES[theme][token]};`)) {
      out(`FAIL  token ${cssVarName(token)} (${theme}) is not in the stylesheet with value ${THEMES[theme][token]}`);
      failed++;
    }
  }
}

const results = checkAllContrast();
for (const theme of Object.keys(THEMES) as ThemeName[]) {
  out(`\n${theme.toUpperCase()} theme`);
  out('Result  Ratio    Min   Kind        Foreground -> Background                       Use');
  for (const r of results.filter((x) => x.theme === theme)) {
    const pair = `${r.fg} ${THEMES[theme][r.fg]} -> ${r.bg} ${THEMES[theme][r.bg]}`;
    out(`${r.pass ? 'PASS' : 'FAIL'}    ${r.ratio.toFixed(2).padStart(5)}:1  ${r.min.toFixed(1).padStart(3)}   ${r.kind.padEnd(10)}  ${pair.padEnd(46)} ${r.why}`);
    if (!r.pass) failed++;
  }
}

const textCount = results.filter((r) => r.kind === 'text').length;
const uiCount = results.filter((r) => r.kind === 'ui').length;
out(`\nChecked ${results.length} pairs (${textCount} text, ${uiCount} control/shape, ${results.length - textCount - uiCount} decorative) (light theme).`);
if (failed > 0) {
  out(`${failed} check(s) FAILED.`);
  process.exitCode = 1;
} else {
  out('All contrast checks passed.');
}
