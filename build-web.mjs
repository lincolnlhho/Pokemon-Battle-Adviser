#!/usr/bin/env node
/**
 * build-web.mjs — turn a Cowork artifact into the battle-adviser.com deploy file.
 *
 *   node build-web.mjs <path-to-artifact.html>
 *
 * The live site is NOT the raw artifact. It is the artifact plus six web-only
 * changes, sourced from _web-parts/. Every step either applies cleanly, is
 * detected as already-applied, or aborts. It never writes a half-patched file.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE  = dirname(fileURLToPath(import.meta.url));
const OUT   = resolve(HERE, 'battle-adviser-web', 'index.html');
const PARTS = resolve(HERE, '_web-parts');

const done = [];
const die  = (msg) => { console.error(`\nBUILD FAILED: ${msg}\n`); process.exit(1); };
const step = (n, msg) => done.push(`  ${n}. ${msg}`);
const part = (name) =>
  readFileSync(resolve(PARTS, name), 'utf8').replace(/\r\n/g, '\n').replace(/\n+$/, '');

const src = process.argv[2];
if (!src) die('usage: node build-web.mjs <path-to-artifact.html>');

let html;
try { html = readFileSync(resolve(src), 'utf8').replace(/\r\n/g, '\n'); }
catch (e) { die(`cannot read artifact: ${e.message}`); }

const srcBytes = Buffer.byteLength(html, 'utf8');

/* 1. strip the Cowork artifact metadata block ------------------------------ */
const META = /<script type="application\/json" id="cowork-artifact-meta">[\s\S]*?<\/script>\s*/;
if (META.test(html)) {
  html = html.replace(META, '').replace(/^(<!DOCTYPE html>)\s*(<html)/i, '$1\n$2');
  step(1, 'stripped cowork-artifact-meta block');
} else {
  step(1, 'no cowork-artifact-meta block found (already clean)');
}

/* 2. brand spelling: Advisor -> Adviser ------------------------------------ */
const spellHits = (html.match(/advisor/gi) || []).length;
html = html.replace(/Advisor/g, 'Adviser').replace(/advisor/g, 'adviser');
step(2, spellHits ? `renamed ${spellHits} x "Advisor" -> "Adviser"` : 'spelling already "Adviser"');

/* 3. Cloudflare Web Analytics into <head> ---------------------------------- */
if (html.includes('cloudflareinsights')) {
  step(3, 'Cloudflare analytics already present');
} else {
  if (!/<\/title>/.test(html)) die('no </title> found — cannot place analytics beacon');
  html = html.replace(/<\/title>/, `</title>\n${part('head-analytics.html')}`);
  step(3, 'injected Cloudflare Web Analytics');
}

/* 4. coffee button into the tab bar ---------------------------------------- */
if (html.includes('id="tab-coffee-btn"')) {
  step(4, 'coffee tab button already present');
} else {
  const SQUAD_BTN = /^([^\n]*<button id="tab-squad-btn"[^\n]*<\/button>)$/m;
  if (!SQUAD_BTN.test(html)) die('tab bar anchor <button id="tab-squad-btn"> not found');
  html = html.replace(SQUAD_BTN, `$1\n${part('tabbar-button.html')}`);
  step(4, 'injected coffee tab button');
}

/* 5. coffee panel, just inside the close of <div class="app"> -------------- */
if (html.includes('id="tab-coffee"')) {
  step(5, 'coffee panel already present');
} else {
  const appAt = html.indexOf('<div class="app">');
  if (appAt === -1) die('<div class="app"> not found — cannot place coffee panel');
  const scan = /<div\b[^>]*>|<\/div>/g;
  scan.lastIndex = appAt + '<div class="app">'.length;
  let depth = 1, closeAt = -1, m;
  while ((m = scan.exec(html)) !== null) {
    depth += m[0] === '</div>' ? -1 : 1;
    if (depth === 0) { closeAt = m.index; break; }
  }
  if (closeAt === -1) die('could not find the </div> closing <div class="app"> (unbalanced markup?)');
  html = `${html.slice(0, closeAt)}${part('coffee-tab.html')}\n${html.slice(closeAt)}`;
  step(5, 'injected coffee panel');
}

/* 6. teach switchTab() about the coffee tab -------------------------------- */
if (html.includes("getElementById('tab-coffee')")) {
  step(6, 'switchTab already handles the coffee tab');
} else {
  const [lineTab, lineBtn] = part('switchtab-lines.txt').split('\n');
  const PANEL = /^([^\n]*getElementById\('tab-squad'\)[^\n]*)$/m;
  const BTN   = /^([^\n]*getElementById\('tab-squad-btn'\)[^\n]*)$/m;
  if (!PANEL.test(html)) die("switchTab anchor getElementById('tab-squad') not found");
  if (!BTN.test(html))   die("switchTab anchor getElementById('tab-squad-btn') not found");
  html = html.replace(PANEL, `$1\n${lineTab}`).replace(BTN, `$1\n${lineBtn}`);
  step(6, 'patched switchTab() for the coffee tab');
}

/* final gate: refuse to write anything half-built --------------------------- */
const required = [
  ['<title>',                            'page title'],
  ['cloudflareinsights',                 'analytics beacon'],
  ['id="tab-coffee-btn"',                'coffee tab button'],
  ['id="tab-coffee"',                    'coffee panel'],
  ['<!-- COFFEE TAB START -->',          'coffee start marker'],
  ['<!-- COFFEE TAB END -->',            'coffee end marker'],
  ["getElementById('tab-coffee')",       'switchTab panel toggle'],
  ["getElementById('tab-coffee-btn')",   'switchTab button toggle'],
];
const missing = required.filter(([needle]) => !html.includes(needle)).map(([, label]) => label);
if (missing.length) die(`output is missing: ${missing.join(', ')}`);
if (/cowork-artifact-meta/.test(html)) die('cowork-artifact-meta survived the strip');
if (/advisor/i.test(html))             die('the spelling "Advisor" survived the rename');

writeFileSync(OUT, html, 'utf8');   // LF endings; git applies CRLF on checkout

console.log(`\nBuilt ${OUT}`);
console.log(done.join('\n'));
console.log(`\n  artifact ${srcBytes.toLocaleString()} bytes  ->  deploy ${Buffer.byteLength(html, 'utf8').toLocaleString()} bytes (LF)`);
console.log('  Live Content-Length should match the LF byte count above once deployed.\n');
