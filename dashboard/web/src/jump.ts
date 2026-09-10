/**
 * The search that follows you.
 *
 * The overview already had a search, but it lived inside the concept panel, so it read as a
 * filter for that table and existed on one page only. From a latent page there was no way back
 * to a concept except through the whole list.
 *
 * It searches concepts, because that is what a reader arrives with. Nobody comes here knowing a
 * latent number, and almost nobody comes with an accession. Both still work, typed as `f/1819`
 * or `Q03217`, because they are how you return to a page you have already seen. They are not
 * advertised in the placeholder for the same reason.
 */

import type { Data } from './data';
import { el } from './ui';

const MAX = 8;

export function mountJump(d: Data, host: HTMLElement): void {
  host.textContent = '';
  const box = el('div', 'jump-box');
  const input = el('input');
  input.type = 'search';
  input.placeholder = 'Search concepts';
  input.setAttribute('aria-label', 'Search concepts');
  const list = el('div', 'jump-list');
  list.hidden = true;
  box.append(input, list);
  host.append(box);

  let hits: { label: string; hash: string; note: string }[] = [];
  let cursor = -1;

  function search(q: string): void {
    hits = [];
    const t = q.trim();
    if (!t) return;

    const asFeature = /^f\/?(\d+)$/i.exec(t);
    if (asFeature) {
      const fid = Number(asFeature[1]);
      const f = d.featureById.get(fid);
      hits.push({
        label: `f/${fid}`,
        hash: `/feature/${fid}`,
        note: f ? (f.c ? f.c.replace('_', ' · ') : 'no concept pairs with it') : 'dead latent',
      });
      return;
    }
    const acc = t.toUpperCase();
    if (d.proteinShard.has(acc)) {
      hits.push({ label: acc, hash: `/protein/${acc}`, note: 'protein' });
      return;
    }

    // Concepts, with the ones whose name starts with the query first, because a reader typing
    // "kinase" wants Protein kinase before Kinase-like domain of something else.
    const low = t.toLowerCase();
    const starts: Data['concepts'] = [];
    const contains: Data['concepts'] = [];
    for (const c of d.concepts) {
      const name = c.c.split('_').slice(1).join('_').toLowerCase();
      if (name.startsWith(low) || c.c.toLowerCase().startsWith(low)) starts.push(c);
      else if (c.c.toLowerCase().includes(low)) contains.push(c);
    }
    // Within each group, the concept the crosscoder found most strongly comes first. Typing
    // "kinase" should reach Protein kinase, at 54 latents, before Histidine kinase at 37.
    const byStrength = (a: Data['concepts'][number], b: Data['concepts'][number]) =>
      b.nf - a.nf || b.f1 - a.f1;
    starts.sort(byStrength);
    contains.sort(byStrength);
    for (const c of [...starts, ...contains].slice(0, MAX)) {
      hits.push({
        label: c.c.replace('_', ' · '),
        hash: `/concept/${encodeURIComponent(c.c)}`,
        note: c.nf ? `${c.nf} latent${c.nf === 1 ? '' : 's'}, best F1 ${c.f1.toFixed(2)}` : 'no latent',
      });
    }
  }

  function render(): void {
    list.textContent = '';
    list.hidden = hits.length === 0;
    hits.forEach((h, i) => {
      const row = el('button', 'jump-hit');
      row.setAttribute('aria-selected', String(i === cursor));
      row.append(el('span', 'jump-label', h.label), el('span', 'jump-note', h.note));
      row.addEventListener('mousedown', (e) => {
        e.preventDefault();
        go(i);
      });
      list.append(row);
    });
  }

  function go(i: number): void {
    if (i < 0 || i >= hits.length) return;
    location.hash = hits[i].hash;
    input.value = '';
    hits = [];
    cursor = -1;
    render();
    input.blur();
  }

  input.addEventListener('input', () => {
    search(input.value);
    cursor = hits.length ? 0 : -1;
    render();
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!hits.length) return;
      cursor = (cursor + (e.key === 'ArrowDown' ? 1 : hits.length - 1)) % hits.length;
      render();
    } else if (e.key === 'Enter') {
      go(cursor >= 0 ? cursor : 0);
    } else if (e.key === 'Escape') {
      input.value = '';
      hits = [];
      render();
      input.blur();
    }
  });
  input.addEventListener('blur', () => {
    setTimeout(() => {
      list.hidden = true;
    }, 120);
  });
  input.addEventListener('focus', () => {
    if (hits.length) list.hidden = false;
  });

  // "/" focuses it, the convention wherever a page is mostly reading. It must not steal the key
  // from a field the reader is already typing into.
  addEventListener('keydown', (e) => {
    const t = e.target as HTMLElement | null;
    if (e.key !== '/' || (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    e.preventDefault();
    input.focus();
  });
}
