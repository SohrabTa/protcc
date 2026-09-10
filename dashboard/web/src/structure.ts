/**
 * The firing site in three dimensions.
 *
 * This exists for one question the sequence views cannot answer. A latent can fire on residues
 * that are far apart along the chain and still be reading a single site, because the chain
 * folds and brings them together. On the letter row that looks like scattered noise. In space
 * it is a pocket. So the panel draws the model, and it also counts the thing the eye is being
 * asked to judge, because a rotating protein is persuasive whether or not the residues are
 * really close.
 *
 * The models are stage 6's output: AlphaFold backbones as gzipped mmCIF, one file per protein,
 * about 19 kB each. 5357 of the 207,463 proteins have no AlphaFold model, and that case has to
 * be shown rather than hidden.
 */

import { cssVar, rampRGB } from './ui';

export interface Backbone {
  /** The raw mmCIF, which the viewer parses itself. */
  cif: string;
  /** label_seq_id of each alpha carbon, 1-based, in file order. */
  resi: Int32Array;
  /** Three coordinates for each alpha carbon, in the same order. */
  xyz: Float32Array;
}

/**
 * Read one model.
 *
 * Returns null when no model exists, which is a real answer and not an error.
 *
 * Whether the page has to decompress depends on the server, so it checks rather than assumes.
 * Vite sends a `.gz` file with `Content-Encoding: gzip` and the browser unwraps it on the way
 * in, leaving plain text. A bare static server, or a folder opened directly, sends the bytes as
 * stored. Decompressing unconditionally fails on the first, and not decompressing fails on the
 * second, so the two magic bytes at the front of a gzip member decide it.
 */
export async function loadBackbone(base: string, acc: string): Promise<Backbone | null> {
  const url = `${base}/structures/${acc.slice(0, 2).toUpperCase()}/${acc}.cif.gz`;
  const r = await fetch(url);
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`${url}: ${r.status} ${r.statusText}`);
  const bytes = new Uint8Array(await r.arrayBuffer());

  let cif: string;
  if (bytes.length > 1 && bytes[0] === 0x1f && bytes[1] === 0x8b) {
    if (typeof DecompressionStream === 'undefined') {
      throw new Error('This browser cannot decompress gzip, so the models cannot be read.');
    }
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    cif = await new Response(stream).text();
  } else {
    cif = new TextDecoder().decode(bytes);
  }
  if (!cif.startsWith('data_')) throw new Error(`${url} is not an mmCIF file.`);
  return { cif, ...alphaCarbons(cif) };
}

/**
 * The alpha carbons, from the rows stage 6 writes.
 *
 * Every row is `ATOM id element atom_name res_name A seq_id x y z occupancy b model`, one atom
 * per line and space-separated, so a split is enough and a full CIF parser is not. The viewer
 * gets the text and does its own parsing; this is only for the distance count.
 */
function alphaCarbons(cif: string): { resi: Int32Array; xyz: Float32Array } {
  const resi: number[] = [];
  const xyz: number[] = [];
  for (const line of cif.split('\n')) {
    if (!line.startsWith('ATOM ')) continue;
    const f = line.split(/\s+/);
    if (f.length < 11 || f[3] !== 'CA') continue;
    resi.push(Number(f[6]));
    xyz.push(Number(f[7]), Number(f[8]), Number(f[9]));
  }
  return { resi: Int32Array.from(resi), xyz: Float32Array.from(xyz) };
}

/** A fixed seed, so the sampled baseline does not change the reported number on a redraw. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 1000000) / 1000000;
  };
}

const APART = 20; // residues apart in sequence, far enough that closeness is not just the chain

export interface SpatialStat {
  nFiring: number;
  nPairs: number;
  /** Median distance in angstroms between distant firing pairs. */
  firing: number;
  /** The same median over pairs drawn from the whole protein. */
  protein: number;
}

/**
 * How far apart in space the firing residues are, against how far apart the protein is.
 *
 * A latent can read one site while firing on residues that are far apart along the chain,
 * because the chain folds. The letter row shows that as scatter. This measures it: the median
 * distance between alpha carbons of firing residues that sit at least 20 apart in sequence.
 * The comparison is the same median over pairs drawn from the whole protein, because a small
 * protein puts everything near everything and the raw distance would say nothing on its own.
 *
 * A median rather than a share above a cutoff, because any cutoff is arbitrary and because two
 * shares near 1% differ mostly by rounding. A distance in angstroms means something by itself.
 *
 * One protein, so this describes that protein. It is not a test.
 */
export function spatialStat(
  bb: Backbone,
  values: Uint8Array,
  threshold = 76, // 0.3 of the latent's own maximum, the same cut the other panels use
): SpatialStat | null {
  const n = bb.resi.length;
  if (n < 2 * APART) return null;

  const dist = (a: number, b: number): number => {
    const dx = bb.xyz[a * 3] - bb.xyz[b * 3];
    const dy = bb.xyz[a * 3 + 1] - bb.xyz[b * 3 + 1];
    const dz = bb.xyz[a * 3 + 2] - bb.xyz[b * 3 + 2];
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  };
  const median = (xs: number[]): number => {
    xs.sort((a, b) => a - b);
    const m = xs.length >> 1;
    return xs.length % 2 ? xs[m] : (xs[m - 1] + xs[m]) / 2;
  };

  const fire: number[] = [];
  for (let i = 0; i < n; i++) {
    const v = values[bb.resi[i] - 1];
    if (v !== undefined && v > threshold) fire.push(i);
  }
  if (fire.length < 6) return null;

  const firingPairs: number[] = [];
  for (let a = 0; a < fire.length; a++) {
    for (let b = a + 1; b < fire.length; b++) {
      if (Math.abs(bb.resi[fire[b]] - bb.resi[fire[a]]) < APART) continue;
      firingPairs.push(dist(fire[a], fire[b]));
    }
  }
  if (firingPairs.length < 20) return null;

  // The baseline is sampled rather than exhaustive. A 3000-residue protein has 4.5 million
  // pairs, and 20,000 of them pin a median far more tightly than the numerator is pinned.
  const next = rng(0x9e3779b9);
  const proteinPairs: number[] = [];
  for (let t = 0; t < 60000 && proteinPairs.length < 20000; t++) {
    const i = Math.floor(next() * n);
    const j = Math.floor(next() * n);
    if (Math.abs(bb.resi[j] - bb.resi[i]) < APART) continue;
    proteinPairs.push(dist(i, j));
  }
  if (proteinPairs.length < 200) return null;

  return {
    nFiring: fire.length,
    nPairs: firingPairs.length,
    firing: median(firingPairs),
    protein: median(proteinPairs),
  };
}

export interface StructureHandle {
  /** Point the viewer at a different latent on the same model. */
  update(values: Uint8Array): void;
  /**
   * Mark one residue, or clear the mark with null.
   *
   * This is what ties the letter row to the model: pointing at a letter shows where that residue
   * sits in the fold, which is the whole reason both views are on the page.
   */
  highlight(resi: number | null): void;
  /** Release the WebGL context, which a page does not get many of. */
  destroy(): void;
}

/**
 * Draw the model, coloured by activation.
 *
 * The colour is the same ramp the strips and the letters use, so the three views speak one
 * language and a reader can carry a colour from one to the next.
 *
 * 3Dmol arrives through a dynamic import. It is 540 kB, which is eighteen times the rest of
 * the site, so it must not be in the bundle every page loads.
 */
export async function structureView(
  bb: Backbone,
  values: Uint8Array,
  host: HTMLElement,
): Promise<StructureHandle> {
  const $3Dmol = await import('3dmol/build/3Dmol.es6-min.js');
  const viewer = $3Dmol.createViewer(host, { backgroundAlpha: 0 });
  viewer.addModel(bb.cif, 'cif');

  let vals = values;
  let marked: number | null = null;
  const paint = (): void => {
    viewer.setStyle(
      {},
      {
        cartoon: {
          // resi is the CIF label_seq_id, which counts from 1 while the track counts from 0.
          // 3Dmol hands it over as a string, so the conversion is written out rather than left
          // to the subtraction, which would keep working and keep hiding what it does.
          colorfunc: (atom: { resi: number | string }) => {
            const i = Number(atom.resi) - 1;
            const v = Number.isFinite(i) ? vals[i] : undefined;
            return `rgb(${rampRGB(v === undefined ? 0 : v / 255).join(',')})`;
          },
        },
      },
    );
    if (marked !== null) {
      viewer.addStyle(
        { resi: String(marked) },
        { sphere: { color: cssVar('--ink'), radius: 1.9 } },
      );
    }
    viewer.render();
  };

  paint();
  viewer.zoomTo();
  viewer.render();

  return {
    update(next) {
      vals = next;
      paint();
    },
    highlight(resi) {
      if (resi === marked) return; // a mousemove fires far more often than the residue changes
      marked = resi;
      paint();
    },
    destroy() {
      try {
        viewer.clear();
      } catch {
        // The viewer is already gone, which is the state we wanted.
      }
    },
  };
}
