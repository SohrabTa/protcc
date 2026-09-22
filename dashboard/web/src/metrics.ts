/**
 * The name and the one-sentence definition of every number the dashboard prints.
 *
 * This module holds no DOM and imports nothing. The table helper reads it to put a tooltip on a
 * column header, and the glossary page reads it for the titles, so a metric is named once. The
 * drawn definitions live in `glossary.ts`, which needs the DOM helpers and would otherwise make
 * an import cycle with `ui.ts`.
 *
 * One word for one thing: a unit the crosscoder learned is a **latent**, never a feature. UniProt
 * calls its own sequence annotations the feature table, and this site puts those annotations next
 * to the crosscoder's units on the same screen. The two cannot share a word.
 */

export interface MetricInfo {
  /** The anchor on the glossary page, and the route `#/glossary/<slug>`. */
  slug: string;
  title: string;
  /** One or two sentences, for the tooltip on a column header. */
  short: string;
  /** The method section that argues for this number. See METHOD_SECTIONS. */
  section: SectionId;
}

export type SectionId = 'why' | 'sparse' | 'one-dictionary' | 'training' | 'naming' | 'limits';

/**
 * The method page, section by section.
 *
 * The glossary says what a word means. The method page says why the dashboard measures that way.
 * Neither repeats the other, and this list is what ties them: a glossary entry links to the
 * section that argues for it, and a section lists the entries that define its words. One list,
 * two pages, so the two cannot drift apart.
 */
export const METHOD_SECTIONS: { id: SectionId; title: string }[] = [
  { id: 'why', title: 'Why read the inside of ProtT5' },
  { id: 'sparse', title: 'Why sparse features' },
  { id: 'one-dictionary', title: 'Why one dictionary for 24 layers' },
  { id: 'training', title: 'How this crosscoder was trained' },
  { id: 'naming', title: 'How a latent gets a name' },
  { id: 'limits', title: 'What these numbers cannot say' },
];

export const METRIC_INFO: MetricInfo[] = [
  {
    slug: 'pairing',
    section: 'naming',
    title: 'What a pairing is',
    short:
      'A latent pairs with a concept when its F1 per domain is more than 0.5 on the held-out ' +
      'set. 1020 of the 8128 live latents pair with something.',
  },
  {
    slug: 'precision',
    section: 'naming',
    title: 'Precision',
    short:
      'Count the residues the latent fires on. Precision is the share of them that the ' +
      'annotation covers. It says how often the latent is right when it fires.',
  },
  {
    slug: 'recall-per-residue',
    section: 'naming',
    title: 'Recall per residue',
    short:
      'Count the residues the annotation covers. Recall per residue is the share of them that ' +
      'the latent fires on. It says how much of the region the latent reads.',
  },
  {
    slug: 'recall-per-domain',
    section: 'naming',
    title: 'Recall per domain',
    short:
      'Count the annotated regions. Recall per domain is the share of them the latent fires ' +
      'somewhere inside. One residue is enough to recall a whole region.',
  },
  {
    slug: 'f1-per-domain',
    section: 'naming',
    title: 'F1 per domain',
    short:
      'Precision and recall per domain, combined into one number. This is the score that ' +
      'decides which latent pairs with a concept. Read it beside recall per residue.',
  },
  {
    slug: 'f1-per-residue',
    section: 'naming',
    title: 'F1 per residue',
    short:
      'Precision and recall per residue, combined into one number. It is the harder score, and ' +
      'it disagrees with F1 per domain for 44% of the concepts.',
  },
  {
    slug: 'peak-layer',
    section: 'one-dictionary',
    title: 'Peak layer',
    short:
      'A latent adds a vector to all 24 encoder layers. The peak layer is the one where that ' +
      'vector is longest, after the correction for layer scale.',
  },
  {
    slug: 'depth',
    section: 'one-dictionary',
    title: 'Depth',
    short:
      'The length of that added vector at each of the 24 layers, drawn as a bar row. The peak ' +
      'layer is the tallest bar.',
  },
  {
    slug: 'cosine-similarity',
    section: 'one-dictionary',
    title: 'Cosine similarity across layers',
    short:
      'Each layer gets its own direction for the same latent. The cosine compares each one ' +
      'against the peak layer: 1 is the same direction, 0 is unrelated.',
  },
  {
    slug: 'covers',
    section: 'sparse',
    title: 'Covers',
    short:
      'Of this protein’s residues, the share where the latent is active at all. It is a ' +
      'property of one latent on one protein.',
  },
  {
    slug: 'peak-activation',
    section: 'sparse',
    title: 'Peak activation',
    short:
      'The strongest this latent fires on this protein, divided by the strongest it fires ' +
      'anywhere in the evaluation set. 1.00 marks its single hardest protein.',
  },
  {
    slug: 'latents',
    section: 'sparse',
    title: 'Latent',
    short:
      'One of the 8192 units the crosscoder learned. This column counts the latents that pair ' +
      'with the concept in this row.',
  },
  {
    slug: 'best-latent',
    section: 'naming',
    title: 'Best latent',
    short:
      'Of the latents that pair with this concept, the one with the highest F1 per domain. Best ' +
      'by that score only, which is not the same as the one that reads the most of the region.',
  },
  {
    slug: 'concept',
    section: 'naming',
    title: 'Concept',
    short:
      'One Swiss-Prot annotation type, for example a named domain or a binding site. There are ' +
      '408 of them in this evaluation set.',
  },
  {
    slug: 'proteins',
    section: 'naming',
    title: 'Proteins',
    short:
      'How many proteins of the 207,463 in the evaluation set Swiss-Prot annotates with this ' +
      'concept. These are the proteins the evidence panel steps through.',
  },
  {
    slug: 'null',
    section: 'limits',
    title: 'Why a high score is not always a finding',
    short:
      'A crosscoder trained on a random ProtT5 also scores above 0.5 per domain on 43 concepts. ' +
      'A per-concept claim needs that concept’s own null.',
  },
];

const BY_SLUG = new Map(METRIC_INFO.map((m) => [m.slug, m]));

/** Which column header resolves to which entry. One header, one definition. */
const BY_HEADER: Record<string, string> = {
  'f1 per domain': 'f1-per-domain',
  'best f1': 'f1-per-domain',
  'f1 per residue': 'f1-per-residue',
  precision: 'precision',
  'recall per residue': 'recall-per-residue',
  'recall per domain': 'recall-per-domain',
  reads: 'recall-per-residue',
  'peak layer': 'peak-layer',
  depth: 'depth',
  covers: 'covers',
  peak: 'peak-activation',
  'peak here': 'peak-activation',
  latent: 'latents',
  latents: 'latents',
  'best latent': 'best-latent',
  concept: 'concept',
  concepts: 'concept',
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
