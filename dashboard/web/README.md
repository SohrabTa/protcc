# The site

Plain TypeScript, no UI framework, built by Vite into one bundle. Three routes over one set of
data, and a fourth for a single protein.

    #/                        every concept, grouped by biological family
    #/concept/<name>          the latents that detect it, and the evidence
    #/feature/<id>            what one latent responds to and where it lives
    #/protein/<accession>     which latents fire along one protein

Routing is hash-based so the site works from a folder with no web server, which is what makes it
air-gappable.

## Running it

    npm install
    npm start          # builds, then serves on http://localhost:4173

`npm start` is build plus serve. Use `npm run dev` while editing, which reloads on save.

The data tree is never copied into the bundle: the full one is several gigabytes. `./data` is a
symlink to `../data/web`, which the precompute writes, and `npm run serve` links the same tree
into `dist/`. A real deployment drops the `data/` folder next to `index.html`.

The build is about 22 kB of JavaScript and 6 kB of CSS, with no runtime dependencies.

## What is not done yet

- **Fonts come from Google.** `index.html` links them, which is fine for development and wrong
  for an offline bundle. They have to be vendored as WOFF2 before the site can claim to run with
  no network. Measured at 299 kB for every subset, far less for Latin alone.
- **No structure viewer.** Stage 6 writes the models; Mol* has still to be wired in.
- **No amino-acid letter view.** The strips show where a latent fires, not what it reads.
- **The data tree is a smoke build.** One shard of 208, so most proteins have no track and the
  header says so. The concept and latent indexes are complete.
