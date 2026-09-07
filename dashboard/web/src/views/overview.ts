/**
 * The landing page: what the crosscoder knows, grouped by biology.
 *
 * Concepts are grouped by their biological family rather than by the Swiss-Prot field name they
 * came from. The field name puts 82.6% of the paired latents in one bucket and tells a reader
 * nothing; the family split gives 9.01 effective buckets against 1.95. See
 * `documentation/experiments/09-feature-dashboard.md`.
 */

import type { Concept, Data } from '../data';
import { coverageBar, el, link, panel, pct, row, table } from '../ui';

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
  search.placeholder = 'Filter concepts, latents (f/1819) or proteins (Q03217)';
  search.addEventListener('input', () => {
    query = search.value.trim();
    if (/^f\/?\d+$/i.test(query)) return; // handled on Enter
    draw();
  });
  search.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const q = search.value.trim();
    const m = /^f\/?(\d+)$/i.exec(q);
    if (m) location.hash = `/feature/${m[1]}`;
    else if (d.proteinShard.has(q.toUpperCase())) location.hash = `/protein/${q.toUpperCase()}`;
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

  // Where the latents live in the encoder.
  const depthPanel = panel(
    'Depth',
    'Where each concept lives in the encoder',
    'Each latent writes into all 24 encoder layers. The layer where it writes hardest is its ' +
      'peak. A per-layer sparse autoencoder cannot state this, because its features are separate ' +
      'models with no correspondence between layers.',
  );
  depthPanel.append(peakHistogram(d));
  views.append(depthPanel);
}

function peakHistogram(d: Data): HTMLElement {
  const counts = new Array(d.nLayers).fill(0);
  for (const f of d.features) counts[f.pk - 1]++;
  const max = Math.max(...counts);
  const W = 1000;
  const H = 170;
  const PL = 40;
  const PB = 30;
  const PT = 10;
  const iw = W - PL - 10;
  const ih = H - PT - PB;
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('width', '100%');
  svg.style.display = 'block';
  svg.style.marginTop = '10px';

  const add = (t: string, attrs: Record<string, string | number>, text?: string) => {
    const n = document.createElementNS(ns, t);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
    if (text !== undefined) n.textContent = text;
    svg.append(n);
    return n;
  };
  for (const f of [0, 0.5, 1]) {
    const y = PT + ih - ih * f;
    add('line', { x1: PL, y1: y, x2: W - 10, y2: y, stroke: 'var(--line)' });
    add(
      'text',
      { x: PL - 6, y: y + 3, 'text-anchor': 'end', fill: 'var(--muted)', 'font-size': 9 },
      String(Math.round(max * f)),
    );
  }
  const bw = iw / d.nLayers;
  counts.forEach((c, i) => {
    const h = ih * (c / max);
    add('rect', {
      x: PL + i * bw + 1.5,
      y: PT + ih - h,
      width: bw - 3,
      height: h,
      fill: 'var(--accent)',
    });
    if (i % 2 === 0 || i === d.nLayers - 1) {
      add(
        'text',
        {
          x: PL + i * bw + bw / 2,
          y: H - 14,
          'text-anchor': 'middle',
          fill: 'var(--muted)',
          'font-size': 9,
        },
        String(i + 1),
      );
    }
  });
  add(
    'text',
    { x: PL + iw / 2, y: H - 2, 'text-anchor': 'middle', fill: 'var(--muted)', 'font-size': 9 },
    'ProtT5 encoder layer',
  );
  const wrap = el('div');
  wrap.append(svg);
  const median = [...d.features].sort((a, b) => a.pk - b.pk)[Math.floor(d.features.length / 2)];
  wrap.append(
    el(
      'p',
      'small muted',
      `${d.features.length.toLocaleString('en-US')} live latents, median peak layer ` +
        `${median.pk}. A latent holds at least half its peak strength across ` +
        `${medianSpread(d)} layers, so it is not confined to one.`,
    ),
  );
  return wrap;
}

function medianSpread(d: Data): number {
  const sp = d.features.map((f) => f.sp).sort((a, b) => a - b);
  return sp[Math.floor(sp.length / 2)];
}

export { pct };
