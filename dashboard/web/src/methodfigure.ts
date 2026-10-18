/**
 * The header of the landing page: the method in four steps, with the site's own numbers.
 *
 * Each step is one link into the part of the method page that argues for it. The heading, the
 * number and the caption are HTML, so they keep their size at every width and wrap like text.
 * Only the small drawing above each number is SVG, and it is drawn at its own size so that its
 * labels are not scaled down with the page.
 *
 * The numbers come from the manifest, so this figure cannot fall behind the data tree.
 */

import type { Data } from './data';
import type { SectionId } from './metrics';
import { el, num } from './ui';

const NS = 'http://www.w3.org/2000/svg';
const PIC_W = 230;
const PIC_H = 84;
const MONO = "'IBM Plex Mono', ui-monospace, monospace";

function add(
  parent: SVGElement,
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

function picture(): SVGSVGElement {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${PIC_W} ${PIC_H}`);
  svg.setAttribute('aria-hidden', 'true');
  return svg;
}

/** Three lines of a sequence: the input is letters, one residue at a time. */
function proteinPicture(): SVGSVGElement {
  const svg = picture();
  ['MVHWTAEEKAAITSVW', 'QKVNVEHDGHDALGRL', 'LIVYPWTQRYFSNFGN'].forEach((t, i) => {
    add(svg, 'text', {
      x: 0, y: 22 + i * 24, 'font-size': 14, fill: 'var(--ink-2)', 'font-family': MONO,
      'letter-spacing': 1,
    }, t);
  });
  return svg;
}

/** Nine bars for the 24 layers, with the band where most latents peak in slate. */
function layersPicture(layers: number): SVGSVGElement {
  const svg = picture();
  for (let i = 0; i < 9; i++) {
    const lit = i >= 3 && i <= 5;
    add(svg, 'rect', {
      x: 0, y: 4 + i * 9, width: 118, height: 6, rx: 1.5,
      fill: lit ? 'var(--depth)' : 'var(--line-strong)', opacity: lit ? 0.9 : 0.55,
    });
  }
  add(svg, 'text', { x: 128, y: 12, 'font-size': 12, fill: 'var(--muted)' }, `layer ${layers}`);
  add(svg, 'text', { x: 128, y: 44, 'font-size': 12, fill: 'var(--depth)' }, 'layers 15 to 19');
  add(svg, 'text', { x: 128, y: 82, 'font-size': 12, fill: 'var(--muted)' }, 'layer 1');
  return svg;
}

/** Every layer into one dictionary, a few of its latents firing, and back into every layer. */
function crosscoderPicture(total: number): SVGSVGElement {
  const svg = picture();
  const fanIn = add(svg, 'g', {
    stroke: 'var(--depth)', 'stroke-width': 1, opacity: 0.6, fill: 'none',
  });
  [8, 24, 42, 60, 76].forEach((y, i) => {
    add(fanIn, 'path', { d: `M0 ${y} C 26 ${y}, 26 ${34 + i * 4}, 48 ${34 + i * 4}` });
  });
  add(svg, 'rect', {
    x: 48, y: 4, width: 24, height: 76, rx: 2, fill: 'none', stroke: 'var(--line-strong)',
  });
  [10, 16, 28, 34, 46, 58, 64, 70].forEach((y) => {
    add(svg, 'rect', { x: 52, y, width: 16, height: 2.5, fill: 'var(--line-strong)', opacity: 0.6 });
  });
  [22, 40, 52].forEach((y) => {
    add(svg, 'rect', { x: 52, y, width: 16, height: 3, fill: 'var(--signal)' });
  });
  const fanOut = add(svg, 'g', {
    stroke: 'var(--signal)', 'stroke-width': 1, opacity: 0.6, fill: 'none',
  });
  [8, 24, 42, 60, 76].forEach((y, i) => {
    add(fanOut, 'path', { d: `M72 ${34 + i * 4} C 94 ${34 + i * 4}, 94 ${y}, 116 ${y}` });
  });
  add(svg, 'rect', {
    x: 116, y: 4, width: 6, height: 76, rx: 1.5, fill: 'var(--surface-2)', stroke: 'var(--line)',
  });
  add(svg, 'text', { x: 132, y: 30, 'font-size': 12, fill: 'var(--muted)' }, `${num(total)} latents`);
  add(svg, 'text', { x: 132, y: 48, 'font-size': 12, fill: 'var(--signal)' }, '32 per residue');
  add(svg, 'text', { x: 132, y: 66, 'font-size': 12, fill: 'var(--muted)' }, 'fire on average');
  return svg;
}

/** One protein, the Swiss-Prot annotation on top, and two latents that fire inside it. */
function namingPicture(): SVGSVGElement {
  const svg = picture();
  const rows: [string, string, [number, number][]][] = [
    ['Swiss-Prot', 'var(--accent)', [[42, 150]]],
    ['f/7525', 'var(--signal)', [[56, 104], [124, 140]]],
    ['f/4643', 'var(--signal)', [[96, 150]]],
  ];
  rows.forEach(([label, color, spans], i) => {
    const y = 10 + i * 26;
    add(svg, 'text', {
      x: 0, y: y + 8, 'font-size': 12, fill: color, 'font-family': MONO,
    }, label);
    add(svg, 'rect', {
      x: 78, y, width: 152, height: 9, rx: 1.5, fill: 'var(--surface-2)', stroke: 'var(--line)',
    });
    for (const [a, b] of spans) {
      add(svg, 'rect', { x: 78 + a - 40, y, width: b - a, height: 9, rx: 1.5, fill: color });
    }
  });
  return svg;
}

function step(
  n: number,
  head: string,
  section: SectionId,
  label: string,
  pic: SVGSVGElement,
  value: string,
  caption: string,
): HTMLAnchorElement {
  const a = el('a', 'mf-step');
  a.href = `#/method/${section}`;
  a.title = `Method: ${label}`;
  const h = el('span', 'mf-head');
  h.append(el('span', 'mf-n', String(n)), head);
  const p = el('span', 'mf-pic');
  p.append(pic);
  a.append(h, p, el('span', 'mf-value', value), el('span', 'mf-cap', caption));
  return a;
}

export function methodFigure(d: Data): HTMLElement {
  const h = d.manifest.headline;
  const box = el('div');
  const steps = el('nav', 'mf');
  steps.setAttribute('aria-label', 'The method in four steps');
  steps.append(
    step(
      1, 'A protein', 'why', 'Why read the inside of ProtT5',
      proteinPicture(),
      num(d.manifest.counts.proteins),
      'Swiss-Prot proteins in the evaluation set, read one residue at a time.',
    ),
    step(
      2, 'ProtT5 encoder', 'one-dictionary', 'Why one dictionary for 24 layers',
      layersPicture(h.layers),
      String(h.layers),
      'layers in the encoder of ProtT5, a protein language model. Each layer passes on a vector ' +
        'of 1,024 numbers for every residue, its residual stream.',
    ),
    step(
      3, 'One dictionary for all 24 layers', 'one-dictionary', 'Why one dictionary for 24 layers',
      crosscoderPicture(h.latents_total),
      num(h.latents_alive),
      `of the ${num(h.latents_total)} latents fire at least once. A latent is one entry of a ` +
        'dictionary that all 24 layers share, so its depth profile shows where in ProtT5 it is ' +
        'written. Separate autoencoders would learn it once for each layer, with no link.',
    ),
    step(
      4, 'Latents pair with Swiss-Prot concepts', 'naming', 'How a latent is paired with a concept',
      namingPicture(),
      `${h.concepts_identified} of ${h.concepts_total}`,
      `concepts have at least one paired latent. ${num(h.features_paired)} latents pair with a ` +
        `concept. Average best F1 per domain: ${h.avg_best_test_f1.toFixed(3)}.`,
    ),
  );
  box.append(steps, el('p', 'methodfoot', 'Click a step to read that part of the method.'));
  return box;
}
