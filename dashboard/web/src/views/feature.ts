/**
 * One latent: what it responds to, where in the encoder it lives, and the proteins it fires on.
 *
 * The protein list is the complete ranking, not a sample of it, so the activation bands are
 * percentile slices of the real distribution rather than a reservoir sample.
 */

import { Data, type Feature } from '../data';
import { activationStrip, el, link, panel, pct, row, table } from '../ui';

const BANDS: [string, number, number][] = [
  ['strongest', 0.8, 1.0],
  ['0.6 to 0.8', 0.6, 0.8],
  ['0.4 to 0.6', 0.4, 0.6],
  ['0.2 to 0.4', 0.2, 0.4],
  ['weakest', 0.0, 0.2],
];

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
  lede.append(
    f.c
      ? `Best paired with ${f.c.replace('_', ' · ')} at F1 ${f.f1!.toFixed(3)} per domain. `
      : 'No Swiss-Prot concept pairs with this latent. ',
    `It writes hardest at layer ${f.pk} of ${d.nLayers}, and holds at least half that strength ` +
      `across ${f.sp} layers. It fires on ${pct(f.pp, 2)} of the proteins in the evaluation set, ` +
      `covering ${pct(f.pw)} of a protein when it does.`,
  );
  p.append(lede);
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
  depthPanel.append(depthChart(d, fid, f));
  grid.append(depthPanel);

  const listPanel = panel('Proteins', 'Where it fires');
  const listBody = el('div');
  listPanel.append(listBody);
  grid.append(listPanel);
  views.append(grid);

  const evPanel = panel(
    'Evidence',
    'The activation along each protein',
    'Pick a band to see what a weaker activation looks like. A latent that only makes sense at ' +
      'its strongest is worth doubting.',
  );
  const bandRow = el('div', 'chips');
  const evBody = el('div');
  evPanel.append(bandRow, evBody);
  views.append(evPanel);

  const rank = await d.ranking(fid);
  listBody.append(
    el(
      'p',
      'small muted',
      `${rank.protein.length.toLocaleString('en-US')} proteins, strongest first.`,
    ),
  );
  const { root, body } = table(['Protein', 'Peak', 'Covers'], [0]);
  for (let i = 0; i < Math.min(12, rank.protein.length); i++) {
    const acc = d.proteinIds[rank.protein[i]];
    body.append(
      row(
        [
          link(`/protein/${acc}`, acc, 'mono'),
          (rank.value[i] / 255).toFixed(2),
          pct((rank.cover[i] / 255) * 100, 0),
        ],
        [0],
      ),
    );
  }
  const scroll = el('div', 'tbl-scroll');
  scroll.append(root);
  listBody.append(scroll);

  let band = 0;
  for (let i = 0; i < BANDS.length; i++) {
    const [label] = BANDS[i];
    const b = el('button', undefined, label);
    b.setAttribute('aria-pressed', String(i === band));
    b.addEventListener('click', () => {
      band = i;
      bandRow.querySelectorAll('button').forEach((x, j) =>
        x.setAttribute('aria-pressed', String(j === band)),
      );
      void drawBand(d, fid, rank, band, evBody);
    });
    bandRow.append(b);
  }
  await drawBand(d, fid, rank, band, evBody);
}

async function drawBand(
  d: Data,
  fid: number,
  rank: { protein: Uint32Array; value: Uint8Array },
  band: number,
  host: HTMLElement,
): Promise<void> {
  host.textContent = '';
  const [, lo, hi] = BANDS[band];
  const picked: string[] = [];
  for (let i = 0; i < rank.protein.length && picked.length < 5; i++) {
    const v = rank.value[i] / 255;
    if (v > lo && v <= hi) {
      const acc = d.proteinIds[rank.protein[i]];
      if (d.hasTrack(acc)) picked.push(acc);
    }
  }
  if (picked.length === 0) {
    host.append(
      el(
        'p',
        'warn',
        'No protein in this band has a track in this data tree. The smoke build covers one ' +
          'shard of 208.',
      ),
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
}

function depthChart(d: Data, fid: number, f: Feature): HTMLElement {
  const { norm, cos } = d.depthOf(fid);
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
  const legend = el('p', 'small muted');
  legend.append(
    'The solid line is how hard the latent writes into each layer, scaled to its own peak. ' +
      'The dashed line is how closely each layer’s direction matches the peak layer’s: 1 is the ' +
      'same direction, 0 is unrelated. Layer norms are corrected for the residual stream growing ' +
      'about 600-fold across depth, without which every latent appears to peak at layer 24.',
  );
  wrap.append(legend);
  return wrap;
}
