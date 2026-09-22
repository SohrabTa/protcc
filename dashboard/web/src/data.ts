/**
 * Everything the site reads, and the decoders for the four binary formats.
 *
 * The precompute writes these; `dashboard/precompute/README.md` holds the layouts. Each format
 * starts with a magic number, and a mismatch throws here rather than rendering as noise.
 *
 * Fetch discipline: the five index files load once at start and stay in memory, and the
 * per-latent and per-protein files are fetched on demand and cached. That split exists because
 * the ranked protein list runs to 207,463 rows for the most common latent.
 */

const MAGIC = {
  rank: 0x50435231, // PCR1  feature/<id>.bin
  depth: 0x50434431, // PCD1  depth.bin
  concept: 0x50434331, // PCC1  concept_proteins.bin
  track: 0x50435431, // PCT1  tracks/<XX>/<acc>.bin
  coverage: 0x50435631, // PCV1  concept_coverage.bin
  locality: 0x50434c31, // PCL1  latent_locality.bin
} as const;

export interface Manifest {
  stage: string;
  built: string;
  partial: boolean;
  crosscoder: string;
  eval_set: string;
  headline: {
    avg_best_test_f1: number;
    concepts_total: number;
    concepts_identified: number;
    features_paired: number;
    latents_total: number;
    latents_alive: number;
    layers: number;
  };
  counts: {
    proteins: number;
    feature_files: number;
    latent_protein_pairs: number;
    /** Written from stage 6. Absent in a tree built before that count existed. */
    structures?: number;
    no_structure?: number;
    /** Written from stage 6b: the models downloaded from EBI rather than read from Foldcomp. */
    structures_from_ebi?: number;
    /** Written from stage 6b: why the proteins with no model have none. */
    no_structure_note?: string;
  };
}

/** One row of concepts.json. Short keys: the file holds 408 of these. */
export interface Concept {
  c: string; // name, "Domain_CN hydrolase"
  fld: string; // Swiss-Prot field, "Domain"
  fam: string; // biological family, the primary grouping
  role: string; // catalytic | binding | structural | PTM | targeting | disorder
  f1: number; // best per-domain F1 any latent reaches
  nf: number; // how many latents pair with it
  bf?: number; // the best latent
  // latent, F1 per domain, precision, recall per residue, recall per domain. The last entry is
  // absent in a tree built before stage 4 wrote it.
  feats?: [number, number, number, number, number?][];
  po?: [number, number]; // its slice of concept_proteins.bin
  npr?: number; // how many proteins carry it
}

export interface Feature {
  f: number; // latent index
  pk: number; // peak layer, 1 to 24
  sp: number; // layers holding at least half the peak norm
  pp: number; // share of proteins it fires on, percent
  pw: number; // share of a protein it covers when it fires, percent
  np: number; // proteins it fires on
  c?: string; // best paired concept
  f1?: number;
}

/** The proteins one latent fires on, strongest first. */
export interface Ranking {
  protein: Uint32Array; // global protein index
  value: Uint8Array; // peak activation on that protein, 255 = its peak anywhere
  cover: Uint8Array; // share of that protein's residues it is active on
}

/** Every latent that fires on one protein, by residue. */
export interface Track {
  length: number;
  indptr: Uint32Array; // where each residue's entries start
  latent: Uint16Array;
  value: Uint8Array;
}

export interface ProteinInfo {
  n: string; // name
  l: number; // length
  s: string; // sequence
  c: Record<string, [number, number][]>; // concept column -> inclusive residue ranges
  af: boolean; // an AlphaFold model exists
}

function check(view: DataView, want: number, what: string) {
  const got = view.getUint32(0, true);
  if (got !== want) {
    throw new Error(
      `${what}: expected magic 0x${want.toString(16)}, read 0x${got.toString(16)}`,
    );
  }
}

async function getBuffer(url: string): Promise<ArrayBuffer> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: ${r.status} ${r.statusText}`);
  return r.arrayBuffer();
}

async function getJSON<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: ${r.status} ${r.statusText}`);
  return r.json() as Promise<T>;
}

export class Data {
  readonly base: string;
  manifest!: Manifest;
  concepts!: Concept[];
  features!: Feature[];
  /** latent index -> its row in `features`, since dead latents are absent. */
  featureById = new Map<number, Feature>();
  conceptByName = new Map<string, Concept>();
  /** depth curves, both [n_latents][n_layers] scaled 0 to 255. */
  depthNorm!: Uint8Array;
  depthCos!: Uint8Array;
  nLayers = 24;
  /** concept_proteins.bin, read through the `po` range on a concept. */
  conceptProtein!: Uint32Array;
  /**
   * concept_coverage.bin, in the same pair order as `conceptProtein`.
   *
   * One byte per concept-protein pair: the share of that protein's annotated residues that the
   * concept's paired latents fire on. Empty when the file is absent, which is the state of any
   * tree built before stage 7 ran.
   */
  conceptCoverage!: Uint8Array;
  /** How many of a concept's latents fire on that protein, same pair order. */
  conceptFiring!: Uint8Array;
  /**
   * Stage 8: how spread out each latent's firing residues are, along the chain and in space.
   *
   * Both are medians over the proteins the latent fires hardest on, each divided by the same
   * spread over the whole protein. 1 means the firing residues are spread like the protein.
   * NaN means the latent was not measured.
   */
  localitySeq!: Float32Array;
  localitySpace!: Float32Array;
  localityN!: Uint16Array;
  proteinIds!: string[];
  proteinShard = new Map<string, number>();
  /** Column order of the annotation ranges inside a protein bundle. */
  conceptColumns: string[] = [];

  private rankCache = new Map<number, Ranking>();
  private trackCache = new Map<string, Track>();
  private bundleCache = new Map<number, Record<string, ProteinInfo>>();

  constructor(base = './data') {
    this.base = base;
  }

  async load(): Promise<void> {
    const [manifest, concepts, features, lookup, depthBuf, cpBuf, columns, covBuf, locBuf] =
      await Promise.all([
        getJSON<Manifest>(`${this.base}/manifest.json`),
        getJSON<Concept[]>(`${this.base}/concepts.json`),
        getJSON<Feature[]>(`${this.base}/features.json`),
        getJSON<Record<string, [number, number]>>(`${this.base}/protein_lookup.json`),
        getBuffer(`${this.base}/depth.bin`),
        getBuffer(`${this.base}/concept_proteins.bin`).catch(() => null),
        getJSON<string[]>(`${this.base}/concept_columns.json`).catch(() => [] as string[]),
        getBuffer(`${this.base}/concept_coverage.bin`).catch(() => null),
        getBuffer(`${this.base}/latent_locality.bin`).catch(() => null),
      ]);
    this.manifest = manifest;
    this.conceptColumns = columns;
    this.concepts = concepts;
    this.features = features;
    for (const f of features) this.featureById.set(f.f, f);
    for (const c of concepts) this.conceptByName.set(c.c, c);

    const dv = new DataView(depthBuf);
    check(dv, MAGIC.depth, 'depth.bin');
    const nLat = dv.getUint32(4, true);
    this.nLayers = dv.getUint32(8, true);
    const n = nLat * this.nLayers;
    this.depthNorm = new Uint8Array(depthBuf, 16, n);
    this.depthCos = new Uint8Array(depthBuf, 16 + n, n);

    if (cpBuf) {
      const cv = new DataView(cpBuf);
      check(cv, MAGIC.concept, 'concept_proteins.bin');
      const nCon = cv.getUint32(4, true);
      const nPair = cv.getUint32(8, true);
      this.conceptProtein = new Uint32Array(cpBuf, 16 + 4 * (nCon + 1), nPair);
    } else {
      this.conceptProtein = new Uint32Array(0);
    }

    if (covBuf) {
      const vv = new DataView(covBuf);
      check(vv, MAGIC.coverage, 'concept_coverage.bin');
      const nPairs = vv.getUint32(4, true);
      const nArrays = vv.getUint32(12, true);
      this.conceptCoverage = new Uint8Array(covBuf, 16, nPairs);
      // A file written before the second array exists reports 1, and the filter is then absent
      // rather than wrong.
      this.conceptFiring =
        nArrays >= 2 ? new Uint8Array(covBuf, 16 + nPairs, nPairs) : new Uint8Array(0);
    } else {
      this.conceptCoverage = new Uint8Array(0);
      this.conceptFiring = new Uint8Array(0);
    }

    if (locBuf) {
      const lv = new DataView(locBuf);
      check(lv, MAGIC.locality, 'latent_locality.bin');
      const nl = lv.getUint32(4, true);
      this.localitySeq = new Float32Array(locBuf, 16, nl);
      this.localitySpace = new Float32Array(locBuf, 16 + 4 * nl, nl);
      this.localityN = new Uint16Array(locBuf, 16 + 8 * nl, nl);
    } else {
      this.localitySeq = new Float32Array(0);
      this.localitySpace = new Float32Array(0);
      this.localityN = new Uint16Array(0);
    }

    this.proteinIds = new Array(Object.keys(lookup).length);
    for (const [acc, [idx, shard]] of Object.entries(lookup)) {
      this.proteinIds[idx] = acc;
      this.proteinShard.set(acc, shard);
    }
  }

  /** The 24 decoder norms of one latent, each 0 to 1, with 1 at its peak layer. */
  depthOf(fid: number): { norm: number[]; cos: number[] } {
    const o = fid * this.nLayers;
    const norm: number[] = [];
    const cos: number[] = [];
    for (let i = 0; i < this.nLayers; i++) {
      norm.push(this.depthNorm[o + i] / 255);
      cos.push((this.depthCos[o + i] / 255) * 2 - 1);
    }
    return { norm, cos };
  }

  /** The annotation column a concept occupies inside a protein bundle, or null. */
  columnOf(name: string): number | null {
    const i = this.conceptColumns.indexOf(name);
    return i >= 0 ? i : null;
  }

  /** The proteins carrying a concept, as accessions. */
  carriersOf(c: Concept): string[] {
    if (!c.po) return [];
    const [lo, hi] = c.po;
    const out: string[] = [];
    for (let i = lo; i < hi; i++) out.push(this.proteinIds[this.conceptProtein[i]]);
    return out;
  }

  /**
   * How much of the annotation the concept's latents read, per carrier, 0 to 1.
   *
   * The order matches `carriersOf`. Returns null when stage 7 has not run, or when no latent
   * pairs with the concept, in which case there is nothing to have read.
   */
  coverageOf(c: Concept): Float32Array | null {
    if (!c.po || !this.conceptCoverage.length || !c.feats?.length) return null;
    const [lo, hi] = c.po;
    if (hi > this.conceptCoverage.length) return null;
    const out = new Float32Array(hi - lo);
    for (let i = lo; i < hi; i++) out[i - lo] = this.conceptCoverage[i] / 255;
    return out;
  }

  /**
   * How many of the concept's latents fire on each carrier, in `carriersOf` order.
   *
   * Returns null when stage 7 has not run, or when the file predates this array.
   */
  latentsFiringOn(c: Concept): Uint8Array | null {
    if (!c.po || !this.conceptFiring.length || !c.feats?.length) return null;
    const [lo, hi] = c.po;
    if (hi > this.conceptFiring.length) return null;
    return this.conceptFiring.subarray(lo, hi);
  }

  /** One latent's two spreads, or null when stage 8 has not run or could not measure it. */
  localityOf(fid: number): { seq: number; space: number; n: number } | null {
    if (fid >= this.localityN.length || !this.localityN[fid]) return null;
    const seq = this.localitySeq[fid];
    const space = this.localitySpace[fid];
    if (!Number.isFinite(seq) || !Number.isFinite(space)) return null;
    return { seq, space, n: this.localityN[fid] };
  }

  /** How many proteins have an AlphaFold model in this tree, or null in an older tree. */
  get nStructures(): number | null {
    return this.manifest.counts.structures ?? null;
  }

  async ranking(fid: number): Promise<Ranking> {
    const hit = this.rankCache.get(fid);
    if (hit) return hit;
    const buf = await getBuffer(`${this.base}/feature/${fid}.bin`);
    const dv = new DataView(buf);
    check(dv, MAGIC.rank, `feature/${fid}.bin`);
    const n = dv.getUint32(4, true);
    const r: Ranking = {
      protein: new Uint32Array(buf, 8, n),
      value: new Uint8Array(buf, 8 + 4 * n, n),
      cover: new Uint8Array(buf, 8 + 5 * n, n),
    };
    this.rankCache.set(fid, r);
    return r;
  }

  async track(acc: string): Promise<Track> {
    const hit = this.trackCache.get(acc);
    if (hit) return hit;
    const buf = await getBuffer(`${this.base}/tracks/${acc.slice(0, 2).toUpperCase()}/${acc}.bin`);
    const dv = new DataView(buf);
    check(dv, MAGIC.track, `tracks/${acc}.bin`);
    const len = dv.getUint32(4, true);
    const nnz = dv.getUint32(8, true);
    const t: Track = {
      length: len,
      indptr: new Uint32Array(buf, 16, len + 1),
      latent: new Uint16Array(buf, 16 + 4 * (len + 1), nnz),
      value: new Uint8Array(buf, 16 + 4 * (len + 1) + 2 * nnz, nnz),
    };
    this.trackCache.set(acc, t);
    return t;
  }

  /** One latent's activation at every residue of a protein, 0 to 255. */
  static activationOf(t: Track, fid: number): Uint8Array {
    const out = new Uint8Array(t.length);
    for (let r = 0; r < t.length; r++) {
      for (let i = t.indptr[r]; i < t.indptr[r + 1]; i++) {
        if (t.latent[i] === fid) {
          out[r] = t.value[i];
          break;
        }
      }
    }
    return out;
  }

  async protein(acc: string): Promise<ProteinInfo | null> {
    const shard = this.proteinShard.get(acc);
    if (shard === undefined || shard < 0) return null;
    let bundle = this.bundleCache.get(shard);
    if (!bundle) {
      const b = await getJSON<{ proteins: Record<string, ProteinInfo> }>(
        `${this.base}/proteins/shard_${shard}.json`,
      );
      bundle = b.proteins;
      this.bundleCache.set(shard, bundle);
    }
    return bundle[acc] ?? null;
  }

  /**
   * Whether this data tree holds the per-residue track of a protein.
   *
   * A shard of -1 marks a protein that stage 1 knows about and stage 2 did not write a track
   * for. It is false for every protein in a full tree, and it is how a tree built from a subset
   * of the 208 shards reports what it does not have.
   */
  hasTrack(acc: string): boolean {
    const s = this.proteinShard.get(acc);
    return s !== undefined && s >= 0;
  }
}
