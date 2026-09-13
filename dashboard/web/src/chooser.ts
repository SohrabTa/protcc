/**
 * How to pick one protein out of tens of thousands.
 *
 * `Region_Disordered` is carried by 38,966 proteins. A stepper alone cannot choose among them,
 * because it offers only "the next one" and no reader will press it 38,966 times. A list cannot
 * choose among them either: nobody recognises an accession, so a dropdown of 38,966 names is a
 * choice that cannot be made.
 *
 * What makes the choice possible is a number per protein. Then the reader picks a part of the
 * range rather than a name: the proteins the latents read best, the middle of the distribution,
 * the ones they read worst. Two numbers are offered, because they rank the carriers differently
 * and each answers a different question. The stepper still exists, and now it steps inside the
 * part of the range the reader chose.
 */

import { el } from './ui';

export interface ChooserMetric {
  key: string;
  label: string;
  /** The glossary entry this metric is defined in. */
  slug: string;
  /** One value per item, in the item order. Higher is "more". */
  values: Float32Array;
  format(v: number): string;
  /** What the number means, one line, shown under the controls. */
  note: string;
}

export interface ChooserHandle {
  root: HTMLElement;
  /** Make the first pick. Call after the root and the body are in the document. */
  mount(): void;
  /** The item on screen. */
  current(): string;
}

const BANDS: [string, number, number][] = [
  ['top', 0.9, 1.0],
  ['upper', 0.65, 0.9],
  ['middle', 0.35, 0.65],
  ['lower', 0.1, 0.35],
  ['bottom', 0.0, 0.1],
];

export function proteinChooser(opts: {
  items: string[];
  label: string;
  metrics: ChooserMetric[];
  onPick(item: string): void;
}): ChooserHandle {
  const { items, label, metrics } = opts;
  const root = el('div', 'chooser');

  let metric = 0;
  let band = -1; // -1 is the whole list, in the order the data defines
  let order: number[] = items.map((_, i) => i);
  let slice: number[] = order;
  let at = 0;

  const controls = el('div', 'chips chooser-row');
  const bandRow = el('div', 'chips chooser-row');
  const stepRow = el('div', 'chips chooser-row');
  const note = el('p', 'small muted chooser-note');
  root.append(controls, bandRow, stepRow, note);

  // ---- the controls ----------------------------------------------------
  const metricButtons: HTMLButtonElement[] = [];
  if (metrics.length > 0) {
    controls.append(el('span', 'small muted', 'rank by'));
    metrics.forEach((m, i) => {
      const b = el('button', undefined, m.label);
      b.addEventListener('click', () => {
        metric = i;
        rebuild();
        pick(0);
      });
      metricButtons.push(b);
      controls.append(b);
    });
  }

  const jump = el('input');
  jump.type = 'search';
  jump.placeholder = 'accession';
  jump.className = 'chooser-jump';
  jump.setAttribute('aria-label', `Go to a ${label} by accession`);
  jump.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const want = jump.value.trim().toUpperCase();
    const i = items.indexOf(want);
    if (i < 0) {
      note.textContent = `${want} does not carry this concept, or is not in the evaluation set.`;
      return;
    }
    band = -1;
    rebuild();
    pick(slice.indexOf(i));
    jump.value = '';
  });
  controls.append(jump);

  const bandButtons: HTMLButtonElement[] = [];
  bandRow.append(el('span', 'small muted', 'from the'));
  const allBtn = el('button', undefined, 'whole range');
  allBtn.addEventListener('click', () => {
    band = -1;
    rebuild();
    pick(0);
  });
  bandButtons.push(allBtn);
  bandRow.append(allBtn);
  BANDS.forEach(([name], i) => {
    const b = el('button', undefined, name);
    b.addEventListener('click', () => {
      band = i;
      rebuild();
      pick(0);
    });
    bandButtons.push(b);
    bandRow.append(b);
  });

  const pos = el('span', 'small muted');
  const name = el('span', 'mono step-name');
  const value = el('span', 'small chooser-value');
  const prev = el('button', undefined, '‹');
  prev.title = 'previous';
  prev.addEventListener('click', () => pick(at - 1));
  const next = el('button', undefined, '›');
  next.title = 'next';
  next.addEventListener('click', () => pick(at + 1));
  const rand = el('button', undefined, 'random');
  rand.addEventListener('click', () => pick(Math.floor(Math.random() * slice.length)));
  stepRow.append(pos, prev, name, next, rand, value);

  // ---- the ordering ----------------------------------------------------
  function rebuild(): void {
    const m = metrics[metric];
    if (!m) {
      order = items.map((_, i) => i);
    } else {
      order = items.map((_, i) => i).sort((a, b) => m.values[b] - m.values[a]);
    }
    if (band < 0) {
      slice = order;
    } else {
      const [, lo, hi] = BANDS[band];
      // The band is a slice of the ranked order, so every band holds about a tenth or a quarter
      // of the carriers whatever the values look like. A fixed cut on the value itself would
      // leave a band empty for a concept whose latents read everything well.
      const a = Math.floor((1 - hi) * order.length);
      const b = Math.max(a + 1, Math.ceil((1 - lo) * order.length));
      slice = order.slice(a, Math.min(order.length, b));
    }
    metricButtons.forEach((b, i) => b.setAttribute('aria-pressed', String(i === metric)));
    bandButtons.forEach((b, i) => b.setAttribute('aria-pressed', String(i - 1 === band)));
    bandRow.hidden = metrics.length === 0;
    controls.hidden = metrics.length === 0 && true;
  }

  function pick(i: number): void {
    if (slice.length === 0) return;
    at = (i + slice.length) % slice.length;
    const idx = slice[at];
    const m = metrics[metric];
    pos.textContent = `${label} ${at + 1} of ${slice.length.toLocaleString('en-US')}`;
    name.textContent = items[idx];
    value.textContent = m ? `${m.label.toLowerCase()} ${m.format(m.values[idx])}` : '';
    note.textContent = m
      ? band < 0
        ? `${m.note} All ${items.length.toLocaleString('en-US')} carriers, strongest first.`
        : `${m.note} The ${BANDS[band][0]} of the range, by ${m.label.toLowerCase()}.`
      : '';
    // The caller owns the height lock, because only the caller knows when its fetch is done.
    opts.onPick(items[idx]);
  }

  return {
    root,
    mount() {
      rebuild();
      pick(0);
    },
    current() {
      return items[slice[at]];
    },
  };
}
