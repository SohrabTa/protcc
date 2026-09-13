/**
 * Does a latent read a stretch of the chain, or a site in the fold?
 *
 * The sequence views and the structure view each answer half of this. A latent that fires on
 * residues 40 to 60 is reading a stretch, and the letter row shows it. A latent that fires on
 * residues 12, 88 and 140 looks like scatter on the letter row, and can still be reading one
 * pocket, because the chain folds and brings those residues together.
 *
 * This panel separates the two, over many proteins at once, with two numbers per protein.
 *
 * ## The two numbers
 *
 * For one protein and one latent, take every pair of firing residues.
 *
 *   sequence spread = the median of |i - j| over those pairs
 *   spatial spread  = the median distance in angstroms between their alpha carbons
 *
 * Neither means anything on its own, because a 90-residue protein puts everything near
 * everything. So each is divided by the same median over pairs drawn from the whole protein.
 * Both ratios are then 1 when the firing residues are spread like the protein itself, and below
 * 1 when they are closer together than that.
 *
 *   bottom left   close along the chain and close in space: one continuous stretch
 *   bottom right  spread along the chain and close in space: one site in the fold
 *   top right     spread both ways: the latent is not reading one place
 *
 * The bottom right is the corner that the sequence views cannot show and the structure view
 * cannot count.
 *
 * ## Why it is measured on demand
 *
 * Each protein costs one track and one structure, about 50 kB together. Twenty-five proteins is
 * 1.2 MB and fifty fetches, which is not something a page should do before anyone asks.
 */

import type { Data } from './data';
import { loadBackbone, type Backbone } from './structure';
import { cssVar, el, figures, num } from './ui';

const THRESHOLD = 76; // 0.3 of the latent's own maximum, the cut every other view uses
const MIN_FIRING = 6;
const MIN_PAIRS = 10;
const SAMPLE_PAIRS = 4000;
/** Below this the firing residues are close along the chain, against the protein's own spread. */
const SEQ_LOCAL = 0.7;
/** Below this they are close in space. Only read it when the sequence ratio is not local. */
const SPACE_LOCAL = 0.7;

export interface Point {
  acc: string;
  name: string;
  /** Median sequence gap between firing residues, over the protein's own median. */
  seq: number;
  /** Median distance in space between firing residues, over the protein's own median. */
  space: number;
  nFiring: number;
  length: number;
}

/** A fixed seed, so the sampled baseline does not move between runs. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 1000000) / 1000000;
  };
}

function median(xs: number[]): number {
  xs.sort((a, b) => a - b);
  const m = xs.length >> 1;
  return xs.length % 2 ? xs[m] : (xs[m - 1] + xs[m]) / 2;
}

/**
 * Both ratios for one protein, or null when the latent fires on too few residues to say.
 *
 * The two ratios come from the same pair sets, so they can be read against each other. Using a
 * different pair set for each, as `spatialStat` does when it keeps only distant pairs, would
 * make the comparison meaningless.
 */
export function localityRatios(bb: Backbone, values: Uint8Array): Omit<Point, 'acc' | 'name'> | null {
  const n = bb.resi.length;
  if (n < 12) return null;

  const dist = (a: number, b: number): number => {
    const dx = bb.xyz[a * 3] - bb.xyz[b * 3];
    const dy = bb.xyz[a * 3 + 1] - bb.xyz[b * 3 + 1];
    const dz = bb.xyz[a * 3 + 2] - bb.xyz[b * 3 + 2];
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  };

  const fire: number[] = [];
  for (let i = 0; i < n; i++) {
    const v = values[bb.resi[i] - 1];
    if (v !== undefined && v > THRESHOLD) fire.push(i);
  }
  if (fire.length < MIN_FIRING) return null;

  const fireSeq: number[] = [];
  const fireSpace: number[] = [];
  for (let a = 0; a < fire.length; a++) {
    for (let b = a + 1; b < fire.length; b++) {
      fireSeq.push(Math.abs(bb.resi[fire[b]] - bb.resi[fire[a]]));
      fireSpace.push(dist(fire[a], fire[b]));
    }
  }
  if (fireSeq.length < MIN_PAIRS) return null;

  const next = rng(0x9e3779b9);
  const baseSeq: number[] = [];
  const baseSpace: number[] = [];
  for (let t = 0; t < SAMPLE_PAIRS * 3 && baseSeq.length < SAMPLE_PAIRS; t++) {
    const i = Math.floor(next() * n);
    const j = Math.floor(next() * n);
    if (i === j) continue;
    baseSeq.push(Math.abs(bb.resi[j] - bb.resi[i]));
    baseSpace.push(dist(i, j));
  }
  if (baseSeq.length < 50) return null;

  const mSeq = median(baseSeq);
  const mSpace = median(baseSpace);
  if (mSeq <= 0 || mSpace <= 0) return null;

  return {
    seq: median(fireSeq) / mSeq,
    space: median(fireSpace) / mSpace,
    nFiring: fire.length,
    length: n,
  };
}

export interface LocalityPanelHandle {
  root: HTMLElement;
}

/**
 * The panel: a button, then a plot of one dot per protein.
 *
 * The proteins are the top of the latent's own ranking, so they are the proteins it fires
 * hardest on. That is a biased sample and the caption says so. A random sample of the proteins
 * it fires on would answer a different question, and most of them fire too weakly to clear the
 * cut at all.
 */
export function localityPanel(d: Data, fid: number, accessions: string[]): LocalityPanelHandle {
  const root = el('div');
  const controls = el('div', 'chips');
  const body = el('div');
  root.append(controls, body);

  const counts = [15, 40].filter((k) => k <= accessions.length);
  if (counts.length === 0 && accessions.length) counts.push(accessions.length);

  for (const k of counts) {
    const b = el('button', undefined, `measure ${k} proteins`);
    b.addEventListener('click', () => {
      controls.querySelectorAll('button').forEach((x) => ((x as HTMLButtonElement).disabled = true));
      void run(k).finally(() => {
        controls.querySelectorAll('button').forEach((x) => ((x as HTMLButtonElement).disabled = false));
      });
    });
    controls.append(b);
  }
  if (counts.length === 0) {
    body.append(el('p', 'small muted', 'No protein this latent fires on has a model in this tree.'));
  }

  async function run(k: number): Promise<void> {
    body.textContent = '';
    const progress = el('p', 'loading', `Reading 0 of ${k} proteins…`);
    body.append(progress);

    const points: Point[] = [];
    let skipped = 0;
    for (let i = 0; i < accessions.length && points.length + skipped < k; i++) {
      const acc = accessions[i];
      progress.textContent = `Reading ${points.length + skipped + 1} of ${k} proteins…`;
      try {
        const [info, track, bb] = await Promise.all([
          d.protein(acc),
          d.track(acc),
          loadBackbone(d.base, acc),
        ]);
        if (!info || !bb) {
          skipped++;
          continue;
        }
        const acts = decode(track, fid);
        const r = localityRatios(bb, acts);
        if (!r) {
          skipped++;
          continue;
        }
        points.push({ acc, name: info.n, ...r });
      } catch {
        skipped++;
      }
    }

    body.textContent = '';
    if (points.length === 0) {
      body.append(
        el(
          'p',
          'small muted',
          'None of those proteins could be measured. A protein needs a model in this tree, and ' +
            `the latent has to fire on at least ${MIN_FIRING} of its residues above 0.3 of its ` +
            'maximum.',
        ),
      );
      return;
    }
    body.append(plot(points));

    // A stretch is decided by the sequence ratio alone. A chain that is close along its length
    // is usually close in space too, but not always: latent 7489 on a collagen-like domain sits
    // at 0.06 in sequence and 1.49 in space, because a collagen helix is extended. Testing both
    // ratios put that case, and every reader of a contiguous domain, in the leftover bucket.
    const stretch = points.filter((p) => p.seq < SEQ_LOCAL).length;
    const pocket = points.filter((p) => p.seq >= SEQ_LOCAL && p.space < SPACE_LOCAL).length;
    const neither = points.length - pocket - stretch;
    body.append(
      figures(
        [
          [String(stretch), 'read one stretch of the chain'],
          [String(pocket), 'read a site in the fold'],
          [String(neither), 'read neither'],
        ],
        `${points.length} proteins measured, ${skipped} skipped. A protein is skipped when this ` +
          `tree holds no model for it, or when the latent fires on fewer than ${MIN_FIRING} of ` +
          'its residues. The proteins are the ones this latent fires hardest on, so they are ' +
          'not a random sample of the proteins it touches.',
      ),
    );
  }

  return { root };
}

/** One latent's activation at every residue. The same decode `Data.activationOf` does. */
function decode(
  t: { length: number; indptr: Uint32Array; latent: Uint16Array; value: Uint8Array },
  fid: number,
): Uint8Array {
  const out = new Uint8Array(t.length);
  for (let r = 0; r < t.length; r++) {
    for (let i = t.indptr[r]; i < t.indptr[r + 1]; i++) {
      if (t.latent[i] === fid) {
        out[r] = t.value[i];
        break;
      }
    }
  }
  return out;
}

function plot(points: Point[]): HTMLElement {
  const ns = 'http://www.w3.org/2000/svg';
  const W = 560;
  const H = 300;
  const PL = 52;
  const PR = 16;
  const PT = 16;
  const PB = 44;
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

  const hi = Math.max(1.25, ...points.map((p) => Math.max(p.seq, p.space)));
  const X = (v: number) => PL + (iw * Math.min(v, hi)) / hi;
  const Y = (v: number) => PT + ih - (ih * Math.min(v, hi)) / hi;

  for (let g = 0; g <= hi + 0.001; g += 0.25) {
    add('line', { x1: X(g), y1: PT, x2: X(g), y2: PT + ih, stroke: 'var(--line)' });
    add('line', { x1: PL, y1: Y(g), x2: PL + iw, y2: Y(g), stroke: 'var(--line)' });
    add(
      'text',
      { x: X(g), y: H - PB + 13, 'text-anchor': 'middle', fill: 'var(--muted)', 'font-size': 9 },
      g.toFixed(2),
    );
    add(
      'text',
      { x: PL - 6, y: Y(g) + 3, 'text-anchor': 'end', fill: 'var(--muted)', 'font-size': 9 },
      g.toFixed(2),
    );
  }

  // The line where the firing residues are spread exactly like the protein itself.
  add('line', {
    x1: X(1), y1: PT, x2: X(1), y2: PT + ih, stroke: 'var(--line-strong)', 'stroke-dasharray': '3 3',
  });
  add('line', {
    x1: PL, y1: Y(1), x2: PL + iw, y2: Y(1), stroke: 'var(--line-strong)', 'stroke-dasharray': '3 3',
  });

  // The corner that the sequence views cannot show.
  add('rect', {
    x: X(SEQ_LOCAL), y: Y(SPACE_LOCAL), width: X(hi) - X(SEQ_LOCAL), height: Y(0) - Y(SPACE_LOCAL),
    fill: 'var(--accent)', 'fill-opacity': 0.09,
  });
  // The band that holds every reader of a contiguous stretch, whatever its spread in space.
  add('rect', {
    x: PL, y: PT, width: X(SEQ_LOCAL) - PL, height: ih,
    fill: 'var(--ink-2)', 'fill-opacity': 0.05,
  });

  for (const p of points) {
    const dot = add('circle', {
      cx: X(p.seq).toFixed(1), cy: Y(p.space).toFixed(1), r: 3.4,
      fill:
        p.seq >= SEQ_LOCAL && p.space < SPACE_LOCAL
          ? 'var(--accent)'
          : p.seq < SEQ_LOCAL
            ? 'var(--ink-2)'
            : 'var(--signal)',
      'fill-opacity': 0.65,
    });
    const t = document.createElementNS(ns, 'title');
    t.textContent =
      `${p.acc}  ${p.name}\n${p.length} residues, ${p.nFiring} firing\n` +
      `sequence ${p.seq.toFixed(2)}, space ${p.space.toFixed(2)} of the protein’s own spread`;
    dot.append(t);
  }

  add(
    'text',
    { x: PL + iw / 2, y: H - 4, 'text-anchor': 'middle', fill: 'var(--muted)', 'font-size': 9 },
    'spread along the chain, over the protein’s own spread',
  );
  const rot = add(
    'text',
    { x: 12, y: PT + ih / 2, 'text-anchor': 'middle', fill: 'var(--muted)', 'font-size': 9 },
    'spread in space, over the protein’s own spread',
  );
  rot.setAttribute('transform', `rotate(-90 12 ${PT + ih / 2})`);

  const wrap = el('div');
  wrap.append(svg);
  const key = el('dl', 'cornerkey');
  const put = (k: string, v: string) => {
    key.append(el('dt', undefined, k));
    key.append(el('dd', undefined, v));
  };
  put(
    'left band',
    'close along the chain. The latent reads one stretch. Its spread in space follows from the ' +
      'fold and can be anything.',
  );
  put(
    'lower right',
    'spread along the chain and close in space. The latent reads one site in the fold. The ' +
      'letter row shows this case as scatter and cannot tell it from noise.',
  );
  put('upper right', 'spread both ways. The latent is not reading one place on that protein.');
  wrap.append(key);
  const note = el('p', 'small muted');
  const sw = el('span', 'inlinekey');
  sw.style.background = cssVar('--accent');
  note.append(
    sw,
    ` A site in the fold. ${num(points.length)} proteins in total. Point at a dot for its ` +
      'accession and its counts.',
  );
  wrap.append(note);
  return wrap;
}
