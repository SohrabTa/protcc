/**
 * The landing page: what the crosscoder knows, grouped by biology.
 *
 * Concepts are grouped by their biological family rather than by the Swiss-Prot field name they
 * came from. The field name puts 82.6% of the paired latents in one bucket and tells a reader
 * nothing; the family split gives 9.01 effective buckets against 1.95. See
 * `documentation/experiments/09-feature-dashboard.md`.
 *
 * One family is shown at a time. All eleven at once is 187 rows of table, and the two panels
 * under it are the ones that carry a finding, so nobody reached them.
 */

import type { Concept, Data } from '../data';
import { depthMap } from '../depthmap';
import { coverageBar, el, figures, howto, infoButton, link, num, panel, row, table } from '../ui';

export function renderOverview(d: Data, host: HTMLElement): void {
  host.textContent = '';
  const views = el('div', 'views');
  host.append(views);

  let query = '';

  const famOrder = familyOrder(d);
  let family = '';

  const p = panel(
    'Concepts',
    'What the crosscoder found',
    'Every Swiss-Prot concept in the evaluation set, grouped by what the annotation is ' +
      'biologically. A concept counts as found when at least one latent pairs with it. A latent ' +
      'pairs with a concept when its F1 per domain is more than 0.5 on a held-out set of ' +
      'proteins. Open a concept to see which latents detect it, and where.',
  );
  p.append(
    howto(
      'Pick a family chip to show one family, or type in the filter box. The filter searches ' +
        'all families, whichever chip is picked. The rows start with the best F1, highest ' +
        'first. Click a column header to sort by it, a second time to reverse, and a third ' +
        'time for this order.',
    ),
  );
  // Every panel on this page starts on all families and has its own chips. All families is 187
  // rows, so the table body scrolls inside the panel instead of pushing the other panels down.
  const tabs = familyTabs(d, famOrder, family, (key) => {
    family = key;
    // A chip and the filter are two ways to narrow the list, and the last one used wins. A chip
    // that did nothing while the box held text would look broken.
    if (query) {
      query = '';
      search.value = '';
    }
    draw();
  });
  p.append(tabs.root);

  const controls = el('div', 'chips');
  const search = el('input');
  search.type = 'search';
  search.placeholder = 'Filter all families';
  search.addEventListener('input', () => {
    query = search.value.trim();
    draw();
  });
  const status = el('span', 'small muted');
  controls.append(search, status);
  p.append(controls);

  // One scroll box for the whole list, not one per family. Nested scroll boxes trap the wheel.
  const body = el('div', 'concept-scroll');
  p.append(body);
  views.append(p);

  function draw() {
    body.textContent = '';
    const q = query.toLowerCase();

    // A search runs over every family, because a reader who types a name does not know which
    // family it is in. That is the one case the tabs step aside for, and they show it by having
    // no chip pressed.
    const searching = q.length > 0;
    tabs.set(searching ? null : family);
    const shown = searching || family === '' ? famOrder : famOrder.filter(([f]) => f === family);

    let any = false;
    let hits = 0;
    let hitFamilies = 0;
    for (const [fam, list] of shown) {
      const match = list.filter((c) => c.nf > 0 && (!q || c.c.toLowerCase().includes(q)));
      if (match.length === 0) continue;
      any = true;
      hits += match.length;
      hitFamilies++;
      const g = el('div', 'famgroup');
      const head = el('div', 'famhead');
      head.append(el('h3', undefined, fam));
      const inFamily = list.filter((c) => !q || c.c.toLowerCase().includes(q));
      head.append(coverageBar(match.length, inFamily.length, 130));
      head.append(el('span', 'sub', `${inFamily.reduce((a, c) => a + c.nf, 0)} latents`));
      head.append(
        infoButton(
          'the family bar',
          'The bar beside a family',
          'The two numbers are the concepts of this family that at least one latent pairs ' +
            'with, and all the concepts of this family. The bar shows the same share.\n\n' +
            'The number of latents is the sum of the Latents column. A latent that pairs with ' +
            'two concepts of the family counts two times.' +
            (searching ? '\n\nThe filter holds text, so all three numbers count only the ' +
              'concepts that match it.' : ''),
        ),
      );
      g.append(head);

      const { root, body: tb } = table(
        ['Concept', 'Best F1', 'Latents', 'Proteins', 'Best latent'],
        [0],
      );
      for (const c of match.sort((a, b) => b.f1 - a.f1)) {
        tb.append(
          row(
            [
              link(`/concept/${encodeURIComponent(c.c)}`, c.c.replace('_', ' · ')),
              c.f1.toFixed(3),
              String(c.nf),
              c.npr === undefined ? '—' : num(c.npr),
              c.bf === undefined ? '—' : link(`/latent/${c.bf}`, `f/${c.bf}`, 'mono'),
            ],
            [0],
            [c.c.replace('_', ' · ').toLowerCase(), c.f1, c.nf, c.npr, c.bf],
          ),
        );
      }
      const missed = inFamily.length - match.length;
      const scroll = el('div', 'tbl-scroll');
      scroll.append(root);
      g.append(scroll);
      if (missed > 0) {
        g.append(
          el(
            'p',
            'small muted',
            `${missed} concept${missed === 1 ? '' : 's'} in this family ` +
              `${missed === 1 ? 'has' : 'have'} no latent.`,
          ),
        );
      }
      body.append(g);
    }
    if (!any) body.append(el('p', 'loading', 'Nothing matches that filter.'));
    status.textContent = searching
      ? `${hits} found concept${hits === 1 ? '' : 's'} in ${hitFamilies} ` +
        `famil${hitFamilies === 1 ? 'y' : 'ies'} match. The filter searches all families. ` +
        'Pick a family chip to clear it.'
      : '';
  }

  const split = splitPanel(d, famOrder);
  views.append(split.root);

  // Where the latents live in the encoder, and which of them anything named.
  const depthPanel = panel(
    'Depth',
    'Where the latents peak, and how many of them pair with a concept',
    'A latent adds its own vector to each of the 24 encoder layers. The vectors differ from ' +
      'layer to layer in direction and in length. The length at a layer is how much the latent ' +
      'changes that layer. The peak layer is the layer where the vector is longest.',
  );
  const map = depthMap(d);
  // The two plots start on all families, so nothing in them is hidden until a reader asks.
  const depthTabs = familyTabs(d, famOrder, '', (key) => {
    depthTabs.set(key);
    map.setFamily(key);
  });
  depthPanel.append(map.howto, depthTabs.root, map.root);
  views.append(depthPanel);
  draw();
  map.mount();
}

type FamilyOrder = [string, Concept[]][];

/** Families, most found concepts first. */
function familyOrder(d: Data): FamilyOrder {
  const families = new Map<string, Concept[]>();
  for (const c of d.concepts) {
    const fam = c.fam || 'unassigned';
    if (!families.has(fam)) families.set(fam, []);
    families.get(fam)!.push(c);
  }
  return [...families.entries()].sort(
    (a, b) => b[1].filter((c) => c.nf > 0).length - a[1].filter((c) => c.nf > 0).length,
  );
}

/**
 * One row of family chips. Each panel on the home page gets its own row and keeps its own choice.
 *
 * Each chip also says how much of its family the crosscoder names, so the row is a summary
 * before anything is clicked.
 */
function familyTabs(
  d: Data,
  famOrder: FamilyOrder,
  initial: string,
  onPick: (key: string) => void,
): { root: HTMLElement; set(key: string | null): void } {
  const root = el('div', 'famtabs');
  const buttons = new Map<string, HTMLButtonElement>();
  const make = (key: string, label: string, found: number, total: number) => {
    const b = el('button', 'famtab');
    b.append(el('span', 'famtab-name', label));
    b.append(el('span', 'famtab-count', `${found} / ${total}`));
    const bar = el('span', 'famtab-bar');
    const fill = el('i');
    fill.style.width = `${total ? (found / total) * 100 : 0}%`;
    bar.append(fill);
    b.append(bar);
    b.addEventListener('click', () => onPick(key));
    buttons.set(key, b);
    root.append(b);
  };
  const found = d.concepts.filter((c) => c.nf > 0).length;
  make('', 'all families', found, d.concepts.length);
  for (const [fam, list] of famOrder) {
    make(fam, fam, list.filter((c) => c.nf > 0).length, list.length);
  }
  const info = infoButton(
    'the family chips',
    'The family chips',
    'Each chip is one biological family of Swiss-Prot concepts. The first number counts the ' +
      'concepts of the family that at least one latent pairs with. The second number counts ' +
      'all the concepts of the family. The bar shows the same share.\n\n' +
      `For all families that is ${found} of ${d.concepts.length}. A latent pairs with a ` +
      'concept when its F1 per domain is more than 0.5.',
    'pairing',
  );
  info.classList.add('famtabs-info');
  root.append(info);
  // null presses no chip, which is how the Concepts panel shows that its filter overrides them.
  const set = (key: string | null) => {
    for (const [k, b] of buttons) b.setAttribute('aria-pressed', String(k === key));
  };
  set(initial);
  return { root, set };
}

/**
 * The second finding: the crosscoder almost never learns one concept as one latent.
 *
 * Every dot is one pair of a latent and a concept, placed by how much of the annotated region the
 * latent covers against how often it is right when it fires. A concept with 62 latents has 62
 * dots. The list above the plot names the concepts with more than one latent, and pointing at a
 * name lights up its dots, which is what ties the count of latents to the plot.
 *
 * The corners are named under the plot, because a dot at (0.09, 0.54) says nothing to a reader
 * who has not been told what the two axes buy.
 */
interface SplitHandle {
  root: HTMLElement;
  /** Count and colour one biological family. '' is all of them. */
  setFamily(fam: string): void;
}

interface Pair {
  fid: number;
  concept: string;
  fam: string;
  prec: number;
  rec: number;
  recd?: number;
}

const show = (name: string) => name.replace('_', ' · ');

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const a = [...xs].sort((x, y) => x - y);
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

function splitPanel(d: Data, famOrder: FamilyOrder): SplitHandle {
  const pairs: Pair[] = [];
  for (const c of d.concepts) {
    if (!c.feats?.length) continue;
    const fam = c.fam || 'unassigned';
    for (const [fid, , prec, rec, recd] of c.feats) {
      pairs.push({ fid, concept: c.c, fam, prec, rec, recd });
    }
  }

  const p = panel(
    'Splitting',
    'One concept, several latents',
    'A concept is rarely one latent. Most found concepts pair with a group of latents. The ' +
      'plot shows each pair of a latent and a concept: how often the latent is right when it ' +
      'fires, and how much of the annotated region it reads.',
  );
  const tabs = familyTabs(d, famOrder, '', (key) => setFamily(key));
  const stats = el('div');
  // The names sit beside the plot and not above it. Above it, a long list pushed the plot out of
  // view, and a reader who points at a name has to see the plot at the same time.
  const grid = el('div', 'splitgrid');
  const plot = el('div');
  const list = el('div', 'splitlist');
  grid.append(plot, list);
  const note = el('p', 'small muted');
  p.append(
    howto(
      'Every dot is one latent paired with one concept. Point at a concept name beside the plot ' +
        'to light up its latents, and click the name to keep them lit. The arrow after a name ' +
        'opens the concept page. Point at a dot to see its latent, and click the dot to open it.',
    ),
    tabs.root,
    stats,
    grid,
    note,
  );

  function setFamily(fam: string): void {
    tabs.set(fam);
    const found = d.concepts.filter((c) => c.nf > 0 && (!fam || (c.fam || 'unassigned') === fam));
    const multi = found.filter((c) => c.nf >= 2);
    const mine = fam ? pairs.filter((x) => x.fam === fam) : pairs;

    // Every figure says how it is counted, because "3.5 latents" and "0.035" mean nothing to a
    // reader who does not know what was counted and over what.
    const ofFam = fam ? ` of the ${fam} family` : '';
    const pairsIn = (n: number) =>
      `A pair is one latent and one concept it pairs with. The value is the middle one over ` +
      (fam ? `the ${num(n)} pairs${ofFam}.` : `all ${num(n)} pairs.`);
    const recRes = median(mine.map((x) => x.rec));
    const withDom = mine.filter((x) => x.recd !== undefined);
    stats.textContent = '';
    stats.append(
      figures([
        [
          `${multi.length} of ${found.length}`,
          'found concepts take more than one latent',
          {
            title: 'Concepts that take more than one latent',
            short:
              'A concept is found when at least one latent pairs with it. The first number ' +
              'counts the found concepts that two or more latents pair with. The second number ' +
              `counts all the found concepts${ofFam}.`,
            slug: 'pairing',
          },
        ],
        [
          String(median(found.map((c) => c.nf))),
          'latents for the median found concept',
          {
            title: 'Latents for the median found concept',
            short:
              'Count the latents that pair with each found concept, and sort the counts. This ' +
              'is the middle count. When the number of concepts is even, it is the mean of the ' +
              'two middle counts, so it can end in .5.',
          },
        ],
        [
          String(found.length ? Math.max(...found.map((c) => c.nf)) : 0),
          'latents for the most split concept',
          {
            title: 'The most split concept',
            short:
              `The largest number of latents that pair with one concept${ofFam}. It is the ` +
              'first name in the list beside the plot.',
          },
        ],
        [
          median(mine.map((x) => x.prec)).toFixed(2),
          'median precision of a pair',
          {
            title: 'Median precision of a pair',
            short:
              'Precision is the share of the residues the latent fires on that the annotation ' +
              `covers. It is the vertical axis of the plot.\n\n${pairsIn(mine.length)}`,
            slug: 'precision',
          },
        ],
        [
          recRes.toFixed(3),
          'median recall per residue',
          {
            title: 'Median recall per residue',
            short:
              'Recall per residue is the share of the annotated residues that the latent fires ' +
              `on. It is the horizontal axis of the plot. ${recRes.toFixed(3)} means that the ` +
              `middle pair fires on ${(recRes * 100).toFixed(1)}% of the annotated residues.` +
              `\n\n${pairsIn(mine.length)}`,
            slug: 'recall-per-residue',
          },
        ],
        ...(withDom.length
          ? ([[
              median(withDom.map((x) => x.recd!)).toFixed(3),
              'median recall per domain',
              {
                title: 'Median recall per domain',
                short:
                  'Recall per domain is the share of the annotated regions where the latent ' +
                  'fires at least once. One residue is enough to recall a whole region, so ' +
                  'this value is high while recall per residue is low.' +
                  `\n\n${pairsIn(withDom.length)}`,
                slug: 'recall-per-domain',
              },
            ]] as [string, string, { title: string; short: string; slug: string }][])
          : []),
      ]),
    );

    const scatter = splitScatter(pairs, fam);
    plot.textContent = '';
    plot.append(scatter.root);
    list.textContent = '';
    list.append(splitList(multi, fam, scatter));

    note.textContent =
      (fam
        ? `The amber dots pair with a concept of ${fam}, and the grey dots with another. `
        : '') +
      'A crosscoder that had learned whole concepts would fill the top right corner. A latent ' +
      'there is right when it fires and also reads the whole region. This one fills the top ' +
      'left.';
  }

  setFamily('');
  return { root: p, setFamily };
}

/**
 * The concepts with more than one latent, most latents first, as names that light up the plot.
 *
 * A name is a button, not a link: pointing at it or clicking it only changes the plot, so a
 * reader who wanted to look does not land on another page. The concept page is behind the
 * arrow after the name, which is a separate target. All names are in a box that scrolls beside
 * the plot, and a filter finds one by name.
 */
function splitList(multi: Concept[], fam: string, scatter: ScatterHandle): HTMLElement {
  const root = el('div', 'splitlist-inner');
  if (multi.length === 0) {
    root.append(el('p', 'small muted', 'No concept here pairs with more than one latent.'));
    return root;
  }
  const sorted = [...multi].sort((a, b) => b.nf - a.nf);
  root.append(
    el(
      'p',
      'small muted splitlist-head',
      `${sorted.length} concept${sorted.length === 1 ? '' : 's'}` +
        (fam ? ` of ${fam}` : '') +
        ' with more than one latent. The number is how many.',
    ),
  );
  const filter = el('input');
  filter.type = 'search';
  filter.placeholder = 'Filter the names';
  root.append(filter);
  const rows = el('div', 'splitrows');
  root.append(rows);

  let pinned: string | null = null;
  const names: HTMLButtonElement[] = [];
  const items: { item: HTMLElement; key: string }[] = [];
  for (const c of sorted) {
    const item = el('div', 'splitchip');
    const name = el('button', 'splitname');
    name.type = 'button';
    name.setAttribute('aria-pressed', 'false');
    name.append(el('span', 'nm', show(c.c)), el('span', 'n', String(c.nf)));
    name.title = 'Point to light up its latents. Click to keep them lit.';
    const light = () => scatter.light(c.c);
    const restore = () => scatter.light(pinned);
    name.addEventListener('mouseenter', light);
    name.addEventListener('focus', light);
    name.addEventListener('mouseleave', restore);
    name.addEventListener('blur', restore);
    name.addEventListener('click', () => {
      pinned = pinned === c.c ? null : c.c;
      for (const b of names) b.setAttribute('aria-pressed', String(b === name && pinned !== null));
      scatter.light(pinned);
    });
    names.push(name);
    const open = link(`/concept/${encodeURIComponent(c.c)}`, '→', 'splitopen');
    open.title = `Open the page of ${show(c.c)}`;
    open.setAttribute('aria-label', `Open the page of ${show(c.c)}`);
    item.append(name, open);
    rows.append(item);
    items.push({ item, key: show(c.c).toLowerCase() });
  }
  filter.addEventListener('input', () => {
    const q = filter.value.trim().toLowerCase();
    for (const x of items) x.item.hidden = q !== '' && !x.key.includes(q);
  });
  return root;
}

const NS = 'http://www.w3.org/2000/svg';

function svgNode(
  parent: SVGElement,
  t: string,
  a: Record<string, string | number>,
  text?: string,
): SVGElement {
  const n = document.createElementNS(NS, t);
  for (const [k, v] of Object.entries(a)) n.setAttribute(k, String(v));
  if (text !== undefined) n.textContent = text;
  parent.append(n);
  return n;
}

interface ScatterHandle {
  root: HTMLElement;
  /** Light up the latents of one concept and dim the rest. null lights nothing. */
  light(concept: string | null): void;
}

function splitScatter(pairs: Pair[], family: string): ScatterHandle {
  const W = 640;
  const H = 280;
  const PL = 46;
  const PB = 38;
  const PT = 18;
  const PR = 14;
  const iw = W - PL - PR;
  const ih = H - PT - PB;
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('width', '100%');
  svg.classList.add('splitsvg');
  svg.style.display = 'block';
  const add = (t: string, a: Record<string, string | number>, text?: string) =>
    svgNode(svg, t, a, text);
  const X = (r: number) => PL + iw * r;
  const Y = (p: number) => PT + ih - ih * p;
  for (const g of [0, 0.5, 1]) {
    add('line', { x1: PL, y1: Y(g), x2: W - PR, y2: Y(g), stroke: 'var(--line)' });
    add(
      'text',
      { x: PL - 6, y: Y(g) + 3, 'text-anchor': 'end', fill: 'var(--muted)', 'font-size': 9 },
      g.toFixed(1),
    );
    add('line', { x1: X(g), y1: PT, x2: X(g), y2: PT + ih, stroke: 'var(--line)' });
    add(
      'text',
      { x: X(g), y: H - PB + 13, 'text-anchor': 'middle', fill: 'var(--muted)', 'font-size': 9 },
      g.toFixed(1),
    );
  }
  const dots = add('g', { class: 'dots' });
  // Out of family first, so a dot in the family is never hidden under a muted one.
  for (const pass of [false, true]) {
    for (const q of pairs) {
      const mine = !family || q.fam === family;
      if (mine !== pass) continue;
      svgNode(dots, 'circle', {
        cx: X(q.rec).toFixed(1),
        cy: Y(q.prec).toFixed(1),
        r: pass ? 2 : 1.7,
        fill: pass ? 'var(--signal)' : 'var(--line-strong)',
        'fill-opacity': pass ? 0.4 : 0.3,
      });
    }
  }
  const lit = add('g', {});
  // The other pairs of the latent under the pointer, ringed with a dashed line.
  const siblings = add('g', {});
  const ring = add('circle', {
    r: 4.5,
    fill: 'none',
    stroke: 'var(--ink)',
    'stroke-width': 1.2,
    visibility: 'hidden',
  });
  // A latent with two concepts has two dots, one for each pair.
  const byLatent = new Map<number, number[]>();
  pairs.forEach((q, i) => byLatent.set(q.fid, [...(byLatent.get(q.fid) ?? []), i]));
  add(
    'text',
    { x: PL + iw / 2, y: H - 4, 'text-anchor': 'middle', fill: 'var(--muted)', 'font-size': 9 },
    'recall per residue: how much of the annotated region it covers',
  );
  const rot = add(
    'text',
    { x: 11, y: PT + ih / 2, 'text-anchor': 'middle', fill: 'var(--muted)', 'font-size': 9 },
    'precision: how often it is right when it fires',
  );
  rot.setAttribute('transform', `rotate(-90 11 ${PT + ih / 2})`);

  const box = el('div', 'split-box');
  const readout = el('div', 'dmap-readout');
  box.append(svg, readout);

  let litConcept: string | null = null;
  let hovered = -1;

  function writeReadout(): void {
    readout.textContent = '';
    if (hovered >= 0) {
      const q = pairs[hovered];
      const others = (byLatent.get(q.fid) ?? []).filter((i) => i !== hovered);
      readout.append(
        el('span', 'mono', `f/${q.fid}`),
        `  ${show(q.concept)}  precision ${q.prec.toFixed(2)}  ` +
          `recall per residue ${q.rec.toFixed(3)}`,
      );
      if (others.length) {
        readout.append(
          el(
            'span',
            'readout-more',
            `This latent also pairs with ` +
              `${others.map((i) => show(pairs[i].concept)).join(' and ')}. ` +
              (others.length === 1
                ? 'The dashed ring marks that pair.'
                : 'The dashed rings mark those pairs.'),
          ),
        );
      }
      return;
    }
    if (litConcept === null) return;
    const mine = pairs.filter((q) => q.concept === litConcept);
    readout.append(
      `${show(litConcept)}: ${mine.length} latents, median precision ` +
        `${median(mine.map((q) => q.prec)).toFixed(2)}, median recall per residue ` +
        `${median(mine.map((q) => q.rec)).toFixed(3)}`,
    );
  }

  function light(concept: string | null): void {
    litConcept = concept;
    lit.textContent = '';
    svg.classList.toggle('dim', concept !== null);
    if (concept !== null) {
      for (const q of pairs) {
        if (q.concept !== concept) continue;
        svgNode(lit, 'circle', {
          cx: X(q.rec).toFixed(1),
          cy: Y(q.prec).toFixed(1),
          r: 3.4,
          fill: 'var(--accent)',
          stroke: 'var(--surface)',
          'stroke-width': 0.8,
        });
      }
    }
    writeReadout();
  }

  /** The pair under the pointer, or -1. The radius is in plot units, about 10 px on screen. */
  function pairAt(e: MouseEvent): number {
    const m = svg.getScreenCTM();
    if (!m) return -1;
    const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    let best = -1;
    let bestD = 36;
    pairs.forEach((q, i) => {
      const dx = X(q.rec) - pt.x;
      const dy = Y(q.prec) - pt.y;
      const dd = dx * dx + dy * dy;
      if (dd < bestD) {
        bestD = dd;
        best = i;
      }
    });
    return best;
  }

  svg.addEventListener('mousemove', (e) => {
    const i = pairAt(e);
    if (i === hovered) return;
    hovered = i;
    svg.style.cursor = i >= 0 ? 'pointer' : 'default';
    if (i >= 0) {
      ring.setAttribute('cx', X(pairs[i].rec).toFixed(1));
      ring.setAttribute('cy', Y(pairs[i].prec).toFixed(1));
    }
    ring.setAttribute('visibility', i >= 0 ? 'visible' : 'hidden');
    siblings.textContent = '';
    if (i >= 0) {
      for (const j of byLatent.get(pairs[i].fid) ?? []) {
        if (j === i) continue;
        svgNode(siblings, 'circle', {
          cx: X(pairs[j].rec).toFixed(1),
          cy: Y(pairs[j].prec).toFixed(1),
          r: 5,
          fill: 'none',
          stroke: 'var(--ink)',
          'stroke-width': 1.2,
          'stroke-dasharray': '2 2',
        });
      }
    }
    writeReadout();
  });
  svg.addEventListener('mouseleave', () => {
    hovered = -1;
    ring.setAttribute('visibility', 'hidden');
    siblings.textContent = '';
    writeReadout();
  });
  svg.addEventListener('click', (e) => {
    const i = pairAt(e);
    if (i >= 0) location.hash = `/latent/${pairs[i].fid}`;
  });

  // The corners are named under the plot and not inside it. Text inside a scatter sits on top
  // of the dots it is describing, and at 10 px over 1080 overlapping marks it cannot be read.
  const wrap = el('div');
  wrap.append(box);
  const corners = el('dl', 'cornerkey');
  const put = (k: string, v: string) => {
    corners.append(el('dt', undefined, k));
    corners.append(el('dd', undefined, v));
  };
  put('top left', 'right when it fires, and reads a sliver of the region.');
  put('top right', 'right when it fires, and reads all of the region.');
  put('bottom', 'wrong more often than right.');
  wrap.append(corners);
  return { root: wrap, light };
}
