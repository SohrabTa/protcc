/**
 * One latent: what it pairs with, what it fires on, where in the encoder it lives, how selective
 * it is, and the proteins it fires on.
 *
 * The order follows the questions of a reader, as in the feature pages of Bricken et al. (2023)
 * and sae_vis: the label and its score first, then the examples, then the one protein in place,
 * then the statistics. The full protein list is last, because it is a reference and not a reading.
 *
 * The protein list is the complete ranking and not a sample of it, so a peak range is a slice of
 * the real distribution, and the Evidence panel counts every protein in a range.
 *
 * The route is `#/latent/<id>`. `#/feature/<id>` still resolves, because links were sent with it.
 */

import { Data, type Concept, type Feature, type LatentPair, type Ranking } from '../data';
import { localityHowto, localityView } from '../locality';
import { currentStructure, drawStructure } from '../structpanel';
import { latentLocalityPlot } from '../locality3d';
import { conceptBadge, conceptName } from '../pairs';
import {
  cssVar, el, figures, holdHeight, howto, infoButton, inkOn, link, num, panel, pct, rampRGB, row,
  stepper, table, uniprotLink,
} from '../ui';

/**
 * The five ranges of a protein's peak, as a share of the latent's strongest anywhere.
 *
 * They are the five of InterPLM's dashboard (`lower_quantile_thresholds` in
 * `interplm/analysis/per_protein_tracking.py`). InterPLM calls them quantiles, but they are equal
 * steps of the value, so each range holds as many proteins as fall in it. A peak belongs to a
 * range when it is above the lower end and at most the upper end, as there.
 */
const RANGES: { label: string; lo: number; hi: number }[] = [
  { label: '0.8 to 1.0', lo: 0.8, hi: 1.0 },
  { label: '0.6 to 0.8', lo: 0.6, hi: 0.8 },
  { label: '0.4 to 0.6', lo: 0.4, hi: 0.6 },
  { label: '0.2 to 0.4', lo: 0.2, hi: 0.4 },
  { label: '0 to 0.2', lo: 0, hi: 0.2 },
];

const PAGE = 25;

/** How many proteins one group of examples shows. */
const EXAMPLES = 10;

/** Residues on each side of the strongest residue in one example row. */
const FLANK = 30;

/** What the page needs to know about each ranked protein, counted once for all panels. */
interface RankedProteins {
  rank: Ranking;
  /** The peak range of each protein, an index into RANGES. */
  range: Int8Array;
  /** How many proteins fall in each range. */
  counts: number[];
  /** For each paired concept, 1 where Swiss-Prot annotates it on the protein. */
  annotated: Uint8Array[];
}

function countRanked(d: Data, rank: Ranking, paired: LatentPair[]): RankedProteins {
  const n = rank.protein.length;
  const range = new Int8Array(n);
  const counts = RANGES.map(() => 0);
  for (let i = 0; i < n; i++) {
    const peak = rank.value[i] / 255;
    const r = RANGES.findIndex((x) => peak > x.lo && peak <= x.hi);
    // A peak that rounds to 0 is still a firing, so it goes to the lowest range.
    range[i] = r === -1 ? RANGES.length - 1 : r;
    counts[range[i]]++;
  }
  const annotated = paired.map(({ concept }) => {
    const carriers = new Set<number>();
    if (concept.po) {
      for (let i = concept.po[0]; i < concept.po[1]; i++) carriers.add(d.conceptProtein[i]);
    }
    return Uint8Array.from(rank.protein, (p) => (carriers.has(p) ? 1 : 0));
  });
  return { rank, range, counts, annotated };
}

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

  // Every concept this latent pairs with, the best by F1 per domain first.
  const paired = d.pairsOf(fid);
  views.append(latentPanel(d, f, paired));

  const exPanel = panel(
    'Examples',
    'What it fires on',
    `The ${EXAMPLES} proteins it fires on most strongly, cut to ${2 * FLANK + 1} residues ` +
      'around the strongest residue. The ranges below show weaker examples.',
  );
  views.append(exPanel);

  const resPanel = panel(
    'Which residues',
    'The firing site, in place',
    'Where on one protein this latent fires, against the residues it ignores.',
  );
  resPanel.classList.add('evpanel');
  resPanel.append(
    howto(
      'Click an example above to show its protein here, or step through the proteins with the ' +
        'arrows, in the order of the Proteins panel. ' +
        (paired.length > 1 ? 'Pick a concept to mark its residues in teal. ' : '') +
        localityHowto(paired.length > 0),
    ),
  );
  const resChooser = el('div', 'chips');
  const resMark = el('div', 'chips');
  const resBody = el('div');
  resPanel.append(resChooser, resMark, resBody);
  views.append(resPanel);

  const evPanel = panel('Evidence', 'Is the concept still there when it fires weakly?');
  evPanel.classList.add('evpanel');
  views.append(evPanel);

  const grid = el('div', 'grid2');
  grid.append(depthPanel(d, f), selectivityPanel(d, f));
  views.append(grid);

  const spacePanel = panel('Locality', 'A stretch of the chain, or a site in the fold');
  spacePanel.append(
    howto(
      'One dot for each live latent. A dot near the left fires on residues that are neighbours ' +
        'in the chain. A dot near the bottom fires on residues that are together in space. ' +
        'Both axes are divided by the same spread over the whole protein, so 1 is as far apart ' +
        'as the protein itself. Point at a dot to name its latent, and click it to open it.',
    ),
    latentLocalityPlot(d, f),
  );
  views.append(spacePanel);

  const listPanel = panel('Proteins', 'Every protein it fires on');
  views.append(listPanel);

  const ranked = countRanked(d, await d.ranking(fid), paired);
  const show = drawResidues(d, f, ranked.rank, paired, resChooser, resMark, resBody);
  drawExamples(d, f, ranked, paired, exPanel, (acc) => {
    if (show(acc)) resPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  drawEvidence(ranked, paired, evPanel);
  drawProteinList(d, ranked, paired, listPanel);
}

function conceptLink(c: Concept): HTMLAnchorElement {
  return link(`/concept/${encodeURIComponent(c.c)}`, conceptName(c.c));
}

/** A concept name, with its number in front when the latent has more than one concept. */
function namedConcept(paired: LatentPair[], i: number, asLink: boolean): HTMLElement {
  const box = el('span', 'cname');
  if (paired.length > 1) box.append(conceptBadge(i, paired[i].concept.c));
  box.append(asLink ? conceptLink(paired[i].concept) : conceptName(paired[i].concept.c));
  return box;
}

/** The concepts this latent pairs with, the scores of each pair, and three numbers about it. */
function latentPanel(d: Data, f: Feature, paired: LatentPair[]): HTMLElement {
  const p = panel('Latent', `f/${f.f}`);
  // The same three numbers on every latent, so that a latent with no concept still says what it is.
  p.append(
    figures([
      [num(f.np), `proteins it fires on, ${pct(f.pp, 2)} of ${num(d.manifest.counts.proteins)}`],
      [pct(f.pw), 'of a protein it covers, as the mean'],
      [`${f.pk} of ${d.nLayers}`, 'peak layer in the encoder'],
    ]),
  );
  if (paired.length === 0) {
    p.append(
      el('p', 'lede', 'No Swiss-Prot concept in this evaluation set pairs with this latent.'),
    );
    return p;
  }
  p.append(
    el(
      'p',
      'lede',
      (paired.length === 1
        ? 'It pairs with one Swiss-Prot concept. '
        : `It pairs with ${paired.length} Swiss-Prot concepts. Their numbers mark them on the ` +
          'rest of this page. ') + 'Click a concept to see all its latents side by side.',
    ),
  );
  const { root, body } = table(
    ['Concept', 'F1 per domain', 'Precision', 'Recall per domain', 'Recall per residue', 'Latents'],
    [0],
  );
  paired.forEach((x, i) => {
    body.append(
      row(
        [
          namedConcept(paired, i, true),
          x.f1.toFixed(3),
          x.prec.toFixed(3),
          x.recd !== undefined ? x.recd.toFixed(3) : '—',
          x.rec.toFixed(3),
          String(x.concept.nf),
        ],
        [0],
        [x.concept.c.toLowerCase(), x.f1, x.prec, x.recd, x.rec, x.concept.nf],
      ),
    );
  });
  const sc = el('div', 'tbl-scroll');
  sc.append(root);
  p.append(sc);
  if (paired.length > 1) {
    p.append(
      el(
        'p',
        'small muted',
        'This latent clears the pairing cut for more than one concept. That can mean the ' +
          'concepts overlap in Swiss-Prot, or that the latent reads something the two share.',
      ),
    );
  }
  return p;
}

function depthPanel(d: Data, f: Feature): HTMLElement {
  const p = panel(
    'Depth',
    'Where it lives in the ProtT5 encoder',
    `How strongly this latent writes into each of the ${d.nLayers} layers of the ProtT5 encoder.`,
  );
  p.append(
    howto(
      `The crosscoder reads all ${d.nLayers} layers at once. When this latent fires, it adds ` +
        'one vector to the reconstruction of the residual stream of each layer. ' +
        'Solid line: the length of that vector in each layer, as a share of its longest. The ' +
        'longer the vector, the more this latent adds to the reconstruction of that layer. ' +
        'The lengths are corrected for the growth of the residual stream from layer to layer. ' +
        'Dashed line, right axis: the cosine similarity between the vector of this latent in ' +
        'each layer and its vector in the peak layer. 1 is the same direction, 0 is unrelated.',
    ),
    depthChart(d, f),
  );
  const spreads = d.features.map((x) => x.sp).sort((a, b) => a - b);
  const median = spreads[spreads.length >> 1];
  p.append(
    el(
      'p',
      'small',
      `Its vector is longest at layer ${f.pk} of ${d.nLayers}. It keeps at least half of that ` +
        `length over ${f.sp} layers. The median live latent keeps it over ${median}.`,
    ),
  );
  return p;
}

function selectivityPanel(d: Data, f: Feature): HTMLElement {
  const n = d.features.length;
  const proteins = d.manifest.counts.proteins;
  const p = panel('How selective it is', `This latent against all ${num(n)}`);
  p.append(
    howto(
      `One dot for each of the ${num(n)} live latents. The ringed dot is this latent. ` +
        `Across: the share of the ${num(proteins)} proteins that a latent fires on. A dot at ` +
        'the left fires on few proteins, and a dot at the right fires on almost all of them. ' +
        'Up: the share of a protein that a latent covers, as the mean over the proteins it ' +
        'fires on. A dot at the bottom fires on a few residues of each protein, and a dot at ' +
        'the top fires on most of the chain. ' +
        'Thus the most specific latents are at the bottom left. No annotation can name a ' +
        'latent at the top right, because it fires almost everywhere.',
    ),
    selectivityPlot(d, f),
  );
  // Where this latent sits, in words, because a marked dot on a log scale is hard to read off.
  const rank = (value: (x: Feature) => number) => {
    let more = 0;
    let less = 0;
    for (const x of d.features) {
      if (value(x) > value(f)) more++;
      else if (value(x) < value(f)) less++;
    }
    return { more, less, same: n - 1 - more - less };
  };
  const fires = rank((x) => x.np);
  const covers = rank((x) => x.pw);
  const same = (k: number, verb: string) => (k ? ` ${num(k)} ${verb}.` : '');
  p.append(
    el(
      'p',
      'small',
      `It fires on ${num(f.np)} of the ${num(proteins)} proteins (${pct(f.pp, 2)}). ` +
        `${num(fires.more)} of the ${num(n)} live latents fire on more proteins, and ` +
        `${num(fires.less)} fire on fewer.` +
        same(fires.same, 'fire on as many'),
    ),
    el(
      'p',
      'small',
      `It covers ${pct(f.pw)} of a protein, as the mean over those ${num(f.np)} proteins. ` +
        `${num(covers.more)} of the live latents cover more, and ${num(covers.less)} cover ` +
        'less.' +
        same(covers.same, 'cover as much'),
    ),
  );
  return p;
}

/**
 * The ranked protein list, filtered by the peak rather than truncated.
 *
 * A flat "top 25 of 45,822" answers one question and hides the rest. The range buttons reach the
 * weak end of the list, and the Annotated column says which proteins carry the paired concepts.
 */
function drawProteinList(
  d: Data,
  ranked: RankedProteins,
  paired: LatentPair[],
  host: HTMLElement,
): void {
  const { rank, range, counts, annotated } = ranked;
  const only = paired.length === 1 ? conceptName(paired[0].concept.c) : '';
  host.append(
    howto(
      'One row for each protein this latent fires on, the strongest peak first. ' +
        'Peak is the strongest it fires on the protein, as a share of its strongest anywhere. ' +
        'Pick a range of the peak to list only those proteins.' +
        (paired.length === 1
          ? ` Annotated says whether Swiss-Prot annotates ${only} on the protein.`
          : '') +
        (paired.length > 1
          ? ` Annotated shows the number of each concept that Swiss-Prot annotates on the ` +
            'protein.'
          : ''),
    ),
  );

  let picked = -1;
  let page = 0;
  const controls = el('div', 'chips');
  controls.append(el('span', 'small muted', 'peak:'));
  const buttons: HTMLButtonElement[] = [];
  const addButton = (label: string, index: number, count: number) => {
    const b = el('button', undefined, `${label} (${num(count)})`);
    b.disabled = count === 0;
    b.addEventListener('click', () => {
      picked = index;
      page = 0;
      draw();
    });
    buttons.push(b);
    controls.append(b);
  };
  addButton('all', -1, rank.protein.length);
  RANGES.forEach((r, i) => addButton(r.label, i, counts[i]));
  controls.append(
    infoButton(
      'the peak ranges',
      'The peak ranges',
      'The peak of a protein is the strongest this latent fires on it, divided by the strongest ' +
        'it fires anywhere.\n\nThe five ranges are equal steps of 0.2, the same five as in the ' +
        'InterPLM dashboard. They are not quintiles, so each range holds a different number of ' +
        'proteins.',
      'peak-activation',
    ),
  );
  host.append(controls);

  if (paired.length > 1) {
    const legend = el('p', 'small cbadge-legend');
    paired.forEach((_, i) => legend.append(namedConcept(paired, i, false)));
    host.append(legend);
  }

  const status = el('p', 'small muted');
  const tableHost = el('div');
  const pager = el('div', 'chips');
  host.append(status, tableHost, pager);

  // The Annotated cell, and a key that sorts the best concept above the others.
  const annotatedCell = (i: number): [Node | string, number] => {
    if (paired.length === 1) return annotated[0][i] ? ['yes', 1] : ['no', 0];
    const cell = el('span');
    let key = 0;
    paired.forEach((x, k) => {
      if (!annotated[k][i]) return;
      cell.append(conceptBadge(k, x.concept.c));
      key += 2 ** (paired.length - 1 - k);
    });
    return key ? [cell, key] : ['no', 0];
  };

  function draw(): void {
    const keep: number[] = [];
    for (let i = 0; i < rank.protein.length; i++) {
      if (picked < 0 || range[i] === picked) keep.push(i);
    }
    buttons.forEach((b, i) => b.setAttribute('aria-pressed', String(i - 1 === picked)));

    const pages = Math.max(1, Math.ceil(keep.length / PAGE));
    page = Math.min(page, pages - 1);
    const shown =
      `Showing ${num(page * PAGE + 1)} to ${num(Math.min(keep.length, (page + 1) * PAGE))} of `;
    status.textContent =
      picked < 0
        ? `${shown}${num(keep.length)} proteins.`
        : `${shown}the ${num(keep.length)} proteins with a peak of ${RANGES[picked].label}.`;

    tableHost.textContent = '';
    const headers = paired.length
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
      if (paired.length) {
        const [cell, key] = annotatedCell(i);
        cells.push(cell);
        keys.push(key);
      }
      body.append(row(cells, [0], keys));
    }
    const sc = el('div', 'tbl-scroll');
    sc.append(root);
    tableHost.append(sc);

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

/** The residue view, one protein at a time, over every ranked protein that has a track. */
function drawResidues(
  d: Data,
  f: Feature,
  rank: Ranking,
  paired: LatentPair[],
  chooserHost: HTMLElement,
  markHost: HTMLElement,
  body: HTMLElement,
): (acc: string) => boolean {
  const withTrack: string[] = [];
  for (let i = 0; i < rank.protein.length; i++) {
    const acc = d.proteinIds[rank.protein[i]];
    if (d.hasTrack(acc)) withTrack.push(acc);
  }
  if (withTrack.length === 0) {
    body.append(
      el('p', 'warn', 'No protein this latent fires on has a per-residue track in this tree.'),
    );
    return () => false;
  }
  let pending = 0;
  let shownAcc = withTrack[0];
  let marked = paired[0]?.concept.c;
  const redraw = () => {
    // Stepping is faster than a fetch, so a later pick must not be overwritten by an earlier
    // one that finished after it.
    const mine = ++pending;
    const release = holdHeight(body);
    void drawLocality(d, f.f, marked, shownAcc, body, () => mine === pending).finally(release);
  };
  if (paired.length > 1) {
    markHost.append(el('span', 'small muted', 'mark the residues of:'));
    const buttons: HTMLButtonElement[] = [];
    paired.forEach((x, i) => {
      const b = el('button');
      b.append(namedConcept(paired, i, false));
      b.addEventListener('click', () => {
        marked = x.concept.c;
        buttons.forEach((o) => o.setAttribute('aria-pressed', String(o === b)));
        redraw();
      });
      b.setAttribute('aria-pressed', String(x.concept.c === marked));
      buttons.push(b);
      markHost.append(b);
    });
  }
  const steps = stepper(withTrack, 'protein', (acc) => {
    shownAcc = acc;
    redraw();
  });
  chooserHost.append(steps.root);
  return (acc) => steps.show(acc);
}

/**
 * The proteins of one group of examples, as indices into the ranking.
 *
 * Group -1 is the top of the ranking. A peak range takes its proteins at even steps through the
 * range, so the examples span the range and do not crowd at its upper end. sae_vis samples its
 * quantile groups the same way, but at random. Even steps need no seed, so a link always shows
 * the same examples.
 */
function exampleIndices(d: Data, ranked: RankedProteins, group: number): number[] {
  const { rank, range } = ranked;
  const pool: number[] = [];
  for (let i = 0; i < rank.protein.length; i++) {
    if ((group < 0 || range[i] === group) && d.hasTrack(d.proteinIds[rank.protein[i]])) {
      pool.push(i);
      if (group < 0 && pool.length === EXAMPLES) break;
    }
  }
  if (group < 0 || pool.length <= EXAMPLES) return pool;
  return Array.from(
    { length: EXAMPLES },
    (_, j) => pool[Math.floor(((j + 0.5) * pool.length) / EXAMPLES)],
  );
}

/**
 * Examples of what the latent fires on: one row per protein, cut around its strongest residue.
 *
 * This is the first thing a feature page shows in Bricken et al. (2023), sae_vis, and InterProt,
 * because a reader judges a feature from its examples before any statistic. The amber of each
 * letter is the activation on the same scale as the strips below. Teal under a letter marks the
 * best paired concept, so a reader can see where label and firing agree.
 */
function drawExamples(
  d: Data,
  f: Feature,
  ranked: RankedProteins,
  paired: LatentPair[],
  host: HTMLElement,
  onPick: (acc: string) => void,
): void {
  const concept = paired[0]?.concept.c;
  host.append(
    howto(
      'Each row is one protein. The letters are its residues, cut to the strongest residue ' +
        'and the residues around it. The stronger the amber, the harder the latent fires there. ' +
        (concept
          ? `A teal line under a letter marks where Swiss-Prot annotates ${conceptName(concept)}. `
          : '') +
        'Peak is the strongest it fires on the protein, as a share of its strongest anywhere. ' +
        'Pick a range to see weaker examples. Click a row to read the whole protein below.',
    ),
  );
  const controls = el('div', 'chips');
  const buttons: HTMLButtonElement[] = [];
  const rows = el('div', 'examples');
  let group = -1;
  let pending = 0;

  const addButton = (label: string, index: number, count: number) => {
    const b = el('button', undefined, label);
    b.disabled = count === 0;
    b.addEventListener('click', () => {
      group = index;
      void draw();
    });
    buttons.push(b);
    controls.append(b);
  };
  addButton('strongest', -1, ranked.rank.protein.length);
  RANGES.forEach((r, i) => addButton(`${r.label} (${num(ranked.counts[i])})`, i, ranked.counts[i]));
  host.append(controls, rows);

  async function draw(): Promise<void> {
    const mine = ++pending;
    buttons.forEach((b, i) => b.setAttribute('aria-pressed', String(i - 1 === group)));
    const picks = exampleIndices(d, ranked, group);
    const release = holdHeight(rows);
    const loaded = await Promise.all(
      picks.map(async (i) => {
        const acc = d.proteinIds[ranked.rank.protein[i]];
        const [info, track] = await Promise.all([d.protein(acc), d.track(acc)]);
        return { i, acc, info, track };
      }),
    );
    release();
    if (mine !== pending) return;
    rows.textContent = '';
    if (loaded.length === 0) {
      rows.append(el('p', 'small muted', 'No protein in this range has a per-residue track.'));
      return;
    }
    for (const { i, acc, info, track } of loaded) {
      if (!info) continue;
      const acts = Data.activationOf(track, f.f);
      const ci = concept ? d.columnOf(concept) : null;
      rows.append(
        exampleRow(acc, info.n, info.s, acts, ci !== null ? info.c[String(ci)] ?? [] : [],
          ranked.rank.value[i] / 255, onPick),
      );
    }
  }
  void draw();
}

/** One example: the accession, the residues around the peak, and the peak value. */
function exampleRow(
  acc: string,
  name: string,
  seq: string,
  acts: Uint8Array,
  ranges: [number, number][],
  peak: number,
  onPick: (acc: string) => void,
): HTMLElement {
  let top = 0;
  for (let r = 1; r < acts.length; r++) if (acts[r] > acts[top]) top = r;
  // The window keeps its full width at the ends of the chain, so every row has the same length.
  const width = Math.min(seq.length, 2 * FLANK + 1);
  const start = Math.max(0, Math.min(top - FLANK, seq.length - width));
  const annotated = new Uint8Array(seq.length);
  for (const [a, b] of ranges) {
    for (let r = Math.max(0, a); r <= Math.min(seq.length - 1, b); r++) annotated[r] = 1;
  }

  const row_ = el('button', 'ex-row');
  row_.type = 'button';
  row_.title = `${acc} ${name}. Click to read the whole protein below.`;
  const label = el('span', 'ex-label');
  label.append(el('span', 'mono ex-acc', acc), el('span', 'ex-name', name));
  const letters = el('span', 'ex-seq mono');
  letters.append(el('span', 'ex-pos', String(start + 1)));
  for (let r = start; r < start + width; r++) {
    const rgb = rampRGB(acts[r] / 255);
    const c = el('span', annotated[r] ? 'ex-aa ann' : 'ex-aa', seq[r]);
    if (acts[r] > 0) {
      c.style.background = `rgb(${rgb.join(',')})`;
      c.style.color = inkOn(rgb);
    }
    if (r === top) c.classList.add('top');
    letters.append(c);
  }
  row_.append(label, letters, el('span', 'ex-peak mono', peak.toFixed(2)));
  row_.addEventListener('click', () => onPick(acc));
  return row_;
}

/**
 * One protein, residue by residue, with the residues of the `marked` concept in teal.
 *
 * `marked` is one of the concepts the latent pairs with, the best one unless the reader picked
 * another. It is undefined for a latent that pairs with none.
 */
async function drawLocality(
  d: Data,
  fid: number,
  marked: string | undefined,
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
  const head = el('p', 'evhead');
  head.append(
    link(`/protein/${acc}`, acc, 'mono'),
    ` ${info.n}`,
    el('span', 'muted', `  ${info.l} aa  `),
    uniprotLink(acc),
  );
  host.append(head);

  const rangesOf = (name: string): [number, number][] => {
    const ci = d.columnOf(name);
    return ci !== null ? info.c[String(ci)] ?? [] : [];
  };
  // The other concepts of this latent that Swiss-Prot annotates on this protein, so a reader
  // whose marked concept is absent here knows which one to pick instead.
  const elsewhere = d
    .pairsOf(fid)
    .map((x) => x.concept.c)
    .filter((name) => name !== marked && rangesOf(name).length > 0);
  const extra =
    elsewhere.length > 0
      ? `Swiss-Prot annotates ${elsewhere.map(conceptName).join(' and ')} on this protein. ` +
        `Pick ${elsewhere.length === 1 ? 'it' : 'one'} above to mark ` +
        `${elsewhere.length === 1 ? 'it' : 'those residues'} instead.`
      : undefined;
  const acts = Data.activationOf(track, fid);
  const loc = localityView(info.s, acts, marked ? rangesOf(marked) : [], {
    marks: marked ? { name: conceptName(marked), extra } : undefined,
  });
  host.append(loc.root);
  loc.mount();
  // Pointing at a letter marks the same residue on the model, which is the reason both views are
  // on one page and not on two.
  loc.onHover((i) => currentStructure()?.highlight(i === null ? null : i + 1));
  await drawStructure(d, acc, acts, loc.structSlot, { coloredBy: `f/${fid}`, letters: true });
}

/**
 * Whether Swiss-Prot annotates the paired concepts on the proteins of each peak range.
 *
 * The question is whether the concept is still there when the latent fires weakly. Each row is
 * one range, and its bar is all of that range's proteins, so every bar has its own denominator
 * and reads to 100%. This is the split of Bricken et al. (2023), "Towards Monosemanticity",
 * section "Activation Specificity" of the Arabic script feature: the share of the activations
 * that a proxy for the concept explains, at each level of activation.
 */
function drawEvidence(ranked: RankedProteins, paired: LatentPair[], host: HTMLElement): void {
  if (paired.length === 0) {
    host.append(
      el(
        'p',
        'small muted',
        'No concept pairs with this latent, so there is no annotation to count. The Proteins ' +
          'panel still counts the proteins in each peak range.',
      ),
    );
    return;
  }
  const { rank, range, counts, annotated } = ranked;
  host.append(
    howto(
      'Each row holds the proteins where the peak of this latent falls in one range. ' +
        'The peak is the strongest it fires on a protein, as a share of its strongest anywhere. ' +
        'Each bar is all the proteins of its row. Teal is the share that Swiss-Prot annotates ' +
        'with the concept, and grey is the rest. ' +
        'If the teal share stays high in the weak rows, the concept is there also when the ' +
        'latent fires weakly. ' +
        'Grey only means that Swiss-Prot has no annotation of the concept on the protein.',
    ),
  );

  // hits[k][r]: the proteins of range r that carry concept k.
  const hits = paired.map((_, k) => {
    const out = RANGES.map(() => 0);
    for (let i = 0; i < range.length; i++) if (annotated[k][i]) out[range[i]]++;
    return out;
  });

  // The result in words: the strongest range against all the others.
  const top = counts[0];
  const rest = rank.protein.length - top;
  paired.forEach((x, k) => {
    const line = el('p', 'small evsum');
    if (paired.length > 1) line.append(conceptBadge(k, x.concept.c), ' ');
    const topHits = hits[k][0];
    const restHits = hits[k].reduce((a, b) => a + b, 0) - topHits;
    const share = (a: number, b: number) => `${shareText(a, b)} of the proteins`;
    line.append(
      `At a peak above 0.8, Swiss-Prot annotates ${conceptName(x.concept.c)} on ` +
        `${share(topHits, top)} (${num(topHits)} of ${num(top)}). ` +
        (rest
          ? `At 0.8 or less, it annotates it on ${share(restHits, rest)} ` +
            `(${num(restHits)} of ${num(rest)}).`
          : 'This latent never fires on a protein with a peak of 0.8 or less.'),
    );
    host.append(line);
  });

  const t = el('table', 'evtable');
  const thead = el('thead');
  const hr = el('tr');
  hr.append(el('th', undefined, 'Peak'), el('th', undefined, 'Proteins'));
  paired.forEach((_, k) => {
    const th = el('th', 'evconcept');
    // The concept columns share the width evenly, so bars of two concepts compare by length.
    th.style.width = `${Math.floor(72 / paired.length)}%`;
    th.append(namedConcept(paired, k, false));
    hr.append(th);
  });
  thead.append(hr);
  const tbody = el('tbody');
  RANGES.forEach((r, i) => {
    const tr = el('tr');
    tr.append(el('td', 'evlabel', r.label), el('td', undefined, num(counts[i])));
    if (counts[i] === 0) {
      const td = el('td', 'muted evnone', 'no proteins');
      td.colSpan = paired.length;
      tr.append(td);
    } else {
      for (let k = 0; k < paired.length; k++) tr.append(barCell(hits[k][i], counts[i]));
    }
    tbody.append(tr);
  });
  t.append(thead, tbody);
  const sc = el('div', 'tbl-scroll');
  sc.append(t);
  host.append(sc);

  // Many latents never fire this weakly, and an empty row with no reason reads as a fault.
  if (counts[counts.length - 1] === 0) {
    let weakest = 255;
    for (const v of rank.value) if (v < weakest) weakest = v;
    host.append(
      el(
        'p',
        'small muted',
        `No protein has a peak of ${RANGES[RANGES.length - 1].hi} or less. The weakest peak ` +
          `of this latent is ${(weakest / 255).toFixed(3)} of its strongest.`,
      ),
    );
  }
}

/** A share in percent. A share that rounds to 0 but is not 0 says so, rather than "0.00%". */
function shareText(part: number, whole: number): string {
  const x = (part / whole) * 100;
  if (part === 0) return '0%';
  return x < 0.01 ? 'under 0.01%' : pct(x);
}

/** One bar: the share of a range's proteins that carry the concept, teal on grey. */
function barCell(hits: number, total: number): HTMLTableCellElement {
  const share = (hits / total) * 100;
  const td = el('td', 'evcell');
  const box = el('div', 'evbar');
  const track = el('span', 'evtrack');
  const fill = el('i');
  fill.style.width = hits > 0 ? `max(1px, ${share}%)` : '0';
  track.append(fill);
  const text = el('span', 'evshare', shareText(hits, total));
  text.append(el('span', 'muted', ` (${num(hits)})`));
  box.append(track, text);
  td.append(box);
  return td;
}

/**
 * Every live latent placed by how widely it fires against how much it covers.
 *
 * InterPLM's dashboard draws the same two numbers. The addition here is that the latent on
 * screen is marked, so the reader can see whether they are looking at a selective latent or at
 * one that fires on almost everything. `f/275` fires on 99.5% of the proteins, and its dot sits
 * alone on the right of this plot.
 *
 * The drawing is as wide as the half-width panel it sits in, so a unit of the drawing is about
 * one pixel and the labels read at their font size.
 */
function selectivityPlot(d: Data, self: Feature): HTMLElement {
  const W = 480;
  const H = 300;
  const PL = 68;
  const PR = 14;
  const PT = 14;
  const PB = 46;
  const FONT = 11.5;
  const iw = W - PL - PR;
  const ih = H - PT - PB;
  const ns = 'http://www.w3.org/2000/svg';
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
    return n;
  };

  // Both axes are log, because most latents fire on a fraction of a percent of the proteins and
  // a linear axis puts 8000 of them on one pixel column.
  const lx = (v: number) => Math.log10(Math.max(0.0005, v));
  const X = (v: number) => PL + (iw * (lx(v) - lx(0.0005))) / (lx(100) - lx(0.0005));
  const Y = (v: number) => PT + ih - (ih * (lx(v) - lx(0.01))) / (lx(100) - lx(0.01));

  for (const g of [0.001, 0.01, 0.1, 1, 10, 100]) {
    add('line', { x1: X(g), y1: PT, x2: X(g), y2: PT + ih, stroke: 'var(--line)' });
    add(
      'text',
      { x: X(g), y: H - PB + 15, 'text-anchor': 'middle', fill: 'var(--muted)', 'font-size': FONT },
      `${g}%`,
    );
  }
  for (const g of [0.1, 1, 10, 100]) {
    add('line', { x1: PL, y1: Y(g), x2: PL + iw, y2: Y(g), stroke: 'var(--line)' });
    add(
      'text',
      { x: PL - 6, y: Y(g) + 4, 'text-anchor': 'end', fill: 'var(--muted)', 'font-size': FONT },
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
    cx: X(self.pp).toFixed(1), cy: Y(self.pw).toFixed(1), r: 6,
    fill: 'none', stroke: 'var(--ink)', 'stroke-width': 2,
  });
  add('circle', {
    cx: X(self.pp).toFixed(1), cy: Y(self.pw).toFixed(1), r: 2.6, fill: 'var(--ink)',
  });

  add(
    'text',
    { x: PL + iw / 2, y: H - 6, 'text-anchor': 'middle', fill: 'var(--muted)', 'font-size': FONT },
    `share of the ${num(d.manifest.counts.proteins)} proteins it fires on`,
  );
  // Two lines, because one line is longer than the plot is high.
  ['mean share of a protein it covers,', 'over the proteins it fires on'].forEach((t, i) => {
    const x = 12 + i * 14;
    const y = PT + ih / 2;
    const rot = add(
      'text',
      { x, y, 'text-anchor': 'middle', fill: 'var(--muted)', 'font-size': FONT },
      t,
    );
    rot.setAttribute('transform', `rotate(-90 ${x} ${y})`);
  });

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
  return wrap;
}

/**
 * The 24 decoder norms and the cosine to the peak layer, on two axes.
 *
 * The cosine runs from -1 to 1 and the norm from 0 to 1, so they cannot share the left axis: the
 * cosine 0 would sit at the norm 0.5. The cosine gets its own axis on the right.
 */
function depthChart(d: Data, f: Feature): HTMLElement {
  const { norm, cos } = d.depthOf(f.f);
  const ns = 'http://www.w3.org/2000/svg';
  const W = 480;
  const H = 230;
  const PL = 44;
  const PR = 44;
  const PT = 20;
  const PB = 40;
  const FONT = 11.5;
  const iw = W - PL - PR;
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
    return n;
  };
  const X = (i: number) => PL + (iw * i) / (norm.length - 1);
  const Y = (v: number) => PT + ih - ih * v;
  const muted = { fill: 'var(--muted)', 'font-size': FONT };
  for (const g of [0, 0.5, 1]) {
    add('line', { x1: PL, y1: Y(g), x2: PL + iw, y2: Y(g), stroke: 'var(--line)' });
    add('text', { x: PL - 6, y: Y(g) + 4, 'text-anchor': 'end', ...muted }, g.toFixed(1));
    add('text', { x: PL + iw + 6, y: Y(g) + 4, ...muted }, String(g * 2 - 1));
  }
  add('line', {
    x1: X(f.pk - 1), y1: PT, x2: X(f.pk - 1), y2: PT + ih,
    stroke: 'var(--signal)', 'stroke-dasharray': '3 3',
  });
  add(
    'text',
    {
      x: X(f.pk - 1), y: PT - 6, 'text-anchor': 'middle', fill: 'var(--signal)',
      'font-size': FONT,
    },
    `peak ${f.pk}`,
  );
  const path = (vals: number[], map: (v: number) => number) =>
    vals.map((v, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(map(v)).toFixed(1)}`).join('');
  add('path', {
    d: path(norm, (v) => v), fill: 'none', stroke: 'var(--depth)', 'stroke-width': 2,
  });
  add('path', {
    d: path(cos, (v) => (v + 1) / 2), fill: 'none', stroke: 'var(--muted)',
    'stroke-width': 1.7, 'stroke-dasharray': '4 3',
  });
  for (const l of [1, 6, 12, 18, 24]) {
    add('text', { x: X(l - 1), y: H - 22, 'text-anchor': 'middle', ...muted }, String(l));
  }
  add('text', { x: PL + iw / 2, y: H - 4, 'text-anchor': 'middle', ...muted }, 'encoder layer');
  const side = (x: number, text: string) => {
    const y = PT + ih / 2;
    const t = add('text', { x, y, 'text-anchor': 'middle', ...muted }, text);
    t.setAttribute('transform', `rotate(-90 ${x} ${y})`);
  };
  side(12, 'length');
  side(W - 6, 'cosine');

  const wrap = el('div');
  wrap.append(svg);
  const legend = el('div', 'loc-legend');
  const solid = el('span', 'loc-key');
  const sk = el('span', 'inlinekey');
  sk.style.background = cssVar('--depth');
  solid.append(sk, 'length of the vector');
  const dashed = el('span', 'loc-key');
  dashed.append(el('span', 'inlinekey dashed'), 'cosine to the peak layer');
  legend.append(solid, dashed);
  wrap.append(legend);
  return wrap;
}
