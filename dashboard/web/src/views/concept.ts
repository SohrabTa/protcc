/**
 * One concept: which latents detect it, and the evidence on a protein that carries it.
 *
 * The protein chooser covers every protein in the evaluation set that carries the annotation. It
 * is not a sample. That is what stage 1 buys by keeping all 156 million latent-protein pairs, and
 * stage 7 turns it into a choice by giving every carrier a number.
 */

import { Data, type Concept } from '../data';
import { localityView } from '../locality';
import { proteinChooser, type ChooserSource } from '../chooser';
import { drawStructure } from '../structpanel';
import {
  activationStrip, annotationStrip, depthRibbon, el, figures, holdHeight, link, num, panel,
  redrawStrips, row, table, uniprotLink,
} from '../ui';

export async function renderConcept(d: Data, name: string, host: HTMLElement): Promise<void> {
  host.textContent = '';
  const c = d.conceptByName.get(name);
  if (!c) {
    host.append(el('p', 'loading', `No concept has the name ${name}.`));
    return;
  }
  const views = el('div', 'views');
  host.append(views);

  const p = panel('Concept', c.c.replace('_', ' · '));
  p.append(
    el('p', 'lede', `${c.fam} · ${c.role}. Swiss-Prot records it as a ${c.fld.toLowerCase()}.`),
  );
  p.append(
    figures([
      [String(c.nf), c.nf === 1 ? 'latent pairs with it' : 'latents pair with it'],
      [c.f1.toFixed(3), 'best F1 per domain'],
      [c.npr === undefined ? '—' : num(c.npr), 'proteins carry it'],
    ]),
  );

  const feats = c.feats ?? [];
  const { root, body } = table(
    ['Latent', 'F1 per domain', 'Precision', 'Recall per residue', 'Peak layer', 'Depth'],
    [0, 5],
  );
  for (const [fid, f1, prec, rec] of feats) {
    const f = d.featureById.get(fid);
    body.append(
      row(
        [
          link(`/latent/${fid}`, `f/${fid}`, 'mono'),
          f1.toFixed(3),
          prec.toFixed(3),
          rec.toFixed(3),
          f ? String(f.pk) : '—',
          f ? depthRibbon(d.depthOf(fid).norm) : '—',
        ],
        [0, 5],
        // The ribbon holds no text, so it sorts by the layer it peaks at.
        [fid, f1, prec, rec, f?.pk, f?.pk],
      ),
    );
  }
  const scroll = el('div', 'tbl-scroll');
  scroll.append(root);
  p.append(scroll);
  p.append(
    el(
      'p',
      'small muted',
      'The rows are in the default order, which is F1 per domain, highest first. Click a column ' +
        'header to sort by it.',
    ),
  );

  // The page used to state, for every concept with more than one latent, that precision is high
  // and recall per residue is low. That is true of this crosscoder in general, and false for 43
  // of the 149 multi-latent concepts, so it is counted here and not asserted.
  if (feats.length > 1) {
    const split = feats.filter(([, , prec, rec]) => prec >= 0.5 && rec < 0.5).length;
    const best = feats.reduce((a, b) => (b[3] > a[3] ? b : a));
    p.append(
      el(
        'p',
        'small muted',
        (split > feats.length / 2
          ? `${split} of these ${feats.length} latents are right more than half the time they ` +
            'fire, and each still reads less than half of the region. That is one concept split ' +
            'across latents.'
          : `${split} of these ${feats.length} latents have a high precision and a low recall ` +
            'per residue. The others do not, so read the two columns for each latent.') +
          ` The latent that reads the most of the region is f/${best[0]}, at ` +
          `${Math.round(best[3] * 100)}% of the annotated residues.`,
      ),
    );
  }
  views.append(p);

  // ---- evidence -------------------------------------------------------
  const ev = panel(
    'Evidence',
    'Which part of the region each latent reads',
    'One row for each latent, on a protein that carries the annotation. Amber is the latent’s ' +
      'activation at that residue. The teal row is where Swiss-Prot annotates the concept.',
  );
  const all = c.po ? d.carriersOf(c) : [];
  const firingAll = d.latentsFiringOn(c);
  // The filter has to carry its arrays with it, because they are in carrier order.
  const keep: number[] = [];
  for (let i = 0; i < all.length; i++) if (d.hasTrack(all[i])) keep.push(i);
  const carriers = keep.map((i) => all[i]);

  if (carriers.length === 0 || feats.length === 0) {
    ev.append(
      el(
        'p',
        'warn',
        feats.length === 0
          ? 'No latent pairs with this concept, so there is nothing to show here.'
          : 'No protein that carries this concept has a per-residue track in this data tree.',
      ),
    );
    views.append(ev);
    return;
  }

  const chooserHost = el('div');
  const evBody = el('div');
  ev.append(chooserHost, evBody);
  views.append(ev); // in the document before the chooser draws, so the strips can measure

  // The global protein index of each kept carrier, to read a latent's ranking file against.
  const lo = c.po![0];
  const globalIndex = keep.map((i) => d.conceptProtein[lo + i]);

  const sources: ChooserSource[] = feats.map(([fid, f1]) => ({
    label: `f/${fid} · F1 ${f1.toFixed(3)}`,
    format: (v) => v.toFixed(2),
    async load() {
      const rank = await d.ranking(fid);
      const byIndex = new Map<number, number>();
      for (let i = 0; i < rank.protein.length; i++) byIndex.set(rank.protein[i], rank.value[i]);
      const out = new Float32Array(globalIndex.length);
      for (let i = 0; i < globalIndex.length; i++) out[i] = (byIndex.get(globalIndex[i]) ?? 0) / 255;
      return out;
    },
  }));

  const firing = firingAll ? Uint8Array.from(keep.map((i) => firingAll[i])) : null;

  let pending = 0;
  const chooser = proteinChooser({
    items: carriers,
    label: 'carrier',
    sources,
    firing,
    nLatents: feats.length,
    onPick: (acc) => {
      const mine = ++pending;
      const release = holdHeight(evBody);
      void drawEvidence(d, c, acc, evBody, () => mine === pending).finally(release);
    },
  });
  chooserHost.append(chooser.root);
  chooser.mount();
}

async function drawEvidence(
  d: Data,
  c: Concept,
  acc: string,
  host: HTMLElement,
  stillWanted: () => boolean,
): Promise<void> {
  const [info, track] = await Promise.all([d.protein(acc), d.track(acc)]);
  if (!stillWanted()) return;
  host.textContent = '';
  if (!info) {
    host.append(el('p', 'warn', `This data tree holds no bundle for ${acc}.`));
    return;
  }

  const head = el('p', 'small');
  head.append(
    link(`/protein/${acc}`, acc, 'mono'),
    ` — ${info.n}`,
    el('span', 'muted', `  ${info.l} aa`),
    '  ',
    uniprotLink(acc),
  );
  host.append(head);

  const rows = el('div', 'rows');
  // Ground truth first, so the reader sees what the latents are measured against.
  const ci = d.columnOf(c.c);
  const ranges = ci !== null ? info.c[String(ci)] ?? [] : [];
  rows.append(el('div', 'lab strong', 'Swiss-Prot'), annotationStrip(info.l, ranges));

  const union = new Uint8Array(info.l);
  const perLatent = new Map<number, Uint8Array>();
  for (const [fid] of c.feats ?? []) {
    const v = Data.activationOf(track, fid);
    perLatent.set(fid, v);
    for (let i = 0; i < v.length; i++) if (v[i] > union[i]) union[i] = v[i];
    const lab = el('div', 'lab');
    lab.append(link(`/latent/${fid}`, `f/${fid}`, 'mono'));
    rows.append(lab, activationStrip(v));
  }
  if ((c.feats?.length ?? 0) > 1) {
    rows.append(el('div', 'lab strong', `all ${c.feats!.length}`), activationStrip(union));
  }
  host.append(rows);
  redrawStrips(rows);
  host.append(
    el(
      'p',
      'small muted',
      'The latent rows are in the same order as the table above, which is F1 per domain, ' +
        'highest first.',
    ),
  );

  if (ranges.length) {
    let covered = 0;
    let total = 0;
    for (const [a, b] of ranges) {
      for (let i = a; i <= b; i++) {
        total++;
        if (union[i] > 76) covered++; // 0.3 of the latent maximum
      }
    }
    host.append(el('h3', 'sub', 'How much of the annotation these latents read'));
    host.append(
      figures([
        [`${Math.round((covered / total) * 100)}%`, 'of the annotated residues'],
        [String(total), 'annotated residues'],
        [String(ranges.length), ranges.length === 1 ? 'annotated region' : 'annotated regions'],
      ]),
    );
  }

  // The strips above compare the latents against each other. This reads one of them down to the
  // residue, which is the question the strips cannot answer.
  const zoomHead = el('div', 'chips');
  const pick = el('select');
  for (const [fid, f1] of c.feats ?? []) {
    const o = el('option', undefined, `f/${fid}  ·  F1 ${f1.toFixed(3)}`);
    o.value = String(fid);
    pick.append(o);
  }
  const allOpt = el('option', undefined, `all ${c.feats?.length ?? 0} together`);
  allOpt.value = 'all';
  if ((c.feats?.length ?? 0) > 1) pick.append(allOpt);
  host.append(el('h3', 'sub', 'Down to the residue'));
  zoomHead.append(el('span', 'small muted', 'read this latent:'), pick);
  host.append(zoomHead);

  const first = c.feats?.[0]?.[0];
  const shown = first !== undefined ? perLatent.get(first)! : union;
  const loc = localityView(info.s, shown, ranges);
  host.append(loc.root);
  loc.mount();

  // The model, coloured by the same latent the letter row shows, marked where the pointer is.
  const structure = await drawStructure(
    d,
    acc,
    shown,
    host,
    first !== undefined ? `f/${first}` : 'all the latents together',
  );
  loc.onHover((i) => structure?.highlight(i === null ? null : i + 1));

  pick.addEventListener('change', () => {
    const v = pick.value === 'all' ? union : perLatent.get(Number(pick.value))!;
    loc.update(v, ranges);
    structure?.update(v);
  });
}
