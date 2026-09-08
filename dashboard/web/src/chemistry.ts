/**
 * The chemical class of each amino acid.
 *
 * Five groups, by polarity and by charge at pH 7. This is the standard classification from
 * introductory biochemistry, and the reason cysteine, glycine and proline sit in a group of
 * their own is that none of the other four describes them: cysteine forms disulfide bonds,
 * glycine has no side chain and takes backbone angles the others cannot, and proline locks the
 * backbone. Selenocysteine (U) and pyrrolysine (O) go with the special group, and the ambiguity
 * codes (B, Z, X) are left uncoloured rather than guessed.
 *
 * InterPLM colours its letters from matplotlib's tab20 in alphabetical order
 * (interplm/dashboard/feature_activation_vis.py:13), so its colours carry no chemistry. This
 * does, which is the point: it answers whether a latent reads a chemical class.
 */

export type AAClass = 'hydrophobic' | 'polar' | 'basic' | 'acidic' | 'special' | 'unknown';

export const AA_CLASSES: {
  key: AAClass;
  label: string; // for the legend, where space is tight
  prose: string; // for a sentence, where the legend's shorthand reads badly
  color: string;
  letters: string;
}[] = [
  { key: 'hydrophobic', label: 'hydrophobic', prose: 'hydrophobic', color: '#7d8794', letters: 'AVLIMFW' },
  { key: 'polar', label: 'polar', prose: 'polar', color: '#3f9e5a', letters: 'STNQY' },
  { key: 'basic', label: 'basic +', prose: 'positively charged', color: '#3b7dd8', letters: 'KRH' },
  { key: 'acidic', label: 'acidic −', prose: 'negatively charged', color: '#d1495b', letters: 'DE' },
  { key: 'special', label: 'C, G, P', prose: 'cysteine, glycine or proline', color: '#9b5de5', letters: 'CGPUO' },
];

const BY_LETTER = new Map<string, { key: AAClass; label: string; prose: string; color: string }>();
for (const c of AA_CLASSES) {
  for (const l of c.letters) BY_LETTER.set(l, c);
}

const UNKNOWN = {
  key: 'unknown' as AAClass,
  label: 'unassigned',
  prose: 'unassigned',
  color: '#b0b0b0',
};

export function classOf(
  letter: string,
): { key: AAClass; label: string; prose: string; color: string } {
  return BY_LETTER.get(letter.toUpperCase()) ?? UNKNOWN;
}

/**
 * Which class a latent prefers, against how common that class is in this protein.
 *
 * This is a count over one protein, not a test. It says what the letters under the firing site
 * are, which is the question the coloured stripe invites and the eye answers badly. Anything
 * that looks like a finding needs the same count over the whole evaluation set.
 */
export interface Enrichment {
  /** null when no class stands out, which is the common and equally reportable case. */
  top: { prose: string; inFiring: number; inProtein: number } | null;
  nFiring: number;
}

export function enrichment(
  seq: string,
  values: Uint8Array,
  threshold = 76, // 0.3 of the latent's own maximum, the same cut the coverage figure uses
): Enrichment | null {
  const n = Math.min(seq.length, values.length);
  const firing = new Map<string, number>();
  const all = new Map<string, number>();
  let nFiring = 0;
  for (let i = 0; i < n; i++) {
    const c = classOf(seq[i]);
    if (c.key === 'unknown') continue;
    all.set(c.prose, (all.get(c.prose) ?? 0) + 1);
    if (values[i] > threshold) {
      firing.set(c.prose, (firing.get(c.prose) ?? 0) + 1);
      nFiring++;
    }
  }
  // A share over fewer than 20 residues moves by 5 points for every residue, so it says
  // nothing either way. Below the floor the honest output is no sentence, not a quiet one.
  if (nFiring < 20) return null;

  let best = '';
  let bestShare = 0;
  let bestBase = 0;
  for (const [prose, count] of firing) {
    const inFiring = count / nFiring;
    const inProtein = (all.get(prose) ?? 0) / n;
    // Rank by ratio, not by difference. A class that is rare in the protein and common under
    // the firing site is the interesting case, and a difference in points hides it behind
    // whichever class is simply the most abundant.
    if (inProtein > 0 && inFiring / inProtein > (bestBase > 0 ? bestShare / bestBase : 0)) {
      best = prose;
      bestShare = inFiring;
      bestBase = inProtein;
    }
  }
  // Below this the composition is ordinary, and saying so is more honest than naming a winner.
  const standsOut = best !== '' && bestShare >= 0.3 && bestShare >= 1.6 * bestBase;
  return {
    nFiring,
    top: standsOut ? { prose: best, inFiring: bestShare, inProtein: bestBase } : null,
  };
}
