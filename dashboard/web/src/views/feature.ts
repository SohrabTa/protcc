/**
 * One latent: what it responds to, where in the encoder it lives, and the proteins it fires on.
 *
 * The protein list is the complete ranking, not a sample of it, so the activation bands are
 * percentile slices of the real distribution rather than a reservoir sample. That is also what
 * makes the band panel a measurement rather than five examples: every protein in a band is
 * counted, and only three of them are drawn.
 */

import { Data, type Feature, type Ranking } from '../data';
import { localityView } from '../locality';
import { currentStructure, drawStructure } from '../structpanel';
import {
  activationStrip, cssVar, el, figures, holdHeight, link, num, panel, pct, redrawStrips, row,
  stepper, table,
} from '../ui';

const BANDS: [string, number, number][] = [
  ['strongest', 0.8, 1.0],
  ['0.6 to 0.8', 0.6, 0.8],
  ['0.4 to 0.6', 0.4, 0.6],
  ['0.2 to 0.4', 0.2, 0.4],
  ['weakest', 0.0, 0.2],
];

const EXAMPLES = 3; // strips drawn per band. The numbers above them count every protein.

export async function renderFeature(d: Data, fid: number, host: HTMLElement): Promise<void> {
  host.textContent = '';
  const f = d.featureById.get(fid);
  if (!f) {
    host.append(
      el('p', 'loading', `Latent ${fid} is dead: it never fires on the evaluation set.`),
    );
    return;
  }
  const views = el('div', 'views');
  host.append(views);

  const p = panel('Latent', `f/${fid}`);
  const lede = el('p', 'lede');
  if (f.c) {
    lede.append(
      'Best paired with ',
      link(`/concept/${encodeURIComponent(f.c)}`, f.c.replace('_', ' · ')),
      '.',
    );
  } else {
    lede.append('No Swiss-Prot concept in this evaluation set pairs with this latent.');
  }
  p.append(lede);
  p.append(
    figures([
      ...(f.c ? ([[f.f1!.toFixed(3), 'F1 per domain']] as [string, string][]) : []),
      [`${f.pk} of ${d.nLayers}`, 'peak encoder layer'],
      [String(f.sp), 'layers at half that strength'],
      [pct(f.pp, 2), 'of proteins it fires on'],
      [pct(f.pw), 'of a protein it covers'],
    ]),
  );
  if (f.c) {
    const c = d.conceptByName.get(f.c);
    if (c && c.nf > 1) {
      const other = el('p', 'small muted');
      other.append(
        `${c.nf - 1} other latent${c.nf === 2 ? '' : 's'} also pair with that concept. `,
        link(`/concept/${encodeURIComponent(c.c)}`, 'See them side by side'),
        '.',
      );
      p.append(other);
    }
  }
  views.append(p);

  const grid = el('div', 'grid2');
  const depthPanel = panel('Depth', 'Where it lives in the encoder');
  depthPanel.append(depthChart(d, f));
  grid.append(depthPanel);

  const listPanel = panel('Proteins', 'Where it fires');
  const listBody = el('div');
  listPanel.append(listBody);
  grid.append(listPanel);
  views.append(grid);

  const locPanel = panel(
    'Which residues',
    'The firing site, in place',
    'The whole protein stays on screen above the letters, so a latent that fires on a few ' +
      'residues can be told apart from one that fires everywhere.',
  );
  const locChooser = el('div', 'chips');
  const locBody = el('div');
  locPanel.append(locChooser, locBody);
  views.append(locPanel);

  const evPanel = panel(
    'Evidence',
    'What changes as the activation gets weaker',
    'Every protein this latent fires on, cut into five bands by how hard it fires. The bars ' +
      'count all of them. The strips below draw three.',
  );
  const evHead = el('div');
  const bandRow = el('div', 'chips');
  const evBody = el('div');
  evPanel.append(evHead, bandRow, evBody);
  views.append(evPanel);

  const rank = await d.ranking(fid);

  const shownRows = Math.min(25, rank.protein.length);
  listBody.append(
    el(
      'p',
      'small muted',
      `The ${shownRows} strongest of ${num(rank.protein.length)} proteins. ` +
        'A column sorts these rows, not the whole ranking.',
    ),
  );
  const { root, body } = table(['Protein', 'Peak', 'Covers'], [0]);
  for (let i = 0; i < shownRows; i++) {
    const acc = d.proteinIds[rank.protein[i]];
    body.append(
      row(
        [
          link(`/protein/${acc}`, acc, 'mono'),
          (rank.value[i] / 255).toFixed(2),
          pct((rank.cover[i] / 255) * 100, 0),
        ],
        [0],
        [acc, rank.value[i], rank.cover[i]],
      ),
    );
  }
  const scroll = el('div', 'tbl-scroll');
  scroll.append(root);
  listBody.append(scroll);

  // The locality view reads one protein at a time, so the chooser lists the ranked proteins
  // that have a track. Their order is the ranking, so the first is the strongest.
  const withTrack: string[] = [];
  for (let i = 0; i < rank.protein.length && withTrack.length < 40; i++) {
    const acc = d.proteinIds[rank.protein[i]];
    if (d.hasTrack(acc)) withTrack.push(acc);
  }
  if (withTrack.length === 0) {
    locBody.append(
      el('p', 'warn', 'No protein this latent fires on has a per-residue track in this tree.'),
    );
  } else {
    let pending = 0;
    locChooser.append(
      stepper(withTrack, 'protein', (acc) => {
        // Stepping is faster than a fetch, so a later pick must not be overwritten by an
        // earlier one that finished after it.
        const mine = ++pending;
        const release = holdHeight(locBody);
        void drawLocality(d, f, fid, acc, locBody, () => mine === pending).finally(release);
      }),
    );
  }

  // ---- the bands -------------------------------------------------------
  const stats = bandStats(d, f, rank);
  evHead.append(bandChart(stats, f));

  let band = 0;
  for (let i = 0; i < BANDS.length; i++) {
    const b = el('button', undefined, `${BANDS[i][0]} (${num(stats[i].n)})`);
    b.setAttribute('aria-pressed', String(i === band));
    b.addEventListener('click', () => {
      band = i;
      bandRow.querySelectorAll('button').forEach((x, j) =>
        x.setAttribute('aria-pressed', String(j === band)),
      );
      const release = holdHeight(evBody);
      void drawBand(d, fid, rank, band, evBody).finally(release);
    });
    bandRow.append(b);
  }
  await drawBand(d, fid, rank, band, evBody);
}

interface BandStat {
  n: number;
  /** How many of them Swiss-Prot annotates with the latent's paired concept. */
  carriers: number;
  /** Median share of the protein the latent covers, over the band. */
  medianCover: number;
}

/**
 * What each band holds, counted over every protein in it.
 *
 * The panel used to draw five example strips per band and say nothing else, and five proteins
 * chosen by rank order tell no story. The question a reader actually has about a weak activation
 * is whether the latent is still right when it fires weakly. That is countable here without a
 * single extra fetch: the ranking file already holds every protein and its peak, and the list of
 * proteins carrying the paired concept is already in memory.
 */
function bandStats(d: Data, f: Feature, rank: Ranking): BandStat[] {
  const concept = f.c ? d.conceptByName.get(f.c) : undefined;
  const carrierSet = new Set<number>();
  if (concept?.po) {
    for (let i = concept.po[0]; i < concept.po[1]; i++) carrierSet.add(d.conceptProtein[i]);
  }
  const out: BandStat[] = BANDS.map(() => ({ n: 0, carriers: 0, medianCover: 0 }));
  const covers: number[][] = BANDS.map(() => []);
  for (let i = 0; i < rank.protein.length; i++) {
    const v = rank.value[i] / 255;
    const b = BANDS.findIndex(([, lo, hi]) => v > lo && v <= hi);
    if (b < 0) continue;
    out[b].n++;
    if (carrierSet.has(rank.protein[i])) out[b].carriers++;
    covers[b].push(rank.cover[i]);
  }
  for (let b = 0; b < BANDS.length; b++) {
    const xs = covers[b];
    if (!xs.length) continue;
    xs.sort((x, y) => x - y);
    const m = xs.length >> 1;
    out[b].medianCover = ((xs.length % 2 ? xs[m] : (xs[m - 1] + xs[m]) / 2) / 255) * 100;
  }
  return out;
}

/** The bands as bars: how many proteins, and how often the annotation is really there. */
function bandChart(stats: BandStat[], f: Feature): HTMLElement {
  const ns = 'http://www.w3.org/2000/svg';
  const W = 620;
  const H = 168;
  const PL = 40;
  const PR = 150;
  const PT = 14;
  const PB = 34;
  const iw = W - PL - PR;
  const ih = H - PT - PB;
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('width', '100%');
  svg.style.display = 'block';
  svg.style.marginTop = '6px';
  const add = (t: string, a: Record<string, string | number>, text?: string) => {
    const n = document.createElementNS(ns, t);
    for (const [k, v] of Object.entries(a)) n.setAttribute(k, String(v));
    if (text !== undefined) n.textContent = text;
    svg.append(n);
    return n;
  };

  const hasConcept = Boolean(f.c);
  const shares = stats.map((s) => (s.n ? (s.carriers / s.n) * 100 : 0));
  const maxShare = Math.max(10, ...shares);
  const bw = iw / BANDS.length;

  for (const g of [0, 0.5, 1]) {
    const y = PT + ih - ih * g;
    add('line', { x1: PL, y1: y, x2: PL + iw, y2: y, stroke: 'var(--line)' });
    add(
      'text',
      { x: PL - 6, y: y + 3, 'text-anchor': 'end', fill: 'var(--muted)', 'font-size': 9 },
      `${Math.round(maxShare * g)}%`,
    );
  }

  BANDS.forEach(([label], i) => {
    const x = PL + i * bw;
    const s = stats[i];
    if (hasConcept && s.n) {
      const h = (ih * shares[i]) / maxShare;
      add('rect', {
        x: x + bw * 0.18, y: PT + ih - h, width: bw * 0.64, height: Math.max(1, h),
        fill: 'var(--accent)', rx: 1,
      });
      add(
        'text',
        {
          x: x + bw / 2, y: PT + ih - h - 4, 'text-anchor': 'middle', 'font-size': 9,
          fill: 'var(--ink-2)',
        },
        `${shares[i].toFixed(shares[i] < 10 ? 1 : 0)}%`,
      );
    }
    add(
      'text',
      { x: x + bw / 2, y: H - PB + 12, 'text-anchor': 'middle', 'font-size': 9, fill: 'var(--muted)' },
      label,
    );
    add(
      'text',
      { x: x + bw / 2, y: H - PB + 24, 'text-anchor': 'middle', 'font-size': 9, fill: 'var(--muted)' },
      num(s.n),
    );
  });

  add(
    'text',
    { x: PL + iw + 12, y: PT + 10, 'font-size': 10, fill: 'var(--ink-2)' },
    hasConcept ? 'Share of the proteins in' : 'No paired concept, so there',
  );
  add(
    'text',
    { x: PL + iw + 12, y: PT + 23, 'font-size': 10, fill: 'var(--ink-2)' },
    hasConcept ? 'each band that Swiss-Prot' : 'is nothing to be right about.',
  );
  add(
    'text',
    { x: PL + iw + 12, y: PT + 36, 'font-size': 10, fill: 'var(--ink-2)' },
    hasConcept ? 'annotates with the concept.' : 'The counts still hold.',
  );

  const wrap = el('div');
  wrap.append(svg);
  if (hasConcept) {
    const first = shares[0];
    const last = shares[shares.length - 1];
    wrap.append(
      el(
        'p',
        'small muted',
        first > last * 1.5
          ? `The latent is right ${first.toFixed(0)}% of the time where it fires hardest and ` +
            `${last.toFixed(1)}% where it fires weakest. A weak activation from this latent ` +
            'carries much less.'
          : `The share barely changes across the bands, from ${first.toFixed(0)}% at the ` +
            `strongest to ${last.toFixed(1)}% at the weakest. How hard this latent fires does ` +
            'not say how likely the annotation is.',
      ),
    );
  }
  // A colour reference, so the bar is read against the same accent the annotation strips use.
  const key = el('p', 'small muted');
  const sw = el('span', 'inlinekey');
  sw.style.background = cssVar('--accent');
  key.append(sw, ' the same teal the Swiss-Prot rows use');
  wrap.append(key);
  return wrap;
}

async function drawLocality(
  d: Data,
  f: Feature,
  fid: number,
  acc: string,
  host: HTMLElement,
  stillWanted: () => boolean,
): Promise<void> {
  const [info, track] = await Promise.all([d.protein(acc), d.track(acc)]);
  if (!stillWanted()) return;
  host.textContent = '';
  if (!info) {
    host.append(el('p', 'warn', `No bundle for ${acc}.`));
    return;
  }
  const head = el('p', 'small');
  head.append(el('span', 'mono', acc), ` — ${info.n}`);
  host.append(head);

  // The teal band marks the concept this latent pairs with, so the reader can see at a glance
  // whether the letters that fire are the annotated ones.
  const ci = f.c ? d.columnOf(f.c) : null;
  const ranges = ci !== null ? info.c[String(ci)] ?? [] : [];
  const acts = Data.activationOf(track, fid);
  const loc = localityView(info.s, acts, ranges);
  host.append(loc.root);
  loc.mount();
  if (f.c && ranges.length === 0) {
    host.append(
      el('p', 'small muted', `Swiss-Prot does not annotate ${f.c.replace('_', ' · ')} on ${acc}.`),
    );
  }
  // Pointing at a letter marks the same residue on the model, which is the reason both views
  // are on one page rather than two.
  loc.onHover((i) => currentStructure()?.highlight(i === null ? null : i + 1));
  await drawStructure(d, acc, acts, host, `f/${fid}`);
}

async function drawBand(
  d: Data,
  fid: number,
  rank: Ranking,
  band: number,
  host: HTMLElement,
): Promise<void> {
  host.textContent = '';
  const [, lo, hi] = BANDS[band];
  const picked: string[] = [];
  for (let i = 0; i < rank.protein.length && picked.length < EXAMPLES; i++) {
    const v = rank.value[i] / 255;
    if (v > lo && v <= hi) {
      const acc = d.proteinIds[rank.protein[i]];
      if (d.hasTrack(acc)) picked.push(acc);
    }
  }
  if (picked.length === 0) {
    host.append(
      el('p', 'small muted', 'No protein falls in this band, so there is nothing to draw.'),
    );
    return;
  }
  host.append(el('p', 'loading', 'Reading the activations…'));
  const rows = el('div', 'rows');
  for (const acc of picked) {
    const [info, track] = await Promise.all([d.protein(acc), d.track(acc)]);
    if (!info) continue;
    const lab = el('div', 'lab');
    lab.append(link(`/protein/${acc}`, acc, 'mono'));
    lab.title = info.n;
    rows.append(lab, activationStrip(Data.activationOf(track, fid)));
  }
  host.textContent = '';
  host.append(rows);
  redrawStrips(rows);
  host.append(
    el(
      'p',
      'small muted',
      `${picked.length} of the proteins in this band, in rank order. They are examples of what a ` +
        'track at this strength looks like. The bars above are the measurement.',
    ),
  );
}

function depthChart(d: Data, f: Feature): HTMLElement {
  const { norm, cos } = d.depthOf(f.f);
  const ns = 'http://www.w3.org/2000/svg';
  const W = 460;
  const H = 190;
  const PL = 32;
  const PT = 14;
  const PB = 32;
  const iw = W - PL - 12;
  const ih = H - PT - PB;
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('width', '100%');
  svg.style.display = 'block';
  svg.style.marginTop = '8px';
  const add = (t: string, a: Record<string, string | number>, text?: string) => {
    const n = document.createElementNS(ns, t);
    for (const [k, v] of Object.entries(a)) n.setAttribute(k, String(v));
    if (text !== undefined) n.textContent = text;
    svg.append(n);
  };
  const X = (i: number) => PL + (iw * i) / (norm.length - 1);
  const Y = (v: number) => PT + ih - ih * v;
  for (const g of [0, 0.5, 1]) {
    add('line', { x1: PL, y1: Y(g), x2: W - 12, y2: Y(g), stroke: 'var(--line)' });
    add(
      'text',
      { x: PL - 6, y: Y(g) + 3, 'text-anchor': 'end', fill: 'var(--muted)', 'font-size': 9 },
      g.toFixed(1),
    );
  }
  add('line', {
    x1: X(f.pk - 1), y1: PT, x2: X(f.pk - 1), y2: PT + ih,
    stroke: 'var(--signal)', 'stroke-dasharray': '3 3',
  });
  add(
    'text',
    { x: X(f.pk - 1), y: PT - 4, 'text-anchor': 'middle', fill: 'var(--signal)', 'font-size': 9 },
    `peak ${f.pk}`,
  );
  const path = (vals: number[], map: (v: number) => number) =>
    vals.map((v, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(map(v)).toFixed(1)}`).join('');
  add('path', {
    d: path(norm, (v) => v), fill: 'none', stroke: 'var(--accent)', 'stroke-width': 1.8,
  });
  add('path', {
    d: path(cos, (v) => (v + 1) / 2), fill: 'none', stroke: 'var(--muted)',
    'stroke-width': 1.6, 'stroke-dasharray': '4 3',
  });
  for (const l of [1, 6, 12, 18, 24]) {
    add(
      'text',
      { x: X(l - 1), y: H - 14, 'text-anchor': 'middle', fill: 'var(--muted)', 'font-size': 9 },
      String(l),
    );
  }
  add(
    'text',
    { x: PL + iw / 2, y: H - 2, 'text-anchor': 'middle', fill: 'var(--muted)', 'font-size': 9 },
    'encoder layer',
  );
  const wrap = el('div');
  wrap.append(svg);

  const solid = el('p', 'small muted');
  const sk = el('span', 'inlinekey');
  sk.style.background = cssVar('--accent');
  solid.append(sk, ' Solid: the strength the latent writes into each layer, as a share of its ' +
    'strongest layer.');
  const dashed = el('p', 'small muted');
  const dk = el('span', 'inlinekey dashed');
  dashed.append(
    dk,
    ' Dashed: the cosine similarity between each layer’s direction and the peak layer’s. ' +
      '1 is the same direction, 0 is unrelated.',
  );
  wrap.append(solid, dashed);
  return wrap;
}
