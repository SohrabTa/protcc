/**
 * The method page: why the dashboard is built this way, and what its numbers can and cannot say.
 *
 * The glossary and this page divide the work. The glossary answers "what does this word mean",
 * one entry at a time, and a reader gets there from a column header while doing something else.
 * This page answers "why is it measured this way", and it is read in order. Neither repeats the
 * other, and `metrics.ts` ties them: every glossary entry names the section that argues for it,
 * so each section can list its own definitions and each definition can link back here.
 *
 * The numbers come from the manifest, not from the text, so the page cannot fall behind the data
 * tree it describes.
 */

import type { Data } from './data';
import { METHOD_SECTIONS, METRIC_INFO, type SectionId } from './metrics';
import { el, link, num, panel, withContents } from './ui';

const NS = 'http://www.w3.org/2000/svg';

function svgNode(
  parent: SVGElement,
  tag: string,
  attrs: Record<string, string | number>,
  text?: string,
): SVGElement {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  if (text !== undefined) n.textContent = text;
  parent.append(n);
  return n;
}

/** A paragraph of body text, at the width the glossary uses. */
function para(...parts: (string | Node)[]): HTMLElement {
  const p = el('p');
  p.append(...parts);
  return p;
}

function cite(text: string, href: string): HTMLAnchorElement {
  const a = el('a', 'extlink', text);
  a.href = href;
  a.target = '_blank';
  a.rel = 'noopener';
  return a;
}

/**
 * 24 dictionaries against one.
 *
 * The left side is what a per-layer sparse autoencoder gives: one dictionary for each layer, and
 * the same direction learned again in every one of them, with nothing that says they are the
 * same. The right side is one dictionary that reads every layer and writes back into every
 * layer, so that direction is one unit with a profile over depth.
 *
 * The two titles and the two captions are HTML under each drawing, so they wrap and keep the
 * size of the text around them.
 */
function dictionaryPicture(): HTMLElement {
  const W = 330;
  const H = 150;
  const ys = [8, 36, 64, 92, 120];
  const layerName = (i: number) => (i === 2 ? 'layer m' : `layer ${[24, 23, '', 2, 1][i]}`);
  const drawing = (label: string): SVGSVGElement => {
    const s = document.createElementNS(NS, 'svg');
    s.setAttribute('viewBox', `0 0 ${W} ${H}`);
    s.setAttribute('role', 'img');
    s.setAttribute('aria-label', label);
    return s;
  };
  const layerBox = (s: SVGSVGElement, y: number, i: number) => {
    svgNode(s, 'rect', {
      x: 0, y, width: 84, height: 22, rx: 2, fill: 'var(--surface)', stroke: 'var(--line)',
    });
    svgNode(s, 'text', {
      x: 42, y: y + 15.5, 'font-size': 12, fill: 'var(--muted)', 'text-anchor': 'middle',
    }, layerName(i));
  };

  // ---- left: one autoencoder for each layer ----
  const left = drawing('One dictionary for each layer, with the same feature learned again in each.');
  ys.forEach((y, i) => {
    layerBox(left, y, i);
    svgNode(left, 'line', {
      x1: 86, y1: y + 11, x2: 112, y2: y + 11, stroke: 'var(--line-strong)',
    });
    svgNode(left, 'rect', {
      x: 114, y, width: 110, height: 22, rx: 2, fill: 'none', stroke: 'var(--line-strong)',
    });
    // The same direction, learned again in every dictionary, with nothing tying the copies.
    svgNode(left, 'rect', { x: 122, y: y + 7, width: 30, height: 8, rx: 1.5, fill: 'var(--signal)',
      opacity: 0.85 });
    svgNode(left, 'rect', { x: 158, y: y + 7, width: 18, height: 8, rx: 1.5,
      fill: 'var(--line-strong)', opacity: 0.6 });
    svgNode(left, 'rect', { x: 182, y: y + 7, width: 26, height: 8, rx: 1.5,
      fill: 'var(--line-strong)', opacity: 0.6 });
  });

  // ---- right: one crosscoder ----
  const right = drawing('One dictionary that reads and writes every layer.');
  ys.forEach((y, i) => {
    layerBox(right, y, i);
    svgNode(right, 'path', {
      d: `M86 ${y + 11} C 118 ${y + 11}, 118 75, 150 75`,
      stroke: 'var(--depth)', 'stroke-width': 1, fill: 'none', opacity: 0.7,
    });
    svgNode(right, 'path', {
      d: `M216 75 C 248 75, 248 ${y + 11}, 280 ${y + 11}`,
      stroke: 'var(--signal)', 'stroke-width': 1, fill: 'none', opacity: 0.6,
    });
    svgNode(right, 'rect', {
      x: 282, y, width: 10, height: 22, rx: 1.5, fill: 'var(--surface)', stroke: 'var(--line)',
    });
  });
  svgNode(right, 'rect', {
    x: 150, y: 40, width: 66, height: 70, rx: 2, fill: 'var(--surface)', stroke: 'var(--line-strong)',
  });
  svgNode(right, 'rect', { x: 158, y: 52, width: 50, height: 9, rx: 1.5, fill: 'var(--signal)',
    opacity: 0.9 });
  svgNode(right, 'rect', { x: 158, y: 70, width: 30, height: 9, rx: 1.5, fill: 'var(--line-strong)',
    opacity: 0.6 });
  svgNode(right, 'rect', { x: 158, y: 88, width: 40, height: 9, rx: 1.5, fill: 'var(--line-strong)',
    opacity: 0.6 });
  svgNode(right, 'text', {
    x: 183, y: 30, 'font-size': 12, fill: 'var(--muted)', 'text-anchor': 'middle',
  }, 'one dictionary');

  const half = (title: string, svg: SVGSVGElement, caption: string): HTMLElement => {
    const f = el('figure', 'm-half');
    const cap = el('figcaption');
    cap.append(el('strong', undefined, title), ' ', caption);
    f.append(svg, cap);
    return f;
  };
  const box = el('div', 'gl-pic m-pair');
  box.append(
    half(
      'One autoencoder for each layer.',
      left,
      'The amber unit is the same direction in all five dictionaries, and nothing in the ' +
        'training says so. 24 models give 24 dictionaries.',
    ),
    half(
      'One crosscoder over all layers.',
      right,
      'The amber unit is one latent. It reads every layer and writes back into every layer, so ' +
        'it has a length at each of the 24.',
    ),
  );
  return box;
}

/** The glossary entries whose definitions this section uses. */
function definitionsOf(id: SectionId): HTMLElement | null {
  const mine = METRIC_INFO.filter((m) => m.section === id);
  if (mine.length === 0) return null;
  const p = el('p', 'm-defs');
  p.append(el('span', 'm-defs-lead', 'Defined in the glossary: '));
  mine.forEach((m, i) => {
    if (i) p.append(' · ');
    const a = el('a', undefined, m.title);
    a.href = `#/glossary/${m.slug}`;
    p.append(a);
  });
  return p;
}

function section(id: SectionId, title: string, body: (Node | string)[]): HTMLElement {
  const i = METHOD_SECTIONS.findIndex((x) => x.id === id) + 1;
  const p = panel(`Method ${i} of ${METHOD_SECTIONS.length}`, title);
  p.id = `m-${id}`;
  const b = el('div', 'gl-body');
  b.append(...body);
  const defs = definitionsOf(id);
  if (defs) b.append(defs);
  p.append(b);
  return p;
}

export function renderMethod(d: Data, host: HTMLElement, want?: string): void {
  host.textContent = '';
  const views = el('div', 'views');
  const h = d.manifest.headline;

  const intro = panel(
    'Method',
    'What this dashboard is, and why it is built this way',
    'ProtT5 reads a protein sequence and writes a vector for every residue. Those vectors hold ' +
      'what the model knows, and nothing in them is labeled. This site puts names on parts of ' +
      'them. This page is the argument behind every number it prints.',
  );
  const toc = el('div', 'gl-toc');
  for (const sct of METHOD_SECTIONS) {
    const a = el('a', undefined, sct.title);
    a.href = `#/method/${sct.id}`;
    toc.append(a);
  }
  const gl = el('a', undefined, 'Glossary');
  gl.href = '#/glossary';
  toc.append(gl);
  intro.append(toc);
  intro.append(
    el(
      'p',
      'lede',
      'The glossary holds the definitions, one entry for each number. Each section here ends ' +
        'with the entries it used. Read this page for the argument and the glossary for a word.',
    ),
  );
  intro.classList.add('pagehead');
  views.append(intro);

  // ---- 1. why ---------------------------------------------------------
  views.append(
    section('why', 'Why read the inside of ProtT5', [
      para(
        'ProtT5 was trained on millions of protein sequences with no labels at all ',
        cite('(Elnaggar and others, 2021)', 'https://doi.org/10.1109/TPAMI.2021.3095381'),
        '. It learned to fill in masked residues, and along the way it learned enough that its ' +
          'vectors predict structure, localization and function. The knowledge is in the ' +
          'weights and the weights say nothing a person can read.',
      ),
      para(
        'The question this project asks is the direct one: what biological concepts are in ' +
          'there? A domain, a sequence motif, an active site, a binding residue. If a model ' +
          'holds them, a reader should be able to point at the part of the model that holds ' +
          'one.',
      ),
      para(
        'Two things follow from a named part. A prediction that traces back to one can be ' +
          'checked against biology. And a named part can be used on purpose, as a handle for ' +
          'guided mutation or for steering ',
        cite('(Yang and others, 2025)', 'https://doi.org/10.1038/s41467-025-55987-8'),
        '. Neither is possible while the vector is one dense block of 1,024 numbers.',
      ),
    ]),
  );

  // ---- 2. sparse ------------------------------------------------------
  views.append(
    section('sparse', 'Why sparse features', [
      para(
        'A residue vector is dense. Every one of its 1,024 numbers is non-zero, and no single ' +
          'number means anything alone. This field works from one assumption: the model holds ' +
          'many more concepts than it has dimensions, so it packs them in as directions that ' +
          'overlap. A dense vector is then a sum of many concepts at once, and that is why one ' +
          'dimension says nothing.',
      ),
      para(
        'A sparse autoencoder unpacks that sum ',
        cite('(Shu and others, 2025)', 'https://arxiv.org/abs/2503.05613'),
        '. It learns a wider dictionary, here 8,192 units against 1,024 dimensions, and it must ' +
          'rebuild the vector from only a few of them. Two terms decide the training: how well ' +
          'the rebuild matches, and how few units it may use. The units that survive are the ' +
          'parts the model reuses.',
      ),
      para(
        'Each of those units is what this site calls a latent. A latent has an activation at ' +
          'every residue of every protein, and that number is what every panel on this site ' +
          'draws. ',
        el('strong', undefined, `${num(h.latents_alive)} of the ${num(h.latents_total)} latents`),
        ' ever fire on the evaluation set. The rest are dead and are not shown.',
      ),
      para(
        'The same idea is already in use on protein language models, one layer at a time ',
        cite('(Simon and Zou, 2025)', 'https://doi.org/10.1038/s41592-025-02836-7'),
        ' ',
        cite('(Adams and others, 2025)', 'https://doi.org/10.1101/2025.02.06.636901'),
        '. What follows is where this project departs from that.',
      ),
    ]),
  );

  // ---- 3. one dictionary ----------------------------------------------
  views.append(
    section('one-dictionary', 'Why one dictionary for 24 layers', [
      para(
        'ProtT5 has 24 encoder layers, and each one holds its own vector for every residue. A ' +
          'sparse autoencoder reads one vector, so the ordinary approach is to train 24 of ' +
          'them, one for each layer. That has three costs.',
      ),
      para(
        'It is 24 training runs instead of one. Every dictionary learns the same direction ' +
          'again, so the same concept is counted 24 times. And nothing in the training says ' +
          'that the copies are one unit. So nobody can ask where in the network a concept ' +
          'appears or disappears.',
      ),
      dictionaryPicture(),
      para(
        'A sparse crosscoder removes all three ',
        cite(
          '(Lindsey and others, 2024)',
          'https://transformer-circuits.pub/2024/crosscoders/index.html',
        ),
        '. One dictionary reads all 24 layers at once and writes its reconstruction back into ' +
          'all 24. A latent is then one unit with 24 decoder vectors, one for each layer. The ' +
          'length of each vector is how hard the latent writes into that layer.',
      ),
      para(
        'That row of 24 lengths is the depth profile, and a per-layer autoencoder cannot ' +
          'produce it. The Depth panel draws it on every latent page. It is also why the ' +
          'landing page can say where in the encoder the named latents live. ',
        el(
          'strong',
          undefined,
          '60% of the live latents peak at layers 15 to 19, against 21% for an even spread.',
        ),
      ),
      para(
        'The same construction is used to compare two different models rather than two layers ' +
          'of one ',
        cite('(Jiralerspong and Bricken, 2025)', 'https://openreview.net/forum?id=ZB84SvrZB8'),
        '. This project is, as far as we know, its first application to a protein language ' +
          'model.',
      ),
    ]),
  );

  // ---- 4. training ----------------------------------------------------
  views.append(
    section('training', 'How this crosscoder was trained', [
      para(
        'The activations come from the residual stream of all 24 encoder layers of ',
        el('span', 'mono', 'Rostlab/prot_t5_xl_uniref50'),
        ', over UniRef50 sequences. The crosscoder has ',
        el('span', 'mono', num(h.latents_total)),
        ' latents and is trained with BatchTopK, which keeps the strongest 32 latents per ' +
          'residue across a batch rather than penalizing them all ',
        cite('(Bussmann and others, 2024)', 'https://arxiv.org/abs/2412.06410'),
        '. An auxiliary term pushes dead latents back into use.',
      ),
      para(
        'At inference the model changes to JumpReLU with one global threshold. A latent then ' +
          'fires whenever it clears that threshold, and the count per residue is no longer ' +
          'fixed at 32. Every activation on this site is read that way, on normalized ' +
          'activations. Without the normalization, the average F1 falls by 0.11.',
      ),
      para(
        'The evaluation set is separate from the training data: ',
        el('strong', undefined, `${num(d.manifest.counts.proteins)} Swiss-Prot proteins`),
        ' of annotation score 3, 4 or 5, at most 512 residues. Every pairing score on this site ' +
          'is measured on a held-out part of that set, never on the proteins used to choose the ' +
          'pairing.',
      ),
      para(
        'The exact checkpoint, the evaluation set and the build date are at the end of the ',
        link('/glossary', 'glossary'),
        '.',
      ),
    ]),
  );

  // ---- 5. naming ------------------------------------------------------
  views.append(
    section('naming', 'How a latent gets a name', [
      para(
        'A latent is a number per residue and nothing more. To give it a name, the method of ',
        cite('InterPLM (Simon and Zou, 2025)', 'https://doi.org/10.1038/s41592-025-02836-7'),
        ' is used: take what Swiss-Prot already annotates, and ask which latent fires where the ' +
          'annotation is.',
      ),
      para(
        `Swiss-Prot contributes ${h.concepts_total} concepts to this evaluation set. A domain, ` +
          'a motif, an active site, a zinc finger. For every concept and every latent, the ' +
          'pipeline compares the residues the latent fires on against the residues the concept ' +
          'covers. That comparison gives precision and recall. A latent pairs with a concept ' +
          'when its F1 per domain is more than 0.5 on the held-out proteins.',
      ),
      para(
        el(
          'strong',
          undefined,
          `${h.concepts_identified} of the ${h.concepts_total} concepts have at least one ` +
            `latent, and ${num(h.features_paired)} latents pair with at least one concept.`,
        ),
        ' The average best test F1 over all concepts is ',
        el('strong', undefined, h.avg_best_test_f1.toFixed(3)),
        '. Those three numbers are the ones in the four steps at the top of the landing page.',
      ),
      para(
        'A concept is rarely one latent. Most found concepts are split across a group, and each ' +
          'latent in the group reads a part of the region. The Splitting panel on the ',
        link('/', 'landing page'),
        ' is that result, and the next section says why it matters for reading any single score.',
      ),
    ]),
  );

  // ---- 6. limits ------------------------------------------------------
  views.append(
    section('limits', 'What these numbers cannot say', [
      para(
        el('strong', undefined, 'A high score is not by itself a finding. '),
        'The same pipeline was run against a crosscoder trained on a randomly initialized ' +
          'ProtT5, which has learned nothing about proteins. That null still clears 0.5 F1 per ' +
          'domain on 43 concepts, and on one of them, ',
        link(`/concept/${encodeURIComponent('Domain_RNase III')}`, 'Domain · RNase III'),
        ', it reaches 0.98. So a claim about one concept needs that concept’s own null, not ' +
          'the average.',
      ),
      para(
        el('strong', undefined, 'F1 per domain is a generous score. '),
        'One firing residue inside a region counts as recalling the whole region. So a latent ' +
          'that fires on a single conserved glycine scores near the top, and reads almost none ' +
          'of the domain. Read recall per residue beside it, always. The gap between the two ' +
          'is the main methodological result of this project, and every concept page prints ' +
          'both.',
      ),
      para(
        el('strong', undefined, 'The set is one set. '),
        'Everything here is Swiss-Prot, at most 512 residues, with an annotation score of 3 or ' +
          'more. A latent that reads something Swiss-Prot does not annotate cannot be named ' +
          'here, and there are ',
        el('strong', undefined, `${num(h.latents_alive - h.features_paired)} live latents`),
        ' that nothing named. They are not noise. They are what this evaluation set could not ' +
          'name.',
      ),
      para(
        el('strong', undefined, 'A correlation is not a mechanism. '),
        'Every number on this site says that a latent fires where an annotation is. None of ' +
          'them says that ProtT5 uses that latent to do anything. That question needs an ' +
          'intervention, and it is not answered here.',
      ),
    ]),
  );

  // ---- sources --------------------------------------------------------
  const src = panel('Method', 'Sources');
  src.id = 'm-sources';
  const list = el('ol', 'm-sources');
  const refs: [string, string, string][] = [
    [
      'Elnaggar and others, 2021',
      'ProtTrans: towards cracking the language of life’s code through self-supervised ' +
        'learning. IEEE TPAMI.',
      'https://doi.org/10.1109/TPAMI.2021.3095381',
    ],
    [
      'Shu and others, 2025',
      'A survey on sparse autoencoders: interpreting the internal mechanisms of large language ' +
        'models. arXiv 2503.05613.',
      'https://arxiv.org/abs/2503.05613',
    ],
    [
      'Simon and Zou, 2025',
      'InterPLM: discovering interpretable features in protein language models via sparse ' +
        'autoencoders. Nature Methods.',
      'https://doi.org/10.1038/s41592-025-02836-7',
    ],
    [
      'Adams and others, 2025',
      'From mechanistic interpretability to mechanistic biology: training, evaluating and ' +
        'interpreting sparse autoencoders on protein language models. Bioinformatics.',
      'https://doi.org/10.1101/2025.02.06.636901',
    ],
    [
      'Lindsey and others, 2024',
      'Sparse crosscoders for cross-layer features and model diffing. Transformer Circuits.',
      'https://transformer-circuits.pub/2024/crosscoders/index.html',
    ],
    [
      'Jiralerspong and Bricken, 2025',
      'Cross-architecture model diffing with crosscoders. Mechanistic Interpretability ' +
        'Workshop, NeurIPS.',
      'https://openreview.net/forum?id=ZB84SvrZB8',
    ],
    [
      'Bussmann and others, 2024',
      'BatchTopK sparse autoencoders. arXiv 2412.06410.',
      'https://arxiv.org/abs/2412.06410',
    ],
    [
      'Yang and others, 2025',
      'Active learning-assisted directed evolution. Nature Communications.',
      'https://doi.org/10.1038/s41467-025-55987-8',
    ],
    [
      'Kim, Mirdita and Steinegger, 2023',
      'Foldcomp: a library and format for compressing and indexing large protein structure ' +
        'sets. Bioinformatics. The structures on this site come from AlphaFold through it.',
      'https://doi.org/10.1093/bioinformatics/btad153',
    ],
  ];
  for (const [who, what, href] of refs) {
    const li = el('li');
    li.append(el('strong', undefined, `${who}. `), what, ' ', cite('link', href));
    list.append(li);
  }
  src.append(list);
  views.append(src);
  host.append(
    withContents(views, [
      ...METHOD_SECTIONS.map((x) => ({ id: `m-${x.id}`, title: x.title, href: `#/method/${x.id}` })),
      { id: 'm-sources', title: 'Sources', href: '#/method/sources' },
    ]),
  );

  // A section in the route scrolls itself into view. Fonts land after the first layout, which
  // moves everything below the target, so the scroll is repeated rather than done once.
  if (want) {
    const target = document.getElementById(`m-${want}`);
    if (target) {
      const go = () => target.scrollIntoView({ block: 'start' });
      requestAnimationFrame(() => requestAnimationFrame(go));
      setTimeout(go, 300);
      if (document.fonts) void document.fonts.ready.then(go);
    }
  }
}
