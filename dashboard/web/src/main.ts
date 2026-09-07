/**
 * Entry point and router.
 *
 * Routing is hash-based on purpose: `#/feature/1819` resolves without a web server, so the site
 * works from a folder or a USB drive. Three routes, over one set of data.
 */

import './style.css';
import { Data } from './data';
import { el, link, num } from './ui';
import { renderOverview } from './views/overview';
import { renderConcept } from './views/concept';
import { renderFeature } from './views/feature';
import { renderProtein } from './views/protein';

const data = new Data('./data');
const app = document.getElementById('app')!;
const crumbs = document.getElementById('crumbs')!;

function header(): void {
  const h = data.manifest.headline;
  const figs = document.getElementById('figs')!;
  figs.textContent = '';
  const items: [string, string][] = [
    ['Average best test F1', h.avg_best_test_f1.toFixed(3)],
    ['Concepts found', `${h.concepts_identified} of ${h.concepts_total}`],
    ['Latents paired', num(h.features_paired)],
    ['Live latents', `${num(h.latents_alive)} of ${num(h.latents_total)}`],
    ['Encoder layers', String(h.layers)],
  ];
  for (const [k, v] of items) {
    const f = el('div', 'fig');
    f.append(el('span', 'v', v), el('span', 'k', k));
    figs.append(f);
  }
  if (data.manifest.partial) {
    document.getElementById('partial')!.hidden = false;
  }
}

function setCrumbs(parts: (Node | string)[]): void {
  crumbs.textContent = '';
  crumbs.append(link('/', 'All concepts'));
  for (const p of parts) {
    crumbs.append(el('span', undefined, '›'));
    crumbs.append(p as Node | string);
  }
}

async function route(): Promise<void> {
  const hash = location.hash.replace(/^#/, '') || '/';
  const [, kind, rest] = /^\/([^/]*)\/?(.*)$/.exec(hash) ?? [];
  try {
    if (!kind) {
      setCrumbs([]);
      renderOverview(data, app);
    } else if (kind === 'concept') {
      const name = decodeURIComponent(rest);
      setCrumbs([el('span', undefined, name.replace('_', ' · '))]);
      await renderConcept(data, name, app);
    } else if (kind === 'feature') {
      setCrumbs([el('span', 'mono', `f/${rest}`)]);
      await renderFeature(data, Number(rest), app);
    } else if (kind === 'protein') {
      setCrumbs([el('span', 'mono', rest.toUpperCase())]);
      await renderProtein(data, rest.toUpperCase(), app);
    } else {
      app.textContent = '';
      app.append(el('p', 'loading', `No route for ${hash}.`));
    }
  } catch (err) {
    app.textContent = '';
    const box = el('div', 'warn');
    box.append(el('strong', undefined, 'Something failed to load. '), String(err));
    app.append(box);
    console.error(err);
  }
  window.scrollTo(0, 0);
}

async function start(): Promise<void> {
  app.append(el('p', 'loading', 'Loading the index…'));
  try {
    await data.load();
  } catch (err) {
    app.textContent = '';
    const box = el('div', 'warn');
    box.append(
      el('strong', undefined, 'The data tree did not load. '),
      String(err),
      ' Run the precompute, then point ./data at its output.',
    );
    app.append(box);
    return;
  }
  header();
  document.getElementById('prov')!.textContent =
    `${data.manifest.crosscoder} on ${data.manifest.eval_set}, built ${data.manifest.built}. ` +
    `${num(data.manifest.counts.proteins)} proteins, ` +
    `${num(data.manifest.counts.latent_protein_pairs)} latent-protein pairs.` +
    (data.manifest.partial
      ? ' This tree was built from a subset of shards and is not publishable.'
      : '');
  addEventListener('hashchange', () => void route());
  await route();
}

void start();
