/**
 * One latent: what it responds to, where in the encoder it lives, and the proteins it fires on.
 *
 * The protein list is the complete ranking and not a sample of it, so the activation bands are
 * percentile slices of the real distribution. That is also what makes the band panel a
 * measurement rather than five examples: every protein in a band is counted.
 *
 * The route is `#/latent/<id>`. `#/feature/<id>` still resolves, because links were sent with it.
 */

import { Data, type Concept, type Feature, type Ranking } from '../data';
import { localityView } from '../locality';
import { currentStructure, drawStructure } from '../structpanel';
import { latentLocalityPlot } from '../locality3d';
import {
  cssVar, el, figures, holdHeight, link, num, panel, pct, row, stepper, table,
} from '../ui';

const BANDS: [string, number, number][] = [
  ['strongest', 0.8, 1.0],
  ['0.6 to 0.8', 0.6, 0.8],
  ['0.4 to 0.6', 0.4, 0.6],
  ['0.2 to 0.4', 0.2, 0.4],
  ['weakest', 0.0, 0.2],
];

const PAGE = 25;

export async function renderFeature(d: Data, fid: number, host: HTMLElement): Promise<void> {
  host.textContent = '';
  const f = d.featureById.get(fid);
  if (!f) {
    host.append(
      el('p', 'loading', `Latent ${fid} is dead. It never fires on the evaluation set.`),
    );
    return;
  }
  const views = el('div', 'views');
  host.append(views);

  // Every concept this latent pairs with, not only the best one. 58 of the 1020 paired latents
  // pair with more than one concept, and three of them with three.
  const paired: { concept: Concept; f1: number; prec: number; rec: number }[] = [];
  for (const c of d.concepts) {
    for (const [g, f1, prec, rec] of c.feats ?? []) {
      if (g === fid) paired.push({ concept: c, f1, prec, rec });
    }
  }
  paired.sort((a, b) => b.f1 - a.f1);

  const p = panel('Latent', `f/${fid}`);
  const lede = el('p', 'lede');
  if (paired.length === 0) {
    lede.append('No Swiss-Prot concept in this evaluation set pairs with this latent.');
  } else if (paired.length === 1) {
    lede.append('It pairs with ', conceptLink(paired[0].concept), '.');
  } else {
    lede.append(`It pairs with ${paired.length} concepts: `);
    paired.forEach((x, i) => {
      if (i) lede.append(', ');
      lede.append(conceptLink(x.concept));
    });
    lede.append('.');
  }
  p.append(lede);
  p.append(
    figures([
      ...(paired.length ? ([[paired[0].f1.toFixed(3), 'best F1 per domain']] as [string, string][]) : []),
      [`${f.pk} of ${d.nLayers}`, 'peak encoder layer'],
      [String(f.sp), 'layers at half that strength'],
      [pct(f.pp, 2), 'of proteins it fires on'],
      [pct(f.pw), 'of a protein it covers'],
    ]),
  );

  if (paired.length > 1) {
    const { root, body } = table(
      ['Concept', 'F1 per domain', 'Precision', 'Recall per residue'],
      [0],
    );
    for (const x of paired) {
      body.append(
        row(
          [
            conceptLink(x.concept),
            x.f1.toFixed(3),
            x.prec.toFixed(3),
            x.rec.toFixed(3),
          ],
          [0],
          [x.concept.c.toLowerCase(), x.f1, x.prec, x.rec],
        ),
      );
    }
    const sc = el('div', 'tbl-scroll');
    sc.append(root);
    p.append(sc);
    p.append(
      el(
        'p',
        'small muted',
        'This latent clears the pairing cut for more than one concept. That can mean the ' +
          'concepts overlap in Swiss-Prot, or that the latent reads something the two share.',
      ),
    );
  } else if (paired.length === 1) {
    const c = paired[0].concept;
    if (c.nf > 1) {
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

  // Where this latent sits among all 8128, on the two numbers that say how selective it is.
  const placePanel = panel(
    'How selective it is',
    'This latent against all 8128',
    'Across: the share of the 207,463 proteins it fires on. Up: the share of a protein it ' +
      'covers when it does fire. A specific latent sits at the bottom left. A latent in the top ' +
      'right fires on everything and covers most of it, which no annotation can name.',
  );
  placePanel.append(selectivityPlot(d, f));
  views.append(placePanel);

  const grid = el('div', 'grid2');
  const leftCol = el('div', 'views');
  const depthPanel = panel('Depth', 'Where it lives in the encoder');
  depthPanel.append(depthChart(d, f));
  leftCol.append(depthPanel);

  // Sequence against space, under the depth chart, because the left column was otherwise short
  // and the two answer the same kind of question about one latent.
  const spacePanel = panel(
    'Locality',
    'A stretch of the chain, or a site in the fold',
    'One dot for each live latent. Across: how far apart its firing residues are along the ' +
      'chain. Up: how far apart they are in space. Both are divided by the same spread over the ' +
      'whole protein, so 1 means the firing residues are spread like the protein itself.',
  );
  spacePanel.append(latentLocalityPlot(d, f));
  leftCol.append(spacePanel);
  grid.append(leftCol);

  const listPanel = panel('Proteins', 'Where it fires');
  const listBody = el('div');
  listPanel.append(listBody);
  grid.append(listPanel);
  views.append(grid);

  const locPanel = panel(
    'Which residues',
    'The firing site, in place',
    'The top bar is the whole protein, so the firing site can be seen against the residues the ' +
      'latent ignores. The row below shows the amino-acid letters, one cell for each residue.',
  );
  const locChooser = el('div', 'chips');
  const locBody = el('div');
  locPanel.append(locChooser, locBody);
  views.append(locPanel);

  const evPanel = panel(
    'Evidence',
    'What changes as the activation gets weaker',
    'Every protein this latent fires on, cut into five bands by how hard it fires. Each bar ' +
      'counts only the proteins inside its own band, so the five bars do not add up to 100%.',
  );
  const evBody = el('div');
  evPanel.append(evBody);
  views.append(evPanel);

  const rank = await d.ranking(fid);

  // ---- the protein list, with filters ----------------------------------
  const carrierSet = new Set<number>();
  const bestConcept = paired[0]?.concept;
  if (bestConcept?.po) {
    for (let i = bestConcept.po[0]; i < bestConcept.po[1]; i++) {
      carrierSet.add(d.conceptProtein[i]);
    }
  }
  drawProteinList(d, fid, rank, carrierSet, bestConcept, listBody);

  // The locality view reads one protein at a time, so the chooser lists the ranked proteins that
  // have a track. Their order is the ranking, so the first is the strongest.
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
        // Stepping is faster than a fetch, so a later pick must not be overwritten by an earlier
        // one that finished after it.
        const mine = ++pending;
        const release = holdHeight(locBody);
        void drawLocality(d, f, fid, acc, locBody, () => mine === pending).finally(release);
      }),
    );
  }

  // ---- the bands -------------------------------------------------------
  evBody.append(bandChart(bandStats(d, f, rank), paired[0]?.concept));
}

function conceptLink(c: Concept): HTMLAnchorElement {
  return link(`/concept/${encodeURIComponent(c.c)}`, c.c.replace('_', ' · '));
}

/**
 * The ranked protein list, filtered rather than truncated.
 *
 * A flat "top 25 of 45,822" answers one question and hides the rest. The two cuts that matter
 * are how hard the latent fires and whether Swiss-Prot annotates the paired concept there. The
 * second one splits the list into the latent's hits and its misses, which is the interesting
 * split and the one no other panel makes.
 */
function drawProteinList(
  d: Data,
  fid: number,
  rank: Ranking,
  carrierSet: Set<number>,
  concept: Concept | undefined,
  host: HTMLElement,
): void {
  let band = -1;
  const carrierFilter: 'any' | 'yes' | 'no' = 'any';
  let page = 0;

  const controls = el('div', 'chips');
  const carrierRow = el('div', 'chips');
  const caption = el('p', 'small muted');
  const tableHost = el('div');
  const pager = el('div', 'chips');
  host.append(controls, carrierRow, caption, tableHost, pager);

  const bandButtons: HTMLButtonElement[] = [];
  controls.append(el('span', 'small muted', 'activation band:'));
  const allBand = el('button', undefined, 'all');
  allBand.addEventListener('click', () => {
    band = -1;
    page = 0;
    draw();
  });
  bandButtons.push(allBand);
  controls.append(allBand);
  BANDS.forEach(([label], i) => {
    const b = el('button', undefined, label);
    b.addEventListener('click', () => {
      band = i;
      page = 0;
      draw();
    });
    bandButtons.push(b);
    controls.append(b);
  });

  carrierRow.hidden = true;

  function draw(): void {
    const keep: number[] = [];
    for (let i = 0; i < rank.protein.length; i++) {
      const v = rank.value[i] / 255;
      if (band >= 0) {
        const [, lo, hi] = BANDS[band];
        if (!(v > lo && v <= hi)) continue;
      }
      if (carrierFilter !== 'any') {
        const isCarrier = carrierSet.has(rank.protein[i]);
        if (carrierFilter === 'yes' ? !isCarrier : isCarrier) continue;
      }
      keep.push(i);
    }
    bandButtons.forEach((b, i) => b.setAttribute('aria-pressed', String(i - 1 === band)));

    const pages = Math.max(1, Math.ceil(keep.length / PAGE));
    page = Math.min(page, pages - 1);
    caption.textContent =
      keep.length === 0
        ? 'No protein passes this filter.'
        : `${num(keep.length)} of ${num(rank.protein.length)} proteins pass. ` +
          `Showing ${page * PAGE + 1} to ${Math.min(keep.length, (page + 1) * PAGE)}, ` +
          'in the default order, which is peak activation, strongest first.';

    tableHost.textContent = '';
    if (keep.length) {
      const headers = concept
        ? ['Protein', 'Peak', 'Covers', 'Annotated']
        : ['Protein', 'Peak', 'Covers'];
      const { root, body } = table(headers, [0]);
      for (const i of keep.slice(page * PAGE, (page + 1) * PAGE)) {
        const acc = d.proteinIds[rank.protein[i]];
        const cells: (Node | string)[] = [
          link(`/protein/${acc}`, acc, 'mono'),
          (rank.value[i] / 255).toFixed(2),
          pct((rank.cover[i] / 255) * 100, 0),
        ];
        const keys: (number | string | undefined)[] = [acc, rank.value[i], rank.cover[i]];
        if (concept) {
          const yes = carrierSet.has(rank.protein[i]);
          cells.push(yes ? 'yes' : 'no');
          keys.push(yes ? 1 : 0);
        }
        body.append(row(cells, [0], keys));
      }
      const sc = el('div', 'tbl-scroll');
      sc.append(root);
      tableHost.append(sc);
    }

    pager.textContent = '';
    if (pages > 1) {
      const prev = el('button', undefined, '‹');
      prev.title = 'previous page';
      prev.addEventListener('click', () => {
        page = (page - 1 + pages) % pages;
        draw();
      });
      const next = el('button', undefined, '›');
      next.title = 'next page';
      next.addEventListener('click', () => {
        page = (page + 1) % pages;
        draw();
      });
      // A jump box as well as the arrows. 6,974 proteins is 279 pages, and nobody presses an
      // arrow 279 times.
      const jump = el('input');
      jump.type = 'number';
      jump.min = '1';
      jump.max = String(pages);
      jump.value = String(page + 1);
      jump.className = 'pagejump';
      jump.setAttribute('aria-label', 'Go to a page');
      jump.addEventListener('change', () => {
        const want = Number(jump.value);
        if (!Number.isFinite(want)) return;
        page = Math.min(pages, Math.max(1, Math.round(want))) - 1;
        draw();
      });
      pager.append(prev, el('span', 'small muted', 'page'), jump,
        el('span', 'small muted', `of ${num(pages)}`), next);
    }
  }

  draw();
}

interface BandStat {
  n: number;
  /** How many of them Swiss-Prot annotates with the latent's paired concept. */
  carriers: number;
  medianCover: number;
}

/**
 * What each band holds, counted over every protein in it.
 *
 * The question a reader has about a weak activation is whether the latent is still right when it
 * fires weakly. That is countable here without a single extra fetch: the ranking file already
 * holds every protein and its peak, and the proteins that carry the paired concept are already
 * in memory.
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
function bandChart(stats: BandStat[], concept: Concept | undefined): HTMLElement {
  const ns = 'http://www.w3.org/2000/svg';
  const W = 620;
  const H = 176;
  const PL = 62;
  const PR = 16;
  const PT = 16;
  const PB = 46;
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
    if (concept && s.n) {
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
      add(
        'text',
        {
          x: x + bw / 2, y: PT + ih - h + 12, 'text-anchor': 'middle', 'font-size': 8.5,
          fill: 'var(--surface)',
        },
        `${num(s.carriers)} of ${num(s.n)}`,
      );
    }
    add(
      'text',
      { x: x + bw / 2, y: H - PB + 13, 'text-anchor': 'middle', 'font-size': 9.5, fill: 'var(--ink-2)' },
      label,
    );
    add(
      'text',
      { x: x + bw / 2, y: H - PB + 26, 'text-anchor': 'middle', 'font-size': 9, fill: 'var(--muted)' },
      `${num(s.n)} proteins`,
    );
  });

  add(
    'text',
    { x: PL + iw / 2, y: H - 4, 'text-anchor': 'middle', 'font-size': 9, fill: 'var(--muted)' },
    'how hard the latent fires, as a share of its hardest anywhere',
  );
  if (concept) {
    const rot = add(
      'text',
      { x: 12, y: PT + ih / 2, 'text-anchor': 'middle', 'font-size': 9, fill: 'var(--muted)' },
      'share of that band that carries the concept',
    );
    rot.setAttribute('transform', `rotate(-90 12 ${PT + ih / 2})`);
  }

  const wrap = el('div');
  wrap.append(svg);
  if (!concept) {
    wrap.append(
      el(
        'p',
        'small muted',
        'No concept pairs with this latent, so there is nothing to be right about. The protein ' +
          'counts under each band still hold.',
      ),
    );
    return wrap;
  }
  const first = shares[0];
  const last = shares[shares.length - 1];
  wrap.append(
    el(
      'h3',
      'sub',
      `Share of each band that Swiss-Prot annotates with ${concept.c.replace('_', ' · ')}`,
    ),
  );
  wrap.append(
    el(
      'p',
      'small muted',
      (first > last * 1.5
        ? `This latent is right for ${first.toFixed(0)}% of the proteins where it fires hardest, ` +
          `and for ${last.toFixed(1)}% where it fires weakest. A weak activation from this ` +
          'latent carries much less.'
        : `The share barely changes across the bands, from ${first.toFixed(0)}% at the strongest ` +
          `to ${last.toFixed(1)}% at the weakest. How hard this latent fires does not say how ` +
          'likely the annotation is.') +
        ' Each bar counts only the proteins inside its own band, so the five bars have five ' +
        'different denominators and do not add up to 100%.',
    ),
  );
  return wrap;
}

/**
 * Every live latent placed by how widely it fires against how much it covers.
 *
 * InterPLM's dashboard draws the same two numbers. The addition here is that the latent on
 * screen is marked, so the reader can see whether they are looking at a selective latent or at
 * one that fires on almost everything. `f/275` fires on 99.5% of the proteins, and its dot sits
 * alone on the right of this plot.
 */
function selectivityPlot(d: Data, self: Feature): HTMLElement {
  const W = 560;
  const H = 260;
  const PL = 46;
  const PR = 14;
  const PT = 14;
  const PB = 40;
  const iw = W - PL - PR;
  const ih = H - PT - PB;
  const ns = 'http://www.w3.org/2000/svg';
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

  // Both axes are log, because most latents fire on a fraction of a percent of the proteins and
  // a linear axis puts 8000 of them on one pixel column.
  const lx = (v: number) => Math.log10(Math.max(0.0005, v));
  const X = (v: number) => PL + (iw * (lx(v) - lx(0.0005))) / (lx(100) - lx(0.0005));
  const Y = (v: number) => PT + ih - (ih * (lx(v) - lx(0.01))) / (lx(100) - lx(0.01));

  for (const g of [0.001, 0.01, 0.1, 1, 10, 100]) {
    if (g < 0.0005) continue;
    add('line', { x1: X(g), y1: PT, x2: X(g), y2: PT + ih, stroke: 'var(--line)' });
    add(
      'text',
      { x: X(g), y: H - PB + 13, 'text-anchor': 'middle', fill: 'var(--muted)', 'font-size': 9 },
      g >= 1 ? `${g}%` : `${g}%`,
    );
  }
  for (const g of [0.1, 1, 10, 100]) {
    add('line', { x1: PL, y1: Y(g), x2: PL + iw, y2: Y(g), stroke: 'var(--line)' });
    add(
      'text',
      { x: PL - 6, y: Y(g) + 3, 'text-anchor': 'end', fill: 'var(--muted)', 'font-size': 9 },
      `${g}%`,
    );
  }

  for (const pass of [false, true]) {
    for (const f of d.features) {
      if (Boolean(f.c) !== pass) continue;
      if (f.f === self.f) continue;
      add('circle', {
        cx: X(f.pp).toFixed(1), cy: Y(f.pw).toFixed(1), r: 1.7,
        fill: pass ? 'var(--signal)' : 'var(--line-strong)',
        'fill-opacity': pass ? 0.55 : 0.3,
      });
    }
  }
  add('circle', {
    cx: X(self.pp).toFixed(1), cy: Y(self.pw).toFixed(1), r: 5.5,
    fill: 'none', stroke: 'var(--ink)', 'stroke-width': 2,
  });
  add('circle', {
    cx: X(self.pp).toFixed(1), cy: Y(self.pw).toFixed(1), r: 2.4, fill: 'var(--ink)',
  });

  add(
    'text',
    { x: PL + iw / 2, y: H - 4, 'text-anchor': 'middle', fill: 'var(--muted)', 'font-size': 9 },
    'share of the 207,463 proteins it fires on',
  );
  const rot = add(
    'text',
    { x: 11, y: PT + ih / 2, 'text-anchor': 'middle', fill: 'var(--muted)', 'font-size': 9 },
    'share of a protein it covers',
  );
  rot.setAttribute('transform', `rotate(-90 11 ${PT + ih / 2})`);

  const wrap = el('div');
  wrap.append(svg);
  const legend = el('div', 'loc-legend');
  for (const [label, color] of [
    ['pairs with a concept', cssVar('--signal')],
    ['nothing named it', cssVar('--line-strong')],
    ['this latent', cssVar('--ink')],
  ] as [string, string][]) {
    const item = el('span', 'loc-key');
    const sw = el('i');
    sw.style.background = color;
    item.append(sw, label);
    legend.append(item);
  }
  wrap.append(legend);
  // Where this latent sits, in words, because a marked dot on a log scale is hard to read off.
  const wider = d.features.filter((x) => x.pp > self.pp).length;
  wrap.append(
    el(
      'p',
      'small muted',
      `${num(wider)} of the ${num(d.features.length)} live latents fire on more proteins than ` +
        `this one, and ${num(d.features.length - wider - 1)} fire on fewer.`,
    ),
  );
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
    host.append(el('p', 'warn', `This data tree holds no bundle for ${acc}.`));
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
  // Pointing at a letter marks the same residue on the model, which is the reason both views are
  // on one page and not on two.
  loc.onHover((i) => currentStructure()?.highlight(i === null ? null : i + 1));
  await drawStructure(d, acc, acts, host, `f/${fid}`);
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
  solid.append(
    sk,
    ' Solid: the length of the vector this latent adds to each layer, as a share of its ' +
      'longest.',
  );
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
