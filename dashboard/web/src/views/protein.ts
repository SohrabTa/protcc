/**
 * One protein: which latents fire along it, and what Swiss-Prot says about the same residues.
 *
 * This route works for any protein in the evaluation set, because stage 2 stores every latent
 * on every protein. Running the crosscoder on a sequence the evaluation never saw is DEP-02.
 */

import { Data } from '../data';
import { metricForHeader } from '../metrics';
import { conceptName, pairCells } from '../pairs';
import { drawStructure } from '../structpanel';
import {
  activationStrip, annotationStrip, el, figures, howto, link, num, panel, pct, proteinName,
  redrawStrips, row, table, uniprotLink,
} from '../ui';

export async function renderProtein(d: Data, acc: string, host: HTMLElement): Promise<void> {
  host.textContent = '';
  if (!d.hasTrack(acc)) {
    host.append(
      el(
        'p',
        'warn',
        `${acc} has no per-residue track in this data tree, so there is nothing to draw for it.`,
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
  p.classList.add('pagehead');
  const lede = el('p', 'lede');
  lede.append(proteinName(info.n), '. ', uniprotLink(acc, 'Open the UniProt entry'), '.');
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

  const withConcept = ranked.filter(([f]) => d.featureById.get(f)!.c);
  p.append(
    figures([
      [num(ranked.length), 'latents fire here', metricForHeader('latent')],
      [num(withConcept.length), 'of them pair with a concept', metricForHeader('pairing')],
      [String(info.l), 'residues'],
    ]),
  );
  const shownRows = Math.min(25, withConcept.length);
  p.append(
    el(
      'p',
      'small muted',
      `The table holds the ${shownRows} paired latents that cover the most of this protein. ` +
        'It shows what else the crosscoder finds on this protein, beside the annotation you came for.',
    ),
    howto(
      'The rows start with the latent that covers the most of the protein. Covers counts every ' +
        'residue where the latent fires at all. Peak activation is the strongest the latent ' +
        'fires on this protein, as a share of its strongest anywhere.',
    ),
  );

  const { root, body } = table(
    [
      'Latent',
      ['Best concept', 'paired concept'],
      ['F1 per domain', 'best pair f1'],
      'Covers',
      'Peak activation',
      'Peak layer',
    ],
    [0, 1],
  );
  for (const [fid, n] of withConcept.slice(0, 25)) {
    const f = d.featureById.get(fid)!;
    const pc = pairCells(d, fid);
    body.append(
      row(
        [
          link(`/latent/${fid}`, `f/${fid}`, 'mono'),
          pc.concept,
          pc.f1,
          pct((n / info.l) * 100, 0),
          ((peaks.get(fid) ?? 0) / 255).toFixed(2),
          String(f.pk),
        ],
        [0, 1],
        [fid, pc.conceptKey, pc.f1Key, n / info.l, peaks.get(fid) ?? 0, f.pk],
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
    'Teal rows are the concepts of the evaluation set that this protein carries. Under each ' +
      'one, the amber rows are all the latents that pair with it. The stronger the amber, the harder the latent fires, from 0 to its ' +
      'strongest anywhere. Where amber lines up with teal, the latent fires on the annotated ' +
      'residues.',
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
    // Every latent that pairs with this annotation, not the first three. The cap was there to
    // keep the page short, and it hid most of the evidence: a concept can have 62 latents and
    // the reader was shown 3 with nothing to say so. The rest start folded instead.
    const mine = (concept?.feats ?? []).map(([fid]) => fid).filter((fid) => !shown.has(fid));
    for (const fid of mine) shown.add(fid);
    const FIRST = 4;
    const extra: HTMLElement[] = [];
    mine.forEach((fid, k) => {
      const l2 = el('div', 'lab');
      l2.append(link(`/latent/${fid}`, `f/${fid}`, 'mono'));
      const strip = activationStrip(Data.activationOf(track, fid));
      if (k >= FIRST) {
        l2.hidden = true;
        strip.hidden = true;
        extra.push(l2, strip);
      }
      rows.append(l2, strip);
    });
    const drawn = mine.length;
    group.append(rows);
    if (extra.length) {
      const more = el('button', 'linkish', `show the other ${extra.length / 2} latents`);
      more.addEventListener('click', () => {
        const nowHidden = extra[0].hidden;
        for (const e of extra) e.hidden = !nowHidden;
        more.textContent = nowHidden
          ? 'show fewer latents'
          : `show the other ${extra.length / 2} latents`;
        if (nowHidden) redrawStrips(rows);
      });
      group.append(more);
    }
    if (drawn === 0) {
      nUnread++;
      group.append(el('p', 'small muted', 'No latent pairs with this annotation.'));
    }
    ev.append(group);
    redrawStrips(group);
  }
  if (nAnnotations === 0) {
    ev.append(
      el('p', 'small muted', `${acc} carries none of the ${d.concepts.length} concepts of the evaluation set.`),
    );
  } else {
    ev.append(
      el(
        'p',
        'small muted',
        `${acc} carries ${nAnnotations} of the ${d.concepts.length} concepts of the evaluation ` +
          'set' +
          (nUnread ? `, and ${nUnread} of them ${nUnread === 1 ? 'has' : 'have'} no paired latent.` : '.') +
          ' A Swiss-Prot annotation that is not one of these concepts does not show here.',
      ),
    );
  }

  // The model is coloured by one latent. The page picks the first one and says which and why,
  // because a reader who does not know that reads the colour as a fact about the protein. The
  // list beside the model lets the reader pick another latent from the table above.
  const choices = (withConcept.length ? withConcept : ranked).slice(0, 10);
  if (choices.length === 0) return;
  const named = withConcept.length > 0;
  const sp = panel(
    'Structure',
    'In three dimensions',
    named
      ? `The model starts colored by f/${choices[0][0]}. Of the latents that fire on ${acc} and ` +
          'pair with a concept, it fires on the most residues.'
      : `No latent that fires on ${acc} pairs with a concept, so the model starts colored by ` +
          `f/${choices[0][0]}, the latent that fires on the most residues.`,
  );
  const pair = el('div', 'loc-pair');
  const slot = el('div', 'loc-struct');
  const side = el('div');
  side.append(el('h3', 'sub', 'Color the model by'));
  const list = el('div', 'colorby');
  side.append(list);
  pair.append(slot, side);
  sp.append(pair);
  views.append(sp);

  const buttons = choices.map(([fid, n]) => {
    const b = el('button');
    b.type = 'button';
    const best = d.featureById.get(fid)?.c;
    b.append(
      el('span', 'mono', `f/${fid}`),
      el('span', 'cb-concept', best ? conceptName(best) : 'no concept'),
      el('span', 'cb-cover', pct((n / info.l) * 100, 0)),
    );
    b.title = `Color the model by f/${fid}. It covers ${pct((n / info.l) * 100, 0)} of ${acc}.`;
    list.append(b);
    return { fid, b };
  });
  const press = (fid: number) => {
    for (const x of buttons) x.b.setAttribute('aria-pressed', String(x.fid === fid));
  };
  press(choices[0][0]);
  side.append(
    el('p', 'small muted', 'The share is how much of the protein the latent covers.'),
  );

  const structure = await drawStructure(d, acc, Data.activationOf(track, choices[0][0]), slot, {
    coloredBy: 'the latent picked on the right',
    heading: false,
  });
  for (const { fid, b } of buttons) {
    b.addEventListener('click', () => {
      press(fid);
      structure?.update(Data.activationOf(track, fid));
    });
  }
}
