/**
 * One concept: which latents detect it, and the evidence on a protein that carries it.
 *
 * The protein chooser covers every protein in the evaluation set carrying the annotation, not a
 * sample. That is what stage 1 keeping all 156 million latent-protein pairs buys.
 */

import { Data, type Concept } from '../data';
import { activationStrip, annotationStrip, depthRibbon, el, link, panel, row, table } from '../ui';

export async function renderConcept(d: Data, name: string, host: HTMLElement): Promise<void> {
  host.textContent = '';
  const c = d.conceptByName.get(name);
  if (!c) {
    host.append(el('p', 'loading', `No concept named ${name}.`));
    return;
  }
  const views = el('div', 'views');
  host.append(views);

  const p = panel('Concept', c.c.replace('_', ' · '));
  const meta = el('p', 'lede');
  meta.append(
    `${c.fam} · ${c.role}. Swiss-Prot records it as a ${c.fld.toLowerCase()}. ` +
      `${c.nf} latent${c.nf === 1 ? '' : 's'} pair with it, the best reaching F1 ${c.f1.toFixed(3)} ` +
      `per domain` + (c.npr ? `, and ${c.npr} proteins in the evaluation set carry it.` : '.'),
  );
  p.append(meta);

  const { root, body } = table(
    ['Latent', 'F1 per domain', 'Precision', 'Recall per residue', 'Peak layer', 'Depth'],
    [0, 5],
  );
  for (const [fid, f1, prec, rec] of c.feats ?? []) {
    const f = d.featureById.get(fid);
    body.append(
      row(
        [
          link(`/feature/${fid}`, `f/${fid}`, 'mono'),
          f1.toFixed(3),
          prec.toFixed(3),
          rec.toFixed(3),
          f ? String(f.pk) : '—',
          f ? depthRibbon(d.depthOf(fid).norm) : '—',
        ],
        [0, 5],
      ),
    );
  }
  const scroll = el('div', 'tbl-scroll');
  scroll.append(root);
  p.append(scroll);
  if ((c.feats?.length ?? 0) > 1) {
    p.append(
      el(
        'p',
        'small muted',
        'Precision is high and per-residue recall is low for most of these. That is the ' +
          'signature of a concept split across latents: each one reads part of the region.',
      ),
    );
  }
  views.append(p);

  // ---- evidence -------------------------------------------------------
  const ev = panel(
    'Evidence',
    'Which part of the region each latent reads',
    'One row per latent, on a protein that carries the annotation. Amber is the latent’s ' +
      'activation at that residue. The teal row is where Swiss-Prot annotates the concept.',
  );
  const carriers = d.carriersOf(c).filter((a) => d.hasTrack(a));
  if (carriers.length === 0) {
    ev.append(
      el(
        'p',
        'warn',
        'No protein carrying this concept has a track in this data tree. The smoke build ' +
          'covers one shard of 208; the full build covers every protein.',
      ),
    );
    views.append(ev);
    return;
  }

  const chooser = el('div', 'chips');
  const sel = el('select');
  for (const acc of carriers) {
    const o = el('option', undefined, acc);
    o.value = acc;
    sel.append(o);
  }
  chooser.append(el('span', 'small muted', `protein (${carriers.length} carry this concept):`), sel);
  ev.append(chooser);
  const evBody = el('div');
  ev.append(evBody);
  views.append(ev);

  sel.addEventListener('change', () => void drawEvidence(d, c, sel.value, evBody));
  await drawEvidence(d, c, carriers[0], evBody);
}

async function drawEvidence(
  d: Data,
  c: Concept,
  acc: string,
  host: HTMLElement,
): Promise<void> {
  host.textContent = '';
  host.append(el('p', 'loading', 'Reading the activations…'));
  const [info, track] = await Promise.all([d.protein(acc), d.track(acc)]);
  host.textContent = '';
  if (!info) {
    host.append(el('p', 'warn', `No bundle for ${acc}.`));
    return;
  }

  const head = el('p', 'small');
  head.append(el('span', 'mono', acc), ` — ${info.n}`, el('span', 'muted', `  ${info.l} aa`));
  host.append(head);

  const rows = el('div', 'rows');
  // Ground truth first, so the reader sees what the latents are being judged against.
  const ci = d.columnOf(c.c);
  const ranges = ci !== null ? info.c[String(ci)] ?? [] : [];
  rows.append(el('div', 'lab strong', 'Swiss-Prot'), annotationStrip(info.l, ranges));

  const union = new Uint8Array(info.l);
  for (const [fid] of c.feats ?? []) {
    const v = Data.activationOf(track, fid);
    for (let i = 0; i < v.length; i++) if (v[i] > union[i]) union[i] = v[i];
    const lab = el('div', 'lab');
    lab.append(link(`/feature/${fid}`, `f/${fid}`, 'mono'));
    rows.append(lab, activationStrip(v));
  }
  if ((c.feats?.length ?? 0) > 1) {
    rows.append(el('div', 'lab strong', `all ${c.feats!.length}`), activationStrip(union));
  }
  host.append(rows);

  if (ranges.length) {
    let covered = 0;
    let total = 0;
    for (const [a, b] of ranges) {
      for (let i = a; i <= b; i++) {
        total++;
        if (union[i] > 76) covered++; // 0.3 of the latent maximum
      }
    }
    host.append(
      el(
        'p',
        'small muted',
        `Together these latents cover ${Math.round((covered / total) * 100)}% of the ` +
          `${total} annotated residues of ${acc}.`,
      ),
    );
  }
}

