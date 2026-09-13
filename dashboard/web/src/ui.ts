/** Small DOM and drawing helpers. No framework: the site builds elements directly. */

import { metricForHeader } from './metrics';

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
export function rampRGB(t: number): [number, number, number] {
  const lo = hex2rgb(cssVar('--ramp-lo'));
  const mid = hex2rgb(cssVar('--signal-bright'));
  const hi = hex2rgb(cssVar('--ramp-hi'));
  const u = Math.max(0, Math.min(1, t));
  const [a, b, k] = u < 0.55 ? [lo, mid, u / 0.55] : [mid, hi, (u - 0.55) / 0.45];
  return a.map((v, i) => Math.round(v + (b[i] - v) * k)) as [number, number, number];
}

export function ramp(t: number): string {
  return `rgb(${rampRGB(t).join(',')})`;
}

/**
 * Black or white, whichever is readable on the given colour.
 *
 * The ramp runs light to dark in the light theme and dark to light in the dark one, so a fixed
 * text colour is unreadable at one end of it in one theme or the other.
 */
export function inkOn(rgb: [number, number, number]): string {
  const [r, g, b] = rgb.map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.36 ? '#101010' : '#f5f5f5';
}

export const fmt = (x: number, d = 3) => x.toFixed(d);
/**
 * A percentage, with enough digits to stay informative.
 *
 * A motif latent fires on one residue of 500, so it covers 0.2% of the protein. Rounded to
 * whole percent that reads as 0%, which says the latent does nothing. Small values keep two
 * digits instead.
 */
export const pct = (x: number, d = 1) => `${x.toFixed(x > 0 && x < 1 ? 2 : d)}%`;
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
  // ResizeObserver rather than one frame callback. The callers build a row of strips inside a
  // loop that awaits a fetch per protein, so a frame passes while the row is still detached from
  // the document. The canvas was then sized from a width of zero and stretched by CSS into a
  // single smear of colour, which only corrected itself when something rebuilt the row.
  new ResizeObserver(() => {
    if (box.clientWidth > 0) draw();
  }).observe(box);
  (box as HTMLElement & { redraw?: () => void }).redraw = draw;
  return box;
}

/**
 * Redraw every strip under a container. Call it after the strips are in the document.
 *
 * The observer above covers a resize, but it is delivered by the rendering loop and so does not
 * arrive at all in a page that is not being painted. The first drawing is the one that matters
 * and the caller knows when the rows are in the document, so the caller asks for it.
 */
export function redrawStrips(root: HTMLElement): void {
  root.querySelectorAll<HTMLElement & { redraw?: () => void }>('.strip').forEach((s) => s.redraw?.());
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

/**
 * The one popover that explains a column header.
 *
 * One element for the whole page rather than one per header. A table can have six headers and a
 * page can have three tables, and eighteen hidden popovers that each need closing when another
 * opens is a worse thing to keep correct than one that moves.
 */
let popover: HTMLElement | null = null;
let popoverFor: HTMLElement | null = null;

function closePopover(): void {
  popover?.remove();
  popover = null;
  popoverFor = null;
}

function openPopover(anchor: HTMLElement, slug: string, title: string, short: string): void {
  if (popoverFor === anchor) {
    closePopover();
    return;
  }
  closePopover();
  const box = el('div', 'metricpop');
  box.setAttribute('role', 'dialog');
  box.append(el('strong', undefined, title), el('p', undefined, short));
  const more = link(`/glossary/${slug}`, 'Full definition');
  more.addEventListener('click', () => closePopover());
  box.append(more);
  document.body.append(box);
  const r = anchor.getBoundingClientRect();
  const w = box.offsetWidth;
  // Keep it on screen. A right-hand column would otherwise open past the edge of the page.
  const x = Math.min(Math.max(8, r.left + scrollX), scrollX + innerWidth - w - 8);
  box.style.left = `${x}px`;
  box.style.top = `${r.bottom + scrollY + 6}px`;
  popover = box;
  popoverFor = anchor;
}

addEventListener('click', (e) => {
  const t = e.target as HTMLElement | null;
  if (popover && t && !popover.contains(t) && !t.closest('.th-info')) closePopover();
});
addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closePopover();
});
// The popover is attached to the body rather than to the table, so leaving the page does not
// take it with it. It would otherwise hang over the next page.
addEventListener('hashchange', closePopover);

/** What one cell sorts by. `data-sort` wins, and the text is parsed when it does not. */
function cellKey(td: HTMLTableCellElement): number | string | null {
  const ds = td.dataset.sort;
  if (ds !== undefined) {
    const n = Number(ds);
    return Number.isFinite(n) && ds.trim() !== '' ? n : ds;
  }
  const t = (td.textContent ?? '').trim();
  if (t === '' || t === '—') return null;
  // `f/1819` sorts by the latent number, `12,345` and `2.9%` by their value.
  const cleaned = t.replace(/^f\//i, '').replace(/[,%\s]/g, '');
  const n = Number(cleaned);
  return cleaned !== '' && Number.isFinite(n) ? n : t.toLowerCase();
}

export interface TableHandle {
  root: HTMLTableElement;
  body: HTMLTableSectionElement;
}

/**
 * A table whose columns sort, and whose headers explain themselves.
 *
 * Every table on the site comes through here, so both behaviours arrive everywhere at once. A
 * header cycles through three states rather than two: the first click sorts, the second
 * reverses, and the third puts the rows back into the order the page built them in. That third
 * state is the reason the default order is captured on the first click and never lost.
 */
export function table(headers: string[], alignLeft: number[] = [0]): TableHandle {
  const t = el('table', 'sortable');
  const thead = el('thead');
  const tr = el('tr');
  const body = el('tbody');

  let defaultOrder: HTMLTableRowElement[] | null = null;
  let sortCol = -1;
  let sortDir = 0; // 0 default, 1 first click, 2 reversed

  const buttons: HTMLButtonElement[] = [];

  const apply = (col: number): void => {
    const rows = [...body.rows] as HTMLTableRowElement[];
    if (!defaultOrder) defaultOrder = rows;
    if (col !== sortCol) {
      sortCol = col;
      sortDir = 1;
    } else {
      sortDir = (sortDir + 1) % 3;
    }

    let ordered: HTMLTableRowElement[];
    if (sortDir === 0) {
      sortCol = -1;
      ordered = defaultOrder.filter((r) => r.isConnected);
    } else {
      const keyed = rows.map((r) => ({ r, k: cellKey(r.cells[col]) }));
      const first = keyed.find((x) => x.k !== null);
      const numeric = typeof first?.k === 'number';
      // A number sorts largest first, because the reader wants the best row. A name sorts A to
      // Z, because there is no "best" name.
      const flip = (numeric ? -1 : 1) * (sortDir === 1 ? 1 : -1);
      keyed.sort((a, b) => {
        if (a.k === null) return 1; // empty cells stay at the end in both directions
        if (b.k === null) return -1;
        if (typeof a.k === 'number' && typeof b.k === 'number') return (a.k - b.k) * flip;
        return String(a.k).localeCompare(String(b.k)) * flip;
      });
      ordered = keyed.map((x) => x.r);
    }
    for (const r of ordered) body.append(r);

    buttons.forEach((b, i) => {
      const on = i === sortCol && sortDir !== 0;
      const numeric = on && typeof cellKey(body.rows[0]?.cells[i] as HTMLTableCellElement) === 'number';
      b.parentElement!.setAttribute(
        'aria-sort',
        on ? (numeric === (sortDir === 1) ? 'descending' : 'ascending') : 'none',
      );
      b.dataset.state = on ? String(sortDir) : '0';
    });
  };

  headers.forEach((h, i) => {
    const th = el('th');
    th.setAttribute('aria-sort', 'none');
    if (alignLeft.includes(i)) th.style.textAlign = 'left';
    const sort = el('button', 'th-sort');
    sort.type = 'button';
    sort.append(el('span', 'th-label', h), el('span', 'th-arrow'));
    sort.title = `Sort by ${h}. Click again to reverse, and once more for the default order.`;
    sort.addEventListener('click', () => apply(i));
    th.append(sort);
    buttons.push(sort);

    const m = metricForHeader(h);
    if (m) {
      const info = el('button', 'th-info', 'i');
      info.type = 'button';
      info.setAttribute('aria-label', `What ${h} means`);
      info.addEventListener('click', (e) => {
        e.stopPropagation();
        openPopover(info, m.slug, m.title, m.short);
      });
      th.append(info);
    }
    tr.append(th);
  });

  thead.append(tr);
  t.append(thead, body);
  return { root: t, body };
}

/**
 * One table row.
 *
 * `sortKeys` gives a cell a value to sort by when its text is not the value: a link reading
 * `f/1819`, a depth ribbon with no text at all, or a percentage already rounded for display.
 */
export function row(
  cells: (Node | string)[],
  alignLeft: number[] = [0],
  sortKeys?: (number | string | undefined)[],
): HTMLTableRowElement {
  const tr = el('tr');
  cells.forEach((c, i) => {
    const td = el('td');
    td.append(c as Node | string);
    if (alignLeft.includes(i)) td.style.textAlign = 'left';
    const k = sortKeys?.[i];
    if (k !== undefined) td.dataset.sort = String(k);
    tr.append(td);
  });
  return tr;
}

/**
 * A row of figures, for the numbers that used to sit inside a sentence.
 *
 * A reader scanning a page finds a number faster than a clause, and a number in a figure can be
 * compared against the one beside it. The note below carries the caution that a sentence used
 * to carry, which is usually that one protein describes itself and proves nothing.
 */
export function figures(items: [string, string][], note?: string): HTMLElement {
  const box = el('div', 'statbox');
  const row_ = el('div', 'statrow');
  for (const [v, k] of items) {
    const f = el('div', 'stat');
    f.append(el('span', 'v', v), el('span', 'k', k));
    row_.append(f);
  }
  box.append(row_);
  if (note) box.append(el('p', 'small muted statnote', note));
  return box;
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

/**
 * Keep a host at its current height while its contents are replaced.
 *
 * Without this the page jumps. A view that empties its host and then awaits a fetch loses its
 * whole height for as long as the fetch takes. Measured on the concept page: the panel fell from
 * 759 px to 274 px, the document from 1684 px to 1199 px, and the browser clamped the scroll
 * position up by 485 px and back again 200 ms later. At the top of the page there is nothing to
 * clamp, which is why the same click looks calm there and violent lower down.
 *
 * Call it before the host is emptied. Call the returned function after the new content is in.
 */
export function holdHeight(host: HTMLElement): () => void {
  const h = host.offsetHeight;
  if (h > 0) host.style.minHeight = `${h}px`;
  host.classList.add('busy');
  return () => {
    host.style.minHeight = '';
    host.classList.remove('busy');
  };
}

/**
 * A stepper for a long list of proteins.
 *
 * It replaces a `<select>` of up to several hundred accessions. Nobody knows the accessions, so
 * a list of them is not a choice anybody can make: the reader wants another example, not a
 * particular protein. So the control offers the next one, the previous one, and a random one,
 * and says where in the list they are.
 */
export function stepper(
  items: string[],
  label: string,
  onPick: (item: string, index: number) => void,
): HTMLElement {
  const box = el('div', 'chips stepper');
  let i = 0;
  const pos = el('span', 'small muted');
  const name = el('span', 'mono step-name');

  const go = (next: number) => {
    i = (next + items.length) % items.length;
    pos.textContent = `${label} ${i + 1} of ${items.length}`;
    name.textContent = items[i];
    onPick(items[i], i);
  };

  const prev = el('button', undefined, '‹');
  prev.title = 'previous';
  prev.addEventListener('click', () => go(i - 1));
  const next = el('button', undefined, '›');
  next.title = 'next';
  next.addEventListener('click', () => go(i + 1));
  const rand = el('button', undefined, 'random');
  rand.addEventListener('click', () => go(Math.floor(Math.random() * items.length)));

  box.append(pos, prev, name, next, rand);
  go(0);
  return box;
}
