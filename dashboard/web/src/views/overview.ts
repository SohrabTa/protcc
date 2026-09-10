/**
 * The landing page: what the crosscoder knows, grouped by biology.
 *
 * Concepts are grouped by their biological family rather than by the Swiss-Prot field name they
 * came from. The field name puts 82.6% of the paired latents in one bucket and tells a reader
 * nothing; the family split gives 9.01 effective buckets against 1.95. See
 * `documentation/experiments/09-feature-dashboard.md`.
 */

import type { Concept, Data } from '../data';
import { depthMap } from '../depthmap';
import { coverageBar, el, link, panel, row, table } from '../ui';

const ROLES = ['catalytic', 'binding', 'structural', 'PTM', 'targeting', 'disorder'];

export function renderOverview(d: Data, host: HTMLElement): void {
  host.textContent = '';
  const views = el('div', 'views');
  host.append(views);

  let roleFilter = '';
  let query = '';

  const p = panel(
    'Concepts',
    'What the crosscoder found',
    'Every Swiss-Prot concept in the evaluation set, grouped by what the annotation is ' +
      'biologically. A concept counts as found when at least one latent pairs with it on the ' +
      'held-out set. Open a concept to see which latents detect it and where.',
  );

  const controls = el('div', 'chips');
  const search = el('input');
  search.type = 'search';
  search.placeholder = 'Filter this list';
  search.addEventListener('input', () => {
    query = search.value.trim();
    if (/^f\/?\d+$/i.test(query)) return; // handled on Enter
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
    const q = query.toLowerCase();
    const byFamily = new Map<string, Concept[]>();
    for (const c of d.concepts) {
      if (roleFilter && c.role !== roleFilter) continue;
      if (q && !c.c.toLowerCase().includes(q)) continue;
      const fam = c.fam || 'unassigned';
      if (!byFamily.has(fam)) byFamily.set(fam, []);
      byFamily.get(fam)!.push(c);
    }
    if (byFamily.size === 0) {
      body.append(el('p', 'loading', 'Nothing matches that filter.'));
      return;
    }
    const fams = [...byFamily.entries()].sort(
      (a, b) => b[1].filter((c) => c.nf > 0).length - a[1].filter((c) => c.nf > 0).length,
    );
    for (const [fam, list] of fams) {
      const found = list.filter((c) => c.nf > 0);
      const g = el('div', 'famgroup');
      const head = el('div', 'famhead');
      head.append(el('h3', undefined, fam));
      head.append(coverageBar(found.length, list.length, 130));
      const latents = list.reduce((a, c) => a + c.nf, 0);
      head.append(el('span', 'sub', `${latents} latents`));
      g.append(head);

      const { root, body: tb } = table(
        ['Concept', 'Best F1', 'Latents', 'Proteins', 'Best latent'],
        [0],
      );
      for (const c of found.sort((a, b) => b.f1 - a.f1)) {
        tb.append(
          row(
            [
              link(`/concept/${encodeURIComponent(c.c)}`, c.c.replace('_', ' · ')),
              c.f1.toFixed(3),
              String(c.nf),
              c.npr === undefined ? '—' : String(c.npr),
              c.bf === undefined ? '—' : link(`/feature/${c.bf}`, `f/${c.bf}`, 'mono'),
            ],
            [0],
          ),
        );
      }
      const missed = list.length - found.length;
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
    el(
      'p',
      'lede',
      `${multi.length} of the ${found.length} named concepts are found by more than one latent, ` +
        `a median of ${nf} and as many as ${Math.max(...found.map((c) => c.nf))}. Over all ` +
        `${pairs.length.toLocaleString('en-US')} latent-concept pairs the median precision is ` +
        `${med(pairs.map((x) => x.prec)).toFixed(2)} and the median per-residue recall is ` +
        `${med(pairs.map((x) => x.rec)).toFixed(3)}.`,
    ),
  );
  p.append(splitScatter(pairs));
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

function splitScatter(
  pairs: { fid: number; concept: string; prec: number; rec: number }[],
): HTMLElement {
  const ns = 'http://www.w3.org/2000/svg';
  const W = 640;
  const H = 260;
  const PL = 44;
  const PB = 36;
  const PT = 12;
  const PR = 12;
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
    const t = document.createElementNS(ns, 'title');
    t.textContent = `f/${q.fid}  ${q.concept.replace('_', ' · ')}`;
    dot.append(t);
  }
  add(
    'text',
    { x: PL + iw / 2, y: H - 4, 'text-anchor': 'middle', fill: 'var(--muted)', 'font-size': 9 },
    'per-residue recall: how much of the annotated region it covers',
  );
  const rot = add(
    'text',
    { x: 11, y: PT + ih / 2, 'text-anchor': 'middle', fill: 'var(--muted)', 'font-size': 9 },
    'precision',
  );
  rot.setAttribute('transform', `rotate(-90 11 ${PT + ih / 2})`);
  const wrap = el('div');
  wrap.append(svg);
  return wrap;
}
