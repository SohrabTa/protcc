/** Small DOM and drawing helpers. No framework: the site builds elements directly. */

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

export function frag(...nodes: (Node | string)[]): DocumentFragment {
  const f = document.createDocumentFragment();
  for (const n of nodes) f.append(n);
  return f;
}

/** A hash link. Routing is hash-based so the site works from a folder with no server. */
export function link(href: string, text: string, cls = ''): HTMLAnchorElement {
  const a = el('a', cls, text);
  a.href = `#${href}`;
  return a;
}

export function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function hex2rgb(h: string): [number, number, number] {
  const s = h.replace('#', '');
  return [
    parseInt(s.slice(0, 2), 16),
    parseInt(s.slice(2, 4), 16),
    parseInt(s.slice(4, 6), 16),
  ];
}

/** The activation ramp. 0 is the page ground, 1 is the strongest the latent ever fires. */
export function ramp(t: number): string {
  const lo = hex2rgb(cssVar('--ramp-lo'));
  const mid = hex2rgb(cssVar('--signal-bright'));
  const hi = hex2rgb(cssVar('--ramp-hi'));
  const u = Math.max(0, Math.min(1, t));
  const [a, b, k] = u < 0.55 ? [lo, mid, u / 0.55] : [mid, hi, (u - 0.55) / 0.45];
  return `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * k)).join(',')})`;
}

export const fmt = (x: number, d = 3) => x.toFixed(d);
export const pct = (x: number, d = 1) => `${x.toFixed(d)}%`;
export const num = (x: number) => x.toLocaleString('en-US');

/** A horizontal bar showing a part of a whole, with the numbers beside it. */
export function coverageBar(part: number, whole: number, width = 150): HTMLElement {
  const box = el('div', 'covbar');
  const track = el('div', 'covbar-track');
  track.style.width = `${width}px`;
  const fill = el('div', 'covbar-fill');
  fill.style.width = `${whole ? (part / whole) * 100 : 0}%`;
  track.append(fill);
  box.append(track, el('span', 'covbar-label', `${part} / ${whole}`));
  return box;
}

/** The 24-layer depth curve as a compact row of bars, for a table cell. */
export function depthRibbon(norm: number[]): HTMLElement {
  const r = el('span', 'ribbon');
  for (const v of norm) {
    const i = el('i');
    i.style.height = `${Math.max(1, Math.round(v * 13))}px`;
    i.style.opacity = (0.35 + 0.65 * v).toFixed(2);
    r.append(i);
  }
  return r;
}

/** A canvas strip of one latent's activation along a whole protein. */
export function activationStrip(values: Uint8Array, height = 15): HTMLElement {
  const box = el('div', 'strip');
  box.style.height = `${height}px`;
  const cv = el('canvas');
  box.append(cv);
  const draw = () => {
    const w = Math.max(1, Math.round(box.clientWidth));
    const dpr = Math.min(2, devicePixelRatio || 1);
    cv.width = w * dpr;
    cv.height = height * dpr;
    const c = cv.getContext('2d')!;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, w, height);
    const n = values.length;
    for (let px = 0; px < w; px++) {
      const a = Math.floor((px * n) / w);
      const b = Math.max(a + 1, Math.floor(((px + 1) * n) / w));
      let m = 0;
      for (let i = a; i < b; i++) if (values[i] > m) m = values[i];
      c.fillStyle = ramp(m / 255);
      c.fillRect(px, 0, 1, height);
    }
    c.strokeStyle = cssVar('--line');
    c.strokeRect(0.5, 0.5, w - 1, height - 1);
  };
  requestAnimationFrame(draw);
  (box as HTMLElement & { redraw?: () => void }).redraw = draw;
  return box;
}

/** A binary strip: where Swiss-Prot annotates a concept. */
export function annotationStrip(length: number, ranges: [number, number][]): HTMLElement {
  const box = el('div', 'strip strip-thin');
  for (const [a, b] of ranges) {
    const m = el('i');
    m.style.left = `${(a / length) * 100}%`;
    m.style.width = `${Math.max(0.4, ((b - a + 1) / length) * 100)}%`;
    box.append(m);
  }
  return box;
}

export function table(headers: string[], alignLeft: number[] = [0]): {
  root: HTMLTableElement;
  body: HTMLTableSectionElement;
} {
  const t = el('table');
  const thead = el('thead');
  const tr = el('tr');
  headers.forEach((h, i) => {
    const th = el('th', undefined, h);
    if (alignLeft.includes(i)) th.style.textAlign = 'left';
    tr.append(th);
  });
  thead.append(tr);
  const body = el('tbody');
  t.append(thead, body);
  return { root: t, body };
}

export function row(cells: (Node | string)[], alignLeft: number[] = [0]): HTMLTableRowElement {
  const tr = el('tr');
  cells.forEach((c, i) => {
    const td = el('td');
    td.append(c as Node | string);
    if (alignLeft.includes(i)) td.style.textAlign = 'left';
    tr.append(td);
  });
  return tr;
}

export function panel(eyebrow: string, title: string, lede?: string): HTMLElement {
  const p = el('section', 'panel');
  const h = el('header');
  const d = el('div');
  d.append(el('span', 'eyebrow', eyebrow), el('h2', undefined, title));
  h.append(d);
  p.append(h);
  if (lede) p.append(el('p', 'lede', lede));
  return p;
}
