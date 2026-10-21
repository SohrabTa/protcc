/**
 * The crosscoder, drawn step by step: the 24 residual streams of one residue go in, one sum of 24
 * encoders gives the pre-activations, a gate keeps a few latents, 24 decoders rebuild the 24
 * streams, and the loss compares the rebuilt streams with the real ones. The last step shows the
 * 24 decoder lengths of one real latent, which are its depth profile.
 *
 * The same drawing is the architecture figure of the paper (roadmap item WR-02). "Download SVG"
 * writes the full figure with the light colors written in, so the paper and the site cannot show
 * two different drawings.
 */

import type { Data } from './data';
import { facts } from './facts';
import { amount, el, num } from './ui';

const NS = 'http://www.w3.org/2000/svg';
const W = 1000;
const H = 440;
const ROW0 = 64;
const ROW_H = 14;
const BAR_H = 8;
const CELLS = 40;
/** The text size of the drawing. The figure is drawn at about 0.8 of its size, so 15 reads as 12. */
const FS = 15;
/** The latents that the drawing shows as active. Index 1 is the real latent of the last step. */
const LIT = [6, 15, 23, 33];
/** The left edge of each column. */
const X = {
  stream: 72, encoder: 200, sum1: 280, pre: 312, gate: 352, latents: 476, hub: 506,
  decoder: 556, rebuilt: 624, sum2: 752, loss: 786,
};
const VEC_W = 80;
const COL_W = 16;
const GATE_W = 100;
const LOSS_W = 210;

type Part = 'input' | 'encode' | 'gate' | 'fan' | 'rebuilt' | 'loss' | 'latent';
type Look = 'on' | 'dim' | 'off';

/** For each step, how each part of the drawing looks. Step 5 is the full figure. */
const PLAN: Record<Part, Look[]> = {
  input: ['on', 'on', 'on', 'on', 'on', 'dim'],
  encode: ['dim', 'on', 'on', 'on', 'on', 'dim'],
  gate: ['dim', 'dim', 'on', 'on', 'on', 'dim'],
  fan: ['dim', 'dim', 'dim', 'on', 'on', 'on'],
  rebuilt: ['dim', 'dim', 'dim', 'on', 'on', 'off'],
  loss: ['dim', 'dim', 'dim', 'dim', 'on', 'off'],
  latent: ['off', 'off', 'off', 'off', 'off', 'on'],
};
const FULL = 4;

function add(
  parent: Element,
  tag: string,
  attrs: Record<string, string | number>,
  text?: string,
): SVGElement {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  if (text !== undefined) n.textContent = text;
  parent.append(n);
  return n;
}

/** Append an italic symbol with a subscript, such as x with the layer index ℓ, to a text. */
function symbol(text: Element, base: string, sub: string): void {
  add(text, 'tspan', { 'font-style': 'italic' }, base);
  add(text, 'tspan', { 'font-style': 'italic', 'baseline-shift': 'sub', 'font-size': FS - 2 }, sub);
}

/** The symbol of a column, under it. */
function foot(parent: Element, x: number, base: string, sub: string): void {
  symbol(add(parent, 'text', { x, y: ROW0 + ROW_H * 24 + 28, 'font-size': FS + 3, 'text-anchor': 'middle' }), base, sub);
}

/** The vertical middle of row i. Row 0 is layer 24 at the top, as in the depth profiles. */
const rowY = (i: number) => ROW0 + i * ROW_H + BAR_H / 2;
const MID = rowY(11.5);
const cellY = (j: number) => ROW0 + (j * (ROW_H * 24 - 6)) / CELLS;

function title(parent: Element, x: number, line1: string, line2 = ''): void {
  add(parent, 'text', { x, y: 20, 'font-size': FS, 'text-anchor': 'middle', fill: 'var(--ink-2)', 'font-weight': 600 }, line1);
  if (line2) add(parent, 'text', { x, y: 40, 'font-size': FS - 1, 'text-anchor': 'middle', fill: 'var(--muted)' }, line2);
}

function column(parent: Element, x: number, fill: (j: number) => [string, number]): void {
  add(parent, 'rect', { x, y: ROW0 - 4, width: COL_W, height: ROW_H * 24 + 2, rx: 2, fill: 'none', stroke: 'var(--line-strong)' });
  for (let j = 0; j < CELLS; j++) {
    const [color, opacity] = fill(j);
    add(parent, 'rect', { x: x + 3, y: cellY(j), width: COL_W - 6, height: 5, fill: color, opacity });
  }
}

interface Drawing {
  svg: SVGSVGElement;
  parts: Record<Part, SVGGElement>;
}

function draw(d: Data, fid: number): Drawing {
  const t = d.manifest.training;
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'The architecture of the crosscoder');
  svg.setAttribute('font-family', "'IBM Plex Sans', Helvetica, Arial, sans-serif");
  svg.setAttribute('fill', 'var(--ink)');
  const group = (name: Part) => add(svg, 'g', { 'data-part': name }) as SVGGElement;
  const parts = {} as Record<Part, SVGGElement>;
  const rows = [...Array(t.layers).keys()];
  const quiet = (j: number) => 0.15 + ((j * 37) % 11) / 30;
  const line = (g: Element, x1: number, y1: number, x2: number, y2: number, stroke: string, opacity = 1) =>
    add(g, 'line', { x1, y1, x2, y2, stroke, opacity });
  const plus = (g: Element, cx: number) => {
    add(g, 'circle', { cx, cy: MID, r: 12, fill: 'var(--surface)', stroke: 'var(--ink-2)' });
    add(g, 'text', { x: cx, y: MID + 5, 'font-size': FS + 1, 'text-anchor': 'middle' }, '+');
  };

  // The input: one residual-stream vector per layer.
  const input = (parts.input = group('input'));
  title(input, X.stream + VEC_W / 2, 'residual stream', '1,024 per layer');
  for (const i of rows) {
    add(input, 'rect', { x: X.stream, y: rowY(i) - BAR_H / 2, width: VEC_W, height: BAR_H, rx: 1.5, fill: 'var(--depth)', opacity: 0.75 });
  }
  for (const [i, text] of [[0, `layer ${t.layers}`], [11, `layer ${t.layers / 2}`], [23, 'layer 1']] as const) {
    add(input, 'text', { x: 0, y: rowY(i) + 5, 'font-size': FS - 1, fill: 'var(--muted)' }, text);
  }
  foot(input, X.stream + VEC_W / 2, 'x', 'ℓ');

  // Encode: one matrix per layer, one sum, one list of pre-activations.
  const encode = (parts.encode = group('encode'));
  title(encode, X.encoder + COL_W / 2, 'encoders');
  for (const i of rows) {
    line(encode, X.stream + VEC_W, rowY(i), X.encoder, rowY(i), 'var(--line-strong)');
    add(encode, 'rect', { x: X.encoder, y: rowY(i) - 5, width: COL_W, height: 10, rx: 1, fill: 'var(--line-strong)' });
    line(encode, X.encoder + COL_W, rowY(i), X.sum1 - 12, MID, 'var(--depth)', 0.45);
  }
  plus(encode, X.sum1);
  line(encode, X.sum1 + 12, MID, X.pre, MID, 'var(--ink-2)');
  title(encode, X.pre + COL_W / 2, 'pre-activations', num(t.latents));
  column(encode, X.pre, (j) => (LIT.includes(j) ? ['var(--ink-2)', 0.95] : ['var(--line-strong)', quiet(j)]));
  foot(encode, X.encoder + COL_W / 2, 'W', 'enc,ℓ');

  // The gate keeps a few latents.
  const gate = (parts.gate = group('gate'));
  const gx = X.gate + GATE_W / 2;
  line(gate, X.pre + COL_W, MID, X.gate, MID, 'var(--ink-2)');
  add(gate, 'rect', { x: X.gate, y: MID - 40, width: GATE_W, height: 80, rx: 4, fill: 'var(--surface)', stroke: 'var(--ink-2)' });
  add(gate, 'text', { x: gx, y: MID - 14, 'font-size': FS, 'text-anchor': 'middle', 'font-weight': 600 }, 'gate');
  add(gate, 'text', { x: gx, y: MID + 8, 'font-size': FS - 1, 'text-anchor': 'middle', fill: 'var(--muted)' }, 'BatchTopK');
  add(gate, 'text', { x: gx, y: MID + 27, 'font-size': FS - 1, 'text-anchor': 'middle', fill: 'var(--muted)' }, 'or JumpReLU');
  line(gate, X.gate + GATE_W, MID, X.latents, MID, 'var(--ink-2)');
  title(gate, X.latents + COL_W / 2, 'latents', `${t.k} on average`);
  column(gate, X.latents, (j) => (LIT.includes(j) ? ['var(--signal)', 1] : ['var(--line-strong)', 0.12]));

  // Decode: one matrix per layer.
  const fan = (parts.fan = group('fan'));
  line(fan, X.latents + COL_W, MID, X.hub, MID, 'var(--signal)');
  add(fan, 'circle', { cx: X.hub, cy: MID, r: 3, fill: 'var(--signal)' });
  title(fan, X.decoder + COL_W / 2, 'decoders');
  for (const i of rows) {
    line(fan, X.hub, MID, X.decoder, rowY(i), 'var(--signal)', 0.4);
    add(fan, 'rect', { x: X.decoder, y: rowY(i) - 5, width: COL_W, height: 10, rx: 1, fill: 'var(--line-strong)' });
  }
  foot(fan, X.decoder + COL_W / 2, 'W', 'dec,ℓ');

  // The rebuilt streams.
  const rebuilt = (parts.rebuilt = group('rebuilt'));
  title(rebuilt, X.rebuilt + VEC_W / 2, 'rebuilt stream');
  for (const i of rows) {
    line(rebuilt, X.decoder + COL_W, rowY(i), X.rebuilt, rowY(i), 'var(--line-strong)');
    add(rebuilt, 'rect', { x: X.rebuilt, y: rowY(i) - BAR_H / 2, width: VEC_W, height: BAR_H, rx: 1.5, fill: 'var(--signal)', opacity: 0.8 });
  }
  foot(rebuilt, X.rebuilt + VEC_W / 2, 'x̂', 'ℓ');

  // The loss compares every rebuilt stream with its real one.
  const loss = (parts.loss = group('loss'));
  for (const i of rows) line(loss, X.rebuilt + VEC_W, rowY(i), X.sum2 - 12, MID, 'var(--ink-2)', 0.3);
  plus(loss, X.sum2);
  line(loss, X.sum2 + 12, MID, X.loss, MID, 'var(--ink-2)');
  title(loss, X.loss + LOSS_W / 2, 'training loss');
  add(loss, 'rect', { x: X.loss, y: MID - 56, width: LOSS_W, height: 112, rx: 4, fill: 'var(--surface)', stroke: 'var(--ink-2)' });
  const tx = X.loss + 14;
  const l1 = add(loss, 'text', { x: tx, y: MID - 26, 'font-size': FS }, 'error of ');
  symbol(l1, 'x̂', 'ℓ');
  add(l1, 'tspan', {}, ' against ');
  symbol(l1, 'x', 'ℓ');
  add(loss, 'text', { x: tx, y: MID - 4, 'font-size': FS }, `summed over ${t.layers} layers`);
  add(loss, 'text', { x: tx, y: MID + 26, 'font-size': FS }, `+ ${t.lambda_aux} × AuxK`);
  add(loss, 'text', { x: tx, y: MID + 45, 'font-size': FS - 1, fill: 'var(--muted)' }, 'brings dead latents back');

  // The last step: the decoder lengths of one real latent.
  const latent = (parts.latent = group('latent'));
  const norm = d.depthOf(fid).norm;
  const peak = norm.indexOf(Math.max(...norm)) + 1;
  add(latent, 'rect', {
    x: X.latents - 3, y: cellY(LIT[1]) - 4, width: COL_W + 6, height: 13, rx: 2,
    fill: 'none', stroke: 'var(--signal-bright)', 'stroke-width': 2,
  });
  title(latent, X.rebuilt + VEC_W / 2, 'decoder length', 'of this latent');
  for (const i of rows) {
    const v = norm[t.layers - 1 - i];
    add(latent, 'rect', { x: X.decoder, y: rowY(i) - 5, width: COL_W, height: 10, rx: 1, fill: 'var(--signal)', opacity: 0.1 + 0.9 * v });
    add(latent, 'rect', { x: X.rebuilt, y: rowY(i) - BAR_H / 2, width: Math.max(1, VEC_W * v), height: BAR_H, rx: 1.5, fill: 'var(--depth)' });
  }
  add(latent, 'text', { x: X.sum2, y: MID - 8, 'font-size': FS + 2, 'font-weight': 600, fill: 'var(--signal)' }, `latent f/${fid}`);
  add(latent, 'text', { x: X.sum2, y: MID + 16, 'font-size': FS }, `writes most into layer ${peak}`);
  return { svg, parts };
}

/** Show step s (0-based): each part on, dimmed or hidden, as PLAN says. */
function show(parts: Record<Part, SVGGElement>, s: number): void {
  for (const [name, looks] of Object.entries(PLAN) as [Part, Look[]][]) {
    const look = looks[s];
    parts[name].style.display = look === 'off' ? 'none' : '';
    parts[name].style.opacity = look === 'dim' ? '0.2' : '1';
    parts[name].style.transition = 'opacity 200ms';
  }
}

/** The full figure as an SVG file, with the colors of the light theme written in. */
function download(d: Data, fid: number): void {
  const { svg, parts } = draw(d, fid);
  show(parts, FULL);
  parts.latent.remove();
  const root = document.documentElement;
  const theme = root.getAttribute('data-theme');
  root.setAttribute('data-theme', 'light');
  const style = getComputedStyle(root);
  for (const node of [svg, ...svg.querySelectorAll('*')]) {
    for (const attr of [...node.attributes]) {
      if (attr.value.includes('var(--')) {
        attr.value = attr.value.replace(/var\((--[\w-]+)\)/g, (_, name: string) => style.getPropertyValue(name).trim());
      }
    }
    (node as SVGElement).style?.removeProperty('transition');
  }
  if (theme === null) root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', theme);
  svg.setAttribute('xmlns', NS);
  const blob = new Blob([new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml' });
  const a = el('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'crosscoder-architecture.svg';
  a.click();
  URL.revokeObjectURL(a.href);
}

export function archFigure(d: Data): HTMLElement {
  const t = d.manifest.training;
  const f = facts(d);
  const fid = f.example?.best.id ?? d.features[0].f;
  const concept = f.example?.concept.c.split('_').slice(1).join(' ');
  const { svg, parts } = draw(d, fid);
  const norm = d.depthOf(fid).norm;
  const peak = norm.indexOf(Math.max(...norm)) + 1;

  const steps: [string, (Node | string)[]][] = [
    ['The input', [
      `ProtT5 reads a protein. For each residue, each of its ${t.layers} layers passes on a ` +
        'vector of 1,024 numbers: the residual stream xℓ of layer ℓ. The crosscoder ' +
        `takes all ${t.layers} vectors of one residue at once.`,
    ]],
    ['Encode', [
      'Each layer has its own encoder matrix. The crosscoder multiplies each xℓ by the ' +
        `matrix of its layer and adds the ${t.layers} results. The sum is one list of ` +
        `${num(t.latents)} pre-activations, one for each latent.`,
    ]],
    ['Keep a few', [
      'A gate keeps only the largest pre-activations and sets the others to 0. In training, ' +
        `BatchTopK keeps the ${t.k} × ${t.batch_size} largest values of a batch of ` +
        `${t.batch_size} residues, so a residue uses ${t.k} latents on average. For the ` +
        'evaluation, a JumpReLU gate with one threshold replaces BatchTopK. Then the latents of ' +
        'a residue do not depend on the other residues in its batch.',
    ]],
    ['Decode into every layer', [
      'Each layer also has its own decoder matrix. The active latents write through all ' +
        `${t.layers} decoder matrices, and the result is one rebuilt vector x̂ℓ for ` +
        'each layer.',
    ]],
    ['The training goal', [
      `The loss adds the error of x̂ℓ against xℓ over all ${t.layers} layers, ` +
        'with each layer normalized to the same scale. The auxiliary term AuxK lets the ' +
        `${t.k_aux} strongest dead latents rebuild what the live latents miss, so that dead ` +
        `latents come back into use. The training read ${amount(t.residues)} ${t.corpus} ` +
        'residues once.',
    ]],
    ['Where one latent writes', [
      `A latent has one decoder column in each of the ${t.layers} decoder matrices. The ` +
        `lengths of these ${t.layers} columns are the depth profile of the latent. `,
      Object.assign(el('a', undefined, `Latent f/${fid}`), { href: `#/feature/${fid}` }),
      concept ? `, the Best latent of ${concept},` : '',
      ` writes most into layer ${peak}.`,
    ]],
  ];

  const box = el('figure', 'arch');
  const nav = el('div', 'arch-steps');
  nav.setAttribute('role', 'tablist');
  nav.setAttribute('aria-label', 'Steps of the architecture');
  const head = el('h3', 'arch-title');
  const text = el('p', 'arch-text');
  const buttons = steps.map(([name], i) => {
    const b = el('button', 'arch-step');
    b.type = 'button';
    b.setAttribute('role', 'tab');
    b.append(el('span', 'arch-n', String(i + 1)), name);
    b.addEventListener('click', () => go(i));
    return b;
  });
  let at = 0;
  const go = (i: number) => {
    at = (i + steps.length) % steps.length;
    show(parts, at);
    buttons.forEach((b, j) => b.setAttribute('aria-selected', String(j === at)));
    head.textContent = `${at + 1}. ${steps[at][0]}`;
    text.replaceChildren(...steps[at][1]);
  };
  nav.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    go(at + (e.key === 'ArrowRight' ? 1 : -1));
    buttons[at].focus();
  });
  nav.append(...buttons);

  const pic = el('div', 'arch-pic');
  pic.append(svg);
  const prev = el('button', 'arch-nav', '‹ Back');
  prev.type = 'button';
  prev.addEventListener('click', () => go(at - 1));
  const next = el('button', 'arch-nav', 'Next ›');
  next.type = 'button';
  next.addEventListener('click', () => go(at + 1));
  const save = el('button', 'arch-nav arch-save', 'Download SVG');
  save.type = 'button';
  save.title = 'The full figure, in the light colors, for the paper';
  save.addEventListener('click', () => download(d, fid));
  const bar = el('div', 'arch-bar');
  bar.append(prev, next, save);

  const cap = el('figcaption', 'arch-cap');
  cap.append(head, text, bar);
  box.append(nav, pic, cap);
  go(0);
  return box;
}
