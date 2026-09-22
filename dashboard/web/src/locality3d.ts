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
 * How to read a position. Across is the distance along the chain between the residues the latent
 * fires on, over the same distance for the whole protein. Up is the same for the distance in
 * space. A value of 1 means the firing residues are as far apart as any two residues of the
 * protein. Left is close along the chain. Low is close in space.
 *
 * Every dot answers to the pointer and opens its own latent page, because a position on its own
 * does not say which latent sits there.
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

const SHAPE_SHORT: Record<Shape, string> = {
  stretch: 'one stretch of the chain',
  'fold-site': 'one site in the fold',
  neither: 'no single place',
};

const NS = 'http://www.w3.org/2000/svg';

type Point = { f: Feature; seq: number; space: number; n: number; x: number; y: number };

/**
 * The plot, with one latent marked.
 *
 * Pass `self` to mark the latent whose page this is. Pass nothing for the plot on its own.
 */
export function latentLocalityPlot(d: Data, self?: Feature): HTMLElement {
  const raw: { f: Feature; seq: number; space: number; n: number }[] = [];
  for (const f of d.features) {
    const l = d.localityOf(f.f);
    if (l) raw.push({ f, seq: l.seq, space: l.space, n: l.n });
  }

  const wrap = el('div');
  if (raw.length === 0) {
    wrap.append(
      el(
        'p',
        'small muted',
        'This data tree carries no locality measurement. Run stage 8 of the precompute.',
      ),
    );
    return wrap;
  }

  const W = 520;
  const H = 340;
  const PL = 54;
  const PR = 16;
  const PT = 18;
  const PB = 58;
  const iw = W - PL - PR;
  const ih = H - PT - PB;
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('width', '100%');
  svg.style.display = 'block';
  const add = (t: string, a: Record<string, string | number>, text?: string) => {
    const n = document.createElementNS(NS, t);
    for (const [k, v] of Object.entries(a)) n.setAttribute(k, String(v));
    if (text !== undefined) n.textContent = text;
    svg.append(n);
    return n;
  };
  const label = (x: number, y: number, anchor: string, size: number, fill: string, t: string) =>
    add('text', { x, y, 'text-anchor': anchor, 'font-size': size, fill }, t);

  const hi = Math.min(2, Math.max(1.3, ...raw.map((p) => Math.max(p.seq, p.space))));
  const X = (v: number) => PL + (iw * Math.min(v, hi)) / hi;
  const Y = (v: number) => PT + ih - (ih * Math.min(v, hi)) / hi;

  const counts = { stretch: 0, 'fold-site': 0, neither: 0 } as Record<Shape, number>;
  for (const p of raw) counts[shapeOf(p.seq, p.space)]++;

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
    label(X(g), H - PB + 13, 'middle', 9, 'var(--muted)', g.toFixed(1));
    label(PL - 6, Y(g) + 3, 'end', 9, 'var(--muted)', g.toFixed(1));
  }

  const placed: Point[] = [];
  for (const pass of [false, true]) {
    for (const p of raw) {
      if (Boolean(p.f.c) !== pass) continue;
      const x = X(p.seq);
      const y = Y(p.space);
      // The unpaired pass runs first, so a named latent wins a tie against an unnamed one under
      // the pointer, the same way it is drawn over it.
      placed.push({ ...p, x, y });
      if (self && p.f.f === self.f) continue;
      add('circle', {
        cx: x.toFixed(1), cy: y.toFixed(1), r: 1.7,
        fill: pass ? 'var(--signal)' : 'var(--line-strong)',
        'fill-opacity': pass ? 0.5 : 0.28,
      });
    }
  }

  // The three regions named where they are, because a reader should not have to hold a rule about
  // 0.7 in their head to read the plot.
  label(
    (PL + X(SEQ_LOCAL)) / 2, PT + 13, 'middle', 9.5, 'var(--ink-2)',
    `one stretch of the chain, ${num(counts.stretch)}`,
  );
  label(
    PL + iw - 5, Y(0) - 7, 'end', 9.5, 'var(--accent)',
    `one site in the fold, ${num(counts['fold-site'])}`,
  );
  label(
    PL + iw - 5, PT + 13, 'end', 9.5, 'var(--ink-2)',
    `no single place, ${num(counts.neither)}`,
  );

  const mine = self ? placed.find((p) => p.f.f === self.f) : undefined;
  if (mine) {
    add('circle', {
      cx: mine.x.toFixed(1), cy: mine.y.toFixed(1), r: 5.5,
      fill: 'none', stroke: 'var(--ink)', 'stroke-width': 2,
    });
    add('circle', { cx: mine.x.toFixed(1), cy: mine.y.toFixed(1), r: 2.4, fill: 'var(--ink)' });
  }

  // Both axes carry the same three parts: what the number is, what the low end means, and what
  // the high end means.
  label(
    PL + iw / 2, H - 18, 'middle', 9.5, 'var(--muted)',
    'how far apart along the chain, over the whole protein',
  );
  label(PL, H - 6, 'start', 8.5, 'var(--muted)', '0, next to each other');
  label(PL + iw, H - 6, 'end', 8.5, 'var(--muted)', '1, as far apart as the protein');
  const yTitle = label(
    14, PT + ih / 2, 'middle', 9.5, 'var(--muted)', 'how far apart in space, over the whole protein',
  );
  yTitle.setAttribute('transform', `rotate(-90 14 ${PT + ih / 2})`);
  const yLow = label(28, PT + ih, 'start', 8.5, 'var(--muted)', '0, one point in space');
  yLow.setAttribute('transform', `rotate(-90 28 ${PT + ih})`);
  const yHigh = label(28, PT, 'end', 8.5, 'var(--muted)', '1, the whole fold');
  yHigh.setAttribute('transform', `rotate(-90 28 ${PT})`);

  // ---- the pointer -----------------------------------------------------
  const marker = add('circle', {
    cx: 0, cy: 0, r: 4.6, fill: 'none', stroke: 'var(--ink)', 'stroke-width': 1.6,
    'pointer-events': 'none',
  });
  marker.setAttribute('visibility', 'hidden');
  const hit = add('rect', {
    x: PL, y: PT, width: iw, height: ih, fill: 'transparent', cursor: 'crosshair',
  });

  const box = el('div', 'loc3d-box');
  const readout = el('div', 'loc3d-readout');
  box.append(svg, readout);
  wrap.append(box);

  let held = -1;
  const at = (e: MouseEvent): number => {
    const r = svg.getBoundingClientRect();
    if (r.width === 0) return -1;
    const vx = ((e.clientX - r.left) / r.width) * W;
    const vy = ((e.clientY - r.top) / r.height) * H;
    // The plot is 300 px wide in the two-column layout and 700 px wide in one column. A radius
    // in drawing units is a 4 px target in the first case, so the radius follows the screen.
    const pick = Math.min(14, Math.max(6, (9 * W) / r.width));
    let best = -1;
    let bestD = pick * pick;
    for (let i = 0; i < placed.length; i++) {
      const dx = placed[i].x - vx;
      const dy = placed[i].y - vy;
      const dd = dx * dx + dy * dy;
      if (dd <= bestD) {
        bestD = dd;
        best = i;
      }
    }
    return best;
  };

  const show = (i: number): void => {
    if (i === held) return;
    held = i;
    if (i < 0) {
      marker.setAttribute('visibility', 'hidden');
      readout.textContent = '';
      hit.setAttribute('cursor', 'crosshair');
      return;
    }
    const p = placed[i];
    marker.setAttribute('cx', p.x.toFixed(1));
    marker.setAttribute('cy', p.y.toFixed(1));
    marker.setAttribute('visibility', 'visible');
    hit.setAttribute('cursor', 'pointer');
    readout.textContent = '';
    const id = el('span', 'mono', `f/${p.f.f}`);
    const what = p.f.c ? p.f.c.replace('_', ' · ') : 'nothing named it';
    readout.append(
      id,
      ` ${what} · ${SHAPE_SHORT[shapeOf(p.seq, p.space)]} · ` +
        `${p.seq.toFixed(2)} along the chain, ${p.space.toFixed(2)} in space, ` +
        `${p.n} protein${p.n === 1 ? '' : 's'}`,
    );
  };

  hit.addEventListener('mousemove', (e) => show(at(e as MouseEvent)));
  hit.addEventListener('mouseleave', () => show(-1));
  hit.addEventListener('click', (e) => {
    const i = at(e as MouseEvent);
    if (i >= 0) location.hash = `/latent/${placed[i].f.f}`;
  });

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
  for (const [name, color] of keys) {
    const item = el('span', 'loc-key');
    const sw = el('i');
    sw.style.background = color;
    item.append(sw, name);
    legend.append(item);
  }
  legend.append(el('span', 'loc-key', 'point at a dot to name it, click it to open it'));
  wrap.append(legend);

  const key = el('dl', 'cornerkey');
  const put = (k: string, v: string) => {
    key.append(el('dt', undefined, k));
    key.append(el('dd', undefined, v));
  };
  put(
    `left, ${num(counts.stretch)}`,
    'The firing residues are close along the chain. The latent reads one stretch. Its spread in ' +
      'space follows from the fold and can be anything, so the height says nothing here.',
  );
  put(
    `lower right, ${num(counts['fold-site'])}`,
    'The firing residues are far apart along the chain and close in space. The latent reads one ' +
      'site in the fold. The letter row shows this case as scatter and cannot tell it from noise.',
  );
  put(
    `upper right, ${num(counts.neither)}`,
    'The firing residues are far apart both ways. The latent reads no single place on the ' +
      'proteins measured.',
  );
  wrap.append(key);
  wrap.append(
    el(
      'p',
      'small muted',
      `${num(placed.length)} of the ${num(d.features.length)} live latents were measured. A ` +
        'latent is left out when it fires on fewer than 6 residues of every protein tried, or ' +
        'when this tree holds no model for those proteins.',
    ),
  );
  return wrap;
}
