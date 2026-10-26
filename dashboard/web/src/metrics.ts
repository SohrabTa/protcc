/**
 * The name and the one-sentence definition of every number the dashboard prints.
 *
 * This module holds no DOM and imports nothing. The table helper reads it to put a tooltip on a
 * column header, and the glossary page reads it for the titles, so a metric is named once. A
 * measured number is written as `{key}`, and `fill` in `facts.ts` puts in the value of the data
 * tree when the sentence is shown. The
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
  /** The method section that argues for this word or number. Absent when none does. */
  section?: SectionId;
}

export type SectionId =
  | 'why'
  | 'sparse'
  | 'one-dictionary'
  | 'architecture'
  | 'training'
  | 'naming'
  | 'limits';

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
  { id: 'sparse', title: 'Why sparse latents' },
  { id: 'one-dictionary', title: 'Why one dictionary for 24 layers' },
  { id: 'architecture', title: 'How the crosscoder is built, step by step' },
  { id: 'training', title: 'How this crosscoder was trained' },
  { id: 'naming', title: 'How a latent is paired with a concept' },
  { id: 'limits', title: 'What these numbers cannot say' },
];

/**
 * The glossary in reading order: the words of the model first, then the scores of a pairing, then
 * the numbers about depth and about one protein, then the data and its limits.
 */
export const METRIC_INFO: MetricInfo[] = [
  {
    slug: 'crosscoder',
    section: 'one-dictionary',
    title: 'Crosscoder',
    short:
      'A sparse dictionary that reads the residual stream of a residue at all 24 encoder layers ' +
      'at once. It rebuilds the residual stream of every layer from the same few latents.',
  },
  {
    slug: 'latents',
    section: 'sparse',
    title: 'Latent',
    short:
      'One of the {latents_total} entries of the crosscoder’s dictionary. At each residue a ' +
      'latent is off, or it fires with some strength: its activation. In a concept table, the ' +
      'Latents column counts the latents that pair with the concept in that row.',
  },
  {
    slug: 'activation',
    section: 'sparse',
    title: 'Activation',
    short:
      'How strongly a latent is used to rebuild one residue, divided by the largest activation ' +
      'of that latent on the evaluation set. 0 is off, and 1.00 is its strongest.',
  },
  {
    slug: 'residual-stream',
    section: 'one-dictionary',
    title: 'Residual stream',
    short:
      'The vector of 1,024 numbers that each layer of ProtT5 passes on for a residue. It is the ' +
      'running sum of what the model holds about that residue so far.',
  },
  {
    slug: 'decoder-vector',
    section: 'one-dictionary',
    title: 'Decoder vector',
    short:
      'What a latent adds to the crosscoder’s rebuilt copy of one layer’s residual stream. Each ' +
      'latent has 24 of them, one for each layer, and their lengths make its depth profile.',
  },
  {
    slug: 'pairing',
    section: 'naming',
    title: 'What a pairing is',
    short:
      'A latent pairs with a concept when its F1 per domain is more than 0.5 on the validation ' +
      'set and again on the test set, the two halves of the evaluation set. {latents_paired} of ' +
      'the {latents_alive} live latents pair with at least one concept.',
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
      'the latent fires on. It says how much of the region the latent fires on.',
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
      'Precision and recall per residue, combined into one number. It is the harder score: with ' +
      'the same pairing rule it pairs {concepts_found_per_residue} concepts, against ' +
      '{concepts_found} for F1 per domain.',
  },
  {
    slug: 'best-latent',
    section: 'naming',
    title: 'Best latent',
    short:
      'The latent with the highest F1 per domain for this concept on the validation set. Its F1 ' +
      'per domain on the test set is the Best F1.',
  },
  {
    slug: 'peak-layer',
    section: 'one-dictionary',
    title: 'Peak layer',
    short:
      'A latent adds its own vector to the crosscoder’s rebuilt copy of the residual stream of ' +
      'each of the 24 layers, and the vectors differ in length. The peak layer is the layer ' +
      'where the vector is longest, after the correction for layer scale.',
  },
  {
    slug: 'depth',
    section: 'one-dictionary',
    title: 'Depth profile',
    short:
      'The length of the vector that the latent adds to each of the 24 layers. Tables draw it as ' +
      'a row of bars, and the latent page draws it as a line. The peak layer is the highest point.',
  },
  {
    slug: 'cosine-similarity',
    section: 'one-dictionary',
    title: 'Cosine similarity across layers',
    short:
      'Each layer gets its own direction for the same latent. The cosine compares each one ' +
      'against the peak layer: 1 is the same direction, 0 is unrelated, and -1 is the opposite.',
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
      'anywhere in the evaluation set. 1.00 marks the protein it fires on most strongly.',
  },
  {
    slug: 'spread',
    title: 'Spread along the chain and in space',
    short:
      'The median distance between the residues a latent fires on, divided by the same median ' +
      'for random residues of the protein. 1 is like random residues.',
  },
  {
    slug: 'concept',
    section: 'naming',
    title: 'Concept',
    short:
      'One Swiss-Prot annotation type, for example a named domain or a binding site. There are ' +
      '{concepts_total} of them in this evaluation set.',
  },
  {
    slug: 'proteins',
    section: 'naming',
    title: 'Proteins with a concept',
    short:
      'How many of the {proteins} proteins in the evaluation set carry this concept in their ' +
      'Swiss-Prot annotation.',
  },
  {
    slug: 'proteins-fired',
    section: 'naming',
    title: 'Proteins a latent fires on',
    short:
      'How many of the {proteins} proteins in the evaluation set a latent fires on, whether or ' +
      'not Swiss-Prot annotates anything there.',
  },
];

const BY_SLUG = new Map(METRIC_INFO.map((m) => [m.slug, m]));

/** Which column header resolves to which entry. One header, one definition. */
const BY_HEADER: Record<string, string> = {
  'f1 per domain': 'f1-per-domain',
  'f1 per residue': 'f1-per-residue',
  precision: 'precision',
  'recall per residue': 'recall-per-residue',
  'recall per domain': 'recall-per-domain',
  reads: 'recall-per-residue',
  'peak layer': 'peak-layer',
  depth: 'depth',
  covers: 'covers',
  peak: 'peak-activation',
  'peak activation': 'peak-activation',
  latents: 'latents',
  'best latent': 'best-latent',
  concept: 'concept',
  concepts: 'concept',
  proteins: 'proteins',
  carriers: 'proteins',
};

/**
 * A header whose meaning depends on its table. The entry keeps the glossary slug of the word and
 * changes only the sentence in the popover. A table names the key beside the label it prints.
 */
const BY_KEY: Record<string, { slug: string; short: string }> = {
  // Every table with this header lists latents, one for each row. The plural header counts them.
  latent: {
    slug: 'latents',
    short:
      'One of the {latents_total} entries of the crosscoder’s dictionary. Each row is one ' +
      'latent, and the link opens its page.',
  },
  // The Best F1 of a concept follows the paper's rule, which is not the highest F1 of a table.
  'best f1': {
    slug: 'f1-per-domain',
    short:
      'The F1 per domain on the test set of the Best latent, the latent that the validation set ' +
      'picked for this concept. The average over all {concepts_total} concepts is {avg_best_f1}.',
  },
  'proteins it fires on': {
    slug: 'proteins-fired',
    short:
      'How many of the {proteins} proteins in the evaluation set this latent fires on, whether ' +
      'or not Swiss-Prot annotates anything there.',
  },
  'paired concept': {
    slug: 'concept',
    short:
      'The concept this latent pairs with best, by F1 per domain. When it pairs with more than ' +
      'one, the button after the name opens the others. "Not paired" means that no ' +
      'concept clears the pairing cut for this latent.',
  },
  'mean cover': {
    slug: 'covers',
    short:
      'The share of a protein’s residues where this latent is active, as the mean over ' +
      'the proteins it fires on. A latent that fires on a short motif covers a few percent. In the ' +
      'view of one layer, this value is the axis across.',
  },
  'best pair f1': {
    slug: 'f1-per-domain',
    short:
      'The F1 per domain of this latent with its best concept. A latent pairs with a concept ' +
      'when this score is more than 0.5 on the validation set and on the test set.',
  },
};

export function metricForHeader(header: string): MetricInfo | undefined {
  const key = header.trim().toLowerCase();
  const alt = BY_KEY[key];
  if (alt) {
    const base = BY_SLUG.get(alt.slug);
    return base ? { ...base, short: alt.short } : undefined;
  }
  const slug = BY_HEADER[key];
  return slug ? BY_SLUG.get(slug) : undefined;
}

export function metricBySlug(slug: string): MetricInfo | undefined {
  return BY_SLUG.get(slug);
}
