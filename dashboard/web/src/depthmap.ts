/**
 * Every live latent at once, placed by where it writes and how widely it fires.
 *
 * This answers "where in ProtT5 does the crosscoder find anything nameable", which no table on
 * the site gives. Across is the encoder layer the latent writes hardest into. Up is how many
 * proteins it fires on.
 *
 * The shape is the point. 4867 of the 8128 live latents, which is 59.9%, peak at layers 15 to
 * 19, against 20.8% for an even spread. The bars across the top are the share of each layer's
 * latents that a concept names.
 *
 * ## Why the grey is a field and the amber is dots
 *
 * 8128 dots in 24 columns cannot be clicked one at a time. They overlap, and a click that lands
 * between two of them opens the wrong latent. So the 7108 latents that no concept names are
 * drawn as a density field, which shows the mass without pretending each dot is a target, and
 * the 1020 that a concept names are drawn as dots, which are few enough to hit.
 *
 * A latent that nobody has a number for still has to be reachable, and that is what the brush is
 * for. Drag a rectangle and every latent inside it, named or not, is listed below the plot.
 */

import type { Data, Feature } from './data';
import { cssVar, el, link, num, row, table } from './ui';

const PL = 46;
const PR = 14;
const BAND = 40; // the top strip that carries the paired share
const PT = 26 + BAND;
const PB = 34;
const H = 340;
const DOT = 2.4;
const CELL = 4; // px per density cell
const MAX_LIST = 120;

export interface DepthMapHandle {
  root: HTMLElement;
  /** Draw. Call after the root is in the document, for the reason locality.ts gives. */
  mount(): void;
  /** Keep the latents of one biological family in colour and mute the rest. '' is all of them. */
  setFamily(fam: string): void;
}

export function depthMap(d: Data): DepthMapHandle {
  const live = d.features;
  const nLayers = d.nLayers;
  const maxProteins = Math.max(2, ...live.map((f) => f.np));

  const root = el('div', 'dmap');
  const head = el('div', 'loc-head');
  const caption = el('span', 'small muted');
  const readout = el('div', 'dmap-readout mono');
  // The way out of a detail view sits beside the plot, not under the table below it. The only
  // way back used to be a button under the layer list, which a reader has to scroll to find.
  const backTop = el('button', 'linkish dmap-back', 'back to all 24 layers');
  backTop.hidden = true;
  backTop.addEventListener('click', leaveDetail);
  head.append(caption, backTop);
  root.append(head);

  const box = el('div', 'dmap-box');
  const cv = el('canvas');
  const marquee = el('div', 'dmap-marquee');
  marquee.hidden = true;
  // The readout sits over the plot rather than beside the caption. In the flow it changed the
  // caption's line count on every hover, which moved the plot up and down under the pointer.
  box.append(cv, marquee, readout);
  root.append(box);

  const legend = el('div', 'loc-legend');
  function writeLegend(): void {
    legend.textContent = '';
    for (const [label, color] of [
      [family ? `pairs with a concept of ${family}` : 'pairs with a concept', cssVar('--signal')],
      [
        family ? 'every other latent, as a density' : 'nothing named it, as a density',
        cssVar('--line-strong'),
      ],
      ['share of that layer’s latents that pair', cssVar('--accent')],
    ] as [string, string][]) {
      const item = el('span', 'loc-key');
      const sw = el('i');
      sw.style.background = color;
      item.append(sw, label);
      legend.append(item);
    }
  }
  root.append(legend);

  const hint = el(
    'p',
    'small muted',
    'Click an amber dot to open that latent. Click anywhere else to open that layer on its own, ' +
      'where every dot can be pointed at. Drag a rectangle to list every latent inside it, ' +
      'named or not.',
  );
  root.append(hint);

  const picked = el('div', 'dmap-pick');
  root.append(picked);

  /** Leave the layer view and draw all 24 again. */
  function backToAll(): void {
    zoomLayer = null;
    selection = null;
    hover = -1;
    readout.textContent = '';
    picked.textContent = '';
    backTop.hidden = true;
    draw();
  }

  /** Drop the rectangle and keep the view it was drawn in. */
  function clearSelection(): void {
    selection = null;
    picked.textContent = '';
    if (zoomLayer === null) {
      backTop.hidden = true;
    } else {
      backTop.textContent = `back to all ${nLayers} layers`;
      listLayer();
    }
    draw();
  }

  /** What the one button at the top does depends on what it says. */
  function leaveDetail(): void {
    if (selection) clearSelection();
    else backToAll();
  }

  // Escape is the other way out, because a reader who zoomed in by clicking expects it.
  root.addEventListener('keydown', (e) => {
    if ((e as KeyboardEvent).key === 'Escape') backToAll();
  });
  addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && (zoomLayer !== null || selection)) leaveDetail();
  });

  /** The family the overview has selected. Latents outside it are drawn as ground. */
  let family = '';
  const inFamily = (f: Feature): boolean => {
    if (!f.c) return false;
    if (!family) return true;
    return (d.conceptByName.get(f.c)?.fam || 'unassigned') === family;
  };

  // A latent's peak layer is one of 24 values, so 1598 of them land on the same vertical line.
  // A fixed spread inside the layer band separates them, and it comes from the latent id rather
  // than from a random number, so a dot does not move between redraws.
  const jitter = (f: Feature): number => (((f.f * 2654435761) % 1000) / 1000 - 0.5) * 0.78;

  const shareByLayer: number[] = new Array(nLayers).fill(0);
  const liveByLayer: number[] = new Array(nLayers).fill(0);
  for (const f of live) {
    const l = f.pk - 1;
    if (l < 0 || l >= nLayers) continue;
    liveByLayer[l]++;
    if (f.c) shareByLayer[l]++;
  }

  let hover = -1;
  /** Screen position of every latent, rebuilt on each draw. Paired first, for hit testing. */
  let placedPaired: { x: number; y: number; f: Feature }[] = [];
  let placedAll: { x: number; y: number; f: Feature }[] = [];

  /** When set, the plot shows one layer spread across the full width. */
  let zoomLayer: number | null = null;

  // The brush.
  let dragFrom: { x: number; y: number } | null = null;
  let dragTo: { x: number; y: number } | null = null;
  let selection: { x: number; y: number; w: number; h: number } | null = null;

  function draw(): void {
    const w = Math.max(1, Math.round(box.clientWidth));
    const dpr = Math.min(2, devicePixelRatio || 1);
    cv.width = w * dpr;
    cv.height = H * dpr;
    cv.style.width = '100%';
    cv.style.height = `${H}px`;
    const c = cv.getContext('2d')!;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, w, H);

    const iw = w - PL - PR;
    const ih = H - PT - PB;
    const X = (layer: number) => PL + (iw * (layer - 0.5)) / nLayers;
    const Y = (np: number) => PT + ih - ih * (Math.log10(Math.max(1, np)) / Math.log10(maxProteins));

    c.strokeStyle = cssVar('--line');
    c.fillStyle = cssVar('--muted');
    c.font = "9px 'IBM Plex Mono', ui-monospace, monospace";
    c.textAlign = 'right';
    c.textBaseline = 'middle';
    for (const p of [1, 10, 100, 1000, 10000, 100000]) {
      if (p > maxProteins) break;
      const y = Y(p);
      c.beginPath();
      c.moveTo(PL, y);
      c.lineTo(w - PR, y);
      c.stroke();
      c.fillText(p >= 1000 ? `${p / 1000}k` : String(p), PL - 6, y);
    }

    placedPaired = [];
    placedAll = [];

    if (zoomLayer !== null) {
      drawZoom(c, w, iw, ih, Y);
      drawMarks(c);
      return;
    }

    // The unnamed latents as a density field. Overlapping translucent dots make a smudge whose
    // darkness depends on the draw order; counting into cells makes it depend on the count.
    const cols = Math.ceil(w / CELL);
    const rows = Math.ceil(H / CELL);
    const grid = new Uint16Array(cols * rows);
    let maxCell = 0;
    for (const f of live) {
      const x = X(f.pk + jitter(f));
      const y = Y(f.np);
      placedAll.push({ x, y, f });
      if (f.c) continue;
      const gx = Math.floor(x / CELL);
      const gy = Math.floor(y / CELL);
      if (gx < 0 || gy < 0 || gx >= cols || gy >= rows) continue;
      const k = gy * cols + gx;
      grid[k]++;
      if (grid[k] > maxCell) maxCell = grid[k];
    }
    const plain = cssVar('--line-strong');
    for (let gy = 0; gy < rows; gy++) {
      for (let gx = 0; gx < cols; gx++) {
        const n = grid[gy * cols + gx];
        if (!n) continue;
        // A square root rather than the raw count. The densest cell holds tens of latents and
        // the sparse ones hold one, and a linear scale makes everything but the core invisible.
        c.globalAlpha = 0.16 + 0.74 * Math.sqrt(n / maxCell);
        c.fillStyle = plain;
        c.fillRect(gx * CELL, gy * CELL, CELL, CELL);
      }
    }
    c.globalAlpha = 1;

    // Out of family first, so a dot in the family is never hidden under a muted one.
    for (const pass of [false, true]) {
      for (const p of placedAll) {
        if (!p.f.c) continue;
        if (inFamily(p.f) !== pass) continue;
        placedPaired.push(p);
        c.fillStyle = pass ? cssVar('--signal') : cssVar('--line-strong');
        c.globalAlpha = pass ? 0.9 : 0.5;
        c.beginPath();
        c.arc(p.x, p.y, pass ? DOT : DOT - 0.6, 0, Math.PI * 2);
        c.fill();
      }
    }
    c.globalAlpha = 1;

    // The share that pairs, layer by layer, as bars across the top band.
    //
    // This was a line inside 22 px, and at that height a range of 0% to 21.7% looked flat. Bars
    // on a taller band show the arch: the share climbs to 21.7% at layer 10, dips through the
    // crowded middle, rises again to 18.7% at layer 19, and collapses to 1.7% at layer 23.
    const top = PT - BAND - 4;
    const maxShare = Math.max(...liveByLayer.map((n, i) => (n ? shareByLayer[i] / n : 0)), 0.01);
    const bw = Math.max(2, (iw / nLayers) * 0.62);
    for (let l = 0; l < nLayers; l++) {
      const s = liveByLayer[l] ? shareByLayer[l] / liveByLayer[l] : 0;
      const h = BAND * (s / maxShare);
      c.fillStyle = cssVar('--accent');
      c.globalAlpha = s > 0 ? 0.85 : 0.2;
      c.fillRect(X(l + 1) - bw / 2, top + BAND - h, bw, Math.max(0.8, h));
    }
    c.globalAlpha = 1;
    c.fillStyle = cssVar('--muted');
    c.font = "9px 'IBM Plex Mono', ui-monospace, monospace";
    c.textAlign = 'right';
    c.textBaseline = 'middle';
    c.fillText(`${(maxShare * 100).toFixed(0)}%`, PL - 6, top + 4);
    c.fillText('0%', PL - 6, top + BAND);

    c.fillStyle = cssVar('--muted');
    c.textAlign = 'center';
    c.textBaseline = 'top';
    for (let l = 1; l <= nLayers; l++) {
      if (l !== 1 && l !== nLayers && l % 6 !== 0) continue;
      c.fillText(String(l), X(l), H - PB + 8);
    }
    c.fillText('encoder layer the latent writes hardest into', PL + iw / 2, H - PB + 21);
    c.save();
    c.translate(11, PT + ih / 2);
    c.rotate(-Math.PI / 2);
    c.textBaseline = 'middle';
    c.fillText('proteins it fires on', 0, 0);
    c.restore();

    drawMarks(c);
  }

  /** The rectangle and the ring under the pointer. Both views draw them the same way. */
  function drawMarks(c: CanvasRenderingContext2D): void {
    if (selection) {
      c.strokeStyle = cssVar('--ink');
      c.setLineDash([3, 3]);
      c.strokeRect(selection.x + 0.5, selection.y + 0.5, selection.w, selection.h);
      c.setLineDash([]);
    }
    if (hover >= 0 && hover < placedPaired.length) {
      const p = placedPaired[hover];
      c.strokeStyle = cssVar('--ink');
      c.beginPath();
      c.arc(p.x, p.y, DOT + 3.5, 0, Math.PI * 2);
      c.stroke();
    }
  }

  /**
   * One layer, spread across the whole width.
   *
   * 1598 latents peak at layer 16, and in the full view they share one column 40 px wide. Here
   * the same latents get the whole plot, so each one can be pointed at. The spread comes from
   * the latent id, so a dot keeps its place between redraws.
   */
  function drawZoom(
    c: CanvasRenderingContext2D,
    w: number,
    iw: number,
    ih: number,
    Y: (np: number) => number,
  ): void {
    const layer = zoomLayer!;
    const mine = live.filter((f) => f.pk === layer);
    const spread = (f: Feature): number => ((f.f * 2654435761) % 100000) / 100000;
    for (const f of mine) {
      const x = PL + 6 + (iw - 12) * spread(f);
      const y = Y(f.np);
      placedAll.push({ x, y, f });
      if (f.c) placedPaired.push({ x, y, f });
    }
    // Unnamed first, then out of family, then the family. Each pass draws over the one before.
    for (const pass of [0, 1, 2]) {
      for (const p of placedAll) {
        const mine = p.f.c ? (inFamily(p.f) ? 2 : 1) : 0;
        if (mine !== pass) continue;
        c.fillStyle = pass === 2 ? cssVar('--signal') : cssVar('--line-strong');
        c.globalAlpha = pass === 2 ? 0.9 : pass === 1 ? 0.55 : 0.42;
        c.beginPath();
        c.arc(p.x, p.y, pass ? DOT + 0.6 : DOT - 0.4, 0, Math.PI * 2);
        c.fill();
      }
    }
    c.globalAlpha = 1;
    c.fillStyle = cssVar('--muted');
    c.font = "10px 'IBM Plex Mono', ui-monospace, monospace";
    c.textAlign = 'center';
    c.textBaseline = 'top';
    c.fillText(
      `layer ${layer}: ${num(mine.length)} latents, ${num(mine.filter((f) => f.c).length)} named`,
      PL + iw / 2,
      H - PB + 12,
    );
    c.save();
    c.translate(11, PT + ih / 2);
    c.rotate(-Math.PI / 2);
    c.textBaseline = 'middle';
    c.fillText('proteins it fires on', 0, 0);
    c.restore();
  }

  /** Which layer a click at this x lands in, or null outside the plot. */
  function layerAt(x: number): number | null {
    const w = Math.max(1, Math.round(box.clientWidth));
    const iw = w - PL - PR;
    if (x < PL || x > PL + iw) return null;
    const l = Math.floor(((x - PL) / iw) * nLayers) + 1;
    return l >= 1 && l <= nLayers ? l : null;
  }

  /** The nearest paired dot, or -1. Only paired dots are targets, because only they are drawn. */
  function nearest(mx: number, my: number): number {
    let best = -1;
    let bestD = 144; // squared pixels, so a click has to land near a dot to count
    for (let i = 0; i < placedPaired.length; i++) {
      const dx = placedPaired[i].x - mx;
      const dy = placedPaired[i].y - my;
      const dd = dx * dx + dy * dy;
      if (dd < bestD) {
        bestD = dd;
        best = i;
      }
    }
    return best;
  }

  function at(e: MouseEvent): { x: number; y: number } {
    const r = cv.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  /** List one layer's latents, after a click on that layer. */
  function listLayer(): void {
    picked.textContent = '';
    if (zoomLayer === null) return;
    const mine = live
      .filter((f) => f.pk === zoomLayer)
      .sort((a, b) => Number(inFamily(b)) - Number(inFamily(a)) || b.np - a.np);
    const named = mine.filter((f) => inFamily(f)).length;
    const back = el('button', 'linkish', 'back to all 24 layers');
    back.addEventListener('click', backToAll);
    picked.append(
      el('h3', 'sub', `Layer ${zoomLayer}`),
      el(
        'p',
        'small muted',
        `${num(mine.length)} latents peak here, and ${num(mine.filter((f) => f.c).length)} of ` +
          'them pair with a concept. The plot above now spreads this one layer across its whole ' +
          'width, so every dot can be pointed at. ' +
          (family
            ? `${num(named)} of them pair with a concept of ${family}, and the table starts ` +
              'with those. '
            : '') +
          (mine.length > MAX_LIST ? `The first ${MAX_LIST} by proteins they fire on:` : ''),
      ),
      back,
    );
    picked.append(latentTable(mine.slice(0, MAX_LIST)));
  }

  /** One table of latents, used by the layer view and by the brush. */
  function latentTable(list: Feature[]): HTMLElement {
    const { root: t, body } = table(['Latent', 'Concept', 'Peak layer', 'Proteins'], [0, 1]);
    for (const f of list) {
      body.append(
        row(
          [
            link(`/latent/${f.f}`, `f/${f.f}`, 'mono'),
            f.c
              ? link(`/concept/${encodeURIComponent(f.c)}`, f.c.replace('_', ' · '))
              : (el('span', 'muted', 'nothing named it') as Node),
            String(f.pk),
            num(f.np),
          ],
          [0, 1],
          [f.f, f.c ? f.c.toLowerCase() : 'zzz', f.pk, f.np],
        ),
      );
    }
    const sc = el('div', 'tbl-scroll tbl-capped');
    sc.append(t);
    return sc;
  }

  /** List every latent inside the rectangle, named or not. */
  function listSelection(): void {
    picked.textContent = '';
    if (!selection) return;
    const { x, y, w, h } = selection;
    const inside = placedAll.filter(
      (p) => p.x >= x && p.x <= x + w && p.y >= y && p.y <= y + h,
    );
    if (inside.length === 0) {
      picked.append(el('p', 'small muted', 'No latent is inside that rectangle.'));
      return;
    }
    // Widest first, because a latent that fires on more proteins is the one a reader opening a
    // region is most likely to want, and because it puts the outliers at the top.
    inside.sort((a, b) => b.f.np - a.f.np);
    const layers = [...new Set(inside.map((p) => p.f.pk))].sort((a, b) => a - b);
    const namedCount = inside.filter((p) => p.f.c).length;
    picked.append(
      el('h3', 'sub', `${num(inside.length)} latents in the rectangle`),
      el(
        'p',
        'small muted',
        `Peak layer ${layers[0]} to ${layers[layers.length - 1]}. ` +
          `${num(namedCount)} of them pair with a concept. ` +
          (inside.length > MAX_LIST ? `The ${MAX_LIST} that fire on the most proteins:` : ''),
      ),
    );
    picked.append(latentTable(inside.map((x) => x.f).slice(0, MAX_LIST)));
    const clear = el('button', 'linkish', 'clear the rectangle');
    clear.addEventListener('click', clearSelection);
    picked.append(clear);
  }

  cv.addEventListener('mousedown', (e) => {
    dragFrom = at(e);
    dragTo = dragFrom;
    marquee.hidden = true;
  });

  addEventListener('mousemove', (e) => {
    if (!dragFrom) return;
    dragTo = at(e);
    const x = Math.min(dragFrom.x, dragTo.x);
    const y = Math.min(dragFrom.y, dragTo.y);
    const w = Math.abs(dragTo.x - dragFrom.x);
    const h = Math.abs(dragTo.y - dragFrom.y);
    if (w > 3 || h > 3) {
      marquee.hidden = false;
      marquee.style.left = `${x}px`;
      marquee.style.top = `${y}px`;
      marquee.style.width = `${w}px`;
      marquee.style.height = `${h}px`;
    }
  });

  addEventListener('mouseup', (e) => {
    if (!dragFrom) return;
    const from = dragFrom;
    const to = dragTo ?? at(e);
    dragFrom = null;
    dragTo = null;
    marquee.hidden = true;
    const w = Math.abs(to.x - from.x);
    const h = Math.abs(to.y - from.y);
    // A drag shorter than 4 px in both directions is a click, not a brush. Without this test
    // every click would clear the list it just opened.
    if (w < 4 && h < 4) {
      const i = nearest(from.x, from.y);
      if (i >= 0) {
        location.hash = `/latent/${placedPaired[i].f.f}`;
        return;
      }
      // No dot under the pointer, so the click means the layer it landed in. In the full view
      // that opens the layer; in a layer view it does nothing, because there is nothing to
      // open into.
      if (zoomLayer === null) {
        const l = layerAt(from.x);
        if (l !== null && liveByLayer[l - 1] > 0) {
          zoomLayer = l;
          selection = null;
          backTop.textContent = `back to all ${nLayers} layers`;
          backTop.hidden = false;
          hover = -1;
          draw();
          listLayer();
        }
      }
      return;
    }
    selection = { x: Math.min(from.x, to.x), y: Math.min(from.y, to.y), w, h };
    backTop.textContent = 'clear the rectangle';
    backTop.hidden = false;
    draw();
    listSelection();
    picked.scrollIntoView({ block: 'nearest' });
  });

  cv.addEventListener('mousemove', (e) => {
    if (dragFrom) return;
    const { x, y } = at(e);
    const i = nearest(x, y);
    if (i === hover) return;
    hover = i;
    const f = i >= 0 ? placedPaired[i].f : null;
    // The family is in the readout because a grey dot is grey for one reason only, and a reader
    // pointing at one wants to know which family it belongs to.
    const fam = f?.c ? d.conceptByName.get(f.c)?.fam || 'unassigned' : '';
    readout.textContent = f
      ? `f/${f.f}  peak layer ${f.pk}  ${num(f.np)} proteins  ` +
        `${f.c!.replace('_', ' · ')}  ${fam}`
      : '';
    cv.style.cursor = f ? 'pointer' : 'crosshair';
    draw();
  });
  cv.addEventListener('mouseleave', () => {
    if (dragFrom) return;
    hover = -1;
    readout.textContent = '';
    draw();
  });

  const ro = new ResizeObserver(() => {
    if (box.clientWidth > 0) {
      // A resize moves every dot, so a rectangle drawn at the old width no longer means
      // anything. Dropping it is more honest than keeping a list that no longer matches.
      if (selection) {
        selection = null;
        picked.textContent = '';
      }
      draw();
      if (zoomLayer !== null) listLayer();
    }
  });

  function writeCaption(): void {
    const mid = [14, 15, 16, 17, 18].reduce((a, l) => a + liveByLayer[l], 0);
    const base =
      `${num(live.length)} live latents. ` +
      `${num(mid)} of them, which is ${((mid / live.length) * 100).toFixed(0)}%, peak at ` +
      'layers 15 to 19. An even spread over 24 layers would put 21% there.';
    caption.textContent = family
      ? `${base} The amber dots pair with a concept of ${family}. Every other latent is grey.`
      : base;
  }

  return {
    root,
    mount() {
      writeCaption();
      writeLegend();
      draw();
      ro.observe(box);
    },
    setFamily(fam: string) {
      if (fam === family) return;
      family = fam;
      hover = -1;
      readout.textContent = '';
      writeCaption();
      writeLegend();
      draw();
      if (zoomLayer !== null) listLayer();
    },
  };
}
