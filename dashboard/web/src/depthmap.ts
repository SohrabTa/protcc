/**
 * Every live latent at once, placed by where it writes and how widely it fires.
 *
 * This is the answer to "where in ProtT5 does the crosscoder find anything nameable", which no
 * table on the site gives. One dot per live latent: across is the encoder layer it writes
 * hardest into, up is how many proteins it fires on. Amber means a Swiss-Prot concept pairs with
 * it, grey means nothing named it.
 *
 * The shape is the point. Nameable latents sit in the middle of the encoder. Layers 22 to 24
 * hold 937 live latents and 26 paired ones, so the deepest layers are busy with something
 * Swiss-Prot cannot name. The line across the top is that share, layer by layer.
 *
 * It is also the only way into a latent that nobody has a number for, so the dots are clickable.
 */

import type { Data, Feature } from './data';
import { cssVar, el } from './ui';

const PL = 46;
const PR = 14;
const PT = 26;
const PB = 34;
const H = 300;
const DOT = 2.1;

export interface DepthMapHandle {
  root: HTMLElement;
  /** Draw. Call after the root is in the document, for the reason locality.ts gives. */
  mount(): void;
}

export function depthMap(d: Data): DepthMapHandle {
  const live = d.features;
  const nLayers = d.nLayers;
  const maxProteins = Math.max(2, ...live.map((f) => f.np));

  const root = el('div', 'dmap');
  const head = el('div', 'loc-head');
  const caption = el('span', 'small muted');
  const readout = el('span', 'loc-readout mono');
  head.append(caption, readout);
  root.append(head);

  const box = el('div', 'dmap-box');
  const cv = el('canvas');
  box.append(cv);
  root.append(box);

  const legend = el('div', 'loc-legend');
  for (const [label, color] of [
    ['pairs with a concept', cssVar('--signal')],
    ['nothing named it', cssVar('--line-strong')],
  ] as [string, string][]) {
    const item = el('span', 'loc-key');
    const sw = el('i');
    sw.style.background = color;
    item.append(sw, label);
    legend.append(item);
  }
  const shareKey = el('span', 'loc-key');
  const shareSw = el('i');
  shareSw.style.background = cssVar('--accent');
  shareKey.append(shareSw, 'share that pairs, by layer');
  legend.append(shareKey);
  root.append(legend);

  // A latent's peak layer is one of 24 values, so 1598 of them land on the same vertical line.
  // A fixed spread inside the layer band separates them, and it is derived from the latent id
  // rather than drawn at random so that a dot does not move between redraws.
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
  let placed: { x: number; y: number; f: Feature }[] = [];

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

    placed = [];
    const paired = cssVar('--signal');
    const plain = cssVar('--line-strong');
    // Unpaired first, so the 1020 paired dots are never hidden under the 7108 that are not.
    for (const pass of [false, true]) {
      for (const f of live) {
        if (Boolean(f.c) !== pass) continue;
        const x = X(f.pk + jitter(f));
        const y = Y(f.np);
        if (pass) placed.push({ x, y, f });
        c.fillStyle = pass ? paired : plain;
        c.globalAlpha = pass ? 0.85 : 0.36;
        c.beginPath();
        c.arc(x, y, DOT, 0, Math.PI * 2);
        c.fill();
      }
    }
    c.globalAlpha = 1;
    // Only paired dots were collected above, so add the rest for hit testing.
    for (const f of live) {
      if (f.c) continue;
      placed.push({ x: X(f.pk + jitter(f)), y: Y(f.np), f });
    }

    // The share that pairs, layer by layer, on its own scale across the top band.
    const top = PT - 18;
    const band = 22;
    const maxShare = Math.max(...liveByLayer.map((n, i) => (n ? shareByLayer[i] / n : 0)), 0.01);
    c.strokeStyle = cssVar('--accent');
    c.lineWidth = 1.6;
    c.beginPath();
    let started = false;
    for (let l = 0; l < nLayers; l++) {
      if (!liveByLayer[l]) continue;
      const s = shareByLayer[l] / liveByLayer[l];
      const x = X(l + 1);
      const y = top + band - band * (s / maxShare);
      if (started) c.lineTo(x, y);
      else {
        c.moveTo(x, y);
        started = true;
      }
    }
    c.stroke();
    c.lineWidth = 1;

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

    if (hover >= 0 && hover < placed.length) {
      const p = placed[hover];
      c.strokeStyle = cssVar('--ink');
      c.beginPath();
      c.arc(p.x, p.y, DOT + 3, 0, Math.PI * 2);
      c.stroke();
    }
  }

  function nearest(mx: number, my: number): number {
    let best = -1;
    let bestD = 90; // squared pixels, so a click has to land near a dot to count
    for (let i = 0; i < placed.length; i++) {
      const dx = placed[i].x - mx;
      const dy = placed[i].y - my;
      const dd = dx * dx + dy * dy;
      if (dd < bestD) {
        bestD = dd;
        best = i;
      }
    }
    return best;
  }

  cv.addEventListener('mousemove', (e) => {
    const r = cv.getBoundingClientRect();
    const i = nearest(e.clientX - r.left, e.clientY - r.top);
    if (i === hover) return;
    hover = i;
    const f = i >= 0 ? placed[i].f : null;
    readout.textContent = f
      ? `f/${f.f}  peak ${f.pk}  ${f.np.toLocaleString('en-US')} proteins` +
        (f.c ? `  ${f.c.replace('_', ' · ')}` : '  unnamed')
      : '';
    cv.style.cursor = f ? 'pointer' : 'default';
    draw();
  });
  cv.addEventListener('mouseleave', () => {
    hover = -1;
    readout.textContent = '';
    draw();
  });
  cv.addEventListener('click', () => {
    if (hover >= 0) location.hash = `/feature/${placed[hover].f.f}`;
  });

  const ro = new ResizeObserver(() => {
    if (box.clientWidth > 0) draw();
  });

  return {
    root,
    mount() {
      const deep = liveByLayer.slice(-3).reduce((a, b) => a + b, 0);
      const deepPaired = shareByLayer.slice(-3).reduce((a, b) => a + b, 0);
      caption.textContent =
        `${live.length.toLocaleString('en-US')} live latents. ` +
        `The last three layers hold ${deep.toLocaleString('en-US')} of them and ` +
        `${deepPaired} that a concept names. Click a dot to open it.`;
      draw();
      ro.observe(box);
    },
  };
}
