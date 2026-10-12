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
 * between two of them opens the wrong latent. So in the view of all layers, the 7108 latents that
 * no concept names are a density field, and the 1020 that a concept names are dots.
 *
 * ## Views
 *
 * The plot shows one view at a time, and the views form a stack. The first view is all 24
 * layers. A click on a layer opens that layer alone, with the share of a protein each latent
 * covers across. A rectangle opens the part of the current view that it encloses, with every
 * latent as a dot, and lists those latents under the plot. The back link and the Escape key go
 * back one view.
 *
 * The brush and the layer click work only inside the plot, between its top and bottom lines.
 * The bars above it answer a hover instead: the bar under the pointer grows and says its share.
 */

import type { Data, Feature } from './data';
import { bestConceptLabel, pairCells } from './pairs';
import { cssVar, el, howto, link, num, pct, row, setHowto, table, type Header } from './ui';

const PL = 46;
const PR = 14;
const BAND = 40; // the top strip that carries the paired share
const BAND_GAP = 10; // between the bars and the top line of the plot
const PT = 22 + BAND + BAND_GAP;
// A zoomed view has no bars, so its plot starts near the top of the canvas. With the full-view
// top it had 66 px of empty canvas between the caption and the plot.
const PT_ZOOM = 14;
// The outermost dots sit this far inside the lines of the plot, so that a rectangle drawn inside
// the plot can enclose every latent. 141 latents fire on almost every protein, and without the
// inset they sat on the top line itself.
const INSET = 6;
const PB = 34;
const H = 340;
const DOT = 2.4;
const CELL = 4; // px per density cell

type Range = [number, number];

/**
 * One view of the plot. The ranges are in the units of the axes, not in pixels, so a resize
 * keeps the view.
 *
 * 'layer' puts a latent at its peak layer across. 'cover' shows one layer and puts a latent at
 * the share of a protein it covers when it fires, as log10 of the percent. Up is always log10 of
 * the proteins it fires on.
 */
type View =
  | { axis: 'layer'; x: Range; y: Range }
  | { axis: 'cover'; layer: number; x: Range; y: Range };

export interface DepthMapHandle {
  root: HTMLElement;
  /** How to use the plot. The panel puts it at the top, above the family chips. */
  howto: HTMLElement;
  /** Draw. Call after the root is in the document, for the reason locality.ts gives. */
  mount(): void;
  /** Keep the latents of one biological family in colour and mute the rest. '' is all of them. */
  setFamily(fam: string): void;
}

/** Tick values for a log axis over [lo, hi] in log10 units. More steps when the range is short. */
function logTicks(lo: number, hi: number): number[] {
  const span = hi - lo;
  const steps =
    span >= 3 ? [1] : span >= 1.2 ? [1, 3] : span >= 0.6 ? [1, 2, 5] : [1, 1.5, 2, 3, 5, 7];
  const out: number[] = [];
  for (let k = Math.floor(lo); k <= Math.ceil(hi); k++) {
    for (const m of steps) {
      const v = m * 10 ** k;
      const l = Math.log10(v);
      if (l >= lo - 1e-9 && l <= hi + 1e-9) out.push(v);
    }
  }
  return out;
}

const proteinsText = (v: number): string =>
  v >= 1000 ? `${parseFloat((v / 1000).toFixed(1))}k` : String(Math.round(v));
const coverText = (v: number): string => `${parseFloat(v.toPrecision(2))}%`;

export function depthMap(d: Data): DepthMapHandle {
  const live = d.features;
  const nLayers = d.nLayers;
  const maxProteins = Math.max(2, ...live.map((f) => f.np));
  const coverOf = (f: Feature): number => Math.log10(Math.max(0.01, f.pw));
  const coverRange: Range = [
    Math.min(...live.map(coverOf)),
    Math.max(2, ...live.map(coverOf)),
  ];

  const overview: View = {
    axis: 'layer',
    x: [0.5, nLayers + 0.5],
    y: [0, Math.log10(maxProteins)],
  };
  const layerView = (layer: number): View => ({
    axis: 'cover',
    layer,
    x: [...coverRange],
    y: [...overview.y],
  });
  /** The views on screen and under it. The first is always the overview. */
  const stack: View[] = [overview];
  const view = (): View => stack[stack.length - 1];
  const isOverview = (): boolean => stack.length === 1;

  const root = el('div', 'dmap');
  const help = howto('');
  const head = el('div', 'loc-head');
  const caption = el('span', 'small muted');
  const readout = el('div', 'dmap-readout mono');
  // The way out of a detail view sits beside the plot, not under the table below it.
  const backs = el('span', 'dmap-backs');
  const backOne = el('button', 'linkish dmap-back');
  // The back links hand the focus to the plot, so that Escape keeps working after a click on them.
  backOne.addEventListener('click', () => {
    goBack();
    box.focus({ preventScroll: true });
  });
  const backAll = el('button', 'linkish dmap-back', `back to all ${nLayers} layers`);
  backAll.addEventListener('click', () => {
    goBack(stack.length - 1);
    box.focus({ preventScroll: true });
  });
  backs.append(backOne, backAll);
  head.append(caption, backs);
  root.append(head);

  const box = el('div', 'dmap-box');
  const cv = el('canvas');
  const marquee = el('div', 'dmap-marquee');
  marquee.hidden = true;
  // The share of one layer, next to its bar. It is its own element and not the readout, because
  // the readout sits at the top right, which is on top of the bars of the last layers.
  const tip = el('div', 'dmap-tip');
  tip.hidden = true;
  // The readout sits over the plot rather than beside the caption. In the flow it changed the
  // caption's line count on every hover, which moved the plot up and down under the pointer.
  box.append(cv, marquee, readout, tip);
  root.append(box);

  const legend = el('div', 'loc-legend');
  root.append(legend);
  const picked = el('div', 'dmap-pick');
  root.append(picked);

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
  const xOf = (f: Feature, v: View): number =>
    v.axis === 'layer' ? f.pk + jitter(f) : coverOf(f);
  const yOf = (f: Feature): number => Math.log10(Math.max(1, f.np));
  const inView = (f: Feature, v: View): boolean => {
    if (v.axis === 'cover' && f.pk !== v.layer) return false;
    const x = xOf(f, v);
    const y = yOf(f);
    return x >= v.x[0] && x <= v.x[1] && y >= v.y[0] && y <= v.y[1];
  };
  const isWholeLayer = (v: View): boolean =>
    v.axis === 'cover' &&
    v.x[0] === coverRange[0] &&
    v.x[1] === coverRange[1] &&
    v.y[0] === overview.y[0] &&
    v.y[1] === overview.y[1];

  const shareByLayer: number[] = new Array(nLayers).fill(0);
  const liveByLayer: number[] = new Array(nLayers).fill(0);
  for (const f of live) {
    const l = f.pk - 1;
    if (l < 0 || l >= nLayers) continue;
    liveByLayer[l]++;
    if (f.c) shareByLayer[l]++;
  }

  let hover = -1;
  /** The layer whose bar is under the pointer, 1 to 24, or -1. */
  let hoverBar = -1;
  type Placed = { x: number; y: number; f: Feature };
  /** Screen position of every latent in the view, rebuilt on each draw. */
  let placedAll: Placed[] = [];
  /**
   * The dots a pointer can hit. In the overview only the paired latents are dots, so only they
   * are targets. In a zoomed view every latent is a dot and a target.
   */
  let targets: Placed[] = [];

  // The brush.
  let dragFrom: { x: number; y: number } | null = null;
  let dragTo: { x: number; y: number } | null = null;

  /** Pixels for the view on screen, and the way back from pixels to the units of the axes. */
  function geometry() {
    const v = view();
    const w = Math.max(1, Math.round(box.clientWidth));
    const top = isOverview() ? PT : PT_ZOOM;
    const iw = w - PL - PR;
    const ih = H - top - PB;
    // The overview keeps its layer columns flush with the plot edges, as it always had.
    const xin = isOverview() ? 0 : INSET;
    const xs = iw - 2 * xin;
    const ys = ih - 2 * INSET;
    const [x0, x1] = v.x;
    const [y0, y1] = v.y;
    return {
      w,
      top,
      iw,
      ih,
      X: (u: number) => PL + xin + (xs * (u - x0)) / (x1 - x0),
      Y: (u: number) => top + INSET + ys - (ys * (u - y0)) / (y1 - y0),
      invX: (px: number) => x0 + ((px - PL - xin) / xs) * (x1 - x0),
      invY: (py: number) => y0 + ((top + INSET + ys - py) / ys) * (y1 - y0),
    };
  }

  function draw(): void {
    const g = geometry();
    const v = view();
    const dpr = Math.min(2, devicePixelRatio || 1);
    cv.width = g.w * dpr;
    cv.height = H * dpr;
    cv.style.width = '100%';
    cv.style.height = `${H}px`;
    const c = cv.getContext('2d')!;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, g.w, H);

    c.strokeStyle = cssVar('--line');
    c.fillStyle = cssVar('--muted');
    c.font = "9px 'IBM Plex Mono', ui-monospace, monospace";
    c.textAlign = 'right';
    c.textBaseline = 'middle';
    for (const p of logTicks(v.y[0], v.y[1])) {
      const y = g.Y(Math.log10(p));
      c.beginPath();
      c.moveTo(PL, y);
      c.lineTo(g.w - PR, y);
      c.stroke();
      c.fillText(proteinsText(p), PL - 6, y);
    }

    placedAll = [];
    targets = [];
    if (isOverview()) drawOverview(c, g);
    else drawZoomed(c, g, v);
    drawXAxis(c, g, v);

    c.fillStyle = cssVar('--muted');
    c.font = "9px 'IBM Plex Mono', ui-monospace, monospace";
    c.save();
    c.translate(11, g.top + g.ih / 2);
    c.rotate(-Math.PI / 2);
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText('proteins it fires on', 0, 0);
    c.restore();

    if (hover >= 0 && hover < targets.length) {
      const p = targets[hover];
      c.strokeStyle = cssVar('--ink');
      c.beginPath();
      c.arc(p.x, p.y, DOT + 3.5, 0, Math.PI * 2);
      c.stroke();
    }
  }

  function drawOverview(c: CanvasRenderingContext2D, g: ReturnType<typeof geometry>): void {
    // The unnamed latents as a density field. Overlapping translucent dots make a smudge whose
    // darkness depends on the draw order; counting into cells makes it depend on the count.
    const cols = Math.ceil(g.w / CELL);
    const rows = Math.ceil(H / CELL);
    const grid = new Uint16Array(cols * rows);
    let maxCell = 0;
    for (const f of live) {
      const x = g.X(xOf(f, overview));
      const y = g.Y(yOf(f));
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
        targets.push(p);
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
    const barsTop = bandTop();
    const maxShare = Math.max(...liveByLayer.map((n, i) => (n ? shareByLayer[i] / n : 0)), 0.01);
    const bw = Math.max(2, (g.iw / nLayers) * 0.62);
    for (let l = 0; l < nLayers; l++) {
      const s = liveByLayer[l] ? shareByLayer[l] / liveByLayer[l] : 0;
      const h = BAND * (s / maxShare);
      const on = hoverBar === l + 1;
      // The bar under the pointer is wider and full strength, and the others step back, so the
      // one being read stands out without a second colour.
      const wide = on ? bw + 6 : bw;
      c.fillStyle = cssVar('--accent');
      c.globalAlpha = s === 0 ? 0.2 : on ? 1 : hoverBar > 0 ? 0.4 : 0.85;
      c.fillRect(g.X(l + 1) - wide / 2, barsTop + BAND - h, wide, Math.max(0.8, h));
      if (on) {
        c.globalAlpha = 1;
        c.fillStyle = cssVar('--ink');
        c.font = "600 10px 'IBM Plex Mono', ui-monospace, monospace";
        c.textAlign = 'center';
        c.textBaseline = 'bottom';
        c.fillText(`${(s * 100).toFixed(1)}%`, g.X(l + 1), barsTop + BAND - h - 2);
      }
    }
    c.globalAlpha = 1;
    c.fillStyle = cssVar('--muted');
    c.font = "9px 'IBM Plex Mono', ui-monospace, monospace";
    c.textAlign = 'right';
    c.textBaseline = 'middle';
    c.fillText(`${(maxShare * 100).toFixed(0)}%`, PL - 6, barsTop + 4);
    c.fillText('0%', PL - 6, barsTop + BAND);
  }

  /** A zoomed view: every latent in it as a dot, because there are few enough to point at. */
  function drawZoomed(
    c: CanvasRenderingContext2D,
    g: ReturnType<typeof geometry>,
    v: View,
  ): void {
    if (v.axis === 'layer') {
      // The edges between layer columns, so a reader can tell which column a dot is in.
      c.strokeStyle = cssVar('--line');
      c.setLineDash([2, 4]);
      for (let l = Math.ceil(v.x[0] - 0.5); l <= Math.floor(v.x[1] - 0.5); l++) {
        const x = g.X(l + 0.5);
        c.beginPath();
        c.moveTo(x, g.top);
        c.lineTo(x, g.top + g.ih);
        c.stroke();
      }
      c.setLineDash([]);
    }
    for (const f of live) {
      if (!inView(f, v)) continue;
      const p = { x: g.X(xOf(f, v)), y: g.Y(yOf(f)), f };
      placedAll.push(p);
      targets.push(p);
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
  }

  function drawXAxis(c: CanvasRenderingContext2D, g: ReturnType<typeof geometry>, v: View): void {
    c.fillStyle = cssVar('--muted');
    c.font = "9px 'IBM Plex Mono', ui-monospace, monospace";
    c.textAlign = 'center';
    c.textBaseline = 'top';
    if (v.axis === 'layer') {
      const first = Math.max(1, Math.ceil(v.x[0]));
      const last = Math.min(nLayers, Math.floor(v.x[1]));
      const step = last - first < 12 ? 1 : 3;
      for (let l = first; l <= last; l++) {
        const shown = isOverview()
          ? l === 1 || l === nLayers || l % 6 === 0
          : (l - first) % step === 0;
        if (shown) c.fillText(String(l), g.X(l), H - PB + 8);
      }
      c.fillText('encoder layer the latent writes hardest into', PL + g.iw / 2, H - PB + 21);
      return;
    }
    for (const p of logTicks(v.x[0], v.x[1])) {
      c.fillText(coverText(p), g.X(Math.log10(p)), H - PB + 8);
    }
    c.fillText(
      'share of a protein it covers when it fires, the mean over the proteins it fires on',
      PL + g.iw / 2,
      H - PB + 21,
    );
  }

  /** The top edge of the bars. */
  function bandTop(): number {
    return PT - BAND - BAND_GAP;
  }

  /** Inside the plot, between its top and bottom lines. The brush and the click live here. */
  function inPlot(x: number, y: number): boolean {
    const g = geometry();
    return x >= PL && x <= g.w - PR && y >= g.top && y <= H - PB;
  }

  /** The point moved to the nearest place inside the plot, so a rectangle never leaves it. */
  function clampToPlot(p: { x: number; y: number }): { x: number; y: number } {
    const g = geometry();
    return {
      x: Math.min(Math.max(p.x, PL), g.w - PR),
      y: Math.min(Math.max(p.y, g.top), H - PB),
    };
  }

  /** The layer whose bar is at this point, or -1. The bars exist only in the overview. */
  function barAt(x: number, y: number): number {
    if (!isOverview()) return -1;
    const top = bandTop();
    // Some room above the bars, where the share of the tallest one is written.
    if (y < top - 14 || y > top + BAND + 2) return -1;
    return layerAt(x) ?? -1;
  }

  /** Which layer a click at this x lands in, or null when the axis across is not layers. */
  function layerAt(x: number): number | null {
    const v = view();
    if (v.axis !== 'layer') return null;
    const g = geometry();
    if (x < PL || x > g.w - PR) return null;
    const l = Math.round(g.invX(x));
    return l >= 1 && l <= nLayers ? l : null;
  }

  /** The nearest target dot, or -1. */
  function nearest(mx: number, my: number): number {
    let best = -1;
    let bestD = isOverview() ? 144 : 49; // squared pixels; zoomed dots are denser
    for (let i = 0; i < targets.length; i++) {
      const dx = targets[i].x - mx;
      const dy = targets[i].y - my;
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

  /** Show a new view on top of the current one. */
  function open(v: View): void {
    stack.push(v);
    refresh();
  }

  /** Go back `steps` views. Never past the overview. */
  function goBack(steps = 1): void {
    if (stack.length === 1) return;
    stack.length = Math.max(1, stack.length - steps);
    refresh();
  }

  function refresh(): void {
    const before = cv.getBoundingClientRect().top;
    hover = -1;
    hoverBar = -1;
    readout.textContent = '';
    tip.hidden = true;
    writeCaption();
    writeHowto();
    writeLegend();
    writeBacks();
    draw();
    listView();
    // Keep the plot where it was on screen. The texts above it change length with the view, and
    // a plot that moves under the pointer right after a drag reads as a jump.
    const shift = cv.getBoundingClientRect().top - before;
    if (shift !== 0) scrollBy(0, shift);
  }

  // Escape goes back one view, because a reader who zoomed in by clicking expects it. It listens
  // on the plot, which takes the focus on a click, so that it does not also go back in the
  // Splitting plot.
  box.tabIndex = 0;
  box.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !isOverview()) goBack();
  });

  /** A short name for a view, for the back link. */
  function nameOf(v: View): string {
    if (v === overview) return `all ${nLayers} layers`;
    if (v.axis === 'cover' && isWholeLayer(v)) return `layer ${v.layer}`;
    return 'the last zoom';
  }

  function writeBacks(): void {
    backs.hidden = isOverview();
    backOne.textContent = stack.length > 1 ? `back to ${nameOf(stack[stack.length - 2])}` : '';
    backAll.hidden = stack.length <= 2;
  }

  /** What the view encloses, in words, from its ranges and from the latents in it. */
  function rangeText(v: View, shown: Feature[]): string {
    const proteins =
      `fire on ${num(Math.ceil(10 ** v.y[0]))} to ${num(Math.floor(10 ** v.y[1]))} proteins`;
    if (v.axis === 'cover') {
      return (
        `Layer ${v.layer}, latents that cover ${coverText(10 ** v.x[0])} to ` +
        `${coverText(10 ** v.x[1])} of a protein on average and ${proteins}`
      );
    }
    const layers = shown.map((f) => f.pk);
    const a = Math.min(...layers);
    const b = Math.max(...layers);
    return `${a === b ? `Layer ${a}` : `Layers ${a} to ${b}`}, latents that ${proteins}`;
  }

  function writeCaption(): void {
    const colour = family
      ? ` The amber dots pair with a concept of ${family}. Every other latent is grey.`
      : '';
    caption.textContent = '';
    const v = view();
    if (isOverview()) {
      // Layers 15 to 19 are 5 of the 24, so an even spread puts 5/24 of the latents there.
      const band = [15, 16, 17, 18, 19];
      const mid = band.reduce((a, l) => a + liveByLayer[l - 1], 0);
      const even = (band.length / nLayers) * 100;
      caption.textContent =
        `${num(live.length)} live latents. ` +
        `${num(mid)} of them, which is ${((mid / live.length) * 100).toFixed(0)}%, peak at ` +
        `layers 15 to 19. Those are ${band.length} of the ${nLayers} layers, so an even spread ` +
        `would put ${band.length}/${nLayers} of the latents there, which is ${even.toFixed(0)}%.` +
        colour;
      return;
    }
    const shown = live.filter((f) => inView(f, v));
    const paired = shown.filter((f) => f.c).length;
    // What is on screen comes first and in bold, because a zoomed plot looks the same for every
    // layer and range and says nothing about which one it is.
    if (v.axis === 'cover' && isWholeLayer(v)) {
      caption.append(
        el('strong', 'dmap-where', `Layer ${v.layer} alone.`),
        ` ${num(shown.length)} latents peak here, and ${num(paired)} of them pair with a ` +
          'concept. Across is now the share of a protein that each latent covers, as the mean ' +
          'over the proteins it fires on.' +
          colour,
      );
      return;
    }
    caption.append(
      el('strong', 'dmap-where', 'Zoomed in.'),
      ` ${rangeText(v, shown)}. ${num(shown.length)} latents, and ${num(paired)} of them pair ` +
        `with a concept.` +
        colour,
    );
  }

  /** The how-to text changes with the view, because a click means another thing in each. */
  function writeHowto(): void {
    const v = view();
    if (isOverview()) {
      setHowto(
        help,
        'Point at an amber dot to see its latent, and click the dot to open it. Click ' +
        'anywhere else inside the plot to open that layer alone. Drag a rectangle inside the ' +
        'plot to zoom into it and to list its latents. Point at a blue bar to see its share.',
      );
      return;
    }
    setHowto(
      help,
      'Point at a dot to see its latent, and click the dot to open it. ' +
        (v.axis === 'layer'
          ? 'Click anywhere else inside the plot to open that layer alone. '
          : '') +
        'Drag a rectangle inside the plot to zoom in more. Use the Escape key or the back link ' +
        'to go back one step.',
    );
  }

  function writeLegend(): void {
    legend.textContent = '';
    // A zoomed view draws every latent as a dot and has no bars, so its legend says so.
    const ground = isOverview() ? 'as a density' : 'as grey dots';
    const items: [string, string][] = [
      [family ? `pairs with a concept of ${family}` : 'pairs with a concept', cssVar('--signal')],
      [
        family ? `every other latent, ${ground}` : `nothing named it, ${ground}`,
        cssVar('--line-strong'),
      ],
    ];
    if (isOverview()) {
      items.push([
        'bars on top: the share of the latents that peak in that layer and pair',
        cssVar('--accent'),
      ]);
    }
    for (const [label, color] of items) {
      const item = el('span', 'loc-key');
      const sw = el('i');
      sw.style.background = color;
      item.append(sw, label);
      legend.append(item);
    }
  }

  /**
   * The default order of every latent list: paired in the family first, then the other paired
   * latents, then the rest. Inside each group, the one that fires on the most proteins first.
   *
   * The proteins alone put a paired latent under hundreds of unnamed ones, and the paired ones
   * are the rows a reader came for.
   */
  const group = (f: Feature): number => (f.c ? (inFamily(f) ? 0 : 1) : 2);
  const byDefault = (a: Feature, b: Feature): number => group(a) - group(b) || b.np - a.np;

  function orderNote(): HTMLElement {
    return howto(
      (family
        ? `The rows start with the latents that pair with a concept of ${family}, then the ` +
          'other paired latents, then the rest. '
        : 'The rows start with the latents that pair with a concept, then the rest. ') +
        'Inside each group, the latent that fires on the most proteins comes first. Click a ' +
        'column header to sort by it, a second time to reverse, and a third time for this order.',
    );
  }

  /** The latents of the view on screen, as a table under the plot. The overview lists none. */
  function listView(): void {
    picked.textContent = '';
    if (isOverview()) return;
    const v = view();
    const list = live.filter((f) => inView(f, v)).sort(byDefault);
    const paired = list.filter((f) => f.c).length;
    const named = list.filter((f) => inFamily(f)).length;
    const layers = new Set(list.map((f) => f.pk));
    picked.append(
      el(
        'h3',
        'sub',
        v.axis === 'cover' && isWholeLayer(v)
          ? `Every latent that peaks at layer ${v.layer}`
          : `${num(list.length)} latents in the zoomed view`,
      ),
      el(
        'p',
        'small muted',
        `${num(list.length)} latents, and ${num(paired)} of them pair with a concept.` +
          (family ? ` ${num(named)} pair with a concept of ${family}.` : ''),
      ),
      orderNote(),
    );
    // A peak-layer column only when the rows have more than one peak layer.
    picked.append(latentTable(list, layers.size > 1));
  }

  /** One table of latents, for every zoomed view. */
  function latentTable(list: Feature[], showLayer: boolean): HTMLElement {
    const headers: Header[] = [
      'Latent',
      ['Best concept', 'paired concept'],
      ['F1 per domain', 'best pair f1'],
      ...(showLayer ? ['Peak layer'] : []),
      ['Mean cover', 'mean cover'],
      ['Proteins', 'proteins it fires on'],
    ];
    const { root: t, body } = table(headers, [0, 1]);
    for (const f of list) {
      const pc = pairCells(d, f.f);
      body.append(
        row(
          [
            link(`/latent/${f.f}`, `f/${f.f}`, 'mono'),
            pc.concept,
            pc.f1,
            ...(showLayer ? [String(f.pk)] : []),
            pct(f.pw),
            num(f.np),
          ],
          [0, 1],
          [f.f, pc.conceptKey, pc.f1Key, ...(showLayer ? [f.pk] : []), f.pw, f.np],
        ),
      );
    }
    const sc = el('div', 'tbl-scroll tbl-capped');
    sc.append(t);
    return sc;
  }

  /** The part of the current view inside a rectangle, or null when no latent is in it. */
  function viewInside(a: { x: number; y: number }, b: { x: number; y: number }): View | null {
    const g = geometry();
    const v = view();
    const clamp = (u: number, r: Range) => Math.min(Math.max(u, r[0]), r[1]);
    const x: Range = [
      clamp(g.invX(Math.min(a.x, b.x)), v.x),
      clamp(g.invX(Math.max(a.x, b.x)), v.x),
    ];
    const y: Range = [
      clamp(g.invY(Math.max(a.y, b.y)), v.y),
      clamp(g.invY(Math.min(a.y, b.y)), v.y),
    ];
    const next: View = v.axis === 'layer' ? { axis: 'layer', x, y } : { ...v, x, y };
    return live.some((f) => inView(f, next)) ? next : null;
  }

  cv.addEventListener('mousedown', (e) => {
    const p = at(e);
    // Outside the plot there is nothing to select: the bars answer a hover, and the axis text
    // under the plot is text.
    if (!inPlot(p.x, p.y)) return;
    e.preventDefault();
    box.focus({ preventScroll: true });
    dragFrom = clampToPlot(p);
    dragTo = dragFrom;
    marquee.hidden = true;
  });

  addEventListener('mousemove', (e) => {
    if (!dragFrom) return;
    dragTo = clampToPlot(at(e));
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
    const to = dragTo ?? clampToPlot(at(e));
    dragFrom = null;
    dragTo = null;
    marquee.hidden = true;
    // A drag shorter than 4 px in both directions is a click, not a brush.
    if (Math.abs(to.x - from.x) < 4 && Math.abs(to.y - from.y) < 4) {
      const i = nearest(from.x, from.y);
      if (i >= 0) {
        location.hash = `/latent/${targets[i].f.f}`;
        return;
      }
      // No dot under the pointer, so the click means the layer it landed in. A view with the
      // coverage across has no layer to open into.
      const l = layerAt(from.x);
      if (l !== null && liveByLayer[l - 1] > 0) open(layerView(l));
      return;
    }
    const next = viewInside(from, to);
    if (!next) {
      readout.textContent = 'No latent is inside that rectangle.';
      return;
    }
    open(next);
  });

  cv.addEventListener('mousemove', (e) => {
    if (dragFrom) return;
    const { x, y } = at(e);

    const bar = barAt(x, y);
    if (bar !== hoverBar) {
      hoverBar = bar;
      showBar(bar);
      draw();
    }
    if (bar > 0) {
      cv.style.cursor = 'default';
      if (hover !== -1) {
        hover = -1;
        readout.textContent = '';
        draw();
      }
      return;
    }

    const i = inPlot(x, y) ? nearest(x, y) : -1;
    cv.style.cursor = i >= 0 ? 'pointer' : inPlot(x, y) ? 'crosshair' : 'default';
    if (i === hover) return;
    hover = i;
    const f = i >= 0 ? targets[i].f : null;
    // The family is in the readout because a grey dot is grey for one reason only, and a reader
    // pointing at one wants to know which family it belongs to.
    const fam = f?.c ? d.conceptByName.get(f.c)?.fam || 'unassigned' : '';
    readout.textContent = f
      ? `f/${f.f}  peak layer ${f.pk}  ${num(f.np)} proteins  mean cover ${pct(f.pw)}  ` +
        (f.c ? `best concept ${bestConceptLabel(d, f.f)}  ${fam}` : 'nothing named it')
      : '';
    draw();
  });
  cv.addEventListener('mouseleave', () => {
    if (dragFrom) return;
    hover = -1;
    hoverBar = -1;
    tip.hidden = true;
    readout.textContent = '';
    draw();
  });

  /** The sentence next to a bar: what share of that layer pairs, and out of how many. */
  function showBar(l: number): void {
    if (l < 1) {
      tip.hidden = true;
      return;
    }
    const n = liveByLayer[l - 1];
    const k = shareByLayer[l - 1];
    const share = n ? (k / n) * 100 : 0;
    let text =
      `Layer ${l}. ${share.toFixed(1)}% of the ${num(n)} latents that peak here pair with a ` +
      `concept, which is ${num(k)}.`;
    if (family) {
      const kf = live.filter((f) => f.pk === l && inFamily(f)).length;
      text += ` ${num(kf)} of them pair with a concept of ${family}.`;
    }
    tip.textContent = text;
    tip.hidden = false;
    const g = geometry();
    const x = g.X(l);
    // Under the bar, and kept inside the plot at the two ends.
    const tw = tip.offsetWidth;
    tip.style.left = `${Math.min(Math.max(4, x - tw / 2), g.w - tw - 4)}px`;
    tip.style.top = `${PT + 2}px`;
  }

  // The view is kept in the units of the axes, so a resize only redraws it.
  const ro = new ResizeObserver(() => {
    if (box.clientWidth > 0) draw();
  });

  return {
    root,
    howto: help,
    mount() {
      writeCaption();
      writeHowto();
      writeLegend();
      writeBacks();
      draw();
      ro.observe(box);
    },
    setFamily(fam: string) {
      if (fam === family) return;
      family = fam;
      refresh();
    },
  };
}
