/**
 * Every latent placed by what shape it reads: a stretch of the chain, or a site in the fold.
 *
 * The letter row and the structure view each answer half of this. A latent that fires on
 * residues 40 to 60 reads a stretch, and the letter row shows it. A latent that fires on residues
 * 12, 88 and 140 looks like scatter on the letter row, and can still be reading one pocket,
 * because the chain folds and brings those residues together.
 *
 * Stage 8 measures both spreads once for every live latent, over the 20 proteins it fires
 * hardest on. An earlier version measured them in the browser for one latent at a time. That
 * answered the question for that latent and could not place it against the others, which is the
 * part that carries a finding.
 *
 * Across: how far apart the firing residues are along the chain, over the same spread for the
 * whole protein. Up: the same for the distance in space. Both are 1 when the firing residues are
 * spread like the protein itself.
 */

import type { Data, Feature } from './data';
import { cssVar, el, figures, num } from './ui';

/** Below this the firing residues are close along the chain, against the protein's own spread. */
export const SEQ_LOCAL = 0.7;
/** Below this they are close in space. Read it only when the sequence ratio is not local. */
export const SPACE_LOCAL = 0.7;

export type Shape = 'stretch' | 'fold-site' | 'neither';

export function shapeOf(seq: number, space: number): Shape {
  // The sequence ratio alone decides a stretch. A chain that is close along its length is usually
  // close in space, but not always: latent 7489 on a collagen-like domain sits at 0.06 along the
  // chain and 1.49 in space, because a collagen helix is extended.
  if (seq < SEQ_LOCAL) return 'stretch';
  return space < SPACE_LOCAL ? 'fold-site' : 'neither';
}

const SHAPE_PROSE: Record<Shape, string> = {
  stretch: 'reads one stretch of the chain',
  'fold-site': 'reads one site in the fold',
  neither: 'reads no single place',
};

/**
 * The plot, with one latent marked.
 *
 * Pass `self` to mark the latent whose page this is. Pass nothing for the plot on its own.
 */
export function latentLocalityPlot(d: Data, self?: Feature): HTMLElement {
  const pts: { f: Feature; seq: number; space: number; n: number }[] = [];
  for (const f of d.features) {
    const l = d.localityOf(f.f);
    if (l) pts.push({ f, seq: l.seq, space: l.space, n: l.n });
  }

  const wrap = el('div');
  if (pts.length === 0) {
    wrap.append(
      el(
        'p',
        'small muted',
        'This data tree carries no locality measurement. Run stage 8 of the precompute.',
      ),
    );
    return wrap;
  }

  const ns = 'http://www.w3.org/2000/svg';
  const W = 460;
  const H = 300;
  const PL = 46;
  const PR = 14;
  const PT = 14;
  const PB = 42;
  const iw = W - PL - PR;
  const ih = H - PT - PB;
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('width', '100%');
  svg.style.display = 'block';
  const add = (t: string, a: Record<string, string | number>, text?: string) => {
    const n = document.createElementNS(ns, t);
    for (const [k, v] of Object.entries(a)) n.setAttribute(k, String(v));
    if (text !== undefined) n.textContent = text;
    svg.append(n);
    return n;
  };

  const hi = Math.min(2, Math.max(1.3, ...pts.map((p) => Math.max(p.seq, p.space))));
  const X = (v: number) => PL + (iw * Math.min(v, hi)) / hi;
  const Y = (v: number) => PT + ih - (ih * Math.min(v, hi)) / hi;

  // The two regions, drawn before the dots so they read as ground and not as marks.
  add('rect', {
    x: PL, y: PT, width: X(SEQ_LOCAL) - PL, height: ih,
    fill: 'var(--ink-2)', 'fill-opacity': 0.06,
  });
  add('rect', {
    x: X(SEQ_LOCAL), y: Y(SPACE_LOCAL), width: X(hi) - X(SEQ_LOCAL), height: Y(0) - Y(SPACE_LOCAL),
    fill: 'var(--accent)', 'fill-opacity': 0.1,
  });

  for (let g = 0; g <= hi + 0.001; g += 0.5) {
    add('line', { x1: X(g), y1: PT, x2: X(g), y2: PT + ih, stroke: 'var(--line)' });
    add('line', { x1: PL, y1: Y(g), x2: PL + iw, y2: Y(g), stroke: 'var(--line)' });
    add(
      'text',
      { x: X(g), y: H - PB + 13, 'text-anchor': 'middle', fill: 'var(--muted)', 'font-size': 9 },
      g.toFixed(1),
    );
    add(
      'text',
      { x: PL - 6, y: Y(g) + 3, 'text-anchor': 'end', fill: 'var(--muted)', 'font-size': 9 },
      g.toFixed(1),
    );
  }

  for (const pass of [false, true]) {
    for (const p of pts) {
      if (Boolean(p.f.c) !== pass) continue;
      if (self && p.f.f === self.f) continue;
      add('circle', {
        cx: X(p.seq).toFixed(1), cy: Y(p.space).toFixed(1), r: 1.7,
        fill: pass ? 'var(--signal)' : 'var(--line-strong)',
        'fill-opacity': pass ? 0.5 : 0.28,
      });
    }
  }

  const mine = self ? pts.find((p) => p.f.f === self.f) : undefined;
  if (mine) {
    add('circle', {
      cx: X(mine.seq).toFixed(1), cy: Y(mine.space).toFixed(1), r: 5.5,
      fill: 'none', stroke: 'var(--ink)', 'stroke-width': 2,
    });
    add('circle', {
      cx: X(mine.seq).toFixed(1), cy: Y(mine.space).toFixed(1), r: 2.4, fill: 'var(--ink)',
    });
  }

  add(
    'text',
    { x: PL + iw / 2, y: H - 4, 'text-anchor': 'middle', fill: 'var(--muted)', 'font-size': 9 },
    'spread along the chain, over the protein’s own',
  );
  const rot = add(
    'text',
    { x: 11, y: PT + ih / 2, 'text-anchor': 'middle', fill: 'var(--muted)', 'font-size': 9 },
    'spread in space, over the protein’s own',
  );
  rot.setAttribute('transform', `rotate(-90 11 ${PT + ih / 2})`);
  wrap.append(svg);

  const counts = { stretch: 0, 'fold-site': 0, neither: 0 } as Record<Shape, number>;
  for (const p of pts) counts[shapeOf(p.seq, p.space)]++;

  if (mine) {
    const shape = shapeOf(mine.seq, mine.space);
    wrap.append(
      figures(
        [
          [mine.seq.toFixed(2), 'spread along the chain'],
          [mine.space.toFixed(2), 'spread in space'],
          [String(mine.n), 'proteins measured'],
        ],
        `This latent ${SHAPE_PROSE[shape]}. Both numbers are medians over the ${mine.n} proteins ` +
          'it fires hardest on, so they describe where it is strongest and not everywhere it ' +
          'fires.',
      ),
    );
  }

  const legend = el('div', 'loc-legend');
  const keys: [string, string][] = [
    ['pairs with a concept', cssVar('--signal')],
    ['nothing named it', cssVar('--line-strong')],
  ];
  if (mine) keys.push(['this latent', cssVar('--ink')]);
  for (const [label, color] of keys) {
    const item = el('span', 'loc-key');
    const sw = el('i');
    sw.style.background = color;
    item.append(sw, label);
    legend.append(item);
  }
  wrap.append(legend);

  const key = el('dl', 'cornerkey');
  const put = (k: string, v: string) => {
    key.append(el('dt', undefined, k));
    key.append(el('dd', undefined, v));
  };
  put(
    `left band, ${num(counts.stretch)}`,
    'close along the chain. The latent reads one stretch. Its spread in space follows from the ' +
      'fold and can be anything.',
  );
  put(
    `lower right, ${num(counts['fold-site'])}`,
    'spread along the chain and close in space. The latent reads one site in the fold. The ' +
      'letter row shows this case as scatter and cannot tell it from noise.',
  );
  put(
    `upper right, ${num(counts.neither)}`,
    'spread both ways. The latent reads no single place on the proteins measured.',
  );
  wrap.append(key);
  wrap.append(
    el(
      'p',
      'small muted',
      `${num(pts.length)} of the ${num(d.features.length)} live latents were measured. A latent ` +
        'is left out when it fires on fewer than 6 residues of every protein tried, or when this ' +
        'tree holds no model for those proteins.',
    ),
  );
  return wrap;
}
