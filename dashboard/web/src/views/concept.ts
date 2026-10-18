/**
 * One concept: which latents detect it, and the evidence on a protein that carries it.
 *
 * The protein chooser covers every protein in the evaluation set that carries the annotation. It
 * is not a sample. That is what stage 1 buys by keeping all 156 million latent-protein pairs, and
 * stage 7 turns it into a choice by giving every carrier a number.
 */

import { Data, type Concept } from '../data';
import { localityHowto, localityView, type LocalityHandle } from '../locality';
import { proteinChooser, type ChooserSource } from '../chooser';
import { conceptName } from '../pairs';
import { metricForHeader } from '../metrics';
import { drawStructure } from '../structpanel';
import type { StructureHandle } from '../structure';
import {
  activationStrip, annotationStrip, depthRibbon, el, figures, holdHeight, howto, link, num, panel,
  infoButton, pct, proteinName, redrawStrips, row, table, uniprotLink,
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
  p.classList.add('pagehead');
  p.append(
    el(
      'p',
      'lede',
      `Family: ${c.fam}. Role: ${c.role}. Swiss-Prot records it as a ${c.fld.toLowerCase()}.`,
    ),
  );
  p.append(
    figures([
      [
        String(c.nf),
        c.nf === 1 ? 'latent pairs with it' : 'latents pair with it',
        metricForHeader('latents'),
      ],
      [c.f1.toFixed(3), 'best F1 per domain', metricForHeader('best f1')],
      [c.npr === undefined ? '—' : num(c.npr), 'proteins carry it', metricForHeader('proteins')],
    ]),
  );

  const feats = c.feats ?? [];
  p.append(
    howto(
      'Each row is one latent that pairs with this concept. The rows start with the highest F1 ' +
        'per domain. The depth column draws each latent’s depth profile, layer 1 on the left.',
    ),
  );
  // Recall per domain sits beside precision, because F1 per domain is made of those two. Recall
  // per residue comes after it, so the two recalls can be read against each other.
  const { root, body } = table(
    [
      'Latent',
      'F1 per domain',
      'Precision',
      'Recall per domain',
      'Recall per residue',
      'Peak layer',
      'Depth',
    ],
    [0, 6],
  );
  for (const [fid, f1, prec, rec, recd] of feats) {
    const f = d.featureById.get(fid);
    body.append(
      row(
        [
          link(`/latent/${fid}`, `f/${fid}`, 'mono'),
          f1.toFixed(3),
          prec.toFixed(3),
          recd === undefined ? '—' : recd.toFixed(3),
          rec.toFixed(3),
          f ? String(f.pk) : '—',
          f ? depthRibbon(d.depthOf(fid).norm) : '—',
        ],
        [0, 6],
        // The ribbon holds no text, so it sorts by the layer it peaks at.
        [fid, f1, prec, recd, rec, f?.pk, f?.pk],
      ),
    );
  }
  const scroll = el('div', 'tbl-scroll');
  scroll.append(root);
  p.append(scroll);
  views.append(p);

  // ---- evidence -------------------------------------------------------
  // Two panels. The first compares every latent on one protein, the second reads one of them
  // residue by residue. They were one panel of 1,515 px with 11 controls, and a reader could not
  // tell which control belonged to which picture.
  const ev = panel('Evidence', 'All latents on one protein');
  ev.classList.add('evpanel');
  ev.append(
    howto(
      'Step through the proteins that carry the concept with the arrows, or pick one at ' +
        'random. Order sorts them by how hard one latent fires on them, and Part keeps one ' +
        'slice of that order. Each row is one latent, in the order of the table above. With more ' +
        'than one latent, the last row is the strongest of them at each residue. Amber is how ' +
        'hard a latent fires, and teal is where Swiss-Prot annotates the concept. Reads is the ' +
        'share of the teal residues where the latent fires above 0.3 of its maximum. Click a ' +
        'row to read it residue by residue in the next panel.',
    ),
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
  const stripHost = el('div');
  ev.append(chooserHost, stripHost);

  const res = panel('Residues', 'One latent, residue by residue');
  res.classList.add('evpanel');
  res.append(
    howto(
      'This panel reads the latent row you clicked in the panel above, on the same protein. ' +
        localityHowto(true),
    ),
  );
  const resHost = el('div');
  res.append(resHost);
  // In the document before the chooser draws, so the strips can measure.
  views.append(ev, res);

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
      for (let i = 0; i < globalIndex.length; i++) {
        out[i] = (byIndex.get(globalIndex[i]) ?? 0) / 255;
      }
      return out;
    },
  }));

  const firing = firingAll ? Uint8Array.from(keep.map((i) => firingAll[i])) : null;

  // The latent the residue panel reads. It stays picked while the reader steps through proteins.
  const picked: { row: Pick } = { row: feats[0][0] };
  let pending = 0;
  const chooser = proteinChooser({
    items: carriers,
    label: 'protein',
    sources,
    firing,
    nLatents: feats.length,
    onPick: (acc) => {
      const mine = ++pending;
      const releaseStrips = holdHeight(stripHost);
      const releaseRes = holdHeight(resHost);
      void drawEvidence(d, c, acc, stripHost, resHost, picked, () => mine === pending).finally(
        () => {
          releaseStrips();
          releaseRes();
        },
      );
    },
  });
  chooserHost.append(chooser.root);
  chooser.mount();
}

/** A latent of the concept, or every latent together. */
type Pick = number | 'all';

/** The share of the annotated residues where an activation is above 0.3 of its maximum. */
function readShare(values: Uint8Array, ranges: [number, number][]): number | null {
  let covered = 0;
  let total = 0;
  for (const [a, b] of ranges) {
    for (let i = a; i <= b; i++) {
      total++;
      if (values[i] > 76) covered++; // 0.3 of the latent maximum
    }
  }
  return total ? (covered / total) * 100 : null;
}

async function drawEvidence(
  d: Data,
  c: Concept,
  acc: string,
  stripHost: HTMLElement,
  resHost: HTMLElement,
  picked: { row: Pick },
  stillWanted: () => boolean,
): Promise<void> {
  const [info, track] = await Promise.all([d.protein(acc), d.track(acc)]);
  if (!stillWanted()) return;
  stripHost.textContent = '';
  resHost.textContent = '';
  if (!info) {
    stripHost.append(el('p', 'warn', `This data tree holds no bundle for ${acc}.`));
    return;
  }

  const proteinLine = () => {
    const head = el('p', 'evhead');
    head.append(
      link(`/protein/${acc}`, acc, 'mono'),
      ' ',
      proteinName(info.n),
      el('span', 'muted', `  ${info.l} aa`),
      '  ',
      uniprotLink(acc),
    );
    return head;
  };
  stripHost.append(proteinLine());

  // Ground truth first, so the reader sees what the latents are measured against. Each row ends
  // with how much of the annotated residues it reads here, which replaced three figures under
  // the rows that said the same for all latents together.
  const rows = el('div', 'rows rows3');
  const ci = d.columnOf(c.c);
  const ranges = ci !== null ? info.c[String(ci)] ?? [] : [];
  const annotated = ranges.reduce((a, [x, y]) => a + y - x + 1, 0);
  const swissEnd = el(
    'div',
    'end',
    annotated
      ? `${annotated} residues in ${ranges.length} region${ranges.length === 1 ? '' : 's'}`
      : 'not annotated here',
  );
  if (annotated) {
    swissEnd.append(
      infoButton(
        'reads',
        'What "reads" means',
        'The share of the annotated residues on this protein where the latent fires at more ' +
          'than 0.3 of its own maximum. The last row counts a residue when any of the latents ' +
          'fires there.',
      ),
    );
  }
  rows.append(el('div', 'lab strong', 'Swiss-Prot'), annotationStrip(info.l, ranges), swissEnd);

  const union = new Uint8Array(info.l);
  const values = new Map<Pick, Uint8Array>();
  const feats = c.feats ?? [];
  for (const [fid] of feats) {
    const v = Data.activationOf(track, fid);
    values.set(fid, v);
    for (let i = 0; i < v.length; i++) if (v[i] > union[i]) union[i] = v[i];
  }
  if (feats.length > 1) values.set('all', union);

  const buttons = new Map<Pick, { button: HTMLButtonElement; strip: HTMLElement }>();
  const addRow = (key: Pick, label: string, v: Uint8Array) => {
    const button = el('button', 'rowpick', label);
    button.type = 'button';
    button.title = 'Read this row residue by residue in the next panel.';
    const strip = activationStrip(v);
    const share = readShare(v, ranges);
    rows.append(
      button,
      strip,
      el('div', 'end', share === null ? '' : `reads ${pct(share, 0)}`),
    );
    button.addEventListener('click', () => select(key));
    buttons.set(key, { button, strip });
  };
  for (const [fid] of feats) addRow(fid, `f/${fid}`, values.get(fid)!);
  if (feats.length > 1) addRow('all', `all ${feats.length}`, union);
  stripHost.append(rows);
  redrawStrips(rows);

  // ---- the residue panel ----------------------------------------------
  if (!values.has(picked.row)) picked.row = feats[0][0];
  const resLine = el('p', 'evhead');
  const writeResLine = () => {
    resLine.textContent = '';
    const k = picked.row;
    resLine.append(
      k === 'all'
        ? `All ${feats.length} latents together`
        : link(`/latent/${k}`, `f/${k}`, 'mono'),
      ' on ',
      link(`/protein/${acc}`, acc, 'mono'),
      ' ',
      proteinName(info.n),
    );
  };
  writeResLine();
  resHost.append(resLine);

  const loc: LocalityHandle = localityView(info.s, values.get(picked.row)!, ranges, {
    marks: { name: conceptName(c.c) },
  });
  resHost.append(loc.root);
  loc.mount();

  const mark = () => {
    for (const [k, x] of buttons) {
      x.button.setAttribute('aria-pressed', String(k === picked.row));
      x.strip.classList.toggle('sel', k === picked.row);
    }
  };
  mark();

  let structure: StructureHandle | null = null;
  function select(key: Pick): void {
    picked.row = key;
    mark();
    writeResLine();
    const v = values.get(key)!;
    loc.update(v, ranges);
    structure?.update(v);
  }

  // The model, colored by the same latent the letter row shows, marked where the pointer is.
  structure = await drawStructure(d, acc, values.get(picked.row)!, loc.structSlot, {
    coloredBy: 'the latent you clicked above',
    letters: true,
  });
  loc.onHover((i) => structure?.highlight(i === null ? null : i + 1));
}
