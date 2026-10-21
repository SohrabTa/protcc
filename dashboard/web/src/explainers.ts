/**
 * The pictures of the method page and the glossary: one small drawing for each idea, with a
 * caption in HTML.
 *
 * A picture is drawn at its own size, so its labels keep the size of text and are never scaled
 * down with the page. Worked examples use small, round, made-up numbers and say so. A picture that
 * shows a measured number reads it from the data tree, as the text does (`facts.ts`).
 */

import type { Training } from './data';
import type { Facts } from './facts';
import { amount, el, num } from './ui';

const NS = 'http://www.w3.org/2000/svg';
const MONO = "'IBM Plex Mono', ui-monospace, monospace";

function svg(w: number, h: number, label: string): SVGSVGElement {
  const s = document.createElementNS(NS, 'svg');
  s.setAttribute('viewBox', `0 0 ${w} ${h}`);
  s.setAttribute('width', '100%');
  s.setAttribute('role', 'img');
  s.setAttribute('aria-label', label);
  s.style.display = 'block';
  s.style.maxWidth = `${w}px`;
  return s;
}

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

function label(
  parent: Element,
  x: number,
  y: number,
  text: string,
  attrs: Record<string, string | number> = {},
): SVGElement {
  return add(parent, 'text', { x, y, 'font-size': 13, fill: 'var(--muted)', ...attrs }, text);
}

function arrow(parent: Element, x1: number, y1: number, x2: number, y2: number, color = 'var(--muted)'): void {
  add(parent, 'line', { x1, y1, x2, y2, stroke: color, 'stroke-width': 1.25 });
  const a = Math.atan2(y2 - y1, x2 - x1);
  const p = (d: number, s: number) => `${x2 - 7 * Math.cos(a + s * d)},${y2 - 7 * Math.sin(a + s * d)}`;
  add(parent, 'polygon', { points: `${x2},${y2} ${p(0.45, 1)} ${p(0.45, -1)}`, fill: color });
}

/** The picture, and its caption under it. */
function pic(drawing: SVGSVGElement, caption: (Node | string)[] | string): HTMLElement {
  const box = el('figure', 'gl-pic');
  const cap = el('figcaption', 'gl-cap');
  cap.append(...(typeof caption === 'string' ? [caption] : caption));
  box.append(drawing, cap);
  return box;
}

/** A fixed pseudo-random number in [0, 1), so a drawing looks the same on every load. */
const rnd = (i: number) => {
  const x = Math.sin(i * 12.9898 + 4.1414) * 43758.5453;
  return x - Math.floor(x);
};

/** A row of residues, each one cell, coloured where `on` gives a colour. */
function track(
  parent: Element,
  x0: number,
  y: number,
  n: number,
  cw: number,
  on: (i: number) => string | null,
  h = 14,
): void {
  for (let i = 0; i < n; i++) {
    add(parent, 'rect', { x: x0 + i * cw, y, width: cw - 1.5, height: h, rx: 1, fill: on(i) ?? 'var(--line)' });
  }
}

const inside = (i: number, a: number, b: number) => i >= a && i <= b;

/** Signed bars around a base line, for a vector whose entries are drawn as heights. */
function bars(parent: Element, x0: number, base: number, values: number[], bw: number, scale: number, color: string): void {
  values.forEach((v, i) => {
    const h = Math.max(1, Math.abs(v) * scale);
    add(parent, 'rect', { x: x0 + i * bw, y: v >= 0 ? base - h : base, width: bw - 1.5, height: h, fill: color });
  });
  add(parent, 'line', { x1: x0, y1: base, x2: x0 + values.length * bw - 1.5, y2: base, stroke: 'var(--line-strong)' });
}

// ---- method page -------------------------------------------------------

/** What ProtT5 gives for one residue: many numbers, all of them in use, none with a label. */
export function densePicture(): HTMLElement {
  const s = svg(660, 96, 'One residue becomes a vector of numbers that all carry some value.');
  const seq = 'MKTAYIAKQRQI';
  [...seq].forEach((c, i) => {
    if (i === 7) add(s, 'rect', { x: i * 16 - 2, y: 30, width: 15, height: 20, rx: 2, fill: 'none', stroke: 'var(--ink)' });
    label(s, i * 16 + 1, 45, c, { 'font-family': MONO, 'font-size': 14, fill: 'var(--ink-2)' });
  });
  label(s, 0, 72, 'one residue', { 'font-size': 12 });
  arrow(s, 202, 40, 252, 40);
  label(s, 227, 30, 'ProtT5', { 'text-anchor': 'middle', 'font-size': 12 });
  const values = [...Array(64).keys()].map((i) => (rnd(i) - 0.5) * 2 * (0.25 + 0.75 * rnd(i + 99)));
  bars(s, 264, 40, values, 6, 26, 'var(--ink-2)');
  label(s, 264, 88, '1,024 numbers for this residue (64 drawn)', { 'font-size': 12 });
  return pic(s, 'Every number of the vector carries some value, and none has a name. Nothing in it says which part is a domain or a binding site.');
}

/** A dense vector rebuilt as the weighted sum of a few dictionary directions. */
export function superpositionPicture(latentsTotal: number): HTMLElement {
  const n = 24;
  const bw = 5;
  const gw = n * bw;
  const dir = (seed: number) => [...Array(n).keys()].map((i) => (rnd(seed * 31 + i) - 0.5) * 2);
  const weights: [number, number][] = [[0.8, 1], [0.5, 2], [0.3, 3]];
  const parts = weights.map(([w, seed]) => ({ w, v: dir(seed) }));
  const dense = [...Array(n).keys()].map((i) => parts.reduce((sum, p) => sum + p.w * p.v[i], 0));
  const scale = 26 / Math.max(...dense.map(Math.abs), ...parts.flatMap((p) => p.v.map(Math.abs)));
  const s = svg(680, 160, 'A residue vector is the weighted sum of three latents from a large dictionary.');
  const base = 44;
  bars(s, 0, base, dense, bw, scale, 'var(--ink-2)');
  label(s, 0, 92, 'the residue vector', { 'font-size': 12 });
  label(s, gw + 12, base + 5, '=', { 'font-size': 16, fill: 'var(--ink)' });
  let x = gw + 34;
  parts.forEach((p, k) => {
    if (k) label(s, x - 18, base + 5, '+', { 'font-size': 16, fill: 'var(--ink)' });
    label(s, x, base + 5, `${p.w} ×`, { fill: 'var(--signal)', 'font-weight': 600 });
    bars(s, x + 40, base, p.v, bw, scale, 'var(--line-strong)');
    label(s, x + 40, 92, `latent ${k + 1}`, { 'font-size': 12 });
    x += 40 + gw + 34;
  });
  const cells = 96;
  const lit = [11, 47, 80];
  for (let j = 0; j < cells; j++) {
    add(s, 'rect', { x: j * 7, y: 116, width: 5.5, height: 14, rx: 1, fill: lit.includes(j) ? 'var(--signal)' : 'var(--line)' });
  }
  label(s, 0, 150, `the dictionary: ${num(latentsTotal)} latents (96 drawn), 3 of them used for this residue`, { 'font-size': 12 });
  return pic(s, [
    'Dictionary learning in one picture. The crosscoder writes the vector as a sum of a few dictionary entries. The weight of an entry is the activation of that latent at this residue (amber). Every other latent has activation 0.',
  ]);
}

/** BatchTopK, drawn small: a batch keeps its k × batch largest values, not k per residue. */
export function batchTopKPicture(t: Training): HTMLElement {
  const rows = 6;
  const cols = 16;
  const k = 2;
  const cw = 24;
  const ch = 20;
  const x0 = 82;
  const values = [...Array(rows * cols).keys()].map((i) => rnd(i * 7 + 3) ** 3);
  const keep = new Set([...values.keys()].sort((a, b) => values[b] - values[a]).slice(0, k * rows));
  const s = svg(x0 + cols * cw + 110, rows * ch + 40, 'A batch of six residues keeps its twelve largest values.');
  for (let r = 0; r < rows; r++) {
    label(s, 0, 16 + r * ch + 13, `residue ${r + 1}`, { 'font-size': 12 });
    let kept = 0;
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      const on = keep.has(i);
      if (on) kept++;
      add(s, 'rect', {
        x: x0 + c * cw, y: 16 + r * ch, width: cw - 3, height: ch - 3, rx: 2,
        fill: on ? 'var(--signal)' : 'var(--line)', opacity: on ? 0.5 + 0.5 * values[i] : 1,
      });
    }
    label(s, x0 + cols * cw + 10, 16 + r * ch + 13, `${kept} kept`, { 'font-size': 12, fill: kept ? 'var(--ink-2)' : 'var(--muted)' });
  }
  label(s, x0, 11, 'latents', { 'font-size': 12 });
  label(s, x0, rows * ch + 34, `${k * rows} kept in the batch, ${k} per residue on average`, { 'font-size': 12, fill: 'var(--ink-2)' });
  return pic(s, [
    `BatchTopK, drawn with k = ${k} and a batch of ${rows} residues. The crosscoder uses k = ${t.k} and batches of ${t.batch_size} residues. The batch keeps its ${k * rows} largest values, so one residue can use more latents and another fewer. The average is exactly k. For the evaluation, one fixed threshold (JumpReLU) replaces this choice, so that the latents of a residue do not depend on its batch.`,
  ]);
}

/** The two data sets: the training corpus, and the evaluation set with its two halves. */
export function dataSetsPicture(t: Training, proteins: number): HTMLElement {
  const s = svg(660, 132, 'UniRef50 trains the crosscoder. Swiss-Prot, split into two halves, evaluates it.');
  label(s, 0, 16, `${t.corpus}, for the training`, { fill: 'var(--ink-2)', 'font-weight': 600 });
  add(s, 'rect', { x: 0, y: 24, width: 660, height: 22, rx: 3, fill: 'var(--line-strong)', opacity: 0.5 });
  label(s, 10, 40, `${amount(t.sequences)} sequences, ${amount(t.residues)} residues, no annotations`, { fill: 'var(--ink)' });
  label(s, 0, 80, 'Swiss-Prot, for the evaluation', { fill: 'var(--ink-2)', 'font-weight': 600 });
  add(s, 'rect', { x: 0, y: 88, width: 327, height: 22, rx: 3, fill: 'var(--accent)', opacity: 0.35 });
  add(s, 'rect', { x: 333, y: 88, width: 327, height: 22, rx: 3, fill: 'var(--accent)', opacity: 0.6 });
  label(s, 10, 104, 'validation half: chooses each pairing', { fill: 'var(--ink)' });
  label(s, 343, 104, 'held-out half: scores it', { fill: 'var(--ink)' });
  label(s, 0, 128, `${num(proteins)} proteins with annotations, divided into two halves`, { 'font-size': 12 });
  return pic(s, 'The two data sets. The bars are not to scale. The training never sees an annotation. Some Swiss-Prot sequences are also in UniRef50, so the evaluation tests what the latents encode, not how they do on unseen proteins.');
}

/** The pairing rule as two cases: one latent clears 0.5 on the two halves, one does not. */
export function pairingRulePicture(): HTMLElement {
  const s = svg(680, 118, 'Two latents scored on the two halves. Only the first clears 0.5 on both.');
  const bw = 170;
  const cols = [110, 330];
  label(s, cols[0], 14, 'validation half', { 'font-size': 12 });
  label(s, cols[1], 14, 'held-out half', { 'font-size': 12 });
  label(s, 570, 14, 'result', { 'font-size': 12 });
  const cases: [string, number, number][] = [['latent A', 0.71, 0.66], ['latent B', 0.62, 0.41]];
  cases.forEach(([name, a, b], r) => {
    const y = 30 + r * 40;
    label(s, 0, y + 14, name, { fill: 'var(--ink-2)', 'font-family': MONO });
    [a, b].forEach((v, c) => {
      const x = cols[c];
      add(s, 'rect', { x, y, width: bw, height: 18, rx: 2, fill: 'var(--line)' });
      add(s, 'rect', { x, y, width: bw * v, height: 18, rx: 2, fill: v > 0.5 ? 'var(--signal)' : 'var(--line-strong)' });
      add(s, 'line', { x1: x + bw / 2, y1: y - 4, x2: x + bw / 2, y2: y + 22, stroke: 'var(--ink)', 'stroke-dasharray': '3 2' });
      label(s, x + bw + 8, y + 14, v.toFixed(2), { fill: v > 0.5 ? 'var(--ink)' : 'var(--muted)', 'font-size': 12 });
    });
    const ok = a > 0.5 && b > 0.5;
    label(s, 570, y + 14, ok ? 'pairs' : 'does not pair', { fill: ok ? 'var(--accent)' : 'var(--muted)', 'font-weight': 600 });
  });
  label(s, cols[0] + bw / 2, 112, '0.5', { 'font-size': 12, 'text-anchor': 'middle' });
  label(s, cols[1] + bw / 2, 112, '0.5', { 'font-size': 12, 'text-anchor': 'middle' });
  return pic(s, 'The F1 per domain of two latents with one concept, made-up values. A latent pairs only when it clears 0.5 on the validation half and again on the held-out half.');
}

/** Why F1 per domain is generous: one firing residue recalls the whole region. */
export function generousPicture(): HTMLElement {
  const n = 40;
  const cw = 12;
  const x0 = 90;
  const s = svg(x0 + n * cw + 10, 104, 'A latent that fires on one residue of a domain recalls the whole domain.');
  label(s, x0 - 10, 18, 'Swiss-Prot', { 'text-anchor': 'end' });
  track(s, x0, 6, n, cw, (i) => (inside(i, 8, 31) ? 'var(--accent)' : null));
  label(s, x0 - 10, 38, 'the latent', { 'text-anchor': 'end' });
  track(s, x0, 26, n, cw, (i) => (i === 19 ? 'var(--signal)' : null));
  label(s, x0, 70, 'recall per domain: 1 of 1 region = 1.00', { fill: 'var(--ink)' });
  label(s, x0, 92, 'recall per residue: 1 of 24 residues = 0.04', { fill: 'var(--ink)' });
  return pic(s, 'One protein, made up. The latent fires on one residue inside a domain of 24. Per domain, it recalls the domain. Per residue, it reads almost none of it.');
}

/** The latents of this crosscoder: dead, live with no pair, and paired. Measured. */
export function latentsPicture(f: Facts): HTMLElement {
  const W = 640;
  const s = svg(W, 74, 'How many latents are dead, live with no pair, and paired.');
  const parts: [number, string, string][] = [
    [f.latentsPaired, 'var(--signal)', `${num(f.latentsPaired)} paired with a concept`],
    [f.latentsUnpaired, 'var(--line-strong)', `${num(f.latentsUnpaired)} live, not paired`],
    [f.latentsDead, 'var(--line)', `${num(f.latentsDead)} dead`],
  ];
  let x = 0;
  for (const [n, color] of parts) {
    const w = (n / f.latentsTotal) * W;
    add(s, 'rect', { x, y: 4, width: Math.max(1, w - 1), height: 22, fill: color });
    x += w;
  }
  let lx = 0;
  for (const [, color, text] of parts) {
    add(s, 'rect', { x: lx, y: 44, width: 14, height: 14, rx: 2, fill: color });
    label(s, lx + 20, 56, text, { fill: 'var(--ink-2)' });
    lx += 20 + text.length * 7.2 + 24;
  }
  return pic(s, `All ${num(f.latentsTotal)} latents of this crosscoder, measured on the evaluation set.`);
}

// ---- glossary ----------------------------------------------------------

/** Many layers in, one dictionary, many layers rebuilt. */
export function crosscoderPicture(layers: number): HTMLElement {
  const s = svg(560, 150, 'The residual stream of every layer goes into one dictionary and comes back rebuilt.');
  const ys = [16, 30, 44, 58, 72, 86, 100, 114];
  for (const y of ys) {
    add(s, 'rect', { x: 0, y, width: 90, height: 8, rx: 1.5, fill: 'var(--depth)', opacity: 0.75 });
    add(s, 'path', { d: `M92 ${y + 4} C 140 ${y + 4}, 140 68, 190 68`, stroke: 'var(--depth)', fill: 'none', opacity: 0.5 });
    add(s, 'path', { d: `M290 68 C 340 68, 340 ${y + 4}, 388 ${y + 4}`, stroke: 'var(--signal)', fill: 'none', opacity: 0.5 });
    add(s, 'rect', { x: 390, y, width: 90, height: 8, rx: 1.5, fill: 'var(--signal)', opacity: 0.8 });
  }
  add(s, 'rect', { x: 190, y: 12, width: 100, height: 112, rx: 3, fill: 'var(--surface)', stroke: 'var(--line-strong)' });
  for (let j = 0; j < 12; j++) {
    add(s, 'rect', { x: 200, y: 20 + j * 8.5, width: 80, height: 5, rx: 1, fill: [3, 8].includes(j) ? 'var(--signal)' : 'var(--line)' });
  }
  label(s, 0, 140, `${layers} layers in`, { 'font-size': 12 });
  label(s, 240, 140, 'a few latents fire', { 'font-size': 12, 'text-anchor': 'middle' });
  label(s, 390, 140, `${layers} layers rebuilt`, { 'font-size': 12 });
  return pic(s, 'One dictionary reads the residual stream of every layer and rebuilds every layer from the same few latents.');
}

/** The raw activations of two latents, and the same values divided by each latent's maximum. */
export function activationScalePicture(): HTMLElement {
  const s = svg(620, 142, 'Two latents with different raw sizes both run from 0 to 1 after the division.');
  const a = [0, 0.5, 2.0, 6.0, 4.5, 1.0, 0, 0, 0.5, 0];
  const b = [0, 0, 0.3, 0.6, 1.5, 1.2, 0.2, 0, 0, 0];
  const base = 100;
  const draw = (x0: number, vals: number[], scale: number, color: string) => {
    vals.forEach((v, i) => {
      const h = Math.max(1, v * scale);
      add(s, 'rect', { x: x0 + i * 11, y: base - h, width: 9, height: h, rx: 1, fill: color });
    });
  };
  draw(0, a, 13, 'var(--signal)');
  draw(124, b, 13, 'var(--depth)');
  label(s, 0, 122, 'latent A, raw', { 'font-size': 12 });
  label(s, 124, 122, 'latent B, raw', { 'font-size': 12 });
  arrow(s, 262, 64, 330, 64);
  label(s, 296, 52, 'divided by', { 'font-size': 12, 'text-anchor': 'middle' });
  label(s, 296, 84, 'its own maximum', { 'font-size': 12, 'text-anchor': 'middle' });
  draw(350, a.map((v) => v / 6), 78, 'var(--signal)');
  draw(474, b.map((v) => v / 1.5), 78, 'var(--depth)');
  label(s, 350, 122, 'latent A, 0 to 1', { 'font-size': 12 });
  label(s, 474, 122, 'latent B, 0 to 1', { 'font-size': 12 });
  add(s, 'line', { x1: 345, y1: base - 78, x2: 590, y2: base - 78, stroke: 'var(--line-strong)', 'stroke-dasharray': '3 3' });
  label(s, 596, base - 74, '1', { 'font-size': 12 });
  return pic(s, 'Made-up values. On the raw scale, latent A looks four times stronger than latent B. After the division, each latent reaches 1 at its own strongest residue, so the two scales do not compare.');
}

/** The residual stream of one residue, passed from layer to layer, read after each layer. */
export function residualStreamPicture(layers: number): HTMLElement {
  const s = svg(690, 128, 'Each layer adds to the vector of a residue, and the crosscoder reads it after each layer.');
  const names = ['1', '2', '3', '…', String(layers - 1), String(layers)];
  const y = 60;
  arrow(s, 0, y, 684, y, 'var(--depth)');
  label(s, 0, y + 20, 'the vector of', { 'font-size': 12 });
  label(s, 0, y + 36, 'one residue', { 'font-size': 12 });
  names.forEach((name, i) => {
    const x = 190 + i * 88;
    if (name === '…') {
      label(s, x, y - 20, '…', { 'text-anchor': 'middle', fill: 'var(--ink-2)' });
      return;
    }
    add(s, 'rect', { x: x - 26, y: 8, width: 52, height: 22, rx: 3, fill: 'var(--surface)', stroke: 'var(--line-strong)' });
    label(s, x, 23, `layer ${name}`, { 'text-anchor': 'middle', 'font-size': 12, fill: 'var(--ink-2)' });
    arrow(s, x, 30, x, y - 3);
    add(s, 'circle', { cx: x + 22, cy: y, r: 3, fill: 'var(--depth)' });
    arrow(s, x + 22, y + 4, x + 22, y + 34, 'var(--depth)');
  });
  label(s, 190 - 26, 120, 'each layer adds to the vector, and the crosscoder reads it after each layer (slate)', { 'font-size': 12 });
  return pic(s, 'The residual stream. The crosscoder only reads it. ProtT5 does not change.');
}

/** One latent, and its decoder vector for each layer: the length is how much it adds there. */
export function decoderVectorPicture(): HTMLElement {
  const profile = [0.1, 0.2, 0.35, 0.6, 0.9, 1.0, 0.75, 0.4];
  const names = ['1', '4', '7', '10', '14', '17', '20', '24'];
  const s = svg(480, 170, 'A latent has one decoder vector for each layer, and the vectors differ in length.');
  add(s, 'circle', { cx: 30, cy: 82, r: 9, fill: 'var(--signal)' });
  label(s, 30, 112, 'one latent', { 'font-size': 12, 'text-anchor': 'middle' });
  profile.forEach((v, i) => {
    const y = 12 + (profile.length - 1 - i) * 19;
    add(s, 'path', { d: `M40 82 C 80 82, 80 ${y + 5}, 120 ${y + 5}`, stroke: 'var(--line-strong)', fill: 'none' });
    label(s, 168, y + 10, `layer ${names[i]}`, { 'font-size': 12, 'text-anchor': 'end' });
    arrow(s, 176, y + 5, 176 + 260 * v, y + 5, 'var(--signal)');
  });
  return pic(s, 'A stylized latent, with eight of the 24 layers drawn. Each arrow is its decoder vector for one layer. The direction says what the latent adds to that layer, and the length says how much. The row of lengths is the depth profile.');
}

/** Two latents: one fires on one stretch of the chain, one on residues the fold brings together. */
export function spreadPicture(): HTMLElement {
  const s = svg(660, 170, 'Close along the chain, and far along the chain but close in the fold.');
  const dot = (x: number, y: number, on: boolean) =>
    add(s, 'circle', { cx: x, cy: y, r: 5, fill: on ? 'var(--signal)' : 'var(--line-strong)' });
  // Left: a straight chain, firing on one stretch.
  for (let i = 0; i < 24; i++) {
    const x = 10 + i * 12.5;
    if (i) add(s, 'line', { x1: x - 12.5, y1: 60, x2: x, y2: 60, stroke: 'var(--line-strong)' });
    dot(x, 60, inside(i, 9, 13));
  }
  label(s, 10, 22, 'one stretch of the chain', { fill: 'var(--ink-2)', 'font-weight': 600 });
  label(s, 10, 100, 'spread along the chain: low', { 'font-size': 12 });
  // Right: a hairpin, firing at the two arms where they meet.
  const pts: [number, number][] = [];
  for (let i = 0; i < 12; i++) pts.push([360 + i * 22, 50]);
  for (let i = 0; i < 12; i++) pts.push([360 + (11 - i) * 22, 82]);
  pts.forEach(([x, y], i) => {
    if (i) {
      const [px, py] = pts[i - 1];
      add(s, 'line', { x1: px, y1: py, x2: x, y2: y, stroke: 'var(--line-strong)' });
    }
  });
  add(s, 'path', { d: 'M602 50 C 630 50, 630 82, 602 82', stroke: 'var(--line-strong)', fill: 'none' });
  pts.forEach(([x, y], i) => dot(x, y, inside(i, 3, 5) || inside(i, 18, 20)));
  label(s, 360, 22, 'one site in the fold', { fill: 'var(--ink-2)', 'font-weight': 600 });
  label(s, 360, 116, 'spread along the chain: high', { 'font-size': 12 });
  label(s, 360, 134, 'spread in space: low', { 'font-size': 12 });
  return pic(s, 'Two made-up latents, with the firing residues in amber. The left one reads one stretch of the chain. The right one fires at residues that are far apart along the chain but next to each other in the fold.');
}

/** The five cuts the pairing tries on one latent's activation. */
export function cutsPicture(): HTMLElement {
  const n = 36;
  const bw = 13;
  const x0 = 10;
  const top = 14;
  const tall = 160;
  const vals = [...Array(n).keys()].map((i) => {
    const bump = Math.exp(-((i - 14) ** 2) / 18) * 0.95 + Math.exp(-((i - 27) ** 2) / 6) * 0.55;
    return Math.min(1, bump + 0.04 * rnd(i));
  });
  const s = svg(x0 + n * bw + 70, top + tall + 26, 'One latent over one protein, with the five cuts of the pairing search.');
  vals.forEach((v, i) => {
    const h = Math.max(1, v * tall);
    add(s, 'rect', { x: x0 + i * bw, y: top + tall - h, width: bw - 2, height: h, rx: 1, fill: 'var(--signal)', opacity: 0.85 });
  });
  for (const c of [0, 0.15, 0.5, 0.6, 0.8]) {
    const y = top + tall - c * tall;
    add(s, 'line', { x1: x0, y1: y, x2: x0 + n * bw, y2: y, stroke: 'var(--ink)', 'stroke-dasharray': c ? '4 3' : '' });
    label(s, x0 + n * bw + 8, y + 4, c ? String(c) : '0', { 'font-size': 12 });
  }
  label(s, x0, top + tall + 20, 'residues of one protein', { 'font-size': 12 });
  return pic(s, 'Made-up activations. Each dashed line is one cut. A residue fires when its bar is above the cut, so each cut gives another set of firing residues. The search keeps the cut with the best F1 per domain.');
}

/** Three pairs of directions: the same, unrelated, and opposite. */
export function cosinePicture(): HTMLElement {
  const s = svg(560, 128, 'Two directions that point the same way, at a right angle, and the opposite way.');
  const cases: [number, string][] = [[0, '1: the same'], [90, '0: unrelated'], [180, '-1: the opposite']];
  cases.forEach(([deg, text], k) => {
    const cx = 90 + k * 190;
    const cy = 62;
    arrow(s, cx, cy, cx + 60, cy, 'var(--depth)');
    const r = (deg * Math.PI) / 180;
    const off = deg === 0 ? 8 : 0;
    arrow(s, cx, cy - off, cx + 60 * Math.cos(r), cy - off - 60 * Math.sin(r), 'var(--signal)');
    label(s, cx, 118, text, { 'text-anchor': 'middle', fill: 'var(--ink-2)' });
  });
  return pic(s, 'Slate is the decoder vector at the peak layer. Amber is the decoder vector at another layer.');
}

/** A 300-residue protein, and the residues one latent fires on. */
export function coversPicture(): HTMLElement {
  const n = 300;
  const s = svg(640, 66, 'A latent fires on 9 of the 300 residues of a protein.');
  const fire = new Set([41, 42, 43, 118, 119, 120, 121, 207, 208]);
  for (let i = 0; i < n; i++) {
    add(s, 'rect', { x: 10 + i * 2, y: 6, width: 1.6, height: 22, fill: fire.has(i) ? 'var(--signal)' : 'var(--line)' });
  }
  label(s, 10, 50, 'fires on 9 of 300 residues: covers 3%', { fill: 'var(--ink)' });
  return pic(s, 'One made-up protein of 300 residues, one thin bar for each residue.');
}

/** One latent over one protein, with its strongest residue marked. */
export function peakActivationPicture(): HTMLElement {
  const n = 48;
  const vals = [...Array(n).keys()].map((i) => 0.62 * Math.exp(-((i - 30) ** 2) / 10) + (i === 30 ? 0 : 0.02 * rnd(i)));
  const s = svg(560, 124, 'One latent over one protein, with its peak marked.');
  const top = 26;
  const tall = 70;
  vals.forEach((v, i) => {
    const h = Math.max(1, v * tall);
    add(s, 'rect', { x: 10 + i * 11, y: top + tall - h, width: 9, height: h, rx: 1, fill: 'var(--signal)', opacity: i === 30 ? 1 : 0.6 });
  });
  label(s, 10 + 30 * 11 + 4, top + tall - 0.62 * tall - 8, 'peak 0.62', { 'text-anchor': 'middle', fill: 'var(--ink)' });
  add(s, 'line', { x1: 10, y1: top + tall, x2: 10 + n * 11, y2: top + tall, stroke: 'var(--line-strong)' });
  label(s, 10, top + tall + 22, 'residues of one protein', { 'font-size': 12 });
  return pic(s, 'Made-up values. The peak is the largest activation on this protein, on the scale where 1 is the strongest the latent fires anywhere.');
}

/** The validation half picks one latent; the held-out half scores it. */
export function bestLatentPicture(): HTMLElement {
  const s = svg(620, 150, 'The validation half picks the latent with the best F1, and the held-out half scores it.');
  const rows: [string, number][] = [['latent A', 0.58], ['latent B', 0.74], ['latent C', 0.52], ['latent D', 0.66]];
  const best = 1;
  label(s, 90, 14, 'F1 per domain, validation half', { 'font-size': 12 });
  rows.forEach(([name, v], r) => {
    const y = 26 + r * 28;
    const on = r === best;
    label(s, 0, y + 14, name, { 'font-family': MONO, fill: on ? 'var(--ink)' : 'var(--muted)' });
    add(s, 'rect', { x: 90, y, width: 200, height: 18, rx: 2, fill: 'var(--line)' });
    add(s, 'rect', { x: 90, y, width: 200 * v, height: 18, rx: 2, fill: on ? 'var(--signal)' : 'var(--line-strong)' });
    label(s, 298, y + 14, v.toFixed(2), { 'font-size': 12, fill: on ? 'var(--ink)' : 'var(--muted)' });
  });
  const y = 26 + best * 28 + 9;
  arrow(s, 340, y, 420, y);
  label(s, 380, y - 8, 'picked', { 'font-size': 12, 'text-anchor': 'middle' });
  label(s, 430, y - 10, 'held-out half scores it', { 'font-size': 12 });
  label(s, 430, y + 12, 'Best F1 = 0.69', { fill: 'var(--ink)', 'font-weight': 600 });
  return pic(s, 'One concept with four paired latents, made-up values. The validation half picks the Best latent, and the held-out half gives its score, the Best F1. The pick never sees the held-out half.');
}

/** A Swiss-Prot field, its values, and the "any" concept that joins them. */
export function conceptPicture(): HTMLElement {
  const s = svg(560, 140, 'The field Zinc finger has several values, and "any" joins them.');
  const box = (x: number, y: number, w: number, text: string, strong = false) => {
    add(s, 'rect', { x, y, width: w, height: 26, rx: 3, fill: 'var(--surface)', stroke: strong ? 'var(--ink-2)' : 'var(--line-strong)' });
    label(s, x + w / 2, y + 17, text, { 'text-anchor': 'middle', fill: strong ? 'var(--ink)' : 'var(--ink-2)' });
  };
  box(0, 56, 130, 'Zinc finger', true);
  label(s, 0, 46, 'field', { 'font-size': 12 });
  const values = ['C2H2-type', 'RING-type', 'CCHC-type'];
  values.forEach((v, i) => {
    const y = 12 + i * 44;
    add(s, 'path', { d: `M130 69 C 170 69, 170 ${y + 13}, 210 ${y + 13}`, stroke: 'var(--line-strong)', fill: 'none' });
    box(210, y, 130, v);
  });
  label(s, 210, 8, 'values: one concept each', { 'font-size': 12 });
  add(s, 'path', { d: 'M352 14 C 372 14, 372 69, 392 69 C 372 69, 372 124, 352 124', stroke: 'var(--accent)', fill: 'none' });
  box(400, 56, 150, 'Zinc finger · any', true);
  label(s, 400, 100, 'one more concept: all values', { 'font-size': 12 });
  return pic(s, 'One field of the Swiss-Prot feature table. Each value is a concept, and "any" is one more concept that joins all values of the field.');
}
