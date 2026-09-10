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

## Navigation

The reader arrives with a question about the model, not about a lookup. Nobody comes here
knowing a latent number, and almost nobody comes with an accession. So the front page answers
"what did the crosscoder find about ProtT5" in three panels, each one a measured finding rather
than a section heading:

- **What it names.** 187 of 408 Swiss-Prot concepts, grouped by biological family, with the
  coverage of each family beside it.
- **How it names them.** 149 of the 187 are found by more than one latent, a median of 4 and as
  many as 62. The scatter is the evidence: every dot is one latent paired with one concept,
  placed by how much of the region it covers against how often it is right. A model that learned
  whole concepts would fill the top right. This one fills the top left.
- **Where in the network.** Every live latent as a dot, across by the layer it writes hardest
  into and up by how many proteins it fires on, amber where a concept names it. The last three
  layers hold 937 live latents and 26 that anything names.

The depth map is also the only way into a latent nobody has a number for, so its dots open the
latent page. It replaced a plain histogram of peak layers, which showed the same distribution
and none of the rest.

A search sits in the header on every page, focused with `/`. It searches concepts, ranked so
that the concept the crosscoder found most strongly comes first: typing `kinase` reaches Protein
kinase at 54 latents before Histidine kinase at 37. It also accepts `f/1819` and an accession,
unadvertised, because those are for returning to a page you have already seen.

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

## The structure view

The feature page draws the AlphaFold backbone, coloured by the same activation ramp the strips
and the letters use, so the three views speak one language.

It exists for one question the sequence views cannot answer. A latent can fire on residues that
are far apart along the chain and still read a single site, because the chain folds and brings
them together. On the letter row that looks like scatter. In space it is a pocket.

A rotating protein is persuasive whether or not the residues are really close, so the panel also
counts it: the median distance between alpha carbons of firing residues at least 20 apart in
sequence, against the same median over pairs drawn from the whole protein. Distant pairs only,
because neighbours along the chain are always close and would drown the signal. A median in
angstroms rather than a share above a cutoff, because a cutoff is arbitrary and two shares near
one percent differ mostly by rounding. It measures one protein and says so.

The measure separates cases. Latent 3652 on CN hydrolase gives 17 Å against 24 Å, so it reads a
compact region. Latent 6187 on globin gives 21 Å against 21 Å, because it covers most of a small
protein and concentrates nowhere.

3Dmol arrives through a dynamic import, so it is a separate 545 kB chunk that only a feature
page fetches. The rest of the site stays at 34 kB.

Whether the page decompresses a model depends on the server, so it checks the first two bytes
rather than assuming. Vite sends a `.gz` file with `Content-Encoding: gzip` and the browser
unwraps it; a bare static server sends the bytes as stored.

## Two drawing rules the code has to obey

Both came out of bugs that reached a screenshot, and both are the same mistake.

**A canvas cannot be sized before it is in the document.** `activationStrip` deferred its first
drawing to a frame callback, and the callers build a row of strips inside a loop that awaits a
fetch per protein, so a frame passed while the row was still detached. The canvas was sized from
a width of zero and stretched by CSS into one smear of colour, which corrected itself only when
switching activation bands rebuilt the row. Strips now redraw on a resize and, because a resize
observation is delivered by the rendering loop and never arrives in a page that is not being
painted, the caller also calls `redrawStrips` once the rows are in the document.

**So the container has to be attached first.** Filling a detached panel and appending it at the
end puts every measurement back at zero. The protein and concept views now append their panel
before they fill it.

## What is not done yet

- **Fonts come from Google.** `index.html` links them, which is fine for development and wrong
  for an offline bundle. They have to be vendored as WOFF2 before the site can claim to run with
  no network. Measured at 299 kB for every subset, far less for Latin alone.
- **No per-residue counts over the whole evaluation set.** The chemistry count runs on one
  protein in the browser. A claim that a latent reads a chemical class needs the same count over
  every protein it fires on, which belongs in the precompute.
