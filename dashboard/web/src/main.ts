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
import { useFacts } from './facts';

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

/** The theme the reader picked last. Dark is the default: light strained the eyes. */
const THEME_KEY = 'protcc-theme';
type Theme = 'light' | 'dark';

function storedTheme(): Theme {
  try {
    return localStorage.getItem(THEME_KEY) === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/** A sun or a moon, the two icons that most sites use for the two themes. */
function themeIcon(theme: Theme): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('aria-hidden', 'true');
  const add = (tag: string, attrs: Record<string, string>) => {
    const n = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    svg.append(n);
  };
  if (theme === 'light') {
    add('circle', { cx: '8', cy: '8', r: '3' });
    for (let k = 0; k < 8; k++) {
      const t = (k * Math.PI) / 4;
      const [c, s_] = [Math.cos(t), Math.sin(t)];
      add('line', {
        x1: (8 + 5 * c).toFixed(2), y1: (8 + 5 * s_).toFixed(2),
        x2: (8 + 6.6 * c).toFixed(2), y2: (8 + 6.6 * s_).toFixed(2),
      });
    }
  } else {
    add('path', { d: 'M13.2 10.1A5.6 5.6 0 0 1 5.9 2.8a5.6 5.6 0 1 0 7.3 7.3Z' });
  }
  return svg;
}

/**
 * The theme switch: a sun and a moon side by side, the current one filled.
 *
 * Two named halves show the state and the choice at once. A single icon that flips leaves the
 * reader to guess whether it shows the theme they have or the theme they get.
 *
 * The canvases and the 3D model read the colours when they draw, so a switch draws the page again.
 */
function mountThemeSwitch(): void {
  const host = document.getElementById('themeswitch')!;
  const buttons = (['light', 'dark'] as Theme[]).map((theme) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.title = theme === 'light' ? 'Light theme' : 'Dark theme';
    b.setAttribute('aria-label', b.title);
    b.append(themeIcon(theme));
    b.addEventListener('click', () => {
      if (document.documentElement.dataset.theme === theme) return;
      try {
        localStorage.setItem(THEME_KEY, theme);
      } catch {
        // Private windows refuse storage. The switch still holds for this visit.
      }
      apply(theme);
      header();
      void route();
    });
    host.append(b);
    return { theme, b };
  });
  const apply = (theme: Theme): void => {
    document.documentElement.dataset.theme = theme;
    for (const x of buttons) x.b.setAttribute('aria-pressed', String(x.theme === theme));
  };
  apply(storedTheme());
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
  // The method picture is the front door. On a detail page it pushed the data 260 px down.
  document.getElementById('figs')!.hidden = Boolean(kind);
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
  mountThemeSwitch();
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
  useFacts(data);
  header();
  mountJump(data, document.getElementById('jump')!);
  // The provenance used to sit under every page. It now lives at the end of the glossary, which
  // is where the reader is when they want to know what the numbers were measured on.
  addEventListener('hashchange', () => void route());
  await route();
}

void start();
