#!/usr/bin/env node
// Survey EJS templates for inline scripts and event handlers — prep work for
// the H5 CSP hardening (removing 'unsafe-inline' from script-src and
// script-src-attr). Reports per-file counts so subsequent migration PRs can
// pick small, low-risk targets.
//
// Usage:
//   node scripts/audit-csp-inline.mjs            # human report
//   node scripts/audit-csp-inline.mjs --json     # machine-readable

import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

const SCRIPT_RE = /<script(?![^>]*\bsrc=)/gi;
const SCRIPT_WITH_NONCE_RE = /<script[^>]*\bnonce=/gi;
const HANDLER_RE = /\son(click|change|submit|input|load|focus|blur|keyup|keydown|mouseover|mouseout|mouseenter|mouseleave|dblclick|wheel|drag|drop)=/gi;
const JS_URL_RE = /\bhref=["']javascript:/gi;

async function walkEjs(root) {
  const out = [];
  async function visit(dir) {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await visit(full);
      } else if (entry.isFile() && entry.name.endsWith('.ejs')) {
        out.push(full);
      }
    }
  }
  await visit(root);
  return out;
}

function countMatches(content, re) {
  return (content.match(re) || []).length;
}

async function audit(root) {
  const files = await walkEjs(root);
  const findings = [];
  for (const file of files) {
    const content = await readFile(file, 'utf8');
    const inlineScripts = countMatches(content, SCRIPT_RE);
    const noncedScripts = countMatches(content, SCRIPT_WITH_NONCE_RE);
    const handlers = countMatches(content, HANDLER_RE);
    const jsUrls = countMatches(content, JS_URL_RE);
    if (inlineScripts || handlers || jsUrls) {
      findings.push({
        file,
        inlineScripts,
        inlineScriptsWithoutNonce: inlineScripts - noncedScripts,
        eventHandlers: handlers,
        javascriptUrls: jsUrls
      });
    }
  }
  return findings.sort((a, b) =>
    (b.inlineScriptsWithoutNonce + b.eventHandlers + b.javascriptUrls) -
    (a.inlineScriptsWithoutNonce + a.eventHandlers + a.javascriptUrls)
  );
}

function summarise(findings) {
  return findings.reduce(
    (acc, f) => ({
      files: acc.files + 1,
      inlineScripts: acc.inlineScripts + f.inlineScripts,
      inlineScriptsWithoutNonce: acc.inlineScriptsWithoutNonce + f.inlineScriptsWithoutNonce,
      eventHandlers: acc.eventHandlers + f.eventHandlers,
      javascriptUrls: acc.javascriptUrls + f.javascriptUrls
    }),
    { files: 0, inlineScripts: 0, inlineScriptsWithoutNonce: 0, eventHandlers: 0, javascriptUrls: 0 }
  );
}

function printHuman(findings) {
  const totals = summarise(findings);
  console.log(`\nH5 CSP audit — ${totals.files} files with inline JS\n`);
  console.log('INLINE_SCRIPTS  WITHOUT_NONCE  EVENT_HANDLERS  JS_URLS  FILE');
  console.log('-'.repeat(80));
  for (const f of findings) {
    console.log(
      String(f.inlineScripts).padStart(14),
      String(f.inlineScriptsWithoutNonce).padStart(13),
      String(f.eventHandlers).padStart(15),
      String(f.javascriptUrls).padStart(8),
      ` ${f.file}`
    );
  }
  console.log('-'.repeat(80));
  console.log(
    `TOTAL: ${totals.inlineScripts} scripts ` +
    `(${totals.inlineScriptsWithoutNonce} without nonce), ` +
    `${totals.eventHandlers} handlers, ` +
    `${totals.javascriptUrls} javascript: URLs across ${totals.files} files\n`
  );
}

async function main() {
  const wantJson = process.argv.includes('--json');
  const root = 'src/views';
  const findings = await audit(root);
  if (wantJson) {
    console.log(JSON.stringify({ summary: summarise(findings), files: findings }, null, 2));
  } else {
    printHuman(findings);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
