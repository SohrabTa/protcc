/**
 * The page that explains every number the dashboard prints.
 *
 * The definitions are drawn rather than described. Precision and recall over a protein are two
 * counts on one picture, and a reader who sees the picture once does not have to re-read the
 * sentence on every page. The column-header tooltips carry the one-line version of the same
 * entries, from `metrics.ts`, so a metric is named once.
 */

import type { Data } from './data';
import { METHOD_SECTIONS, METRIC_INFO } from './metrics';
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
  pairing: () => [
    para(
      'A latent pairs with a concept when it scores more than 0.5 on F1 per domain, measured on ' +
      'a held-out set of proteins that the pairing search never saw. InterPLM sets that cut, and ' +
      'this site keeps it.',
    ),
    formula('pairs with the concept  =  F1 per domain > 0.5 on the held-out set'),
    para(
      'The search runs over every concept against every live latent, at five activation ' +
      'thresholds, and keeps the best. 1020 of the 8128 live latents pair with something, and ' +
      '187 of the 408 concepts get at least one latent. A concept with no latent is not ' +
      'evidence that ProtT5 ignores it.',
    ),
    para(
      'Read the cut with care. The score is per domain, so one firing inside a region counts ' +
      'that whole region as read. A latent can pair at 0.99 and still touch 1% of the annotated ' +
      'residues.',
    ),
  ],
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
      'This is the number that shows concept splitting. Most paired latents have a high ' +
      'precision and a low recall per residue, because each one reads a part of the region and ' +
      'no single latent reads all of it. Over the 1080 pairings the median is 0.032.',
    ),
  ],
  'recall-per-domain': () => [
    para(
      'Recall per domain counts whole annotated regions instead of residues. A region counts as ' +
      'read when the latent fires anywhere inside it, even on one residue.',
    ),
    domainPicture(),
    formula('recall per domain = 1 region read / 2 regions = 0.50'),
    para(
      'This is the metric InterPLM reports, and it is the one that decides a pairing here. It ' +
      'answers a detection question: does this latent tell you that the region is present?',
    ),
    para(
      'It is generous by design, and the gap it leaves is large. Over the 1080 pairings on this ' +
      'site the median recall per domain is 0.981 and the median recall per residue is 0.032. ' +
      'The same latent that finds almost every region touches 3% of the residues in them.',
    ),
  ],
  'f1-per-domain': () => [
    para('F1 is the harmonic mean of precision and recall. It falls if either of the two falls.'),
    formula('F1 per domain = 2 · precision · recall per domain / (precision + recall per domain)'),
    para(
      'Per domain means the recall half counts whole regions and not residues, so one firing ' +
      'inside a region is enough to recall it.',
    ),
    domainPicture(),
    para(
      'A worked case from this site. On Domain · ABC transporter, latent 4587 scores 0.994 and ' +
      'reads 0.86% of the annotated residues. Latent 831 scores 0.857 and reads 53%. The metric ' +
      'ranks 4587 first, and 831 is the one that reads the domain.',
    ),
    para(
      'So read F1 per domain as a detection score, not as a fidelity score, and keep recall per ' +
      'residue in view beside it.',
    ),
  ],
  'f1-per-residue': () => [
    para(
      'The same harmonic mean, with the recall counted over residues. It asks whether the latent ' +
      'covers the region rather than whether it notices the region.',
    ),
    formula('F1 per residue = 2 · precision · recall per residue / (precision + recall per residue)'),
    para(
      'The two scores disagree, and the size of the disagreement is measured. Over the 209 ' +
      'concepts that the per-domain metric identifies, the two metrics name the same latent for ' +
      'only 117. The per-domain winner scores a median 0.262 per residue. The per-residue ' +
      'winner scores 0.606 on the same concepts.',
    ),
    para(
      'The site pairs on F1 per domain, because that is what InterPLM does and what the ' +
      'published comparison needs. This entry exists so that the reader knows what the choice ' +
      'costs.',
    ),
  ],
  'peak-layer': () => [
    para(
      'A crosscoder latent writes into all 24 encoder layers at once. To write into a layer ' +
      'means to add a vector to that layer’s residual stream, which is the running sum of ' +
      'everything the model has computed about a residue so far.',
    ),
    para(
      'Each layer gets its own vector for the same latent. The length of that vector is how much ' +
      'the latent changes that layer. The peak layer is the layer with the longest vector.',
    ),
    depthPicture(),
    para(
      'The lengths are corrected before they are compared. The residual stream of ProtT5 grows ' +
      'about 600-fold from layer 1 to layer 24, so without the correction every latent appears ' +
      'to peak at layer 24.',
    ),
    para(
      'A per-layer sparse autoencoder has no peak layer. It trains one model for each layer, and ' +
      'a unit in one model has no counterpart in the next, so there is nothing to compare.',
    ),
  ],
  depth: () => [
    para(
      'The depth ribbon draws the full profile that the peak layer summarises. Each bar is one ' +
      'encoder layer, from 1 on the left to 24 on the right. The bars are scaled so the peak ' +
      'layer reaches full height.',
    ),
    depthPicture(),
    para(
      'A narrow ribbon is a latent that writes into a few layers. A broad ribbon is a latent ' +
      'that holds its strength across the encoder. The median latent keeps at least half its ' +
      'peak across 12 of the 24 layers.',
    ),
  ],
  'cosine-similarity': () => [
    para(
      'Each layer has its own direction for the same latent. The cosine similarity compares each ' +
      'of those directions against the direction at the peak layer. The latent page draws it as ' +
      'the dashed line.',
    ),
    formula('1 = the same direction   ·   0 = unrelated   ·   -1 = the opposite direction'),
    para(
      'A latent whose cosine stays near 1 across many layers writes one thing all the way ' +
      'through the encoder. A latent whose cosine falls away from its peak writes something that ' +
      'changes with depth. Its strength at a distant layer then means something different from ' +
      'its strength at the peak.',
    ),
  ],
  covers: () => [
    para(
      'Covers is a property of one latent on one protein. Of that protein’s residues, it is the ' +
      'share where the latent is active at all.',
    ),
    para(
      'It is small for almost every latent, because the crosscoder keeps 32 of 8192 latents ' +
      'active at each residue. 2.9% of a 300-residue protein is about 9 residues.',
    ),
    para(
      'Small values keep two digits. Rounded to whole percent, a motif latent reads as 0% and ' +
      'appears to do nothing.',
    ),
  ],
  'peak-activation': () => [
    para(
      'Every activation on this site is divided by that latent’s largest activation over the ' +
      'whole evaluation set. 1.00 marks the one protein and residue where the latent fires ' +
      'hardest.',
    ),
    para(
      'The scale is per latent and it is not shared. A peak of 0.50 for one latent and 0.50 for ' +
      'another say the same thing about each latent against itself. They say nothing about which ' +
      'of the two fires harder in the raw activations.',
    ),
    para(
      'A strong activation carries more than a weak one, and that is measured. Over the 1080 ' +
      'pairings the median precision rises from 0.656 at any activation to 0.953 above 0.8 of ' +
      'the maximum. The random-init null stays flat over the same cuts, at 0.817 to 0.795.',
    ),
  ],
  latents: () => [
    para(
      'A latent is one of the 8192 units the crosscoder learned. 8128 of them fire at least once ' +
      'on the evaluation set and are called live. The other 64 are dead and have no page.',
    ),
    para(
      'In a concept table the Latents column counts how many latents pair with that concept. A ' +
      'concept with 11 in that column has 11 separate latents that each clear the pairing cut ' +
      'for it, and each of them reads a part of the region.',
    ),
    para(
      '1020 of the live latents pair with a concept, and 58 of those pair with more than one. ' +
      'The remaining 7108 fire on something the Swiss-Prot annotations in this evaluation set ' +
      'cannot name, which is not evidence that they carry nothing.',
    ),
    para(
      'This site says latent and never feature. UniProt calls its own sequence annotations the ' +
      'feature table, and those annotations are the concepts on this site, so the word is taken.',
    ),
  ],
  'best-latent': () => [
    para(
      'Of all the latents that pair with a concept, the best latent is the one with the highest ' +
      'F1 per domain. Nothing else enters the choice.',
    ),
    para(
      'Best by that score is not the same as best at reading the region. On Domain · ABC ' +
      'transporter the best latent is 4587, at F1 0.994, and it fires on 0.86% of the annotated ' +
      'residues. Latent 831 scores 0.857 and reads 53% of them.',
    ),
    para(
      'So treat the best latent as the concept’s most reliable detector, and open the table to ' +
      'find the one that covers the most.',
    ),
  ],
  concept: () => [
    para(
      'A concept is one annotation type from Swiss-Prot, written as the field and the value. ' +
      'Domain_CN hydrolase is the Domain field with the value CN hydrolase, and the site prints ' +
      'it as Domain · CN hydrolase.',
    ),
    para(
      'There are 408 concepts in this evaluation set, and at least one latent pairs with 187 of ' +
      'them.',
    ),
    para(
      'The landing page groups the concepts by what they are biologically and not by the ' +
      'Swiss-Prot field. The field name puts 82.6% of the paired latents into one bucket and ' +
      'tells a reader nothing.',
    ),
  ],
  proteins: () => [
    para(
      'The evaluation set is 207,463 proteins from UniProtKB with an annotation score of 3, 4 ' +
      'or 5, each of at most 512 residues. Every latent was measured on every one of them, so a ' +
      'protein count on this site is a full count and not a sample.',
    ),
    para(
      'In a concept table the Proteins column counts the proteins that Swiss-Prot annotates with ' +
      'that concept. Those are the proteins the evidence panel steps through.',
    ),
    para(
      'On a latent page the count is different. There it is the proteins the latent fires on, ' +
      'whether or not Swiss-Prot annotates anything there. A latent that fires on 206,415 of ' +
      'them tells you about the crosscoder and not about biology, so read a large count as a ' +
      'warning.',
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
      'counted in more than one way, the entry says which way it is counted here. This page ' +
      'says what a word means. The method page says why the number is measured that way, and ' +
      'every entry below links to the part of it that argues for the entry.',
  );
  const toc = el('div', 'gl-toc');
  for (const m of METRIC_INFO) {
    const a = el('a', undefined, m.title);
    a.href = `#/glossary/${m.slug}`;
    toc.append(a);
  }
  const method = el('a', undefined, 'Method');
  method.href = '#/method';
  toc.append(method);
  intro.append(toc);
  views.append(intro);

  for (const m of METRIC_INFO) {
    const p = panel('Definition', m.title);
    p.id = `gl-${m.slug}`;
    p.append(el('p', 'lede', m.short));
    const body = el('div', 'gl-body');
    body.append(...(BODIES[m.slug]?.() ?? []));
    // The one link that ties the two pages: this entry, and the argument for measuring it.
    const sct = METHOD_SECTIONS.find((x) => x.id === m.section);
    if (sct) {
      const why = el('p', 'm-defs');
      const a = el('a', undefined, sct.title);
      a.href = `#/method/${sct.id}`;
      why.append(el('span', 'm-defs-lead', 'Why it is measured this way: '), a);
      body.append(why);
    }
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
  const fromEbi = man.counts.structures_from_ebi ?? 0;
  const missing = man.counts.no_structure ?? 0;
  const note = man.counts.no_structure_note;
  const source =
    fromEbi && d.nStructures
      ? `A Foldcomp snapshot of AlphaFold model version 3 holds ${num(d.nStructures - fromEbi)} ` +
        `of them. The other ${num(fromEbi)} entered Swiss-Prot after that snapshot, so this ` +
        'tree carries the model AlphaFold serves for them today, one download each from EBI. '
      : '';
  put(
    'Structures',
    d.nStructures === null
      ? 'AlphaFold models, backbone only'
      : `AlphaFold models, backbone only, for ${num(d.nStructures)} of the proteins. ` +
        source +
        (missing
          ? `${num(missing)} have none. ` +
            (note ||
              'The Foldcomp database this tree was extracted from does not hold them, and they ' +
                'all carry an AlphaFoldDB cross-reference.')
          : ''),
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
