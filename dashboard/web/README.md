# The site

Plain TypeScript, no UI framework, built by Vite into one bundle. Five routes over one set of
data.

    #/                        every concept, grouped by biological family
    #/concept/<name>          the latents that detect it, and the evidence
    #/feature/<id>            what one latent responds to and where it lives
    #/protein/<accession>     which latents fire along one protein
    #/glossary[/<entry>]      what every number on the site means

Routing is hash-based so the site works from a folder with no web server, which is what makes it
air-gappable.

## Running it

    npm install
    npm start          # builds, then serves on http://localhost:4173

`npm start` is build plus serve. Use `npm run dev` while editing, which reloads on save.

The data tree is never copied into the bundle: the full one is several gigabytes. `./data` is a
symlink to `../data/web`, which the precompute writes, and `npm run serve` links the same tree
into `dist/`. A real deployment drops the `data/` folder next to `index.html`.

The build is about 70 kB of JavaScript and 13 kB of CSS, with no runtime dependencies. 3Dmol is
a separate 545 kB chunk that only a page with a structure fetches.

## Navigation

The reader arrives with a question about the model, not about a lookup. Nobody comes here
knowing a latent number, and almost nobody comes with an accession. So the front page answers
"what did the crosscoder find about ProtT5" in three panels, each one a measured finding rather
than a section heading:

- **What it names.** 187 of 408 Swiss-Prot concepts, grouped by biological family, with the
  coverage of each family beside it. One family is shown at a time. All eleven at once is 187
  rows of table, and the two panels below carry the findings, so nobody reached them. The tab row
  is also the summary: each tab shows its family's found count and a coverage bar, so the
  overview is visible before any table is opened. A search runs across every family, because a
  reader who types a name does not know which family it is in.
- **How it names them.** 149 of the 187 are found by more than one latent, a median of 4 and as
  many as 62. The scatter is the evidence: every dot is one latent paired with one concept,
  placed by how much of the region it covers against how often it is right. A model that learned
  whole concepts would fill the top right. This one fills the top left. Both corners are labelled
  in the plot, and a sketch beside it draws what a top-left dot looks like on a real region:
  three latents, each right when it fires, each reading a quarter.
- **Where in the network.** Every live latent as a dot, across by the layer it writes hardest
  into and up by how many proteins it fires on, amber where a concept names it. The last three
  layers hold 937 live latents and 26 that anything names. 4867 of the 8128, which is 59.9%, peak
  at layers 15 to 19 against 20.8% for an even spread. That concentration is real and not an
  artifact of the layer-norm correction: see `PP-06` in the roadmap.

## Reaching one latent in the depth map

8128 dots in 24 columns are not targets. They overlap, and a click that lands between two of them
opens the wrong latent. So the map draws the 7108 unnamed latents as a density field, counted
into 4 px cells, and only the 1020 named ones as dots. Counting into cells also makes the
darkness depend on the count instead of on the draw order.

Three ways in, in rising order of precision:

- **Click a named dot** to open that latent.
- **Click anywhere else** to open that layer on its own. The plot then spreads one layer across
  its whole width, so all 1598 latents of layer 16 can be pointed at one at a time, and the list
  below carries the same latents with their concept and protein count.
- **Drag a rectangle** to list every latent inside it, named or not, widest first.

An unnamed latent has a page and a complete ranking file, exactly like a named one, so the lists
link to it. What it does not have is a dot of its own in the full view, because at that density a
dot is not a thing anyone can hit.

The hover readout floats over the plot rather than sitting beside the caption. In the flow it
changed the caption's line count on every hover, which moved the plot up and down under the
pointer.

## Tables, and what a column means

Every table comes from one helper, `table()` in `ui.ts`, so a change there reaches all five
routes at once. Two behaviours arrive that way.

**Columns sort, and sorting can be undone.** A header cycles through three states: the first
click sorts, the second reverses, and the third puts the rows back into the order the page built
them in. The third state matters because the built order is itself a ranking, and a reader who
sorts by something else has no way back to it otherwise. Numbers sort largest first, because the
reader wants the best row; names sort A to Z, because there is no best name. A cell whose text is
not its value carries a `data-sort` key: the depth ribbon has no text at all, and `f/1819` sorts
by 1819.

**A header explains itself.** The small `i` next to a header opens one sentence and a link into
the glossary entry for that metric. The sentences live in `metrics.ts`, which holds no DOM and
imports nothing, so the tooltip and the glossary page cannot drift apart. A header with no entry
gets no button, which is the right failure: a missing definition is invisible rather than wrong.

## The glossary

One page that defines every number, at `#/glossary`, reached from the header and from every
column tooltip. The entries are drawn rather than described: precision, recall per residue, F1
per domain and Reads are all counts over one picture of an annotated region and a latent track,
so a reader who sees that picture once does not re-read the sentence on each page.

It also carries the provenance, which used to sit in a footer under every page. It is one line
that nobody reads four hundred times and everybody needs once, so it belongs where a reader goes
when they ask what the numbers were measured on.

A tooltip link routes to `#/glossary/<entry>` rather than to a second `#`, which a hash router
cannot carry. The entry scrolls itself into view twice and once more after a pause, because on a
first load the fonts arrive after the first layout and every panel above the target changes
height.

## A stretch of the chain, or a site in the fold

The letter row and the structure view each answer half of one question. A latent that fires on
residues 40 to 60 reads a stretch, and the letter row shows it. A latent that fires on residues
12, 88 and 140 looks like scatter on the letter row, and can still be reading one pocket, because
the chain folds and brings those residues together.

Stage 8 measures both spreads for every live latent, over the 20 proteins it fires hardest on.
For one protein it takes every pair of firing residues and takes the median gap along the chain
and the median distance in space, each divided by the same spread over the whole protein. Both
are 1 when the firing residues are spread like the protein itself.

The sequence ratio alone decides a stretch, and the spatial ratio is read only when the sequence
ratio is not local. A first version tested both and got it wrong twice: latent 831 reads the ABC
transporter domain at 0.48 along the chain and 0.72 in space, and latent 7489 on a collagen-like
domain sits at 0.06 along the chain and 1.49 in space, because a collagen helix is extended.

The panel was a button that measured proteins in the browser while the reader waited. It now
draws all the latents at once and marks the one on screen, which is the part that carries a
finding. Latent 1531, paired with `Motif · Histidine box-3`, sits in the fold-site corner:
histidine boxes coordinate a di-iron centre, so they are far apart in sequence and together in
space.

## Choosing a protein

`Region_Disordered` is carried by 38,966 proteins. A stepper cannot choose among them and a
dropdown cannot either, because nobody recognises an accession. What makes the choice possible is
a number per protein, and the concept page offers two of them:

Two earlier attempts are worth recording, because both looked reasonable and both were wrong:

- **Reads**, from stage 7: the share of the annotated residues that all the concept's latents
  fire on, blended.
- **Strength**: how hard the concept's best latent fires, where "best" was never shown.

Both of those blended several latents and neither said what it ranked against, which is not a
control a reader can trust. The chooser now ranks the carriers by how hard **one named latent**
fires on each of them, and a picker says which latent, defaulting to the highest F1 per domain.
The reader then takes a part of that range (top, upper, middle, lower, bottom) and the stepper
walks inside it.

## What changes as the activation gets weaker

The latent page used to draw five example proteins per activation band and say nothing else.
Five proteins chosen by rank order tell no story, and the question a reader has about a weak
activation is whether the latent is still right when it fires weakly.

That is countable with no extra fetch. The ranking file already holds every protein and its peak,
and the carriers of the paired concept are already in memory, so the panel now counts, for each
band, the share of proteins in it that Swiss-Prot annotates with the concept. Three example
strips stay below as illustration. On f/4079 the share runs 95%, 93%, 83%, 52%, 30% from the
strongest band to the weakest. On f/275, a latent that fires on 206,415 of the 207,463 proteins,
it runs 38% to 0.0%, which is what a spurious pairing looks like.

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

A missing model is not always a 404 either. A server with a single-page fallback answers 200 and
sends the application's own HTML, which is what `vite preview` does, so the page also treats a
body that starts with `<` as a missing model. Without that check the reader was told the file was
corrupt. 5357 of the 207,463 proteins have no model in this tree. Every one of them carries an
AlphaFoldDB cross-reference, so the model exists; the Foldcomp database the tree was extracted
from does not hold it, and the message says exactly that.

## Three drawing rules the code has to obey

The first two came out of bugs that reached a screenshot, and they are the same mistake.

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

**A host that is being refilled must keep its height.** A view that empties its host and then
awaits a fetch loses its whole height for the length of that fetch. Measured on the concept page:
the panel fell from 759 px to 274 px, the document from 1684 px to 1199 px, and the browser
clamped the scroll position up by 485 px and back again 200 ms later. At the top of the page
there is nothing to clamp, which is why the same click looked calm there and violent lower down.
`holdHeight` in `ui.ts` pins the height and dims the host until the new content is in.

## What is not done yet

- **Fonts come from Google.** `index.html` links them, which is fine for development and wrong
  for an offline bundle. They have to be vendored as WOFF2 before the site can claim to run with
  no network. Measured at 299 kB for every subset, far less for Latin alone.
- **No per-residue counts over the whole evaluation set.** The chemistry count runs on one
  protein in the browser. A claim that a latent reads a chemical class needs the same count over
  every protein it fires on, which belongs in the precompute.
- **The latent page table sorts 25 rows, not the whole ranking.** The caption says so. Sorting
  45,822 rows in the browser is possible; fetching and rendering them is not the same question,
  and it has not been asked yet.
