/**
 * The header of the landing page: how the data on this site was made, as one small schematic.
 *
 * Two lanes share one model. The top lane is the training: UniRef50 goes through ProtT5, and the
 * crosscoder learns to rebuild all 24 layers. The bottom lane is the evaluation: Swiss-Prot goes
 * through the same ProtT5 and the same crosscoder, now frozen, and its latents pair with
 * concepts. ProtT5 and the crosscoder span the two lanes, so the reader sees that one model serves
 * both, and that the training never sees an annotation.
 *
 * Every box is plain text at reading size, with its numbers inside the sentence, and one link into
 * the method page. The pictures are on the method page, where there is room to explain them.
 */

import type { Data } from './data';
import type { SectionId } from './metrics';
import { amount, el, num } from './ui';

function node(area: string, name: string, detail: string, section: SectionId): HTMLAnchorElement {
  const a = el('a', `mf-node mf-${area}`);
  a.href = `#/method/${section}`;
  a.append(el('span', 'mf-name', name), el('span', 'mf-detail', detail));
  return a;
}

function arrow(area: string): HTMLElement {
  const s = el('span', `mf-arrow mf-${area}`, '→');
  s.setAttribute('aria-hidden', 'true');
  return s;
}

/** In one column the two lanes no longer share their boxes, so the label says it instead. */
function evaluateLabel(): HTMLElement {
  const s = el('span', 'mf-lane mf-le', 'Evaluate');
  s.append(el('span', 'mf-lane-note', ', with the same ProtT5 and the crosscoder frozen'));
  return s;
}

export function methodFigure(d: Data): HTMLElement {
  const h = d.manifest.headline;
  const t = d.manifest.training;
  const box = el('div');
  const grid = el('nav', 'mf');
  grid.setAttribute('aria-label', 'How the crosscoder was trained and evaluated');
  grid.append(
    el('span', 'mf-lane mf-lt', 'Train'),
    evaluateLabel(),
    node(
      'td', t.corpus,
      `${amount(t.sequences)} sequences, ${amount(t.residues)} residues, no labels`,
      'training',
    ),
    node(
      'ed', 'Swiss-Prot',
      `${num(d.manifest.counts.proteins)} proteins with annotations`,
      'naming',
    ),
    node(
      'pt', 'ProtT5 encoder',
      `${t.layers} layers, frozen. Each layer passes on 1,024 numbers per residue.`,
      'why',
    ),
    node(
      'cc', 'Crosscoder',
      `${num(t.latents)} latents in one dictionary for all ${t.layers} layers`,
      'one-dictionary',
    ),
    node(
      'tg', `Learns to rebuild all ${t.layers} layers`,
      `from ${t.k} latents per residue, on average`,
      'architecture',
    ),
    node(
      'ep', 'Latents pair with concepts',
      `${h.concepts_identified} of ${h.concepts_total} concepts have a paired latent`,
      'naming',
    ),
    arrow('a1'), arrow('a2'), arrow('a3'), arrow('a4'), arrow('a5'), arrow('a6'),
  );
  const foot = el('p', 'methodfoot');
  const how = el('a', undefined, 'How the crosscoder is built, step by step');
  how.href = '#/method/architecture';
  foot.append(
    'The training never sees a Swiss-Prot annotation. Each box opens its part of the method. ',
    how,
    '.',
  );
  box.append(grid, foot);
  return box;
}
