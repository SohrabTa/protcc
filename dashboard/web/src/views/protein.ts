/**
 * One protein: which latents fire along it, and what Swiss-Prot says about the same residues.
 *
 * This route works for any protein in the evaluation set, because stage 2 stores every latent
 * on every protein. Running the crosscoder on a sequence the evaluation never saw is DEP-02.
 */

import { Data } from '../data';
import { activationStrip, annotationStrip, el, link, panel, pct, row, table } from '../ui';

export async function renderProtein(d: Data, acc: string, host: HTMLElement): Promise<void> {
  host.textContent = '';
  if (!d.hasTrack(acc)) {
    host.append(
      el(
        'p',
        'warn',
        `${acc} has no track in this data tree. The smoke build covers one shard of 208.`,
      ),
    );
    return;
  }
  host.append(el('p', 'loading', 'Reading the activations…'));
  const [info, track] = await Promise.all([d.protein(acc), d.track(acc)]);
  host.textContent = '';
  if (!info) {
    host.append(el('p', 'warn', `No bundle for ${acc}.`));
    return;
  }

  const views = el('div', 'views');
  host.append(views);

  const p = panel('Protein', acc);
  const lede = el('p', 'lede');
  lede.append(`${info.n}. ${info.l} residues.`);
  const uni = el('a', undefined, 'UniProt');
  uni.href = `https://www.uniprot.org/uniprotkb/${acc}`;
  uni.target = '_blank';
  uni.rel = 'noopener';
  lede.append(' ', uni, info.af ? ', with an AlphaFold model.' : ', no AlphaFold model.');
  p.append(lede);

  // Which latents fire here, ranked by how much of the protein they cover.
  const counts = new Map<number, number>();
  const peaks = new Map<number, number>();
  for (let i = 0; i < track.latent.length; i++) {
    const f = track.latent[i];
    counts.set(f, (counts.get(f) ?? 0) + 1);
    const v = track.value[i];
    if (v > (peaks.get(f) ?? 0)) peaks.set(f, v);
  }
  const ranked = [...counts.entries()]
    .filter(([f]) => d.featureById.has(f))
    .sort((a, b) => b[1] - a[1]);

  p.append(
    el(
      'p',
      'small muted',
      `${ranked.length.toLocaleString('en-US')} latents fire somewhere on this protein. ` +
        'The ones that pair with a Swiss-Prot concept are listed first.',
    ),
  );

  const withConcept = ranked.filter(([f]) => d.featureById.get(f)!.c);
  const { root, body } = table(
    ['Latent', 'Concept', 'Covers', 'Peak here', 'Peak layer'],
    [0, 1],
  );
  for (const [fid, n] of withConcept.slice(0, 25)) {
    const f = d.featureById.get(fid)!;
    body.append(
      row(
        [
          link(`/feature/${fid}`, `f/${fid}`, 'mono'),
          link(`/concept/${encodeURIComponent(f.c!)}`, f.c!.replace('_', ' · ')),
          pct((n / info.l) * 100, 0),
          ((peaks.get(fid) ?? 0) / 255).toFixed(2),
          String(f.pk),
        ],
        [0, 1],
      ),
    );
  }
  const scroll = el('div', 'tbl-scroll');
  scroll.append(root);
  p.append(scroll);
  views.append(p);

  // ---- the residue view ------------------------------------------------
  const ev = panel(
    'Along the sequence',
    'What fires where',
    'The teal rows are Swiss-Prot annotations. The amber rows are the latents that pair with ' +
      'them, so a row pair that lines up is a latent doing its job.',
  );
  const rows = el('div', 'rows');
  const shown = new Set<number>();
  for (const [col, ranges] of Object.entries(info.c)) {
    const name = d.conceptColumns[Number(col)];
    if (!name || name.endsWith('_any')) continue;
    const concept = d.conceptByName.get(name);
    const lab = el('div', 'lab strong');
    lab.append(
      concept
        ? link(`/concept/${encodeURIComponent(name)}`, name.split('_').slice(1).join('_') || name)
        : (name as unknown as Node),
    );
    lab.title = name;
    rows.append(lab, annotationStrip(info.l, ranges));
    for (const [fid] of (concept?.feats ?? []).slice(0, 3)) {
      if (shown.has(fid)) continue;
      shown.add(fid);
      const l2 = el('div', 'lab');
      l2.append(link(`/feature/${fid}`, `f/${fid}`, 'mono'));
      rows.append(l2, activationStrip(Data.activationOf(track, fid)));
    }
  }
  if (rows.childElementCount === 0) {
    ev.append(el('p', 'small muted', 'Swiss-Prot annotates no region of this protein.'));
  } else {
    ev.append(rows);
  }
  views.append(ev);
}
