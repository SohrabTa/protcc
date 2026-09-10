/**
 * The structure panel, shared by the latent page and the protein page.
 *
 * Both pages want the same thing: a model of one protein, coloured by one latent, with the
 * measurement that says whether the firing residues really are close in space. Only the caption
 * differs, so the panel is one function rather than two copies that drift apart.
 *
 * A page gets a small number of WebGL contexts and never gets them back, so the module holds at
 * most one viewer. Stepping through proteins would otherwise take a context each and eventually
 * lose the earliest one.
 */

import type { Data } from './data';
import { loadBackbone, spatialStat, structureView, type StructureHandle } from './structure';
import { el } from './ui';

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
  host.append(el('h3', 'sub', 'In three dimensions'), note, box);

  let bb;
  try {
    bb = await loadBackbone(d.base, acc);
  } catch (err) {
    note.textContent = `The model could not be read. ${String(err)}`;
    box.remove();
    return null;
  }
  if (!bb) {
    note.textContent =
      `AlphaFold has no model for ${acc}. 5357 of the 207,463 proteins in the evaluation set ` +
      'are in that position.';
    box.remove();
    return null;
  }

  const sp = spatialStat(bb, acts);
  note.textContent =
    `Coloured by ${coloredBy}. ` +
    (sp
      ? `Firing residues more than 20 apart in sequence sit a median ${sp.firing.toFixed(0)} Å ` +
        `apart, against ${sp.protein.toFixed(0)} Å for the protein as a whole ` +
        `(${sp.nPairs} pairs). One protein, so this describes it rather than shows a rule.`
      : 'The colour is the same activation ramp the sequence views use.');

  try {
    live = await structureView(bb, acts, box);
  } catch (err) {
    note.textContent = `The viewer failed to start. ${String(err)}`;
    box.remove();
    return null;
  }
  return live;
}
