// Fails when the text of the site holds a measured number that is typed into the source.
//
// The rule (src/facts.ts): the site prints only numbers of the crosscoder and eval set that the
// data tree describes, and it reads them from the data. This check reads every string in src/
// and looks for the shapes that measured numbers have: a count with a thousands separator, a
// value with three or more decimals, a percentage with decimals, and a whole number of 100 or
// more. A fixed property of the method or a worked example goes on the list below, with a reason.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';

const ALLOWED = new Map([
  ['1,024', 'the width of the ProtT5 residual stream'],
  ['512', 'the length limit of the training and evaluation sequences'],
  ['300', 'the length of the protein in a worked example'],
  ['600', 'the growth of the ProtT5 residual stream, a property of the model (build_depth_profiles.py)'],
  ['1819', 'the latent number in the example of the search hint'],
  ['0.01%', 'the cut under which a share prints as "under 0.01%"'],
]);

const MEASURED = /\b\d{1,3}(?:,\d{3})+\b|\b\d+\.\d{3,}\b|\b\d+\.\d+%|\b\d{3,}\b/g;

/** Parts of a text that hold digits but no measurement: links, arXiv numbers, proceedings volumes, citation years. */
function strip(text) {
  return text
    .replace(/\S*:\/\/\S*/g, ' ')
    .replace(/arXiv \d{4}\.\d{4,5}/g, ' ')
    .replace(/PMLR \d+/g, ' ')
    .replace(/,\s(?:19|20)\d{2}\b/g, ' ');
}

/** The text of every string literal and template part in one file, with its line. */
function strings(file) {
  const src = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  const out = [];
  const visit = (node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return;
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node)
    ) {
      out.push({ text: node.text, line: src.getLineAndCharacterOfPosition(node.getStart()).line + 1 });
    }
    ts.forEachChild(node, visit);
  };
  visit(src);
  return out;
}

function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? files(p) : p.endsWith('.ts') ? [p] : [];
  });
}

const root = new URL('../src/', import.meta.url).pathname;
const found = [];
for (const file of files(root)) {
  for (const { text, line } of strings(file)) {
    // One word is a label, a CSS value or an attribute, and SVG path data is drawing.
    if (!/\s/.test(text.trim()) || /^[\sMmLlCcQqSsTtHhVvAaZz\d.,-]*$/.test(text)) continue;
    for (const m of strip(text).matchAll(MEASURED)) {
      if (!ALLOWED.has(m[0])) {
        found.push(`${relative(root, file)}:${line}: ${m[0]}  in  "${text.trim().slice(0, 70)}"`);
      }
    }
  }
}

if (found.length) {
  console.error('Measured numbers typed into the site text. Read them from the data (src/facts.ts):\n');
  console.error(found.join('\n'));
  process.exit(1);
}
console.log('check-numbers: no measured number is typed into the site text');
