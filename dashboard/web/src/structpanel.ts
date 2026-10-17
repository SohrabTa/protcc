/**
 * The structure panel, shared by the latent page, the concept page and the protein page.
 *
 * All three want the same thing: a model of one protein, coloured by one latent. Only the
 * caption differs, so the panel is one function rather than three copies that drift apart.
 *
 * A page gets a small number of WebGL contexts and never gets them back, so the module holds at
 * most one viewer. Stepping through proteins would otherwise take a context each and eventually
 * lose the earliest one.
 */

import type { Data } from './data';
import { loadBackbone, structureView, type StructureHandle } from './structure';
import { el, howto, num } from './ui';

export interface StructureOptions {
  /** What colours the model, for example "f/2358". */
  coloredBy: string;
  /** Why the page picked that latent, when the reader did not. */
  why?: string;
  /** True when a letter row above marks its residue on the model. */
  letters?: boolean;
  /** False when the panel title already says "In three dimensions". */
  heading?: boolean;
}

let live: StructureHandle | null = null;

export function currentStructure(): StructureHandle | null {
  return live;
}

export async function drawStructure(
  d: Data,
  acc: string,
  acts: Uint8Array,
  host: HTMLElement,
  opts: StructureOptions,
): Promise<StructureHandle | null> {
  live?.destroy();
  live = null;

  const box = el('div', 'struct square');
  const note = el('p', 'small muted', 'Reading the AlphaFold model…');
  // The model alone. A per-protein distance used to sit beside it. The Locality panel on the
  // latent page measures the same question over the 20 proteins the latent fires hardest on, so
  // the one-protein number repeated it with less evidence.
  const wrap = el('div', 'structwrap');
  wrap.append(box);
  if (opts.heading !== false) host.append(el('h3', 'sub', 'In three dimensions'));
  host.append(note, wrap);

  let bb;
  try {
    bb = await loadBackbone(d.base, acc);
  } catch (err) {
    note.textContent = `The model could not be read. ${String(err)}`;
    wrap.remove();
    return null;
  }
  if (!bb) {
    // Every protein in this evaluation set carries an AlphaFoldDB cross-reference, so a model
    // exists. This tree is extracted from a Foldcomp database that does not hold all of them.
    const missing = d.manifest.counts.no_structure;
    const why =
      d.manifest.counts.no_structure_note ||
      'AlphaFold has a model for every one of them. The Foldcomp database the models were ' +
        'extracted from does not.';
    note.textContent =
      `This data tree holds no model for ${acc}. ` +
      (missing
        ? `${num(missing)} of the ${num(d.manifest.counts.proteins)} proteins are in that ` +
          `position. ${why}`
        : why);
    wrap.remove();
    return null;
  }

  const help = howto(
    'The model is the AlphaFold prediction for this protein. ' +
      `The colour is how hard ${opts.coloredBy} fires on each residue, on the same scale as ` +
      'the strips and the letters. ' +
      (opts.why ? `${opts.why} ` : '') +
      'Drag to turn the model. To zoom, hold Ctrl (⌘ on a Mac) and scroll, or pinch.' +
      (opts.letters ? ' Point at a letter in the row above to mark its residue with a ball.' : ''),
  );
  note.replaceWith(help);

  try {
    live = await structureView(bb, acts, box);
  } catch (err) {
    help.replaceWith(note);
    note.textContent = `The viewer failed to start. ${String(err)}`;
    wrap.remove();
    return null;
  }
  return live;
}
