/**
 * How a latent's concepts appear in a table row or a hover line.
 *
 * A latent can pair with more than one concept, and every list of latents shows the best one
 * only. The cell and the label here say so in the same words everywhere: the best concept by F1
 * per domain, and how many others there are.
 */

import type { Data } from './data';
import { el, link } from './ui';

const show = (name: string) => name.replace('_', ' · ');

/** The two cells a latent row needs, and the values they sort by. */
export interface PairCells {
  /** The best concept, and a button that opens the others with their F1 per domain. */
  concept: Node;
  /** The F1 per domain of the best pair, or a dash. */
  f1: string;
  conceptKey: string;
  f1Key: number | undefined;
}

export function pairCells(d: Data, fid: number): PairCells {
  const pairs = d.pairsOf(fid);
  if (pairs.length === 0) {
    // 'zzz' puts the unnamed latents after every name when the column sorts A to Z.
    return {
      concept: el('span', 'muted', 'nothing named it'),
      f1: '—',
      conceptKey: 'zzz',
      f1Key: undefined,
    };
  }
  const [best, ...others] = pairs;
  const cell = el('div', 'paircell');
  cell.append(link(`/concept/${encodeURIComponent(best.concept.c)}`, show(best.concept.c)));
  if (others.length) {
    const label = `+${others.length} more`;
    const toggle = el('button', 'linkish pairmore', label);
    toggle.type = 'button';
    toggle.setAttribute('aria-expanded', 'false');
    const sub = el('table', 'subpairs');
    const tb = el('tbody');
    for (const p of others) {
      const tr = el('tr');
      const name = el('td');
      name.append(link(`/concept/${encodeURIComponent(p.concept.c)}`, show(p.concept.c)));
      tr.append(name, el('td', 'mono', p.f1.toFixed(3)));
      tb.append(tr);
    }
    sub.append(tb);
    sub.hidden = true;
    toggle.addEventListener('click', () => {
      sub.hidden = !sub.hidden;
      toggle.setAttribute('aria-expanded', String(!sub.hidden));
      toggle.textContent = sub.hidden ? label : 'hide';
    });
    cell.append(toggle, sub);
  }
  return {
    concept: cell,
    f1: best.f1.toFixed(3),
    conceptKey: show(best.concept.c).toLowerCase(),
    f1Key: best.f1,
  };
}

/** One line for a hover text: the best concept, "X and 1 more", or "nothing named it". */
export function bestConceptLabel(d: Data, fid: number): string {
  const pairs = d.pairsOf(fid);
  if (pairs.length === 0) return 'nothing named it';
  const best = show(pairs[0].concept.c);
  return pairs.length === 1 ? best : `${best} and ${pairs.length - 1} more`;
}
