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
import { coverageBar, el, figures, link, num, panel, row, table } from '../ui';

export function renderOverview(d: Data, host: HTMLElement): void {
  host.textContent = '';
  const views = el('div', 'views');
  host.append(views);

  let query = '';

  // Families, most found concepts first. The tab row is also the summary: it says how much of
  // each family the crosscoder names before a single table is opened.
  const families = new Map<string, Concept[]>();
  for (const c of d.concepts) {
    const fam = c.fam || 'unassigned';
    if (!families.has(fam)) families.set(fam, []);
    families.get(fam)!.push(c);
  }
  const famOrder = [...families.entries()].sort(
    (a, b) => b[1].filter((c) => c.nf > 0).length - a[1].filter((c) => c.nf > 0).length,
  );
  let family = famOrder[0]?.[0] ?? '';

  const bar = panel(
    'Filter',
    'One biological family at a time',
    'All 408 concepts at once is 187 rows of table, and the two panels below it never get read. ' +
      'So the table shows one family. The same choice runs the whole page: the two plots below ' +
      'keep every latent and every pairing, and only colour the family you pick. Nothing is ' +
      'removed from them. Pick "all families" to colour everything.',
  );
  views.append(bar);

  const p = panel(
    'Concepts',
    'What the crosscoder found',
    'Every Swiss-Prot concept in the evaluation set, grouped by what the annotation is ' +
      'biologically. A concept counts as found when at least one latent pairs with it. A latent ' +
      'pairs with a concept when its F1 per domain is more than 0.5 on a held-out set of ' +
      'proteins. Open a concept to see which latents detect it, and where.',
  );

  const tabs = el('div', 'famtabs');
  const tabButtons = new Map<string, HTMLButtonElement>();
  const makeTab = (key: string, label: string, found: number, total: number) => {
    const b = el('button', 'famtab');
    b.append(el('span', 'famtab-name', label));
    b.append(el('span', 'famtab-count', `${found} / ${total}`));
    const bar = el('span', 'famtab-bar');
    const fill = el('i');
    fill.style.width = `${total ? (found / total) * 100 : 0}%`;
    bar.append(fill);
    b.append(bar);
    // One family selection runs the whole page. The two panels below were fixed while the tabs
    // moved, so a reader who picked a family saw a plot about a different set.
    b.addEventListener('click', () => {
      family = key;
      draw();
      split.setFamily(key);
      map.setFamily(key);
    });
    tabButtons.set(key, b);
    tabs.append(b);
  };
  bar.append(tabs);
  const allFound = d.concepts.filter((c) => c.nf > 0).length;
  makeTab('', 'all families', allFound, d.concepts.length);
  for (const [fam, list] of famOrder) {
    makeTab(fam, fam, list.filter((c) => c.nf > 0).length, list.length);
  }

  const controls = el('div', 'chips');
  const search = el('input');
  search.type = 'search';
  search.placeholder = 'Filter this list';
  search.addEventListener('input', () => {
    query = search.value.trim();
    draw();
  });
  controls.append(search);
  p.append(controls);

  const body = el('div');
  p.append(body);
  views.append(p);

  function draw() {
    body.textContent = '';
    for (const [key, b] of tabButtons) b.setAttribute('aria-pressed', String(key === family));
    const q = query.toLowerCase();

    // A search runs over every family, because a reader who types a name does not know which
    // family it is in. That is the one case the tabs step aside for.
    const searching = q.length > 0;
    const shown = searching || family === '' ? famOrder : famOrder.filter(([f]) => f === family);

    let any = false;
    for (const [fam, list] of shown) {
      const match = list.filter((c) => c.nf > 0 && (!q || c.c.toLowerCase().includes(q)));
      if (match.length === 0) continue;
      any = true;
      const g = el('div', 'famgroup');
      const head = el('div', 'famhead');
      head.append(el('h3', undefined, fam));
      const inFamily = list.filter((c) => !q || c.c.toLowerCase().includes(q));
      head.append(coverageBar(match.length, inFamily.length, 130));
      head.append(el('span', 'sub', `${inFamily.reduce((a, c) => a + c.nf, 0)} latents`));
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
      const scroll = el('div', 'tbl-scroll tbl-capped');
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
      g.append(
        el(
          'p',
          'small muted',
          'The rows are in the default order, which is best F1, highest first. Click a column ' +
            'header to sort by it.',
        ),
      );
      body.append(g);
    }
    if (!any) body.append(el('p', 'loading', 'Nothing matches that filter.'));
  }

  const split = splitPanel(d);
  views.append(split.root);

  // Where the latents live in the encoder, and which of them anything named.
  const depthPanel = panel(
    'Depth',
    'What it names lives in the middle of the encoder',
    'Each latent adds a vector to all 24 encoder layers. The length of that vector is how much ' +
      'the latent changes that layer. The peak layer is the layer where the vector is longest. ' +
      'A per-layer sparse autoencoder has no peak layer. It trains one model for each layer, ' +
      'and a unit in one model has no counterpart in the next.',
  );
  const map = depthMap(d);
  depthPanel.append(map.root);
  views.append(depthPanel);
  draw();
  split.setFamily(family);
  map.mount();
  map.setFamily(family);
}

/**
 * The second finding: the crosscoder almost never learns one concept as one feature.
 *
 * The scatter is the evidence rather than a decoration. Every dot is one latent paired with one
 * concept, placed by how much of the annotated region it covers against how often it is right
 * when it fires. A model that learned whole concepts would fill the top right. This one fills
 * the top left, which is many precise latents each reading part of a region.
 *
 * The corners are labelled and a sketch sits beside the plot, because a dot at (0.09, 0.54) says
 * nothing to a reader who has not been told what the two axes buy.
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

function splitPanel(d: Data): SplitHandle {
  const pairs: Pair[] = [];
  for (const c of d.concepts) {
    if (!c.feats?.length) continue;
    const fam = c.fam || 'unassigned';
    for (const [fid, , prec, rec, recd] of c.feats) {
      pairs.push({ fid, concept: c.c, fam, prec, rec, recd });
    }
  }
  const med = (xs: number[]) => {
    if (xs.length === 0) return 0;
    const a = [...xs].sort((x, y) => x - y);
    const m = a.length >> 1;
    return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
  };

  const p = panel(
    'Splitting',
    'One concept, several latents',
    'A concept is rarely one latent. A group of latents detects most concepts, and each latent ' +
      'in the group fires where the concept is and covers only a part of it.',
  );
  const stats = el('div');
  const plot = el('div');
  const note = el('p', 'small muted');
  const links = el('p', 'small muted');
  p.append(stats, plot, note, links);

  const allFound = d.concepts.filter((c) => c.nf > 0);
  const allMulti = allFound.filter((c) => c.nf >= 2);

  function setFamily(fam: string): void {
    const found = d.concepts.filter((c) => c.nf > 0 && (!fam || (c.fam || 'unassigned') === fam));
    const multi = found.filter((c) => c.nf >= 2);
    const mine = fam ? pairs.filter((x) => x.fam === fam) : pairs;
    const most = [...multi].sort((a, b) => b.nf - a.nf).slice(0, 6);
    // Under a family the figures describe that family, so the whole set goes beside each one.
    // Otherwise a reader who picks a family reads a smaller finding and never learns it is one.
    const all = (v: string) => (fam ? ` (all families: ${v})` : '');

    stats.textContent = '';
    stats.append(
      figures([
        [
          `${multi.length} of ${found.length}`,
          'found concepts take more than one latent' +
            all(`${allMulti.length} of ${allFound.length}`),
        ],
        [
          String(med(found.map((c) => c.nf))),
          'latents for the median found concept' + all(String(med(allFound.map((c) => c.nf)))),
        ],
        [
          String(found.length ? Math.max(...found.map((c) => c.nf)) : 0),
          'latents for the most split concept' +
            all(String(Math.max(...allFound.map((c) => c.nf)))),
        ],
        [
          med(mine.map((x) => x.prec)).toFixed(2),
          'median precision of a pair' + all(med(pairs.map((x) => x.prec)).toFixed(2)),
        ],
        [
          med(mine.map((x) => x.rec)).toFixed(3),
          'median recall per residue' + all(med(pairs.map((x) => x.rec)).toFixed(3)),
        ],
        ...(mine.some((x) => x.recd !== undefined)
          ? ([[
              med(mine.filter((x) => x.recd !== undefined).map((x) => x.recd!)).toFixed(3),
              'median recall per domain' +
                all(med(pairs.filter((x) => x.recd !== undefined)
                  .map((x) => x.recd!)).toFixed(3)),
            ]] as [string, string][])
          : []),
      ]),
    );

    plot.textContent = '';
    plot.append(splitScatter(pairs, fam));

    note.textContent =
      (fam
        ? `${num(mine.length)} of the ${num(pairs.length)} dots are a latent paired with a ` +
          `concept of ${fam}, and they are the amber ones. Every other dot is grey. `
        : `Every one of the ${num(pairs.length)} dots is one latent paired with one concept. `) +
      'A crosscoder that had learned whole concepts would fill the top right corner. A latent ' +
      'there is right when it fires and also reads the whole region. This one fills the top ' +
      'left.';

    links.textContent = '';
    if (most.length) {
      links.append(fam ? `The most split in ${fam}: ` : 'The most split: ');
      most.forEach((c, i) => {
        if (i) links.append(' · ');
        links.append(
          // The full name, not the part after the underscore. `Zinc finger_any` is a roll-up over
          // a whole Swiss-Prot field, and its tail alone reads as "any".
          link(`/concept/${encodeURIComponent(c.c)}`, `${c.c.replace('_', ' · ')} (${c.nf})`),
        );
      });
    }
  }

  return { root: p, setFamily };
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

function splitScatter(pairs: Pair[], family: string): HTMLElement {
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
  // Out of family first, so a dot in the family is never hidden under a muted one.
  for (const pass of [false, true]) {
    for (const q of pairs) {
      const mine = !family || q.fam === family;
      if (mine !== pass) continue;
      const dot = add('circle', {
        cx: X(q.rec).toFixed(1),
        cy: Y(q.prec).toFixed(1),
        r: pass ? 2 : 1.7,
        fill: pass ? 'var(--signal)' : 'var(--line-strong)',
        'fill-opacity': pass ? 0.4 : 0.3,
      });
      const t = document.createElementNS(NS, 'title');
      t.textContent = `f/${q.fid}  ${q.concept.replace('_', ' · ')}  ${q.fam}`;
      dot.append(t);
    }
  }
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
  // The corners are named under the plot and not inside it. Text inside a scatter sits on top
  // of the dots it is describing, and at 10 px over 1080 overlapping marks it cannot be read.
  const wrap = el('div');
  wrap.append(svg);
  const corners = el('dl', 'cornerkey');
  const put = (k: string, v: string) => {
    corners.append(el('dt', undefined, k));
    corners.append(el('dd', undefined, v));
  };
  put('top left', 'right when it fires, and reads a sliver of the region.');
  put('top right', 'right when it fires, and reads all of the region.');
  put('bottom', 'wrong more often than right.');
  wrap.append(corners);
  return wrap;
}
