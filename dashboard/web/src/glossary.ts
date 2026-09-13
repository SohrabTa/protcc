/**
 * The page that explains every number the dashboard prints.
 *
 * The definitions are drawn rather than described. Precision and recall over a protein are two
 * counts on one picture, and a reader who sees the picture once does not have to re-read the
 * sentence on every page. The column-header tooltips carry the one-line version of the same
 * entries, from `metrics.ts`, so a metric is named once.
 */

import type { Data } from './data';
import { METRIC_INFO } from './metrics';
import { el, link, num, panel } from './ui';

const ns = 'http://www.w3.org/2000/svg';

function svgEl(w: number, h: number): SVGSVGElement {
  const s = document.createElementNS(ns, 'svg');
  s.setAttribute('viewBox', `0 0 ${w} ${h}`);
  s.setAttribute('width', '100%');
  s.style.display = 'block';
  s.style.maxWidth = `${w}px`;
  return s;
}

function add(
  parent: SVGElement,
  tag: string,
  attrs: Record<string, string | number>,
  text?: string,
): SVGElement {
  const n = document.createElementNS(ns, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  if (text !== undefined) n.textContent = text;
  parent.append(n);
  return n;
}

/** The one worked example every residue-level metric is read from. */
const ANN: [number, number][] = [[9, 24]];
const FIRE: [number, number][] = [[17, 21], [29, 31]];
const N_RES = 40;

const inAny = (i: number, spans: [number, number][]): boolean =>
  spans.some(([a, b]) => i >= a && i <= b);

/**
 * One annotated region, one latent, and the four counts every score is built from.
 *
 * 16 annotated residues, 8 firing residues, 5 of them inside the annotation. Those three
 * numbers give every metric on the site, so the same picture serves four entries.
 */
function residuePicture(scored: boolean): HTMLElement {
  const cw = 15;
  const x0 = 92;
  const W = x0 + N_RES * cw + 6;
  const H = scored ? 104 : 60;
  const s = svgEl(W, H);

  const label = (y: number, t: string) =>
    add(s, 'text', {
      x: x0 - 8, y: y + 11, 'text-anchor': 'end', fill: 'var(--muted)', 'font-size': 10,
    }, t);
  const strip = (y: number, on: (i: number) => string | null) => {
    for (let i = 0; i < N_RES; i++) {
      add(s, 'rect', {
        x: x0 + i * cw, y, width: cw - 1.5, height: 15, rx: 1,
        fill: on(i) ?? 'var(--surface-2)',
      });
    }
  };

  label(6, 'Swiss-Prot');
  strip(6, (i) => (inAny(i, ANN) ? 'var(--accent)' : null));
  label(26, 'the latent');
  strip(26, (i) => (inAny(i, FIRE) ? 'var(--signal)' : null));

  if (scored) {
    label(46, 'the count');
    for (let i = 0; i < N_RES; i++) {
      const a = inAny(i, ANN);
      const f = inAny(i, FIRE);
      const mark = a && f ? 'right' : f ? 'wrong' : a ? 'missed' : '';
      if (!mark) continue;
      const color =
        mark === 'right' ? 'var(--accent)' : mark === 'wrong' ? 'var(--signal)' : 'var(--line-strong)';
      add(s, 'rect', { x: x0 + i * cw, y: 46, width: cw - 1.5, height: 15, rx: 1, fill: color });
      add(s, 'text', {
        x: x0 + i * cw + (cw - 1.5) / 2, y: 57, 'text-anchor': 'middle', 'font-size': 9,
        fill: 'var(--surface)', 'font-family': 'IBM Plex Mono, monospace',
      }, mark === 'right' ? '+' : mark === 'wrong' ? '!' : '-');
    }
    const keys: [string, string, string][] = [
      ['+', 'var(--accent)', '5 right'],
      ['!', 'var(--signal)', '3 wrong'],
      ['-', 'var(--line-strong)', '11 missed'],
    ];
    let kx = x0;
    for (const [g, c, t] of keys) {
      add(s, 'rect', { x: kx, y: 72, width: 12, height: 12, rx: 1, fill: c });
      add(s, 'text', {
        x: kx + 6, y: 81.5, 'text-anchor': 'middle', 'font-size': 9, fill: 'var(--surface)',
        'font-family': 'IBM Plex Mono, monospace',
      }, g);
      add(s, 'text', { x: kx + 18, y: 82, 'font-size': 10.5, fill: 'var(--ink-2)' }, t);
      kx += 18 + t.length * 6.1 + 20;
    }
  }
  const wrap = el('div', 'gl-pic');
  wrap.append(s);
  return wrap;
}

/** Two proteins, to show what "per domain" changes. */
function domainPicture(): HTMLElement {
  const cw = 9;
  const x0 = 118;
  const n = 46;
  const W = x0 + n * cw + 78;
  const s = svgEl(W, 84);
  const cases: [string, [number, number][], [number, number][], string][] = [
    ['protein 1', [[8, 26]], [[19, 20]], 'domain recalled'],
    ['protein 2', [[8, 26]], [[33, 36]], 'domain missed'],
  ];
  cases.forEach(([name, ann, fire, verdict], k) => {
    const y = 8 + k * 38;
    add(s, 'text', {
      x: x0 - 8, y: y + 11, 'text-anchor': 'end', fill: 'var(--muted)', 'font-size': 10,
    }, name);
    for (let i = 0; i < n; i++) {
      add(s, 'rect', {
        x: x0 + i * cw, y, width: cw - 1.5, height: 12, rx: 1,
        fill: inAny(i, ann) ? 'var(--accent)' : 'var(--surface-2)',
      });
      add(s, 'rect', {
        x: x0 + i * cw, y: y + 14, width: cw - 1.5, height: 12, rx: 1,
        fill: inAny(i, fire) ? 'var(--signal)' : 'var(--surface-2)',
      });
    }
    add(s, 'text', {
      x: x0 + n * cw + 8, y: y + 17, 'font-size': 10.5,
      fill: k === 0 ? 'var(--accent)' : 'var(--muted)',
    }, verdict);
  });
  const wrap = el('div', 'gl-pic');
  wrap.append(s);
  return wrap;
}

/** The 24-layer profile, with one latent's peak marked. */
function depthPicture(): HTMLElement {
  const W = 420;
  const s = svgEl(W, 74);
  const profile = [
    2, 3, 4, 5, 7, 9, 12, 16, 21, 28, 37, 48, 61, 74, 87, 96, 100, 95, 82, 66, 50, 36, 25, 17,
  ];
  const bw = 14;
  const x0 = 26;
  profile.forEach((v, i) => {
    const h = Math.max(2, (v / 100) * 44);
    add(s, 'rect', {
      x: x0 + i * bw, y: 8 + 44 - h, width: bw - 3, height: h, rx: 1,
      fill: v === 100 ? 'var(--signal)' : 'var(--accent)',
      'fill-opacity': v === 100 ? 1 : 0.35 + 0.5 * (v / 100),
    });
  });
  add(s, 'text', {
    x: x0 + 16 * bw + (bw - 3) / 2, y: 4, 'text-anchor': 'middle', 'font-size': 9,
    fill: 'var(--signal)',
  }, 'peak 17');
  for (const l of [1, 12, 24]) {
    add(s, 'text', {
      x: x0 + (l - 1) * bw + (bw - 3) / 2, y: 66, 'text-anchor': 'middle', 'font-size': 9,
      fill: 'var(--muted)',
    }, String(l));
  }
  add(s, 'text', { x: x0, y: 66, 'font-size': 9, fill: 'var(--muted)', opacity: 0 }, '');
  const wrap = el('div', 'gl-pic');
  wrap.append(s);
  return wrap;
}

function para(...parts: (string | Node)[]): HTMLElement {
  const p = el('p');
  p.append(...parts);
  return p;
}

function formula(text: string): HTMLElement {
  return el('p', 'gl-formula mono', text);
}

/** The drawn entry for each slug in `metrics.ts`. A slug with no body gets its short line only. */
const BODIES: Record<string, () => Node[]> = {
  precision: () => [
    para(
      'Precision asks whether the latent is right when it fires. Count the residues it fires ' +
        'on. Count how many of those the Swiss-Prot annotation covers. Divide.',
    ),
    residuePicture(true),
    formula('precision = 5 right / (5 right + 3 wrong) = 0.63'),
    para(
      'A latent that fires on one residue of one protein, inside an annotation, has a precision ' +
        'of 1.00. Precision on its own does not say that a latent is useful.',
    ),
  ],
  'recall-per-residue': () => [
    para(
      'Recall per residue asks how much of the annotation the latent reads. Count the residues ' +
        'the annotation covers. Count how many of those the latent fires on. Divide.',
    ),
    residuePicture(true),
    formula('recall per residue = 5 right / (5 right + 11 missed) = 0.31'),
    para(
      'This is the number that shows concept splitting. Most paired latents on this site have a ' +
        'high precision and a low recall per residue, because each one reads a part of the ' +
        'region and no single latent reads all of it.',
    ),
  ],
  'f1-per-domain': () => [
    para('F1 is the harmonic mean of precision and recall. It falls if either of the two falls.'),
    formula('F1 = 2 · precision · recall / (precision + recall)'),
    para(
      'Per domain means the recall is counted over whole annotated regions and not over ' +
        'residues. A latent that fires on one residue inside a region has recalled that region.',
    ),
    domainPicture(),
    para(
      'The two recall columns disagree on purpose, and the gap carries information. A motif ' +
        'detector that fires on one conserved residue scores near 1.00 per domain and near 0.02 ' +
        'per residue. Read the two together.',
    ),
    para(
      'The per-domain column is the one InterPLM reports, so it is the column that compares ' +
        'with the published work.',
    ),
  ],
  'peak-layer': () => [
    para(
      'A crosscoder latent writes into all 24 encoder layers at once. Each layer has its own ' +
        'decoder direction, and the length of that direction is how hard the latent writes ' +
        'there. The peak layer is the longest one.',
    ),
    depthPicture(),
    para(
      'The lengths are corrected first. The residual stream of ProtT5 grows about 600-fold from ' +
        'layer 1 to layer 24, and without the correction every latent appears to peak at layer ' +
        '24.',
    ),
    para(
      'This number has no counterpart in a per-layer sparse autoencoder. There each layer has ' +
        'its own model, and its features carry no correspondence across layers.',
    ),
  ],
  depth: () => [
    para(
      'The depth ribbon is the profile the peak layer summarises, drawn in full. Each bar is one ' +
        'encoder layer, from 1 on the left to 24 on the right, scaled so the peak layer reaches ' +
        'full height.',
    ),
    depthPicture(),
    para(
      'A narrow ribbon is a latent that writes into a few layers. A broad ribbon is a latent ' +
        'that holds its strength across the encoder.',
    ),
  ],
  'cosine-similarity': () => [
    para(
      'Each layer has its own decoder direction for the same latent. The cosine similarity ' +
        'compares each of those directions against the direction at the peak layer. The latent ' +
        'page draws it as the dashed line.',
    ),
    formula('1 = the same direction   ·   0 = unrelated   ·   -1 = the opposite direction'),
    para(
      'A latent whose cosine stays near 1 across many layers writes one thing all the way ' +
        'through the encoder. A latent whose cosine falls away from its peak writes something ' +
        'that changes with depth, and its strength at a distant layer then means something ' +
        'different from its strength at the peak.',
    ),
  ],
  covers: () => [
    para(
      'Covers is a property of one latent on one protein: of that protein’s residues, the share ' +
        'where the latent is active at all.',
    ),
    para(
      'It is small for almost every latent, because the crosscoder keeps 32 of 8192 latents ' +
        'active at each residue. 2.9% of a 300-residue protein is about 9 residues.',
    ),
    para(
      'Small values are printed with two digits. Rounded to whole percent, a motif latent reads ' +
        'as 0% and appears to do nothing.',
    ),
  ],
  'peak-activation': () => [
    para(
      'Every activation on this site is divided by that latent’s largest activation over the ' +
        'whole evaluation set. 1.00 marks the one protein and residue where the latent fires ' +
        'hardest.',
    ),
    para(
      'The scale is per latent and is not shared. A peak of 0.50 for one latent and 0.50 for ' +
        'another say the same thing about each latent against itself, and nothing about which of ' +
        'the two fires harder in the raw activations.',
    ),
    para(
      'The colour ramp on every strip, letter row and structure uses this same scale, so a ' +
        'colour carries from one view to the next.',
    ),
  ],
  reads: () => [
    para(
      'Reads is a property of one concept on one protein. Take the residues the annotation ' +
        'covers. Count how many of them at least one paired latent fires on, at more than 0.3 of ' +
        'that latent’s own maximum. Divide.',
    ),
    residuePicture(true),
    formula('reads = 5 of 16 annotated residues = 31%'),
    para(
      'It is the arithmetic of the per-residue recall, over one protein rather than over the ' +
        'evaluation set, and over all the concept’s latents together rather than one at a time.',
    ),
    para(
      'It answers which protein to open. A protein the latents read well shows what the concept ' +
        'looks like when the crosscoder gets it right. One they read badly shows what they miss. ' +
        'Over the 173,378 pairs where a concept has a paired latent, the median is 73%, the ' +
        'lower quarter is under 22%, and the upper quarter is 100%.',
    ),
  ],
  strength: () => [
    para(
      'Strength ranks the proteins that carry a concept by the peak activation of that ' +
        'concept’s best latent. 1.00 is the protein where that latent fires hardest.',
    ),
    para(
      'It is not the same as Reads. A latent can fire very hard on one residue of a long ' +
        'annotated region, which is a high strength and a low read. The two columns sort the ' +
        'carriers differently on purpose.',
    ),
  ],
  latents: () => [
    para(
      'The crosscoder has 8192 latents. 8128 of them fire at least once on the evaluation set ' +
        'and are called live. The other 64 are dead and have no page.',
    ),
    para(
      'A latent is paired with a concept when it scores best for that concept on a held-out set. ' +
        '1020 of the live latents are paired. The remaining 7108 fire on something the ' +
        'Swiss-Prot annotations in this evaluation set cannot name, which is not evidence that ' +
        'they carry nothing.',
    ),
  ],
  concept: () => [
    para(
      'A concept is one annotation type from Swiss-Prot, written as the field and the value. ' +
        'Domain_CN hydrolase is the Domain field with the value CN hydrolase, and the site ' +
        'prints it as Domain · CN hydrolase.',
    ),
    para(
      'There are 408 concepts in this evaluation set, and a latent pairs with 187 of them. A ' +
        'concept counts as found when at least one latent pairs with it on the held-out set.',
    ),
    para(
      'The landing page groups the concepts by what they are biologically rather than by the ' +
        'Swiss-Prot field. The field name puts 82.6% of the paired latents into one bucket and ' +
        'tells a reader nothing.',
    ),
  ],
  proteins: () => [
    para(
      'The evaluation set is 207,463 proteins from UniProtKB with an annotation score of 3, 4 ' +
        'or 5. Every latent was measured on every one of them, so a protein count on this site ' +
        'is a full count and not a sample.',
    ),
    para(
      'A latent that fires on 206,415 of them is telling you something about the crosscoder ' +
        'rather than about biology. Read a large protein count as a warning.',
    ),
  ],
  null: () => [
    para(
      'A matched crosscoder trained on a randomly initialized ProtT5 reaches 0.175 average test ' +
        'F1 on this same evaluation set, against 0.479 for the real one. That average hides the ' +
        'per-concept picture.',
    ),
    para(
      'On 43 concepts the null clears 0.5 per domain, and on 13 of the 403 shared concepts it ' +
        'beats the real crosscoder. The per-domain metric is the reason: one firing recalls a ' +
        'whole region, so a detector of any conserved motif scores well.',
    ),
    para(
      'Read the per-residue column beside the per-domain column. There the null’s median is ' +
        '0.0079 against 0.1012, and none of its 43 high concepts clears 0.5.',
    ),
  ],
};

export function renderGlossary(d: Data, host: HTMLElement, slug?: string): void {
  host.textContent = '';
  const views = el('div', 'views');
  host.append(views);

  const intro = panel(
    'Glossary',
    'Every number on this site',
    'Each entry is the definition this site uses, not the general one. Where a number could be ' +
      'counted in more than one way, the entry says which way it is counted here.',
  );
  const toc = el('div', 'gl-toc');
  for (const m of METRIC_INFO) {
    const a = el('a', undefined, m.title);
    a.href = `#/glossary/${m.slug}`;
    toc.append(a);
  }
  intro.append(toc);
  views.append(intro);

  for (const m of METRIC_INFO) {
    const p = panel('Definition', m.title);
    p.id = `gl-${m.slug}`;
    p.append(el('p', 'lede', m.short));
    const body = el('div', 'gl-body');
    body.append(...(BODIES[m.slug]?.() ?? []));
    p.append(body);
    views.append(p);
  }

  // The provenance, which used to sit under every page. It belongs with the definitions,
  // because it says what all of them were measured on.
  const man = d.manifest;
  const prov = panel(
    'Provenance',
    'What this data is',
    'Every number on this site comes from one crosscoder and one evaluation set.',
  );
  prov.id = 'gl-provenance';
  const dl = el('dl', 'gl-dl');
  const put = (k: string, v: string | Node) => {
    dl.append(el('dt', undefined, k));
    const dd = el('dd');
    dd.append(v);
    dl.append(dd);
  };
  put('Crosscoder', el('span', 'mono', man.crosscoder));
  put('Evaluation set', el('span', 'mono', man.eval_set));
  put('Built', man.built);
  put('Proteins', num(man.counts.proteins));
  put('Latent-protein pairs', num(man.counts.latent_protein_pairs));
  put('Latents', `${num(man.headline.latents_alive)} live of ${num(man.headline.latents_total)}`);
  put('Concepts', `${man.headline.concepts_identified} found of ${man.headline.concepts_total}`);
  put('Average best test F1', man.headline.avg_best_test_f1.toFixed(3));
  put(
    'Structures',
    d.nStructures === null
      ? 'AlphaFold models, backbone only'
      : `AlphaFold models, backbone only, for ${num(d.nStructures)} of the proteins. ` +
        `The ${num(man.counts.no_structure ?? 0)} that are missing all carry an AlphaFoldDB ` +
        'cross-reference. The Foldcomp database this tree was extracted from does not hold them.',
  );
  prov.append(dl);
  if (man.partial) {
    prov.append(
      el('p', 'warn', 'This tree was built from a subset of shards and is not publishable.'),
    );
  }
  const back = el('p', 'small');
  back.append(link('/', 'Back to the concepts'));
  prov.append(back);
  views.append(prov);

  if (slug) {
    // The route carries the entry, so a tooltip link lands on the entry rather than at the top.
    //
    // Twice, and once more after a pause. On a page that is already loaded one frame is enough.
    // On a first load the fonts arrive after the first layout and every panel above the target
    // changes height, so a single scroll lands thousands of pixels short.
    const target = document.getElementById(`gl-${slug}`);
    if (target) {
      const go = () => target.scrollIntoView({ block: 'start' });
      requestAnimationFrame(() => requestAnimationFrame(go));
      setTimeout(go, 300);
      if (document.fonts) void document.fonts.ready.then(go);
    }
  }
}
