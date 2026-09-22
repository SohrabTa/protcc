/**
 * Entry point and router.
 *
 * Routing is hash-based on purpose: `#/feature/1819` resolves without a web server, so the site
 * works from a folder or a USB drive. Six routes, over one set of data. `#/feature/<id>` is
 * kept as an alias of `#/latent/<id>` so that links sent before the rename still resolve.
 */

import './style.css';
import { Data } from './data';
import { el, link } from './ui';
import { renderOverview } from './views/overview';
import { renderConcept } from './views/concept';
import { renderFeature } from './views/feature';
import { renderProtein } from './views/protein';
import { renderGlossary } from './glossary';
import { renderMethod } from './method';
import { methodFigure } from './methodfigure';
import { mountJump } from './jump';

const data = new Data('./data');
const app = document.getElementById('app')!;
const crumbs = document.getElementById('crumbs')!;

function header(): void {
  // The five numbers used to stand alone here, and a number with no context says nothing. Each
  // one now sits under the station of the method it counts, and the picture is a link.
  const figs = document.getElementById('figs')!;
  figs.textContent = '';
  figs.append(methodFigure(data));
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
    } else if (kind === 'latent' || kind === 'feature') {
      // `#/feature/<id>` is the old spelling. It is kept so that links already sent still work.
      // Everything the site writes says latent, because UniProt calls its own annotations
      // features and those annotations are the concepts on this site.
      setCrumbs([el('span', 'mono', `f/${rest}`)]);
      await renderFeature(data, Number(rest), app);
    } else if (kind === 'protein') {
      setCrumbs([el('span', 'mono', rest.toUpperCase())]);
      await renderProtein(data, rest.toUpperCase(), app);
    } else if (kind === 'method') {
      setCrumbs([el('span', undefined, 'Method')]);
      renderMethod(data, app, rest || undefined);
    } else if (kind === 'glossary') {
      // The entry is part of the route rather than a second hash, because a second `#` would
      // not survive the hash router.
      setCrumbs([el('span', undefined, 'Glossary')]);
      renderGlossary(data, app, rest || undefined);
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
  // A glossary entry and a method section scroll themselves into view, so the route must not
  // fight them back to the top.
  if (!/^#\/(glossary|method)\/./.test(location.hash)) window.scrollTo(0, 0);
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
  mountJump(data, document.getElementById('jump')!);
  // The provenance used to sit under every page. It now lives at the end of the glossary, which
  // is where the reader is when they want to know what the numbers were measured on.
  addEventListener('hashchange', () => void route());
  await route();
}

void start();
