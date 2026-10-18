/**
 * The landing page: what the crosscoder knows, grouped by biology.
 *
 * Concepts are grouped by their biological family rather than by the Swiss-Prot field name they
 * came from. The field name puts 82.6% of the paired latents in one bucket and tells a reader
 * nothing; the family split gives 9.01 effective buckets against 1.95. See
 * `documentation/experiments/09-feature-dashboard.md`.
 *
 * One family choice holds for the whole page. Each panel used to have its own row of chips, and
 * a reader who picked a family in the Depth panel still saw all families in the two above it.
 */

import type { Concept, Data } from '../data';
import { depthMap, peakBand } from '../depthmap';
import {
  coverageBar, el, figures, howto, infoButton, link, num, panel, pct, row, table,
} from '../ui';

export function renderOverview(d: Data, host: HTMLElement): void {
  host.textContent = '';
  const views = el('div', 'views');
  host.append(views);

  let query = '';
  let family = '';
  const famOrder = familyOrder(d);
  const found = d.concepts.filter((c) => c.nf > 0).length;

  const bar = familyBar(d, famOrder, (key) => setFamily(key));
  views.append(bar.root);

  const p = panel(
    'Concepts',
    `${found} of ${d.concepts.length} concepts have at least one latent`,
    'Every Swiss-Prot concept in the evaluation set, grouped by what the annotation is ' +
      'biologically. A concept counts as found when at least one latent pairs with it. A latent ' +
      'pairs with a concept when its F1 per domain is more than 0.5 on two separate halves of ' +
      'the proteins. Open a concept to see which latents detect it, and where.',
  );
  p.append(
    howto(
      'Pick a family above to show one family, or type in the filter box. The filter searches ' +
        'all families, so it sets the family to All families. The rows start with the best F1, ' +
        'highest first.',
    ),
  );

  const controls = el('div', 'chips');
  const search = el('input');
  search.type = 'search';
  search.placeholder = 'Filter all families';
  search.addEventListener('input', () => {
    query = search.value.trim();
    // A filter that searches all families while a chip says one family would contradict it.
    if (query && family) setFamily('', false);
    else draw();
  });
  const status = el('span', 'small muted');
  controls.append(search, status);
  p.append(controls);

  const body = el('div', 'concept-list');
  p.append(body);
  views.append(p);

  function draw() {
    body.textContent = '';
    const q = query.toLowerCase();
    const searching = q.length > 0;
    const shown = family === '' ? famOrder : famOrder.filter(([f]) => f === family);

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
      const scroll = el('div', 'tbl-scroll');
      scroll.append(root);
      g.append(scroll);
      const missed = inFamily.length - match.length;
      if (missed > 0) {
        g.append(
          el(
            'p',
            'small muted famfoot',
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
        `famil${hitFamilies === 1 ? 'y' : 'ies'} match.`
      : '';
  }

  const split = splitPanel(d);
  views.append(split.root);

  // Where the latents live in the encoder, and which of them anything named.
  const band = peakBand(d);
  const depthPanel = panel(
    'Depth',
    `${pct(band.share * 100, 0)} of the live latents peak in layers ${band.from} to ${band.to}`,
    'Each latent sits across at its peak layer, the layer it writes into hardest after a ' +
      'correction for the growth of the residual stream. It sits up at the number of proteins ' +
      'it fires on, on a log scale. Amber dots pair with a concept, and the gray field holds the ' +
      'latents that pair with no concept. The bars on top show the share of each layer’s ' +
      'latents that pair.',
  );
  const map = depthMap(d);
  depthPanel.append(map.howto, map.root);
  views.append(depthPanel);
  views.insertBefore(panelTabs([p, split.root, depthPanel], bar.tools), p);

  /** The one place that changes the family. `clearQuery` is false when the filter asks for it. */
  function setFamily(key: string, clearQuery = true): void {
    family = key;
    if (clearQuery && query) {
      query = '';
      search.value = '';
    }
    bar.set(key);
    draw();
    split.setFamily(key);
    map.setFamily(key);
  }

  draw();
  map.mount();
}

/**
 * One tab for each panel, and one panel on screen at a time.
 *
 * Three things keep the other two panels in view. The tabs are cards that state each result, so
 * the three findings are on screen before a click. The bar that stays at the top of the window
 * switches the panel too, so a reader deep in the concept list still sees the other two. And
 * each panel ends with a link to the next one.
 */
function panelTabs(panels: HTMLElement[], floatTools: HTMLElement): HTMLElement {
  const box = el('section', 'ovtabs-box');
  box.append(el('span', 'eyebrow', 'The results, in three views'));
  const strip = el('div', 'ovtabs');
  strip.setAttribute('role', 'tablist');
  box.append(strip);
  const mini = el('div', 'ovmini');
  mini.setAttribute('role', 'group');
  mini.setAttribute('aria-label', 'View');
  floatTools.append(mini);

  const names = panels.map((pane) => (pane.querySelector('.eyebrow')?.textContent ?? '').split(':')[0]);
  const results = panels.map((pane) => pane.querySelector('h2')?.textContent ?? '');
  const tabs = panels.map((pane, i) => {
    pane.classList.add('ovtab-pane');
    pane.setAttribute('role', 'tabpanel');
    const tab = el('button', 'ovtab');
    tab.type = 'button';
    tab.setAttribute('role', 'tab');
    tab.append(
      el('span', 'ovtab-name', `${i + 1} · ${names[i]}`),
      el('span', 'ovtab-sub', results[i]),
    );
    tab.addEventListener('click', () => show(i));
    strip.append(tab);
    return tab;
  });
  const minis = names.map((name, i) => {
    const b = el('button', undefined, name);
    b.type = 'button';
    b.addEventListener('click', () => show(i, true));
    mini.append(b);
    return b;
  });
  panels.forEach((pane, i) => {
    if (i === panels.length - 1) return;
    const next = el('button', 'ovnext');
    next.type = 'button';
    next.append(el('span', 'ovnext-k', `Next view: ${names[i + 1]}`), el('span', undefined, results[i + 1]));
    next.addEventListener('click', () => show(i + 1, true));
    pane.append(next);
  });

  function show(at: number, scroll = false): void {
    panels.forEach((pane, i) => {
      pane.hidden = i !== at;
      tabs[i].setAttribute('aria-selected', String(i === at));
      minis[i].setAttribute('aria-pressed', String(i === at));
    });
    if (scroll) box.scrollIntoView({ block: 'start' });
  }
  show(0);
  return box;
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
 * The family choice for the whole page: a row of chips under the header, and a slim bar with the
 * same choice that stays at the top of the window once the chips have scrolled away.
 *
 * Each chip also says how much of its family the crosscoder names, so the row is a summary
 * before anything is clicked.
 */
function familyBar(
  d: Data,
  famOrder: FamilyOrder,
  onPick: (key: string) => void,
): { root: HTMLElement; set(key: string): void; tools: HTMLElement } {
  const root = el('section', 'fambar');
  const head = el('div', 'fambar-head');
  head.append(
    el('span', 'eyebrow', 'Family'),
    el('span', 'small muted', 'The family you pick applies to all three panels on this page.'),
  );
  const tabs = el('div', 'famtabs');
  root.append(head, tabs);

  const found = d.concepts.filter((c) => c.nf > 0).length;
  const options: [string, string, number, number][] = [
    ['', 'All families', found, d.concepts.length],
    ...famOrder.map(([fam, list]): [string, string, number, number] => [
      fam, fam, list.filter((c) => c.nf > 0).length, list.length,
    ]),
  ];

  const buttons = new Map<string, HTMLButtonElement>();
  for (const [key, label, n, total] of options) {
    const b = el('button', 'famtab');
    b.append(el('span', 'famtab-name', label));
    b.append(el('span', 'famtab-count', `${n} / ${total}`));
    const meter = el('span', 'famtab-bar');
    const fill = el('i');
    fill.style.width = `${total ? (n / total) * 100 : 0}%`;
    meter.append(fill);
    b.append(meter);
    b.addEventListener('click', () => onPick(key));
    buttons.set(key, b);
    tabs.append(b);
  }
  const info = infoButton(
    'the family chips',
    'The family chips',
    'Each chip is one biological family of Swiss-Prot concepts. The first number counts the ' +
      'concepts of the family that at least one latent pairs with. The second number counts ' +
      'all the concepts of the family. The bar shows the same share.\n\n' +
      `For all families that is ${found} of ${d.concepts.length}. A latent pairs with a ` +
      'concept when its F1 per domain is more than 0.5 on two separate halves of the proteins.',
    'pairing',
  );
  info.classList.add('famtabs-info');
  tabs.append(info);

  // The slim bar. It is fixed and not sticky, so it takes no room in the page and the page does
  // not move when it appears.
  const float = el('div', 'famfloat');
  float.hidden = true;
  const inner = el('div', 'famfloat-in');
  const select = el('select');
  select.setAttribute('aria-label', 'Family');
  for (const [key, label, n, total] of options) {
    const o = el('option', undefined, `${label} (${n} / ${total})`);
    o.value = key;
    select.append(o);
  }
  select.addEventListener('change', () => onPick(select.value));
  inner.append(el('span', 'eyebrow', 'Family'), select);
  float.append(inner);
  root.append(float);
  new IntersectionObserver(([e]) => {
    float.hidden = e.isIntersecting || e.boundingClientRect.top > 0;
  }).observe(tabs);

  const set = (key: string) => {
    for (const [k, b] of buttons) b.setAttribute('aria-pressed', String(k === key));
    select.value = key;
  };
  set('');
  return { root, set, tools: inner };
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

function splitPanel(d: Data): SplitHandle {
  const pairs: Pair[] = [];
  for (const c of d.concepts) {
    if (!c.feats?.length) continue;
    const fam = c.fam || 'unassigned';
    for (const [fid, , prec, rec, recd] of c.feats) {
      pairs.push({ fid, concept: c.c, fam, prec, rec, recd });
    }
  }

  const allFound = d.concepts.filter((c) => c.nf > 0);
  const allMulti = allFound.filter((c) => c.nf >= 2);
  const p = panel(
    'Splitting: one concept, several latents',
    'Most latents read only a small part of their concept',
    `A concept is rarely one latent. ${allMulti.length} of the ${allFound.length} found ` +
      'concepts pair with more than one latent, and the median pair reads ' +
      `${pct(median(pairs.map((x) => x.rec)) * 100)} of the annotated residues. The plot shows ` +
      'each pair of a latent and a concept. Up is how often the latent is right when it fires, ' +
      'and across is how much of the annotated region it reads.',
  );
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
      'Point at a concept name to light up its latents, and click the name to keep them lit. ' +
        'The arrow after a name opens the concept page. Point at a dot to name its latent, and ' +
        'click it to open it. Drag a rectangle to zoom in, and press Escape to go back one step.',
    ),
    stats,
    grid,
    note,
  );

  function setFamily(fam: string): void {
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
        ? `The amber dots pair with a concept of ${fam}, and the gray dots with another. `
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
    const light = () => scatter.preview(c.c);
    const restore = () => scatter.preview(null);
    name.addEventListener('mouseenter', light);
    name.addEventListener('focus', light);
    name.addEventListener('mouseleave', restore);
    name.addEventListener('blur', restore);
    name.addEventListener('click', () => {
      pinned = pinned === c.c ? null : c.c;
      for (const b of names) b.setAttribute('aria-pressed', String(b === name && pinned !== null));
      scatter.pin(pinned);
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
  /** Light up one concept while its name is under the pointer. null shows the pinned one again. */
  preview(concept: string | null): void;
  /** Keep one concept lit, and let only its dots answer the pointer. null lets every dot answer. */
  pin(concept: string | null): void;
}

type Span = [number, number];
/** A part of the plot: recall per residue across, precision up. */
interface Area {
  x: Span;
  y: Span;
}

/** About four round tick values over a linear range. */
function linearTicks([lo, hi]: Span): { values: number[]; decimals: number } {
  const raw = (hi - lo) / 4;
  const k = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * k).find((v) => v >= raw)!;
  const values: number[] = [];
  for (let v = Math.ceil(lo / step - 1e-9) * step; v <= hi + 1e-9; v += step) {
    values.push(Math.round(v / step) * step);
  }
  return { values, decimals: Math.max(1, -Math.floor(Math.log10(step))) };
}

/**
 * The scatter of every pair, with a zoom.
 *
 * Many pairs of one concept sit within a few pixels of each other at the left edge, so a
 * rectangle zooms into the part of the plot it encloses. The zooms form a stack, and the back
 * links and the Escape key go back one step.
 */
function splitScatter(pairs: Pair[], family: string): ScatterHandle {
  const W = 640;
  const H = 280;
  const PL = 50;
  const PB = 42;
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
  const axes = add('g', {});
  const dots = add('g', { class: 'dots' });
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
  const brush = add('rect', {
    fill: 'var(--ink)',
    'fill-opacity': 0.06,
    stroke: 'var(--ink)',
    'stroke-dasharray': '3 3',
    visibility: 'hidden',
  });
  add(
    'text',
    { x: PL + iw / 2, y: H - 4, 'text-anchor': 'middle', fill: 'var(--muted)', 'font-size': 11 },
    'Recall per residue: share of the annotated residues it fires on',
  );
  const rot = add(
    'text',
    { x: 12, y: PT + ih / 2, 'text-anchor': 'middle', fill: 'var(--muted)', 'font-size': 11 },
    'Precision: how often it is right when it fires',
  );
  rot.setAttribute('transform', `rotate(-90 12 ${PT + ih / 2})`);

  // A small margin around 0 and 1, so that the many dots at precision 1.0 and at recall 0 sit
  // inside the plot and not on its edge, where a rectangle cannot start.
  const whole: Area = { x: [-0.02, 1.02], y: [-0.02, 1.02] };
  const zooms: Area[] = [whole];
  const area = (): Area => zooms[zooms.length - 1];
  const X = (r: number) => PL + (iw * (r - area().x[0])) / (area().x[1] - area().x[0]);
  const Y = (p: number) => PT + ih - (ih * (p - area().y[0])) / (area().y[1] - area().y[0]);
  const invX = (x: number) => area().x[0] + ((x - PL) / iw) * (area().x[1] - area().x[0]);
  const invY = (y: number) => area().y[0] + ((PT + ih - y) / ih) * (area().y[1] - area().y[0]);
  const inArea = (q: Pair, a = area()) =>
    q.rec >= a.x[0] && q.rec <= a.x[1] && q.prec >= a.y[0] && q.prec <= a.y[1];

  // A latent with two concepts has two dots, one for each pair.
  const byLatent = new Map<number, number[]>();
  pairs.forEach((q, i) => byLatent.set(q.fid, [...(byLatent.get(q.fid) ?? []), i]));

  const box = el('div', 'split-box');
  // The zoom line sits above the plot and always holds one line of text, so the plot does not
  // move when a zoom starts or ends.
  const tools = el('div', 'split-tools small muted');
  const readout = el('div', 'dmap-readout');
  box.append(svg, readout);

  let previewed: string | null = null;
  let pinned: string | null = null;
  let hovered = -1;
  const litConcept = () => previewed ?? pinned;

  function render(): void {
    axes.textContent = '';
    const a = area();
    const xt = linearTicks(a.x);
    const yt = linearTicks(a.y);
    for (const g of yt.values) {
      svgNode(axes, 'line', { x1: PL, y1: Y(g), x2: W - PR, y2: Y(g), stroke: 'var(--line)' });
      svgNode(
        axes,
        'text',
        { x: PL - 6, y: Y(g) + 4, 'text-anchor': 'end', fill: 'var(--muted)', 'font-size': 10.5 },
        g.toFixed(yt.decimals),
      );
    }
    for (const g of xt.values) {
      svgNode(axes, 'line', { x1: X(g), y1: PT, x2: X(g), y2: PT + ih, stroke: 'var(--line)' });
      svgNode(
        axes,
        'text',
        { x: X(g), y: H - PB + 14, 'text-anchor': 'middle', fill: 'var(--muted)', 'font-size': 10.5 },
        g.toFixed(xt.decimals),
      );
    }
    dots.textContent = '';
    // Out of family first, so a dot in the family is never hidden under a muted one.
    for (const pass of [false, true]) {
      for (const q of pairs) {
        const mine = !family || q.fam === family;
        if (mine !== pass || !inArea(q)) continue;
        svgNode(dots, 'circle', {
          cx: X(q.rec).toFixed(1),
          cy: Y(q.prec).toFixed(1),
          r: pass ? 2 : 1.7,
          fill: pass ? 'var(--signal)' : 'var(--line-strong)',
          'fill-opacity': pass ? 0.4 : 0.3,
        });
      }
    }
    drawLit();
    setHover(-1);
    writeTools();
  }

  function drawLit(): void {
    const concept = litConcept();
    lit.textContent = '';
    svg.classList.toggle('dim', concept !== null);
    if (concept === null) return;
    for (const q of pairs) {
      if (q.concept !== concept || !inArea(q)) continue;
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

  function writeTools(): void {
    tools.textContent = '';
    if (zooms.length === 1) {
      tools.append('Drag a rectangle on the plot to zoom in.');
      return;
    }
    const a = area();
    // The margin of the whole plot runs past 0 and 1, and no value lies there.
    const v = (u: number, digits: number) => Math.min(1, Math.max(0, u)).toFixed(digits);
    tools.append(
      el('strong', undefined, 'Zoomed in.'),
      ` Recall ${v(a.x[0], 3)} to ${v(a.x[1], 3)}, precision ${v(a.y[0], 2)} to ${v(a.y[1], 2)}. `,
    );
    const back = el(
      'button',
      'linkish',
      zooms.length > 2 ? 'back one step' : 'back to the whole plot',
    );
    back.addEventListener('click', () => goBack(1));
    tools.append(back);
    if (zooms.length > 2) {
      const all = el('button', 'linkish', 'back to the whole plot');
      all.addEventListener('click', () => goBack(zooms.length - 1));
      tools.append(' ', all);
    }
  }

  function goBack(steps: number): void {
    zooms.length = Math.max(1, zooms.length - steps);
    render();
    box.focus({ preventScroll: true });
  }

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
    const concept = litConcept();
    if (concept === null) return;
    const mine = pairs.filter((q) => q.concept === concept);
    const here = mine.filter((q) => inArea(q)).length;
    readout.append(
      `${show(concept)}: ${mine.length} latents, median precision ` +
        `${median(mine.map((q) => q.prec)).toFixed(2)}, median recall per residue ` +
        `${median(mine.map((q) => q.rec)).toFixed(3)}` +
        (zooms.length > 1 ? `. ${here} of them are in this zoom.` : ''),
    );
  }

  function setHover(i: number): void {
    hovered = i;
    ring.setAttribute('visibility', i >= 0 ? 'visible' : 'hidden');
    siblings.textContent = '';
    if (i >= 0) {
      ring.setAttribute('cx', X(pairs[i].rec).toFixed(1));
      ring.setAttribute('cy', Y(pairs[i].prec).toFixed(1));
      for (const j of byLatent.get(pairs[i].fid) ?? []) {
        if (j === i || !inArea(pairs[j])) continue;
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
  }

  /** The pointer in the units of the viewBox. */
  function toPlot(e: MouseEvent): { x: number; y: number } | null {
    const m = svg.getScreenCTM();
    if (!m) return null;
    const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    return { x: pt.x, y: pt.y };
  }

  const insidePlot = (p: { x: number; y: number }) =>
    p.x >= PL && p.x <= W - PR && p.y >= PT && p.y <= PT + ih;
  const clamp = (p: { x: number; y: number }) => ({
    x: Math.min(Math.max(p.x, PL), W - PR),
    y: Math.min(Math.max(p.y, PT), PT + ih),
  });

  /**
   * The pair under the pointer, or -1. The radius is in plot units, about 10 px on screen. With
   * a pinned concept, only its pairs answer, so a reader can step through one concept's dots
   * without the dots of other concepts in the way.
   */
  function pairAt(p: { x: number; y: number }): number {
    let best = -1;
    let bestD = 36;
    pairs.forEach((q, i) => {
      if (pinned !== null && q.concept !== pinned) return;
      if (!inArea(q)) return;
      const dx = X(q.rec) - p.x;
      const dy = Y(q.prec) - p.y;
      const dd = dx * dx + dy * dy;
      if (dd < bestD) {
        bestD = dd;
        best = i;
      }
    });
    return best;
  }

  let dragFrom: { x: number; y: number } | null = null;

  function onDragMove(e: MouseEvent): void {
    const p = toPlot(e);
    if (!dragFrom || !p) return;
    const to = clamp(p);
    brush.setAttribute('x', String(Math.min(dragFrom.x, to.x)));
    brush.setAttribute('y', String(Math.min(dragFrom.y, to.y)));
    brush.setAttribute('width', String(Math.abs(to.x - dragFrom.x)));
    brush.setAttribute('height', String(Math.abs(to.y - dragFrom.y)));
    brush.setAttribute('visibility', 'visible');
  }

  function onDragEnd(e: MouseEvent): void {
    removeEventListener('mousemove', onDragMove);
    removeEventListener('mouseup', onDragEnd);
    brush.setAttribute('visibility', 'hidden');
    const p = toPlot(e);
    const from = dragFrom;
    dragFrom = null;
    if (!from || !p) return;
    const to = clamp(p);
    // A drag shorter than 4 plot units in both directions is a click, not a rectangle.
    if (Math.abs(to.x - from.x) < 4 && Math.abs(to.y - from.y) < 4) {
      const i = pairAt(from);
      if (i >= 0) location.hash = `/latent/${pairs[i].fid}`;
      return;
    }
    const next: Area = {
      x: [invX(Math.min(from.x, to.x)), invX(Math.max(from.x, to.x))],
      y: [invY(Math.max(from.y, to.y)), invY(Math.min(from.y, to.y))],
    };
    if (!pairs.some((q) => inArea(q, next))) {
      readout.textContent = 'No dot is inside that rectangle.';
      return;
    }
    zooms.push(next);
    render();
  }

  svg.addEventListener('mousedown', (e) => {
    const p = toPlot(e);
    if (!p || !insidePlot(p)) return;
    e.preventDefault();
    box.focus({ preventScroll: true });
    dragFrom = p;
    addEventListener('mousemove', onDragMove);
    addEventListener('mouseup', onDragEnd);
  });

  svg.addEventListener('mousemove', (e) => {
    if (dragFrom) return;
    const p = toPlot(e);
    if (!p) return;
    const i = insidePlot(p) ? pairAt(p) : -1;
    svg.style.cursor = i >= 0 ? 'pointer' : insidePlot(p) ? 'crosshair' : 'default';
    if (i !== hovered) setHover(i);
  });
  svg.addEventListener('mouseleave', () => {
    if (!dragFrom) setHover(-1);
  });

  // Escape goes back one zoom. It listens on the plot, which takes the focus on a click, so that
  // it does not also go back in the depth map.
  box.tabIndex = 0;
  box.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && zooms.length > 1) goBack(1);
  });

  // The corners are named under the plot and not inside it. Text inside a scatter sits on top
  // of the dots it is describing, and at 10 px over 1080 overlapping marks it cannot be read.
  const wrap = el('div');
  wrap.append(tools, box);
  const corners = el('dl', 'cornerkey');
  const put = (k: string, v: string) => {
    corners.append(el('dt', undefined, k));
    corners.append(el('dd', undefined, v));
  };
  put('top left', 'right when it fires, and reads a sliver of the region.');
  put('top right', 'right when it fires, and reads all of the region.');
  put(
    'bottom',
    'wrong more often than right. No pair sits below 1/3, because a precision that low cannot ' +
      'reach an F1 per domain above 0.5.',
  );
  wrap.append(corners);

  render();
  return {
    root: wrap,
    preview(concept) {
      previewed = concept;
      drawLit();
      writeReadout();
    },
    pin(concept) {
      pinned = concept;
      previewed = null;
      drawLit();
      setHover(-1);
    },
  };
}
