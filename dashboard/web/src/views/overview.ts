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

const ROLES = ['catalytic', 'binding', 'structural', 'PTM', 'targeting', 'disorder'];

export function renderOverview(d: Data, host: HTMLElement): void {
  host.textContent = '';
  const views = el('div', 'views');
  host.append(views);

  let roleFilter = '';
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

  const p = panel(
    'Concepts',
    'What the crosscoder found',
    'Every Swiss-Prot concept in the evaluation set, grouped by what the annotation is ' +
      'biologically. A concept counts as found when at least one latent pairs with it on the ' +
      'held-out set. Open a concept to see which latents detect it and where.',
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
    b.addEventListener('click', () => {
      family = key;
      draw();
    });
    tabButtons.set(key, b);
    tabs.append(b);
  };
  const allFound = d.concepts.filter((c) => c.nf > 0).length;
  makeTab('', 'all families', allFound, d.concepts.length);
  for (const [fam, list] of famOrder) {
    makeTab(fam, fam, list.filter((c) => c.nf > 0).length, list.length);
  }
  p.append(tabs);

  const controls = el('div', 'chips');
  const search = el('input');
  search.type = 'search';
  search.placeholder = 'Filter this list';
  search.addEventListener('input', () => {
    query = search.value.trim();
    draw();
  });
  controls.append(search);
  for (const r of ['', ...ROLES]) {
    const b = el('button', undefined, r || 'all roles');
    b.setAttribute('aria-pressed', String(roleFilter === r));
    b.addEventListener('click', () => {
      roleFilter = r;
      controls.querySelectorAll('button').forEach((x) =>
        x.setAttribute('aria-pressed', String((x.textContent || '') === (r || 'all roles'))),
      );
      draw();
    });
    controls.append(b);
  }
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
      const match = list.filter(
        (c) =>
          c.nf > 0 &&
          (!roleFilter || c.role === roleFilter) &&
          (!q || c.c.toLowerCase().includes(q)),
      );
      if (match.length === 0) continue;
      any = true;
      const g = el('div', 'famgroup');
      const head = el('div', 'famhead');
      head.append(el('h3', undefined, fam));
      const inFamily = list.filter(
        (c) => (!roleFilter || c.role === roleFilter) && (!q || c.c.toLowerCase().includes(q)),
      );
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
              c.bf === undefined ? '—' : link(`/feature/${c.bf}`, `f/${c.bf}`, 'mono'),
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
  }

  draw();

  views.append(splitPanel(d));

  // Where the latents live in the encoder, and which of them anything named.
  const depthPanel = panel(
    'Depth',
    'What it names lives in the middle of the encoder',
    'Each latent writes into all 24 encoder layers, and the layer it writes hardest into is its ' +
      'peak. A per-layer sparse autoencoder cannot state this, because its features are separate ' +
      'models with no correspondence between layers.',
  );
  const map = depthMap(d);
  depthPanel.append(map.root);
  views.append(depthPanel);
  map.mount();
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
function splitPanel(d: Data): HTMLElement {
  const pairs: { fid: number; concept: string; prec: number; rec: number }[] = [];
  const multi: Concept[] = [];
  for (const c of d.concepts) {
    if (!c.feats?.length) continue;
    if (c.nf >= 2) multi.push(c);
    for (const [fid, , prec, rec] of c.feats) {
      pairs.push({ fid, concept: c.c, prec, rec });
    }
  }
  const found = d.concepts.filter((c) => c.nf > 0);
  const med = (xs: number[]) => {
    const a = [...xs].sort((x, y) => x - y);
    const m = a.length >> 1;
    return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
  };
  const nf = med(found.map((c) => c.nf));
  const mostSplit = [...multi].sort((a, b) => b.nf - a.nf).slice(0, 6);

  const p = panel(
    'Splitting',
    'One concept, several latents',
    'A concept is rarely one feature. Most are detected by a group of latents, and each one ' +
      'fires where the concept is but covers only part of it.',
  );
  p.append(
    figures([
      [`${multi.length} of ${found.length}`, 'found concepts take more than one latent'],
      [String(nf), 'latents for the median found concept'],
      [String(Math.max(...found.map((c) => c.nf))), 'latents for the most split one'],
      [med(pairs.map((x) => x.prec)).toFixed(2), 'median precision of a pair'],
      [med(pairs.map((x) => x.rec)).toFixed(3), 'median recall per residue'],
    ]),
  );

  const wrap = el('div', 'splitwrap');
  wrap.append(splitScatter(pairs));
  wrap.append(splitSketch());
  p.append(wrap);

  p.append(
    el(
      'p',
      'small muted',
      `Every one of the ${num(pairs.length)} dots is one latent paired with one concept. A ` +
        'crosscoder that had learned whole concepts would fill the top right corner, where a ' +
        'latent is right when it fires and also reads the whole region. This one fills the top ' +
        'left.',
    ),
  );

  const links = el('p', 'small muted');
  links.append('The most split: ');
  mostSplit.forEach((c, i) => {
    if (i) links.append(' · ');
    links.append(
      link(`/concept/${encodeURIComponent(c.c)}`, `${c.c.split('_').slice(1).join('_')} (${c.nf})`),
    );
  });
  p.append(links);
  return p;
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

/** What a dot in the top left actually looks like on a protein. */
function splitSketch(): HTMLElement {
  const W = 250;
  const H = 232;
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('width', '100%');
  svg.style.display = 'block';
  svg.style.maxWidth = `${W}px`;

  const x0 = 64;
  const n = 30;
  const cw = 6;
  const strip = (y: number, name: string, spans: [number, number][], color: string) => {
    svgNode(svg, 'text', {
      x: x0 - 7, y: y + 9, 'text-anchor': 'end', fill: 'var(--muted)', 'font-size': 9,
    }, name);
    for (let i = 0; i < n; i++) {
      const on = spans.some(([a, b]) => i >= a && i <= b);
      svgNode(svg, 'rect', {
        x: x0 + i * cw, y, width: cw - 1, height: 11, rx: 1,
        fill: on ? color : 'var(--surface-2)',
      });
    }
  };

  svgNode(svg, 'text', { x: 4, y: 10, 'font-size': 10, fill: 'var(--ink-2)' }, 'What a top-left dot is');
  strip(20, 'the region', [[6, 25]], 'var(--accent)');
  strip(40, 'latent A', [[6, 10]], 'var(--signal)');
  strip(54, 'latent B', [[13, 16]], 'var(--signal)');
  strip(68, 'latent C', [[21, 25]], 'var(--signal)');
  svgNode(svg, 'text', {
    x: x0, y: 96, 'font-size': 9.5, fill: 'var(--muted)',
  }, 'each right when it fires,');
  svgNode(svg, 'text', {
    x: x0, y: 108, 'font-size': 9.5, fill: 'var(--muted)',
  }, 'each reading a quarter');

  svgNode(svg, 'line', { x1: 4, y1: 124, x2: W - 4, y2: 124, stroke: 'var(--line)' });

  svgNode(svg, 'text', { x: 4, y: 142, 'font-size': 10, fill: 'var(--ink-2)' }, 'What a top-right dot would be');
  strip(152, 'the region', [[6, 25]], 'var(--accent)');
  strip(172, 'one latent', [[6, 25]], 'var(--signal)');
  svgNode(svg, 'text', {
    x: x0, y: 200, 'font-size': 9.5, fill: 'var(--muted)',
  }, 'right when it fires, and');
  svgNode(svg, 'text', {
    x: x0, y: 212, 'font-size': 9.5, fill: 'var(--muted)',
  }, 'reading all of the region');

  const wrap = el('div', 'gl-pic');
  wrap.append(svg);
  return wrap;
}

function splitScatter(
  pairs: { fid: number; concept: string; prec: number; rec: number }[],
): HTMLElement {
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
  for (const q of pairs) {
    const dot = add('circle', {
      cx: X(q.rec).toFixed(1),
      cy: Y(q.prec).toFixed(1),
      r: 2,
      fill: 'var(--signal)',
      'fill-opacity': 0.4,
    });
    const t = document.createElementNS(NS, 'title');
    t.textContent = `f/${q.fid}  ${q.concept.replace('_', ' · ')}`;
    dot.append(t);
  }
  // The two corners the reader has to be told about. An empty corner is the finding.
  add(
    'text',
    { x: PL + 8, y: PT + 12, fill: 'var(--ink-2)', 'font-size': 10 },
    'right when it fires, reads a sliver',
  );
  const tr = add(
    'text',
    { x: W - PR - 8, y: PT + 12, 'text-anchor': 'end', fill: 'var(--muted)', 'font-size': 10 },
    'right when it fires, reads all of it',
  );
  tr.setAttribute('font-style', 'italic');
  add(
    'text',
    { x: PL + 8, y: PT + ih - 6, fill: 'var(--muted)', 'font-size': 10 },
    'wrong more often than right',
  );
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
  const wrap = el('div');
  wrap.append(svg);
  return wrap;
}
