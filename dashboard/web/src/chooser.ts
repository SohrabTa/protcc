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

/** A band of the ranked list, as a fraction from the top, with the name the control shows. */
const BANDS: [string, number, number][] = [
  ['the top 10%', 0.0, 0.1],
  ['10% to 35%', 0.1, 0.35],
  ['35% to 65%', 0.35, 0.65],
  ['65% to 90%', 0.65, 0.9],
  ['the bottom 10%', 0.9, 1.0],
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

  // One row for the whole control: where in the order, the step buttons, the order, and the part
  // of it. It used to be three rows and a sentence, which was most of the text in its panel.
  const stepRow = el('div', 'chips chooser-row');
  const note = el('p', 'small muted chooser-note');
  root.append(stepRow, note);

  // ---- which latent the ranking uses -----------------------------------
  const sourceSelect = el('select');
  sourceSelect.title = 'Order the proteins by how hard this latent fires on them.';
  sources.forEach((s, i) => {
    const o = el('option', undefined, `${s.label.split(' ')[0]} fires hardest first`);
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

  // ---- which part of the ranking ---------------------------------------
  const bandSelect = el('select');
  bandSelect.title = 'Step through only this part of the order.';
  const allOpt = el('option', undefined, `all ${items.length.toLocaleString('en-US')}`);
  allOpt.value = '-1';
  bandSelect.append(allOpt);
  BANDS.forEach(([name], i) => {
    const o = el('option', undefined, name);
    o.value = String(i);
    bandSelect.append(o);
  });
  bandSelect.addEventListener('change', () => {
    band = Number(bandSelect.value);
    rebuild();
    pick(0);
  });

  const pos = el('span', 'small muted');
  const name = el('span', 'mono step-name');
  const prev = el('button', undefined, '‹');
  prev.title = 'previous';
  prev.addEventListener('click', () => pick(at - 1));
  const next = el('button', undefined, '›');
  next.title = 'next';
  next.addEventListener('click', () => pick(at + 1));
  const rand = el('button', undefined, 'random');
  rand.addEventListener('click', () => pick(Math.floor(Math.random() * slice.length)));
  stepRow.append(
    pos,
    prev,
    name,
    next,
    rand,
    el('span', 'small muted chooser-label', 'order:'),
    sourceSelect,
    el('span', 'small muted chooser-label', 'show:'),
    bandSelect,
  );

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
  }

  function pick(i: number): void {
    if (slice.length === 0) {
      pos.textContent = 'no protein passes this filter';
      name.textContent = '';
      note.textContent = '';
      return;
    }
    at = (i + slice.length) % slice.length;
    const idx = slice[at];
    const s = sources[source];
    pos.textContent = `${label} ${at + 1} of ${slice.length.toLocaleString('en-US')}`;
    name.textContent = items[idx];
    // The number the order uses, and how many latents fire here. When the latent's strongest
    // protein is not in this list, a third sentence says so, because the first protein of the
    // order is then not the latent's strongest case. 1 is the latent's own maximum.
    const who = s.label.split(' ')[0];
    const top = s.values ? s.values[order[0]] : 1;
    note.textContent =
      (s.values ? `${who} fires at ${s.format(s.values[idx])} here. ` : '') +
      (firing && firing.length === items.length
        ? `${firing[idx]} of the ${nLatents} latents fire on this protein.`
        : '') +
      (s.values && top < 1
        ? ` On these proteins ${who} reaches at most ${s.format(top)} of its maximum, so it ` +
          'fires harder on proteins that do not carry the concept.'
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
