/**
 * How to pick one protein out of tens of thousands.
 *
 * `Region_Disordered` is carried by 38,966 proteins. A stepper alone cannot choose among them,
 * because it offers only the next one. A list cannot choose among them either, because nobody
 * recognises an accession.
 *
 * What makes a choice possible is one number per protein. The reader then picks a part of the
 * range rather than a name, and the stepper walks inside that part.
 *
 * The number is how hard one named latent fires on that protein. It is one latent and not a
 * blend, because a blend cannot be checked against the rows on screen. The control says which
 * latent it uses, and the reader can change it. An earlier version offered two blended rankings
 * and never said what they ranked against, which is not a control a reader can trust.
 */

import { el } from './ui';

/** A band of the ranked list, as a fraction from the top. */
const BANDS: [string, number, number][] = [
  ['top', 0.0, 0.1],
  ['upper', 0.1, 0.35],
  ['middle', 0.35, 0.65],
  ['lower', 0.65, 0.9],
  ['bottom', 0.9, 1.0],
];

export interface ChooserSource {
  /** Shown on the control, for example "f/831 · F1 0.857". The first word names the latent. */
  label: string;
  /** How to print one value. */
  format(v: number): string;
  /** One value per item, higher first. Absent until `load` has run. */
  values?: Float32Array;
  /**
   * Fetch the values. A concept can have 62 latents and each ranking is its own file, so only
   * the one the reader is looking at is fetched.
   */
  load?(): Promise<Float32Array>;
}

export interface ChooserHandle {
  root: HTMLElement;
  /** Make the first pick. Call after the root and the body are in the document. */
  mount(): void;
  current(): string;
}

export function proteinChooser(opts: {
  items: string[];
  label: string;
  /** One entry per latent the reader can rank by. The first is the default. */
  sources: ChooserSource[];
  /**
   * How many of the concept's latents fire on each protein, or null when unknown. It becomes a
   * filter: a carrier that one of nine latents touches is a different case from one that all
   * nine touch.
   */
  firing: Uint8Array | null;
  nLatents: number;
  onPick(item: string): void;
}): ChooserHandle {
  const { items, label, sources, firing, nLatents } = opts;
  const root = el('div', 'chooser');

  let source = 0;
  let band = -1; // -1 is the whole ranked list
  let order: number[] = [];
  let slice: number[] = [];
  let at = 0;

  const rankRow = el('div', 'chips chooser-row');
  const bandRow = el('div', 'chips chooser-row');
  const stepRow = el('div', 'chips chooser-row');
  const note = el('p', 'small muted chooser-note');
  root.append(rankRow, bandRow, stepRow, note);

  // ---- which latent the ranking uses -----------------------------------
  const sourceSelect = el('select');
  sources.forEach((s, i) => {
    const o = el('option', undefined, s.label);
    o.value = String(i);
    sourceSelect.append(o);
  });
  sourceSelect.addEventListener('change', () => {
    void useSource(Number(sourceSelect.value));
  });

  /** Switch the ranking, and fetch its values if this is the first time. */
  async function useSource(i: number): Promise<void> {
    const s = sources[i];
    if (!s.values && s.load) {
      sourceSelect.disabled = true;
      note.textContent = `Reading where ${s.label.split(' ')[0]} fires…`;
      try {
        s.values = await s.load();
      } catch {
        note.textContent = `The ranking for ${s.label.split(' ')[0]} could not be read.`;
        sourceSelect.disabled = false;
        sourceSelect.value = String(source);
        return;
      }
      sourceSelect.disabled = false;
    }
    if (!s.values) return;
    source = i;
    rebuild();
    pick(0);
  }
  rankRow.append(
    el('span', 'small muted', 'order the proteins by how hard this latent fires:'),
    sourceSelect,
  );

  // ---- which part of the ranking ---------------------------------------
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

  function rebuild(): void {
    const s = sources[source];
    if (!s.values) return;
    const values = s.values;
    order = items.map((_, i) => i).sort((a, b) => values[b] - values[a]);

    if (band < 0) {
      slice = order;
    } else {
      // The band is a slice of the ranked order, so every band holds a fixed share of whatever
      // survives the filter. A fixed cut on the value would leave a band empty for a latent that
      // fires hard everywhere.
      const [, lo, hi] = BANDS[band];
      const a = Math.floor(lo * order.length);
      const b = Math.max(a + 1, Math.ceil(hi * order.length));
      slice = order.slice(a, Math.min(order.length, b));
    }
    bandButtons.forEach((b, i) => b.setAttribute('aria-pressed', String(i - 1 === band)));
  }

  function pick(i: number): void {
    if (slice.length === 0) {
      pos.textContent = 'no protein passes this filter';
      name.textContent = '';
      value.textContent = '';
      note.textContent = '';
      return;
    }
    at = (i + slice.length) % slice.length;
    const idx = slice[at];
    const s = sources[source];
    pos.textContent = `${label} ${at + 1} of ${slice.length.toLocaleString('en-US')}`;
    name.textContent = items[idx];
    value.textContent = s.values
      ? `${s.label.split(' ')[0]} fires at ${s.format(s.values[idx])} here`
      : '';
    note.textContent =
      `Ordered by how hard ${s.label.split(' ')[0]} fires, strongest first. ` +
      (band < 0
        ? `The whole range of ${items.length.toLocaleString('en-US')} carriers.`
        : `The ${BANDS[band][0]} of the range, of ${items.length.toLocaleString('en-US')} carriers.`) +
      (firing && firing.length === items.length
        ? ` ${firing[idx]} of the ${nLatents} latents fire on this one.`
        : '');
    opts.onPick(items[idx]);
  }

  return {
    root,
    mount() {
      void useSource(0);
    },
    current() {
      return items[slice[at]] ?? items[0];
    },
  };
}
