#!/usr/bin/env node
/**
 * build-web.mjs — turn the Pokémon Team Type Index into the battle-adviser.com deploy file.
 *
 *   node build-web.mjs ../pokemon-analytics/index.html
 *
 * Pass the BUILT page (pokemon-analytics/index.html), never app.html. app.html loads the
 * engine through relative <script src="../Pokemon_Type_Engine/..."> tags that 404 on the
 * live domain; index.html has the engine inlined.
 *
 * The live site is NOT the app as built. It is the app plus a web-only layer sourced from
 * _web-parts/. Every step either applies cleanly, is detected as already-applied, or aborts.
 * It never writes a half-patched file.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE  = dirname(fileURLToPath(import.meta.url));
const OUT   = resolve(HERE, 'battle-adviser-web', 'index.html');
const PARTS = resolve(HERE, '_web-parts');

const BRAND = 'Pokémon Battle Adviser';

const done = [];
const die  = (msg) => { console.error(`\nBUILD FAILED: ${msg}\n`); process.exit(1); };
const step = (n, msg) => done.push(`  ${n}. ${msg}`);
const part = (name) =>
  readFileSync(resolve(PARTS, name), 'utf8').replace(/\r\n/g, '\n').replace(/\n+$/, '');

const src = process.argv[2];
if (!src) die('usage: node build-web.mjs <path-to-built-index.html>');

let html;
try { html = readFileSync(resolve(src), 'utf8').replace(/\r\n/g, '\n'); }
catch (e) { die(`cannot read source: ${e.message}`); }

const srcBytes = Buffer.byteLength(html, 'utf8');

/* guard: refuse the un-inlined source -------------------------------------- */
/* Anchored to line start so the engine's own JSDoc examples — which mention
   <script src="../..."> inside block comments — do not trip the check. */
if (/^\s*<script src="\.\.\/Pokemon_Type_Engine\//m.test(html)) {
  die('this is app.html, not the built page — the engine is not inlined and would 404 live.\n' +
      '  Run pokemon-analytics\\build.ps1 first, then pass pokemon-analytics\\index.html.');
}

/* 1. strip any Cowork artifact metadata block ------------------------------ */
const META = /<script type="application\/json" id="cowork-artifact-meta">[\s\S]*?<\/script>\s*/;
if (META.test(html)) {
  html = html.replace(META, '').replace(/^(<!DOCTYPE html>)\s*(<html)/i, '$1\n$2');
  step(1, 'stripped cowork-artifact-meta block');
} else {
  step(1, 'no cowork-artifact-meta block (already clean)');
}

/* 2. brand the page for the domain ----------------------------------------- */
const TITLE = /<title>[^<]*<\/title>/;
if (!TITLE.test(html)) die('no <title> found');
const oldTitle = html.match(TITLE)[0].replace(/<\/?title>/g, '');
html = html.replace(TITLE, `<title>${BRAND}</title>`);

const BRAND_LABEL = /(<div class="brand" aria-label=")[^"]*(">)/;
const BRAND_NAME  = /(<strong>)Team Type Index(<\/strong>)/;
if (!BRAND_LABEL.test(html)) die('topbar brand block not found — cannot rebrand the header');
if (!BRAND_NAME.test(html))  die('topbar <strong>Team Type Index</strong> not found — cannot rebrand the header');
html = html
  .replace(BRAND_LABEL, `$1${BRAND}$2`)
  .replace(BRAND_NAME, '$1Battle Adviser$2');
step(2, `rebranded "${oldTitle}" -> "${BRAND}" (title + topbar)`);

/* 3. Cloudflare Web Analytics into <head> ---------------------------------- */
if (html.includes('cloudflareinsights')) {
  step(3, 'Cloudflare analytics already present');
} else {
  html = html.replace(/<\/title>/, `</title>\n${part('head-analytics.html')}`);
  step(3, 'injected Cloudflare Web Analytics');
}

/* 4. coffee styles into <head> --------------------------------------------- */
/* Deliberately in <head>, not inside the coffee section. A <style> that sits in an
   initially-hidden subtree does not get re-invalidated when :root custom properties
   change, so a live theme toggle stranded the button on the light-mode brand. */
if (html.includes('id="coffee-styles"')) {
  step(4, 'coffee styles already present');
} else {
  if (!html.includes('</head>')) die('no </head> found — cannot place the coffee styles');
  html = html.replace('</head>', `${part('coffee-styles.html')}\n</head>`);
  step(4, 'injected coffee styles into <head>');
}

/* 5. coffee nav tab -------------------------------------------------------- */
if (html.includes('data-view="coffee"')) {
  step(5, 'coffee nav tab already present');
} else {
  const LAST_NAV = /^([^\n]*<button class="nav-tab" data-view="exposure">[^\n]*<\/button>)$/m;
  if (!LAST_NAV.test(html)) die('nav anchor <button class="nav-tab" data-view="exposure"> not found');
  html = html.replace(LAST_NAV, `$1\n${part('nav-button.html')}`);
  step(5, 'injected coffee nav tab');
}

/* 6. coffee view section, after the last existing view --------------------- */
if (html.includes('id="coffeeView"')) {
  step(6, 'coffee view already present');
} else {
  const OPEN = '<section id="exposureView"';
  const openAt = html.indexOf(OPEN);
  if (openAt === -1) die('<section id="exposureView"> not found — cannot place the coffee view');
  const scan = /<section\b[^>]*>|<\/section>/g;
  scan.lastIndex = openAt + OPEN.length;
  let depth = 1, closeAt = -1, m;
  while ((m = scan.exec(html)) !== null) {
    depth += m[0] === '</section>' ? -1 : 1;
    if (depth === 0) { closeAt = m.index + m[0].length; break; }
  }
  if (closeAt === -1) die('could not find the </section> closing #exposureView (unbalanced markup?)');
  html = `${html.slice(0, closeAt)}\n\n${part('coffee-view.html')}${html.slice(closeAt)}`;
  step(6, 'injected coffee view section');
}

/* 7. register the element -------------------------------------------------- */
if (/coffeeView:\s*document\.getElementById/.test(html)) {
  step(7, 'els.coffeeView already registered');
} else {
  const ELS = /^([^\n]*const els = \{)$/m;
  if (!ELS.test(html)) die('element registry anchor "const els = {" not found');
  html = html.replace(ELS, `$1\n${part('els-line.txt')}`);
  step(7, 'registered els.coffeeView');
}

/* 8. show/hide the view on render ------------------------------------------ */
if (/els\.coffeeView\.hidden/.test(html)) {
  step(8, 'render already toggles the coffee view');
} else {
  const HIDE = /^([^\n]*els\.exposureView\.hidden = state\.view !== "exposure";)$/m;
  if (!HIDE.test(html)) die('render anchor els.exposureView.hidden not found');
  html = html.replace(HIDE, `$1\n${part('render-line.txt')}`);
  step(8, 'render now toggles the coffee view');
}

/* 9. let setView accept "coffee" ------------------------------------------- */
/* Without this the whitelist silently bounces every unknown view to "setup", so the tab
   would highlight and then dump the visitor straight back on Team setup. */
if (/view === "coffee"/.test(html)) {
  step(9, 'setView already accepts "coffee"');
} else {
  const GUARD = 'state.view = view === "analytics" || view === "exposure" ? view : "setup";';
  if (!html.includes(GUARD)) {
    die('setView whitelist not found in its expected form — check whether app.html changed it');
  }
  html = html.replace(GUARD,
    'state.view = view === "analytics" || view === "exposure" || view === "coffee" ? view : "setup";');
  step(9, 'widened the setView whitelist to accept "coffee"');
}

/* final gate: refuse to write anything half-built --------------------------- */
const required = [
  [`<title>${BRAND}</title>`,              'rebranded title'],
  ['<strong>Battle Adviser</strong>',      'rebranded topbar'],
  ['cloudflareinsights',                   'analytics beacon'],
  ['id="coffee-styles"',                   'coffee styles'],
  ['data-view="coffee"',                   'coffee nav tab'],
  ['id="coffeeView"',                      'coffee view section'],
  ['coffeeView: document.getElementById',  'els registration'],
  ['els.coffeeView.hidden',                'render toggle'],
  ['view === "coffee"',                    'setView whitelist'],
];
const missing = required.filter(([needle]) => !html.includes(needle)).map(([, label]) => label);
if (missing.length) die(`output is missing: ${missing.join(', ')}`);
if (/cowork-artifact-meta/.test(html)) die('cowork-artifact-meta survived the strip');
if (/Team Type Index/.test(html))      die('"Team Type Index" survived the rebrand');
if (/^\s*<script src="\.\.\//m.test(html)) die('a real relative <script src> survived — the page would 404 live');

writeFileSync(OUT, html, 'utf8');   // LF endings; git applies CRLF on checkout

console.log(`\nBuilt ${OUT}`);
console.log(done.join('\n'));
console.log(`\n  source ${srcBytes.toLocaleString()} bytes  ->  deploy ${Buffer.byteLength(html, 'utf8').toLocaleString()} bytes (LF)`);
console.log('  Live Content-Length should match the LF byte count above once deployed.\n');
