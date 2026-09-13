/**
 * The structure panel, shared by the latent page, the concept page and the protein page.
 *
 * All three want the same thing: a model of one protein, coloured by one latent, with the
 * measurement that says whether the firing residues really are close in space. Only the caption
 * differs, so the panel is one function rather than three copies that drift apart.
 *
 * A page gets a small number of WebGL contexts and never gets them back, so the module holds at
 * most one viewer. Stepping through proteins would otherwise take a context each and eventually
 * lose the earliest one.
 */

import type { Data } from './data';
import { loadBackbone, spatialStat, structureView, type StructureHandle } from './structure';
import { el, figures, num } from './ui';

let live: StructureHandle | null = null;

export function currentStructure(): StructureHandle | null {
  return live;
}

export async function drawStructure(
  d: Data,
  acc: string,
  acts: Uint8Array,
  host: HTMLElement,
  coloredBy: string,
): Promise<StructureHandle | null> {
  live?.destroy();
  live = null;

  const box = el('div', 'struct');
  const note = el('p', 'small muted', 'Reading the AlphaFold model…');
  // The model on the left and the numbers beside it, because the numbers say whether the shape
  // on screen means what it looks like it means.
  const wrap = el('div', 'structwrap');
  const side = el('div', 'structside');
  wrap.append(box, side);
  host.append(el('h3', 'sub', 'In three dimensions'), note, wrap);

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
    note.textContent =
      `This data tree holds no model for ${acc}. ` +
      (missing
        ? `${num(missing)} of the ${num(d.manifest.counts.proteins)} proteins are in that ` +
          'position. AlphaFold has a model for every one of them. The Foldcomp database the ' +
          'models were extracted from does not.'
        : 'AlphaFold has a model for it, and the database the models were extracted from ' +
          'does not hold it.');
    wrap.remove();
    return null;
  }

  note.textContent = `Coloured by ${coloredBy}, on the same scale as the strips and the letters.`;

  const sp = spatialStat(bb, acts);
  if (sp) {
    side.append(
      figures(
        [
          [`${sp.firing.toFixed(0)} Å`, 'between firing residues'],
          [`${sp.protein.toFixed(0)} Å`, 'across the whole protein'],
          [num(sp.nPairs), 'pairs measured'],
        ],
        sp.firing < sp.protein
          ? 'The firing residues sit closer together in space than the protein does on average, ' +
            'so they are one site rather than scattered points. Only residue pairs more than 20 ' +
            'apart in the sequence are counted, so the chain itself cannot produce the effect. ' +
            'One protein, so this describes it rather than shows a rule.'
          : 'The firing residues sit no closer together in space than the protein does on ' +
            'average, so this latent is not reading one site on this protein. Only residue ' +
            'pairs more than 20 apart in the sequence are counted. One protein, so this ' +
            'describes it rather than shows a rule.',
      ),
    );
  }

  try {
    live = await structureView(bb, acts, box);
  } catch (err) {
    note.textContent = `The viewer failed to start. ${String(err)}`;
    wrap.remove();
    return null;
  }
  return live;
}
