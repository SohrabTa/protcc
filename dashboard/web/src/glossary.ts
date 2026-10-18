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
import { facts, fill, type Facts } from './facts';
import { conceptName } from './pairs';
import { el, link, num, panel, withContents } from './ui';

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
  const x0 = 96;
  const W = x0 + N_RES * cw + 6;
  const H = scored ? 112 : 60;
  const s = svgEl(W, H);

  const label = (y: number, t: string) =>
    add(s, 'text', {
      x: x0 - 10, y: y + 12, 'text-anchor': 'end', fill: 'var(--muted)', 'font-size': 13,
    }, t);
  // An empty cell is drawn in the line color, so the protein shows as a track and the marks on
  // it read as a part of a whole.
  const strip = (y: number, on: (i: number) => string | null) => {
    for (let i = 0; i < N_RES; i++) {
      add(s, 'rect', {
        x: x0 + i * cw, y, width: cw - 1.5, height: 15, rx: 1,
        fill: on(i) ?? 'var(--line)',
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
        x: x0 + i * cw + (cw - 1.5) / 2, y: 58, 'text-anchor': 'middle', 'font-size': 12,
        fill: mark === 'missed' ? 'var(--ink)' : 'var(--surface)',
        'font-family': 'IBM Plex Mono, monospace',
      }, mark === 'right' ? '+' : mark === 'wrong' ? '!' : '-');
    }
    const keys: [string, string, string][] = [
      ['+', 'var(--accent)', '5 right'],
      ['!', 'var(--signal)', '3 wrong'],
      ['-', 'var(--line-strong)', '11 missed'],
    ];
    let kx = x0;
    for (const [g, c, t] of keys) {
      add(s, 'rect', { x: kx, y: 80, width: 15, height: 15, rx: 1, fill: c });
      add(s, 'text', {
        x: kx + 7.5, y: 92, 'text-anchor': 'middle', 'font-size': 12,
        fill: g === '-' ? 'var(--ink)' : 'var(--surface)', 'font-family': 'IBM Plex Mono, monospace',
      }, g);
      add(s, 'text', { x: kx + 22, y: 92, 'font-size': 13, fill: 'var(--ink-2)' }, t);
      kx += 22 + t.length * 7.6 + 24;
    }
  }
  const wrap = el('div', 'gl-pic');
  wrap.append(s);
  return wrap;
}

/** Two proteins, to show what "per domain" changes. */
function domainPicture(): HTMLElement {
  const cw = 11;
  const x0 = 96;
  const n = 46;
  // Room after the cells for the longest verdict, "domain recalled", at 13 px.
  const W = x0 + n * cw + 128;
  const s = svgEl(W, 88);
  const cases: [string, [number, number][], [number, number][], string][] = [
    ['protein 1', [[8, 26]], [[19, 20]], 'domain recalled'],
    ['protein 2', [[8, 26]], [[33, 36]], 'domain missed'],
  ];
  cases.forEach(([name, ann, fire, verdict], k) => {
    const y = 6 + k * 42;
    add(s, 'text', {
      x: x0 - 10, y: y + 12, 'text-anchor': 'end', fill: 'var(--muted)', 'font-size': 13,
    }, name);
    for (let i = 0; i < n; i++) {
      add(s, 'rect', {
        x: x0 + i * cw, y, width: cw - 1.5, height: 13, rx: 1,
        fill: inAny(i, ann) ? 'var(--accent)' : 'var(--line)',
      });
      add(s, 'rect', {
        x: x0 + i * cw, y: y + 16, width: cw - 1.5, height: 13, rx: 1,
        fill: inAny(i, fire) ? 'var(--signal)' : 'var(--line)',
      });
    }
    add(s, 'text', {
      x: x0 + n * cw + 12, y: y + 20, 'font-size': 13,
      fill: k === 0 ? 'var(--accent)' : 'var(--muted)',
    }, verdict);
  });
  const wrap = el('div', 'gl-pic');
  wrap.append(s);
  return wrap;
}

/** The 24-layer profile, with one latent's peak marked. Slate, because slate is depth. */
function depthPicture(): HTMLElement {
  const profile = [
    2, 3, 4, 5, 7, 9, 12, 16, 21, 28, 37, 48, 61, 74, 87, 96, 100, 95, 82, 66, 50, 36, 25, 17,
  ];
  const bw = 22;
  const x0 = 12;
  const top = 24;
  const tall = 56;
  const W = x0 + profile.length * bw + 12;
  const s = svgEl(W, 116);
  profile.forEach((v, i) => {
    const h = Math.max(2, (v / 100) * tall);
    add(s, 'rect', {
      x: x0 + i * bw, y: top + tall - h, width: bw - 4, height: h, rx: 1,
      fill: v === 100 ? 'var(--signal)' : 'var(--depth)',
      'fill-opacity': v === 100 ? 1 : 0.35 + 0.55 * (v / 100),
    });
  });
  const mid = (layer: number) => x0 + (layer - 1) * bw + (bw - 4) / 2;
  add(s, 'text', {
    x: mid(17), y: top - 8, 'text-anchor': 'middle', 'font-size': 12, fill: 'var(--signal)',
  }, 'peak 17');
  for (const l of [1, 12, 24]) {
    add(s, 'text', {
      x: mid(l), y: top + tall + 18, 'text-anchor': 'middle', 'font-size': 12,
      fill: 'var(--muted)',
    }, String(l));
  }
  add(s, 'text', {
    x: x0 + (profile.length * bw) / 2, y: top + tall + 36, 'text-anchor': 'middle',
    'font-size': 13, fill: 'var(--muted)',
  }, 'encoder layer');
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
const BODIES: Record<string, (f: Facts) => Node[]> = {
  crosscoder: (f) => [
    para(
      'A sparse autoencoder learns a dictionary for one layer: a list of directions, of which a ' +
      'few rebuild each residue vector. Learning such a list is called dictionary learning. A ' +
      'crosscoder learns one dictionary for all 24 layers. It reads the residual stream of a ' +
      'residue at all 24 layers as one input, and it rebuilds the residual stream of every ' +
      'layer from the same few latents.',
    ),
    para(
      'Each latent is then one unit across the whole encoder, with one decoder vector for each ' +
        `layer. This crosscoder has ${num(f.latentsTotal)} latents, and 32 of them fire at each ` +
        'residue on average.',
    ),
  ],
  activation: (f) => [
    para(
      'The crosscoder gives each latent one raw number for each residue. The site divides it by ' +
      'the largest raw number that latent reaches anywhere in the evaluation set, so every ' +
      'latent runs from 0 to 1. The strips, the letters and the 3D model all draw this number.',
    ),
    para(
      'The scale is per latent. 0.50 for one latent and 0.50 for another are each half of their ' +
      'own strongest. They say nothing about which of the two fires harder in raw numbers.',
    ),
    para(
      'A latent fires on a residue when its activation is above a cut. The cut differs by ' +
      'place: the pairing tries five cuts, the concept page counts a residue as read above 0.3, ' +
      'and Covers counts any activation above 0.',
    ),
  ],
  'residual-stream': (f) => [
    para(
      'ProtT5 passes the vector of each residue from layer to layer, and each layer adds to it. ' +
      'The crosscoder reads this vector after each of the 24 layers. It does not change ProtT5: ' +
      'it rebuilds its own copy of the residual stream of each layer.',
    ),
  ],
  'decoder-vector': (f) => [
    para(
      'When a latent fires, the crosscoder adds its decoder vector for each layer, scaled by the ' +
      'activation, to its rebuilt copy of that layer’s residual stream. The direction of the ' +
      'vector says what the ' +
      'latent adds, and the length says how much.',
    ),
  ],
  spread: (f) => [
    formula('spread  =  median distance between firing residues / median distance between random residues'),
    para(
      'Along the chain, the distance is counted in residues. In space, it is measured between ' +
      'the alpha carbons of the AlphaFold model. Each value is the median over the 20 proteins ' +
      'the latent fires on most strongly.',
    ),
    para(
      'Below 0.7 counts as close. Close along the chain is one stretch of the chain. Far along ' +
      'the chain but close in space is one site in the fold. A latent that fires at the two ' +
      'ends of a chain is further apart than random residues, so a spread can be above 1. The ' +
      'Locality panel of every latent page places all measured latents by these two numbers.',
    ),
  ],
  pairing: (f) => [
    para(
      'The proteins are split into two halves. A pair must clear 0.5 on the validation half and ' +
      'again on the held-out half, so a score that is high by chance on one half does not ' +
      'count. InterPLM sets this rule, and this site keeps it.',
    ),
    formula('pairs with the concept  =  F1 per domain > 0.5 on the validation half and on the held-out half'),
    para(
      'A latent fires on a residue when its activation is above a cut. The search tries five ' +
      'cuts, 0, 0.15, 0.5, 0.6 and 0.8 of the latent’s maximum, and keeps the cut with the best ' +
      'F1 per domain. The precision and the recalls in the tables use that cut.',
    ),
    para(
      `${num(f.conceptsFound)} of the ${num(f.conceptsTotal)} concepts get at least one ` +
        'latent. Some latents pair with more than one concept, so the ' +
        `${num(f.latentsPaired)} paired latents make ${num(f.pairs)} pairs. A concept with no ` +
        'latent is not evidence that ProtT5 ignores it.',
    ),
    para(
      'Read the cut with care. The score is per domain, so one firing inside a region counts ' +
      'that whole region as read. A latent can pair at 0.99 and still touch 1% of the annotated ' +
      'residues.',
    ),
  ],
  precision: (f) => [
    residuePicture(true),
    formula('precision = 5 right / (5 right + 3 wrong) = 0.63'),
    para(
      'A latent that fires on one residue of one protein, inside an annotation, has a precision ' +
      'of 1.00. Precision on its own does not say that a latent is useful.',
    ),
  ],
  'recall-per-residue': (f) => [
    residuePicture(true),
    formula('recall per residue = 5 right / (5 right + 11 missed) = 0.31'),
    para(
      'This number shows concept splitting. Most paired latents have a high precision and a ' +
      'low recall per residue. Each one reads a part of the region, and no single latent reads ' +
      `all of it. Over the ${num(f.pairs)} pairs the median is ` +
        `${f.medianRecallResidue.toFixed(3)}.`,
    ),
  ],
  'recall-per-domain': (f) => [
    domainPicture(),
    formula('recall per domain = 1 region read / 2 regions = 0.50'),
    para(
      'This is the metric InterPLM reports, and it is the one that decides a pairing here. It ' +
      'answers a detection question: does this latent tell you that the region is present?',
    ),
    para(
      'It is generous by design, and the gap it leaves is large. Over the ' +
        `${num(f.pairs)} pairs on this site the median recall per domain is ` +
        `${f.medianRecallDomain.toFixed(3)} and the median recall per residue is ` +
        `${f.medianRecallResidue.toFixed(3)}. The same latent that finds almost every region ` +
        `touches ${(f.medianRecallResidue * 100).toFixed(0)}% of the residues in them.`,
    ),
  ],
  'f1-per-domain': (f) => [
    para('F1 is the harmonic mean of precision and recall. It falls if either of the two falls.'),
    formula('F1 per domain = 2 · precision · recall per domain / (precision + recall per domain)'),
    para(
      'Per domain means the recall half counts whole regions and not residues, so one firing ' +
      'inside a region is enough to recall it.',
    ),
    domainPicture(),
    ...(f.example
      ? [
          para(
            `A worked case from this site. On ${conceptName(f.example.concept.c)}, latent ` +
              `${f.example.best.id} scores ${f.example.best.f1.toFixed(3)} and reads ` +
              `${f.example.best.reads} of the annotated residues. Latent ${f.example.reader.id} ` +
              `scores ${f.example.reader.f1.toFixed(3)} and reads ${f.example.reader.reads}. The ` +
              `metric ranks ${f.example.best.id} first, and ${f.example.reader.id} is the one ` +
              'that reads the domain.',
          ),
        ]
      : []),
    para(
      'So read F1 per domain as a detection score, not as a fidelity score, and keep recall per ' +
      'residue in view beside it.',
    ),
  ],
  'f1-per-residue': (f) => [
    para('It asks whether the latent covers the region, not whether it notices the region.'),
    formula('F1 per residue = 2 · precision · recall per residue / (precision + recall per residue)'),
    ...(f.conceptsFoundPerResidue !== undefined && f.latentsPairedPerResidue !== undefined
      ? [
          para(
            'The two scores disagree, and the size of the disagreement is measured. With the ' +
              `same pairing rule, F1 per residue pairs ${num(f.conceptsFoundPerResidue)} of the ` +
              `${num(f.conceptsTotal)} concepts, against ${num(f.conceptsFound)} for F1 per ` +
              `domain. It pairs ${num(f.latentsPairedPerResidue)} latents, against ` +
              `${num(f.latentsPaired)}.`,
          ),
        ]
      : []),
    para(
      'The site pairs on F1 per domain, because that is what InterPLM does and what the ' +
      'published comparison needs. This entry exists so that the reader knows what the choice ' +
      'costs.',
    ),
  ],
  'peak-layer': (f) => [
    para(
      'To write into a layer means to add a vector to the crosscoder’s rebuilt copy of that ' +
      'layer’s residual stream. ProtT5 itself does not change. The length of the vector is how ' +
      'much the latent adds to that layer.',
    ),
    depthPicture(),
    para(
      'The site corrects the lengths before it compares them. The residual stream of ProtT5 ' +
      'grows about 600-fold from layer 1 to layer 24. Without the correction, every latent ' +
      'appears to peak at layer 24.',
    ),
    para(
      'A per-layer sparse autoencoder has no peak layer. It trains one model for each layer, and ' +
      'a unit in one model has no counterpart in the next, so there is nothing to compare.',
    ),
  ],
  depth: (f) => [
    para(
      'Each bar is one encoder layer, from 1 on the left to 24 on the right. The bars are scaled ' +
      'so that the peak layer reaches full height. The latent page draws the same lengths as a ' +
      'line.',
    ),
    depthPicture(),
    para(
      'A narrow ribbon is a latent that writes into a few layers. A broad ribbon is a latent ' +
      'that holds its strength across the encoder. The median latent keeps at least half its ' +
        `peak across ${f.medianSpreadLayers} of the 24 layers.`,
    ),
  ],
  'cosine-similarity': (f) => [
    para('The latent page draws it as the dashed line of the Depth panel.'),
    formula('1 = the same direction   ·   0 = unrelated   ·   -1 = the opposite direction'),
    para(
      'A latent whose cosine stays near 1 across many layers writes one thing all the way ' +
      'through the encoder. A latent whose cosine falls away from its peak writes something that ' +
      'changes with depth. Its strength at a distant layer then means something different from ' +
      'its strength at the peak.',
    ),
  ],
  covers: (f) => [
    para(
      `It is small for almost every latent, because 32 of the ${num(f.latentsTotal)} latents ` +
        'fire at each residue, on average. A latent that covers 3% of a 300-residue protein ' +
        'fires on 9 residues.',
    ),
    para(
      'Small values keep two digits. Rounded to whole percent, a motif latent reads as 0% and ' +
      'appears to do nothing.',
    ),
  ],
  'peak-activation': (f) => [
    para(
      'It is on the scale of every activation on this site, so a peak of 0.50 is half the ' +
      'latent’s own strongest. The Activation entry says more about that scale.',
    ),
  ],
  latents: (f) => [
    para(
      `${num(f.latentsAlive)} of the latents fire at least once on the evaluation set and are ` +
        `called live. The other ${num(f.latentsDead)} are dead and have no page.`,
    ),
    para(
      'A concept with 11 in the Latents column has 11 latents that each clear the pairing cut. ' +
      'Each one reads a part of the region.',
    ),
    para(
      `${num(f.latentsPaired)} of the live latents pair with a concept, and ` +
        `${num(f.latentsMulti)} of those pair with more than one. Together they make ` +
        `${num(f.pairs)} pairs. The remaining ${num(f.latentsUnpaired)} pair with no concept of ` +
        'this evaluation set, which is not evidence that they carry nothing.',
    ),
    para(
      'This site says latent and never feature. UniProt calls its own sequence annotations the ' +
      'feature table, and those annotations are the concepts on this site, so the word is taken.',
    ),
  ],
  'best-latent': (f) => [
    para(
      'This is the paper’s rule. For each concept, the validation half chooses one latent, and ' +
        'the held-out half scores it. That score is the Best F1, and its average over the ' +
        `${num(f.conceptsTotal)} concepts is ${f.avgBestF1.toFixed(3)}.`,
    ),
    ...(f.example
      ? [
          para(
            'Best by that score is not the same as best at reading the region. On ' +
              `${conceptName(f.example.concept.c)} the best latent is ${f.example.best.id}, at ` +
              `F1 ${f.example.best.f1.toFixed(3)}, and it fires on ${f.example.best.reads} of the ` +
              `annotated residues. Latent ${f.example.reader.id} scores ` +
              `${f.example.reader.f1.toFixed(3)} and reads ${f.example.reader.reads} of them.`,
          ),
        ]
      : []),
    para(
      'So treat the best latent as the concept’s most reliable detector, and open the table to ' +
      'find the one that covers the most.',
    ),
  ],
  concept: (f) => [
    para(
      'A concept is one annotation type from Swiss-Prot, written as the field and the value. ' +
      'Domain_CN hydrolase is the Domain field with the value CN hydrolase, and the site prints ' +
      'it as Domain · CN hydrolase.',
    ),
    para(
      'A concept whose value is "any" joins all the values of one field. "Zinc finger · any" ' +
      'is every zinc finger, of any type.',
    ),
    para(
      `At least one latent pairs with ${num(f.conceptsFound)} of the ${num(f.conceptsTotal)} ` +
        'concepts.',
    ),
    para(
      'The landing page groups the concepts by what they are biologically and not by the ' +
      `Swiss-Prot field. The field ${f.biggestField.name} alone holds ` +
        `${f.biggestField.share} of the paired latents, so the field name tells a reader nothing.`,
    ),
  ],
  proteins: (f) => [
    para(
      `The evaluation set is ${num(f.proteins)} Swiss-Prot proteins with an annotation score ` +
        'of 3, 4 or 5, each of at most 512 residues. Every latent was measured on every one of ' +
        'them, so a protein count on this site is a full count and not a sample.',
    ),
    para(
      'On a latent page the count is different. There it is the proteins the latent fires on, ' +
      'whether or not Swiss-Prot annotates anything there. A latent that fires on ' +
        `${num(f.mostProteins)} of them tells you about the crosscoder and not about biology, so ` +
        'read a large count as a warning.',
    ),
  ],
};

export function renderGlossary(d: Data, host: HTMLElement, slug?: string): void {
  host.textContent = '';
  const views = el('div', 'views');
  const f = facts(d);

  const intro = panel(
    'Glossary',
    'Every word and number on this site',
    'Each entry is the definition this site uses, not the general one. The words of the model ' +
      'come first, then the scores of a pairing, then the numbers about one latent or one ' +
      'protein. Where a number could be counted in more than one way, the entry says which way ' +
      'it is counted here. The method page says why it is measured that way.',
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
  intro.classList.add('pagehead');
  views.append(intro);

  for (const m of METRIC_INFO) {
    const p = panel('', m.title);
    p.id = `gl-${m.slug}`;
    p.append(el('p', 'lede', fill(m.short)));
    const body = el('div', 'gl-body');
    body.append(...(BODIES[m.slug]?.(f) ?? []));
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
  host.append(
    withContents(views, [
      ...METRIC_INFO.map((m) => ({ id: `gl-${m.slug}`, title: m.title, href: `#/glossary/${m.slug}` })),
      { id: 'gl-provenance', title: 'What this data is', href: '#/glossary/provenance' },
    ]),
  );

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
