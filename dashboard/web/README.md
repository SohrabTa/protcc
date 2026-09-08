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

The build is about 30 kB of JavaScript and 7 kB of CSS, with no runtime dependencies.

## The locality view

The panel that answers where along a protein a latent fires. Both scales stay on screen at once,
because either one alone misleads.

The whole protein is drawn across the top and never moves or crops. A latent that fires on three
residues of five hundred only looks specific next to the residues it ignores, so cropping to the
firing site destroys the thing worth showing. The amino-acid letters sit below at a fixed 9 px
cell, reached by scrolling, with a marker on the overview saying which part they show. The view
opens centred on the strongest firing site.

Each letter sits on a cell coloured by the activation there, and a stripe under the letters
carries the residue's chemical class: hydrophobic, polar, positively charged, negatively charged,
and the group of cysteine, glycine and proline that none of the other four describes. The class
goes in its own row rather than into the letter, because the cell colour already carries the
activation and that is the primary signal.

Under the view is a count of what the firing residues are made of, against what the protein is
made of. It stays silent below 20 firing residues, where a share moves by 5 points for every
residue, and it says the composition is ordinary when no class stands out. That case is the
common one and it is worth reporting: a domain detector should not prefer a chemical class.
The count covers one protein, so it describes that protein and does not show a rule.

InterPLM colours its letters from matplotlib's `tab20` in alphabetical order
(`interplm/dashboard/feature_activation_vis.py:13`), so its colours carry no chemistry.

## What is not done yet

- **Fonts come from Google.** `index.html` links them, which is fine for development and wrong
  for an offline bundle. They have to be vendored as WOFF2 before the site can claim to run with
  no network. Measured at 299 kB for every subset, far less for Latin alone.
- **No structure viewer.** Stage 6 writes the models; Mol* has still to be wired in.
- **No per-residue counts over the whole evaluation set.** The chemistry count runs on one
  protein in the browser. A claim that a latent reads a chemical class needs the same count over
  every protein it fires on, which belongs in the precompute.
