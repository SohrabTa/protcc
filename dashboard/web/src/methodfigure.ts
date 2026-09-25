/**
 * The header picture: the method in four stations, with the site's own numbers under each one.
 *
 * It replaces a strip of five numbers with no context. A reader who lands here does not know
 * what an average best test F1 of 0.479 is an average over, and the strip could not tell them.
 * Each number now sits under the thing it counts, the arrows say what feeds what, and the whole
 * picture is a link to the method page.
 *
 * The numbers come from the manifest, so this figure cannot fall behind the data tree.
 */

import type { Data } from './data';
import { el, num } from './ui';

const NS = 'http://www.w3.org/2000/svg';
const W = 1120;
const H = 206;

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

/** A station's heading, its big number, and the lines under it. */
function station(
  svg: SVGElement,
  x: number,
  n: number,
  head: string,
  value: string,
  lines: string[],
): void {
  add(svg, 'text', {
    x, y: 14, 'font-size': 10.5, fill: 'var(--muted)', 'letter-spacing': 1.2,
  }, `${n} · ${head}`);
  add(svg, 'text', {
    x, y: 136, 'font-size': 18, 'font-weight': 700, fill: 'var(--ink)',
    'font-family': 'Archivo, sans-serif',
  }, value);
  lines.forEach((t, i) => {
    add(svg, 'text', { x, y: 154 + i * 14, 'font-size': 11, fill: 'var(--muted)' }, t);
  });
}

function arrow(svg: SVGElement, x1: number, x2: number): void {
  add(svg, 'line', {
    x1, y1: 78, x2, y2: 78, stroke: 'var(--line-strong)', 'marker-end': 'url(#mf-arrow)',
  });
}

/** One station, as a link into the section of the method page that argues for it. */
function hotspot(host: HTMLElement, left: number, width: number, section: string, label: string) {
  const a = el('a', 'mf-hot');
  a.href = `#/method/${section}`;
  a.title = label;
  a.setAttribute('aria-label', label);
  a.style.left = `${(left / W) * 100}%`;
  a.style.width = `${(width / W) * 100}%`;
  host.append(a);
}

export function methodFigure(d: Data): HTMLElement {
  const h = d.manifest.headline;
  const box = el('div', 'methodfig');
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('width', '100%');
  svg.setAttribute('role', 'img');
  svg.setAttribute(
    'aria-label',
    'A protein goes into ProtT5. One crosscoder reads all 24 encoder layers at once and writes ' +
      'back into all of them. Swiss-Prot then names what each latent reads.',
  );
  svg.style.display = 'block';

  const defs = add(svg, 'defs', {});
  const marker = add(defs, 'marker', {
    id: 'mf-arrow', viewBox: '0 0 8 8', refX: 7, refY: 4, markerWidth: 7, markerHeight: 7,
    orient: 'auto',
  });
  add(marker, 'path', { d: 'M0 0 L8 4 L0 8 z', fill: 'var(--line-strong)' });

  // ---- 1. a protein ----------------------------------------------------
  const mono = "'IBM Plex Mono', ui-monospace, monospace";
  ['AQSVPYGIS', 'QIKAPALHS', 'QGYTGSNVK'].forEach((t, i) => {
    add(svg, 'text', {
      x: 14, y: 52 + i * 18, 'font-size': 13, fill: 'var(--ink-2)', 'font-family': mono,
    }, t);
  });
  station(svg, 14, 1, 'A PROTEIN', num(d.manifest.counts.proteins), [
    'proteins of Swiss-Prot, read',
    'one residue at a time',
  ]);
  arrow(svg, 150, 182);

  // ---- 2. ProtT5 -------------------------------------------------------
  // Nine bars stand for the 24 layers. Drawing all 24 at this height gives a grey block.
  for (let i = 0; i < 9; i++) {
    const lit = i >= 4 && i <= 6;
    add(svg, 'rect', {
      x: 196, y: 26 + i * 10, width: 150, height: 7, rx: 1.5,
      fill: lit ? 'var(--accent)' : 'var(--line-strong)', opacity: lit ? 0.85 : 0.5,
    });
  }
  add(svg, 'text', { x: 352, y: 33, 'font-size': 10, fill: 'var(--muted)' }, `layer ${h.layers}`);
  add(svg, 'text', { x: 352, y: 81, 'font-size': 10, fill: 'var(--accent)' }, 'layers 15 to 19');
  add(svg, 'text', { x: 352, y: 117, 'font-size': 10, fill: 'var(--muted)' }, 'layer 1');
  station(svg, 196, 2, 'PROTT5, 24 ENCODER LAYERS', String(h.layers), [
    'layers, and each one holds its own',
    'vector for every residue',
  ]);
  arrow(svg, 430, 462);

  // ---- 3. the crosscoder ----------------------------------------------
  // The fan in and the fan out are the point of the picture. One dictionary reads every layer
  // and writes back into every layer, which is what a stack of per-layer autoencoders cannot do.
  const fan = add(svg, 'g', {
    stroke: 'var(--accent)', 'stroke-width': 0.7, opacity: 0.45, fill: 'none',
  });
  [30, 50, 70, 90, 110].forEach((y, i) => {
    add(fan, 'path', { d: `M476 ${y} C 520 ${y}, 520 ${70 + i * 4}, 560 ${70 + i * 4}` });
  });
  add(svg, 'rect', {
    x: 560, y: 26, width: 26, height: 104, rx: 2, fill: 'none', stroke: 'var(--line)',
  });
  const quiet = add(svg, 'g', { fill: 'var(--line-strong)', opacity: 0.55 });
  [30, 35, 45, 50, 60, 70, 80, 90, 100, 110, 120, 125].forEach((y) => {
    add(quiet, 'rect', { x: 564, y, width: 18, height: 2.2 });
  });
  const firing = add(svg, 'g', { fill: 'var(--signal)' });
  [40, 65, 85, 105].forEach((y) => {
    add(firing, 'rect', { x: 564, y, width: 18, height: 2.6 });
  });
  add(svg, 'text', {
    x: 592, y: 36, 'font-size': 10, fill: 'var(--muted)',
  }, `${num(h.latents_total)} latents`);
  add(svg, 'text', { x: 592, y: 50, 'font-size': 10, fill: 'var(--signal)' }, '32 fire at a time');
  const out = add(svg, 'g', {
    stroke: 'var(--signal)', 'stroke-width': 0.7, opacity: 0.5, fill: 'none',
  });
  [30, 50, 70, 90, 110].forEach((y, i) => {
    add(out, 'path', { d: `M586 ${70 + i * 4} C 626 ${70 + i * 4}, 626 ${y}, 668 ${y}` });
  });
  add(svg, 'rect', {
    x: 668, y: 26, width: 8, height: 104, rx: 1.5, fill: 'var(--surface-2)', stroke: 'var(--line)',
  });
  add(svg, 'text', {
    x: 672, y: 142, 'font-size': 10, fill: 'var(--muted)', 'text-anchor': 'middle',
  }, 'back into');
  add(svg, 'text', {
    x: 672, y: 155, 'font-size': 10, fill: 'var(--muted)', 'text-anchor': 'middle',
  }, 'all 24');
  station(svg, 476, 3, 'ONE CROSSCODER READS ALL 24 AT ONCE', num(h.latents_alive), [
    `of ${num(h.latents_total)} latents ever fire. One latent`,
    'writes into every layer, so it has',
    'a depth profile.',
  ]);
  arrow(svg, 700, 732);

  // ---- 4. Swiss-Prot names them ---------------------------------------
  const rowLabel = (y: number, t: string, fill: string) => {
    add(svg, 'text', { x: 746, y, 'font-size': 10, fill, 'font-family': mono }, t);
  };
  const strip = (y: number) => {
    add(svg, 'rect', {
      x: 820, y, width: 270, height: 7, rx: 1.5, fill: 'var(--surface-2)', stroke: 'var(--line)',
    });
  };
  rowLabel(40, 'Swiss-Prot', 'var(--accent)');
  strip(33);
  add(svg, 'rect', {
    x: 884, y: 33, width: 150, height: 7, rx: 1.5, fill: 'var(--accent)', opacity: 0.8,
  });
  rowLabel(58, 'f/7525', 'var(--signal)');
  strip(51);
  add(svg, 'rect', {
    x: 892, y: 51, width: 42, height: 7, rx: 1.5, fill: 'var(--signal)', opacity: 0.85,
  });
  add(svg, 'rect', {
    x: 1002, y: 51, width: 16, height: 7, rx: 1.5, fill: 'var(--signal)', opacity: 0.85,
  });
  rowLabel(76, 'f/4643', 'var(--signal)');
  strip(69);
  add(svg, 'rect', {
    x: 940, y: 69, width: 60, height: 7, rx: 1.5, fill: 'var(--signal)', opacity: 0.85,
  });
  add(svg, 'text', {
    x: 820, y: 94, 'font-size': 10, fill: 'var(--muted)',
  }, 'one protein, one row for each latent');
  station(
    svg,
    746,
    4,
    'SWISS-PROT NAMES WHAT A LATENT READS',
    `${h.concepts_identified} of ${h.concepts_total}`,
    [
      `concepts have a latent. ${num(h.features_paired)} latents pair, at`,
      'F1 per domain over 0.5 on held-out proteins.',
      `Average best F1 ${h.avg_best_test_f1.toFixed(3)}.`,
    ],
  );

  box.append(svg);
  // Each station is its own link, over the drawing, so a reader who wants one part goes there.
  hotspot(box, 0, 182, 'why', 'Why read the inside of ProtT5');
  hotspot(box, 182, 280, 'one-dictionary', 'What ProtT5 holds at each layer');
  hotspot(box, 462, 270, 'one-dictionary', 'Why one dictionary for 24 layers');
  hotspot(box, 732, 388, 'naming', 'How a latent gets a name');

  const foot = el('div', 'methodfoot');
  foot.append(el('span', undefined, 'Click a station to open that part of the method.'));
  box.append(foot);
  return box;
}
