/**
 * Where along one protein a latent fires, at two scales at once.
 *
 * The whole protein stays on screen at the top. A latent that fires on 3 residues of 500 only
 * looks specific when the other 497 are visible, so cropping to the firing site destroys the
 * very thing the panel exists to show. The letters below answer the second question, which
 * residues exactly, and they are reached by scrolling rather than by cropping. The window
 * marker on the overview says which part of the protein the letters are showing.
 *
 * The letter row draws only the residues on screen, into a canvas the width of the viewport.
 * A 5000-residue protein at 9 px per residue is 45,000 px wide, which is past the width limit
 * of a canvas in most browsers, so the full row cannot be one drawing.
 */

import { AA_CLASSES, classOf, enrichment } from './chemistry';
import { cssVar, el, inkOn, rampRGB } from './ui';

const CELL = 9; // px per residue in the letter row
const ANN_H = 6;
const LET_H = 18;
const CHEM_H = 7;
const BAR_H = 24;
const TICK_H = 13;
const ZOOM_H = ANN_H + LET_H + CHEM_H + BAR_H + TICK_H;
const OVER_H = 26;

/** The residues a Swiss-Prot range list covers, as a lookup. */
function annotationMask(length: number, ranges: [number, number][]): Uint8Array {
  const m = new Uint8Array(length);
  for (const [a, b] of ranges) {
    for (let i = Math.max(0, a); i <= Math.min(length - 1, b); i++) m[i] = 1;
  }
  return m;
}

export interface LocalityHandle {
  root: HTMLElement;
  /**
   * Draw. Call this once, after the root is in the document.
   *
   * The canvases have to be sized from the layout, and a detached element has no width, so the
   * first drawing cannot happen while this function builds the view. Deferring it to a frame
   * callback or to a resize observation would work in a foreground tab and fail in a background
   * one, because both of those are delivered by the rendering loop. The caller knows when the
   * root is in the document, so the caller says when to draw.
   */
  mount(): void;
  /** Point the view at a different latent on the same protein. */
  update(values: Uint8Array, ranges: [number, number][]): void;
}

export function localityView(seq: string, values: Uint8Array, ranges: [number, number][]): LocalityHandle {
  const n = Math.min(seq.length, values.length);
  let vals = values;
  let mask = annotationMask(n, ranges);

  const root = el('div', 'loc');

  // ---- the readout -----------------------------------------------------
  const head = el('div', 'loc-head');
  const scale = el('span', 'small muted');
  const readout = el('span', 'loc-readout mono');
  head.append(scale, readout);
  root.append(head);

  // ---- the whole protein ----------------------------------------------
  const over = el('div', 'loc-over');
  const overCv = el('canvas');
  const marker = el('div', 'loc-window');
  const overAnn = el('div', 'strip strip-thin loc-over-ann');
  over.append(overCv, marker);
  root.append(over, overAnn);

  // ---- the letters -----------------------------------------------------
  const scroller = el('div', 'loc-zoom');
  const spacer = el('div', 'loc-spacer');
  spacer.style.width = `${n * CELL}px`;
  spacer.style.height = `${ZOOM_H}px`;
  const zoomCv = el('canvas', 'loc-zoom-canvas');
  scroller.append(spacer, zoomCv);
  root.append(scroller);

  const legend = el('div', 'loc-legend');
  for (const c of AA_CLASSES) {
    const item = el('span', 'loc-key');
    const sw = el('i');
    sw.style.background = c.color;
    item.append(sw, c.label);
    item.title = c.letters.split('').join(' ');
    legend.append(item);
  }
  root.append(legend);

  const chem = el('p', 'small muted');
  root.append(chem);

  const hint = el(
    'p',
    'small muted',
    'The top bar is the whole protein. Click it to move the letters, or scroll them directly.',
  );
  root.append(hint);

  /** What the residues under the firing site are, since the stripe alone invites a guess. */
  function describeChemistry(): void {
    const e = enrichment(seq, vals);
    if (!e) {
      chem.textContent = '';
    } else if (e.top) {
      chem.textContent =
        `Of the ${e.nFiring} residues this fires on, ${Math.round(e.top.inFiring * 100)}% are ` +
        `${e.top.prose}, against ${Math.round(e.top.inProtein * 100)}% of the protein. ` +
        'One protein, so this describes it rather than shows a rule.';
    } else {
      chem.textContent =
        `The ${e.nFiring} residues this fires on are chemically ordinary for this protein.`;
    }
  }

  let hover = -1;

  function drawOverview(): void {
    const w = Math.max(1, Math.round(over.clientWidth));
    const dpr = Math.min(2, devicePixelRatio || 1);
    overCv.width = w * dpr;
    overCv.height = OVER_H * dpr;
    overCv.style.width = '100%';
    overCv.style.height = `${OVER_H}px`;
    const c = overCv.getContext('2d')!;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, w, OVER_H);
    // One column of pixels can cover many residues, so take the strongest of them. A mean
    // would hide a single-residue spike, which is exactly the case this view is built for.
    for (let px = 0; px < w; px++) {
      const a = Math.floor((px * n) / w);
      const b = Math.max(a + 1, Math.floor(((px + 1) * n) / w));
      let m = 0;
      for (let i = a; i < b; i++) if (vals[i] > m) m = vals[i];
      c.fillStyle = `rgb(${rampRGB(m / 255).join(',')})`;
      c.fillRect(px, 0, 1, OVER_H);
    }
    c.strokeStyle = cssVar('--line');
    c.strokeRect(0.5, 0.5, w - 1, OVER_H - 1);
  }

  function drawAnnotation(): void {
    overAnn.textContent = '';
    for (const [a, b] of ranges) {
      const i = el('i');
      i.style.left = `${(a / n) * 100}%`;
      i.style.width = `${Math.max(0.4, ((b - a + 1) / n) * 100)}%`;
      overAnn.append(i);
    }
  }

  function drawZoom(): void {
    const vw = Math.max(1, Math.round(scroller.clientWidth));
    const left = scroller.scrollLeft;
    const dpr = Math.min(2, devicePixelRatio || 1);
    zoomCv.width = vw * dpr;
    zoomCv.height = ZOOM_H * dpr;
    zoomCv.style.width = `${vw}px`;
    zoomCv.style.height = `${ZOOM_H}px`;
    zoomCv.style.left = `${left}px`;
    const c = zoomCv.getContext('2d')!;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, vw, ZOOM_H);

    const first = Math.floor(left / CELL);
    const last = Math.min(n - 1, Math.ceil((left + vw) / CELL));
    const mono = "11px 'IBM Plex Mono', ui-monospace, monospace";
    const line = cssVar('--line');
    const accent = cssVar('--accent');
    const muted = cssVar('--muted');
    const chemTop = ANN_H + LET_H;
    const barTop = chemTop + CHEM_H;

    c.fillStyle = cssVar('--surface-2');
    c.fillRect(0, barTop, vw, BAR_H);

    for (let i = first; i <= last; i++) {
      const x = i * CELL - left;
      const v = vals[i] / 255;
      const rgb = rampRGB(v);

      if (mask[i]) {
        c.fillStyle = accent;
        c.fillRect(x, 0, CELL, ANN_H);
      }

      c.fillStyle = `rgb(${rgb.join(',')})`;
      c.fillRect(x, ANN_H, CELL, LET_H);
      c.fillStyle = inkOn(rgb);
      c.font = mono;
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText(seq[i] ?? '?', x + CELL / 2, ANN_H + LET_H / 2 + 0.5);

      // The chemical class of the residue, as its own row. Tinting the letter instead would
      // fight the cell colour, which already carries the activation and is the primary signal.
      c.fillStyle = classOf(seq[i] ?? '').color;
      c.fillRect(x, chemTop, CELL, CHEM_H);

      if (v > 0) {
        const h = Math.max(1, Math.round(v * (BAR_H - 2)));
        c.fillStyle = cssVar('--signal');
        c.fillRect(x + 1, barTop + BAR_H - h, CELL - 2, h);
      }

      if (i === hover) {
        c.strokeStyle = cssVar('--ink');
        c.lineWidth = 1;
        c.strokeRect(x + 0.5, 0.5, CELL - 1, ANN_H + LET_H + CHEM_H + BAR_H - 1);
      }
    }

    // A tick every 10 residues, numbered every 50, both counted from 1 like Swiss-Prot.
    c.textBaseline = 'top';
    c.font = "10px 'IBM Plex Mono', ui-monospace, monospace";
    for (let i = first; i <= last; i++) {
      const num = i + 1;
      if (num % 10 !== 0) continue;
      const x = i * CELL - left + CELL / 2;
      c.strokeStyle = line;
      c.beginPath();
      c.moveTo(x + 0.5, barTop + BAR_H);
      c.lineTo(x + 0.5, barTop + BAR_H + 3);
      c.stroke();
      if (num % 50 === 0) {
        c.fillStyle = muted;
        c.textAlign = 'center';
        c.fillText(String(num), x, barTop + BAR_H + 3);
      }
    }
  }

  function drawMarker(): void {
    const vw = scroller.clientWidth;
    const total = n * CELL;
    const from = Math.min(1, scroller.scrollLeft / total);
    const width = Math.min(1, vw / total);
    marker.style.left = `${from * 100}%`;
    marker.style.width = `${Math.max(1, width * 100)}%`;
    marker.hidden = width >= 1;
    // Clamp the end to the start. A container only a pixel or two wide, which happens while the
    // panel is still being laid out, otherwise rounds the end below the start and reads
    // "showing 217 to 216".
    const a = Math.floor(from * n) + 1;
    const b = Math.max(a, Math.min(n, Math.ceil((from + width) * n)));
    scale.textContent =
      width >= 1
        ? `all ${n} residues`
        : `${n} residues, showing ${a} to ${b}`;
  }

  function redraw(): void {
    drawOverview();
    drawAnnotation();
    drawZoom();
    drawMarker();
    describeChemistry();
  }

  // ---- interaction -----------------------------------------------------
  scroller.addEventListener('scroll', () => {
    drawZoom();
    drawMarker();
  });

  over.addEventListener('click', (e) => {
    const r = over.getBoundingClientRect();
    const frac = (e.clientX - r.left) / r.width;
    scroller.scrollLeft = frac * n * CELL - scroller.clientWidth / 2;
  });

  zoomCv.addEventListener('mousemove', (e) => {
    const r = zoomCv.getBoundingClientRect();
    const i = Math.floor((e.clientX - r.left + scroller.scrollLeft) / CELL);
    if (i === hover || i < 0 || i >= n) return;
    hover = i;
    readout.textContent = `${seq[i] ?? '?'}${i + 1}  ${classOf(seq[i] ?? '').label}  ${(
      vals[i] / 255
    ).toFixed(2)}${mask[i] ? '  annotated' : ''}`;
    drawZoom();
  });
  zoomCv.addEventListener('mouseleave', () => {
    hover = -1;
    readout.textContent = '';
    drawZoom();
  });

  /** Put the strongest firing site on screen, since that is what the reader came for. */
  function centerOnPeak(): void {
    let peak = 0;
    for (let i = 1; i < n; i++) if (vals[i] > vals[peak]) peak = i;
    scroller.scrollLeft = peak * CELL - scroller.clientWidth / 2;
  }

  // Redraw when the window changes width, which is the one case the caller cannot announce.
  const ro = new ResizeObserver(() => {
    if (over.clientWidth > 0) redraw();
  });

  return {
    root,
    mount() {
      centerOnPeak();
      redraw();
      ro.observe(over);
    },
    update(nextValues, nextRanges) {
      vals = nextValues;
      mask = annotationMask(n, nextRanges);
      ranges = nextRanges;
      hover = -1;
      readout.textContent = '';
      centerOnPeak();
      redraw();
    },
  };
}
