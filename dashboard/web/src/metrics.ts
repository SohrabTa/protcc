/**
 * The name and the one-sentence definition of every number the dashboard prints.
 *
 * This module holds no DOM and imports nothing. The table helper reads it to put a tooltip on a
 * column header, and the glossary page reads it for the titles, so a metric is named once. The
 * drawn definitions live in `glossary.ts`, which needs the DOM helpers and would otherwise make
 * an import cycle with `ui.ts`.
 */

export interface MetricInfo {
  /** The anchor on the glossary page, and the route `#/glossary/<slug>`. */
  slug: string;
  title: string;
  /** One sentence, for the tooltip on a column header. */
  short: string;
}

export const METRIC_INFO: MetricInfo[] = [
  {
    slug: 'precision',
    title: 'Precision',
    short: 'Of the residues the latent fires on, the share that the annotation covers.',
  },
  {
    slug: 'recall-per-residue',
    title: 'Recall per residue',
    short: 'Of the annotated residues, the share the latent fires on.',
  },
  {
    slug: 'f1-per-domain',
    title: 'F1 per domain',
    short:
      'Precision and recall in one number, with a whole region counted as read when the latent ' +
      'fires anywhere inside it.',
  },
  {
    slug: 'peak-layer',
    title: 'Peak layer',
    short: 'The encoder layer the latent writes hardest into, from 1 to 24.',
  },
  {
    slug: 'depth',
    title: 'Depth',
    short: 'The whole 24-layer profile as a bar row, with the peak layer tallest.',
  },
  {
    slug: 'cosine-similarity',
    title: 'Cosine similarity across layers',
    short:
      'How closely a layer’s direction matches the peak layer’s: 1 is the same direction, 0 is ' +
      'unrelated.',
  },
  {
    slug: 'covers',
    title: 'Covers',
    short: 'The share of a protein’s residues the latent is active on.',
  },
  {
    slug: 'peak-activation',
    title: 'Peak activation',
    short: 'The strongest this latent fires on this protein, against its strongest anywhere.',
  },
  {
    slug: 'reads',
    title: 'Reads',
    short: 'Of the residues Swiss-Prot annotates here, the share the concept’s latents fire on.',
  },
  {
    slug: 'strength',
    title: 'Strength',
    short: 'How hard the concept’s best latent fires on this protein, against its hardest anywhere.',
  },
  {
    slug: 'latents',
    title: 'Latents, live and paired',
    short: 'One of the 8192 features the crosscoder learned. Live if it ever fires, paired if a concept matches it.',
  },
  {
    slug: 'concept',
    title: 'Concept',
    short: 'One Swiss-Prot annotation type, for example a named domain or a binding site.',
  },
  {
    slug: 'proteins',
    title: 'Proteins',
    short: 'How many proteins of the 207,463 in the evaluation set this row counts.',
  },
  {
    slug: 'null',
    title: 'Why a high score is not always a finding',
    short: 'A crosscoder over a random-init ProtT5 also scores well on some concepts.',
  },
];

const BY_SLUG = new Map(METRIC_INFO.map((m) => [m.slug, m]));

/** Which column header resolves to which entry. One header, one definition. */
const BY_HEADER: Record<string, string> = {
  'f1 per domain': 'f1-per-domain',
  'best f1': 'f1-per-domain',
  precision: 'precision',
  'recall per residue': 'recall-per-residue',
  'peak layer': 'peak-layer',
  depth: 'depth',
  covers: 'covers',
  peak: 'peak-activation',
  'peak here': 'peak-activation',
  reads: 'reads',
  strength: 'strength',
  latent: 'latents',
  latents: 'latents',
  'best latent': 'latents',
  concept: 'concept',
  proteins: 'proteins',
  carriers: 'proteins',
};

export function metricForHeader(header: string): MetricInfo | undefined {
  const slug = BY_HEADER[header.trim().toLowerCase()];
  return slug ? BY_SLUG.get(slug) : undefined;
}

export function metricBySlug(slug: string): MetricInfo | undefined {
  return BY_SLUG.get(slug);
}
