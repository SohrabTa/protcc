/**
 * Every measured number that the text of the site states, taken from the data tree.
 *
 * The rule: the site prints only numbers of the crosscoder and eval set that the data tree
 * describes. A number typed into a sentence can belong to another crosscoder, eval set or
 * counting rule and stay there unseen, so the text reads its numbers from here.
 * `tools/check-numbers.mjs` fails the build when a measured number is typed into a string.
 *
 * `metrics.ts` holds no data, so its sentences name a number as `{key}`, and `fill` puts the
 * value in when the sentence is shown.
 */

import type { Concept, Data } from './data';

const num = (x: number) => x.toLocaleString('en-US');
const pct = (x: number) => `${x.toFixed(x < 1 ? 2 : 0)}%`;

function median(xs: number[]): number {
  const a = [...xs].sort((x, y) => x - y);
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

/** One latent of a concept, with the two numbers a worked example quotes. */
export interface ExampleLatent {
  id: number;
  f1: number;
  /** Recall per residue, as a percentage. */
  reads: string;
}

export interface Facts {
  latentsTotal: number;
  latentsAlive: number;
  latentsDead: number;
  latentsPaired: number;
  latentsUnpaired: number;
  /** Latents that pair with two or more concepts. */
  latentsMulti: number;
  /** Pairs of a latent and a concept. A latent with two concepts makes two. */
  pairs: number;
  conceptsTotal: number;
  conceptsFound: number;
  proteins: number;
  avgBestF1: number;
  medianRecallDomain: number;
  medianRecallResidue: number;
  conceptsFoundPerResidue?: number;
  latentsPairedPerResidue?: number;
  /** The Swiss-Prot field that holds the most paired latents, and its share of them. */
  biggestField: { name: string; share: string };
  /** The most proteins one latent fires on. */
  mostProteins: number;
  /** The median number of layers at which a latent keeps half its peak. */
  medianSpreadLayers: number;
  /** For one concept: the Best latent, and the latent that reads the most of the region. */
  example?: { concept: Concept; best: ExampleLatent; reader: ExampleLatent };
}

const EXAMPLE_CONCEPT = 'Domain_ABC transporter';

function exampleOf(d: Data): Facts['example'] {
  const concept = d.conceptByName.get(EXAMPLE_CONCEPT);
  const feats = concept?.feats;
  if (!concept || !feats?.length) return undefined;
  const as = ([id, f1, , rec]: (typeof feats)[number]): ExampleLatent => ({
    id,
    f1,
    reads: pct(rec * 100),
  });
  const best = feats.find(([id]) => id === concept.bf) ?? feats[0];
  const reader = feats.reduce((a, b) => (b[3] > a[3] ? b : a));
  return { concept, best: as(best), reader: as(reader) };
}

let cache: { d: Data; facts: Facts } | null = null;

export function facts(d: Data): Facts {
  if (cache?.d === d) return cache.facts;
  const h = d.manifest.headline;
  const pairs = d.concepts.flatMap((c) => c.feats ?? []);
  const perLatent = new Map<number, number>();
  for (const [id] of pairs) perLatent.set(id, (perLatent.get(id) ?? 0) + 1);
  const paired = d.features.filter((f) => f.c);
  const fields = new Map<string, number>();
  for (const f of paired) {
    const field = f.c!.split('_')[0];
    fields.set(field, (fields.get(field) ?? 0) + 1);
  }
  const [field, inField] = [...fields.entries()].reduce((a, b) => (b[1] > a[1] ? b : a));
  const out: Facts = {
    latentsTotal: h.latents_total,
    latentsAlive: h.latents_alive,
    latentsDead: h.latents_total - h.latents_alive,
    latentsPaired: h.features_paired,
    latentsUnpaired: h.latents_alive - h.features_paired,
    latentsMulti: [...perLatent.values()].filter((n) => n > 1).length,
    pairs: pairs.length,
    conceptsTotal: h.concepts_total,
    conceptsFound: h.concepts_identified,
    proteins: d.manifest.counts.proteins,
    avgBestF1: h.avg_best_test_f1,
    medianRecallDomain: median(pairs.flatMap(([, , , , recd]) => (recd === undefined ? [] : [recd]))),
    medianRecallResidue: median(pairs.map(([, , , rec]) => rec)),
    conceptsFoundPerResidue: h.concepts_identified_per_residue,
    latentsPairedPerResidue: h.features_paired_per_residue,
    biggestField: { name: field, share: `${((inField / paired.length) * 100).toFixed(1)}%` },
    mostProteins: Math.max(...d.features.map((f) => f.np)),
    medianSpreadLayers: median(d.features.map((f) => f.sp)),
    example: exampleOf(d),
  };
  cache = { d, facts: out };
  return out;
}

let shown: Record<string, string> = {};

/** Make the facts of this data tree the ones that `fill` writes into a sentence. */
export function useFacts(d: Data): void {
  const f = facts(d);
  shown = {
    latents_total: num(f.latentsTotal),
    latents_alive: num(f.latentsAlive),
    latents_paired: num(f.latentsPaired),
    concepts_total: num(f.conceptsTotal),
    concepts_found: num(f.conceptsFound),
    proteins: num(f.proteins),
    avg_best_f1: f.avgBestF1.toFixed(3),
    concepts_found_per_residue:
      f.conceptsFoundPerResidue === undefined ? 'fewer' : num(f.conceptsFoundPerResidue),
  };
}

/** A sentence from `metrics.ts`, with each `{key}` replaced by the number of this data tree. */
export function fill(text: string): string {
  return text.replace(/\{(\w+)\}/g, (m, key: string) => shown[key] ?? m);
}
