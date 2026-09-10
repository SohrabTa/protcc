/**
 * One protein: which latents fire along it, and what Swiss-Prot says about the same residues.
 *
 * This route works for any protein in the evaluation set, because stage 2 stores every latent
 * on every protein. Running the crosscoder on a sequence the evaluation never saw is DEP-02.
 */

import { Data } from '../data';
import { drawStructure } from '../structpanel';
import { activationStrip, annotationStrip, el, link, panel, pct, redrawStrips, row, table } from '../ui';

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
  // One block per annotation, each holding its own latents. A single flat grid left the reader
  // guessing which amber rows belonged to which teal one, because an annotation that no latent
  // pairs with is followed straight away by the next annotation's latents.
  views.append(ev); // in the document first, so the strips inside it can measure themselves
  const shown = new Set<number>();
  let nAnnotations = 0;
  let nUnread = 0;
  for (const [col, ranges] of Object.entries(info.c)) {
    const name = d.conceptColumns[Number(col)];
    // `<field>_any` is a roll-up over every concept of that Swiss-Prot field, so it repeats
    // ranges that the named columns already carry.
    if (!name || name.endsWith('_any')) continue;
    nAnnotations++;
    const concept = d.conceptByName.get(name);
    const group = el('div', 'anngroup');
    const head = el('span', 'annname');
    head.append(
      concept
        ? link(`/concept/${encodeURIComponent(name)}`, name.replace('_', ' · '))
        : (name.replace('_', ' · ') as unknown as Node),
    );
    group.append(head);

    const rows = el('div', 'rows');
    rows.append(el('div', 'lab strong', 'Swiss-Prot'), annotationStrip(info.l, ranges));
    let drawn = 0;
    for (const [fid] of concept?.feats ?? []) {
      if (shown.has(fid) || drawn >= 3) continue;
      shown.add(fid);
      drawn++;
      const l2 = el('div', 'lab');
      l2.append(link(`/feature/${fid}`, `f/${fid}`, 'mono'));
      rows.append(l2, activationStrip(Data.activationOf(track, fid)));
    }
    group.append(rows);
    if (drawn === 0) {
      nUnread++;
      group.append(el('p', 'small muted', 'No latent pairs with this annotation.'));
    }
    ev.append(group);
    redrawStrips(group);
  }
  if (nAnnotations === 0) {
    ev.append(el('p', 'small muted', 'Swiss-Prot annotates no region of this protein.'));
  } else {
    ev.append(
      el(
        'p',
        'small muted',
        `Swiss-Prot annotates ${nAnnotations} region type${nAnnotations === 1 ? '' : 's'} of ` +
          `${acc}` +
          (nUnread ? `, and ${nUnread} of them no latent reads.` : '.'),
      ),
    );
  }

  // The strongest latent on this protein is the one worth colouring the model by.
  const best = withConcept[0]?.[0] ?? ranked[0]?.[0];
  if (best !== undefined) {
    await drawStructure(d, acc, Data.activationOf(track, best), views, `f/${best}`);
  }
}
