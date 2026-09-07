#!/usr/bin/env python
"""Assign every Swiss-Prot concept in the evaluation set to a biological category.

Why. The dashboard groups concepts so a reader can find their way around 408 of them. The
obvious grouping is the Swiss-Prot field name, Domain / Region / Motif and so on, and it is
useless: it puts 83% of the paired features in one bucket. The paper repo already measured
four alternatives in `documentation/scripts/category_scheme_balance.py` and found the
enzyme-family split to be the balanced one. That analysis covered the 61 concepts of the
auxfix run. This script extends it to all 408 concepts of the preprint evaluation set.

Two schemes, both written for every concept:

  family  11 buckets, an enzyme-family aware split. The primary grouping in the dashboard.
  role     6 buckets, what the concept does: catalytic, binding, structural, PTM,
           targeting, disorder. A second filter, and the way a biologist usually asks.

Each row records how it was decided, so a reviewer reads only what needs reviewing:

  inherited  copied from the paper repo's map, unchanged
  rule       the Swiss-Prot field settles it, for example every Modified residue is a PTM
  hand       a per-name call made here

The `note` column carries a source for any call that was not obvious. Fourteen names were
researched against InterPro, PROSITE and UniProt on 2026-09-07 and now cite the entry that
settles them. One call changed as a result: `Domain_OCT` is the Obg C-terminal domain, not a
transcription-factor or transporter domain. One name stays genuinely ambiguous and says so in
its note: `Region_Domain II` covers two opposite things in different proteins.

Reads : the concept list from the held-out pairing table of the preprint evaluation
Writes: concept_categories.csv
Repro : uv run python build_concept_categories.py --pairings <path>
        Deterministic, no randomness, no seed.
"""

import argparse
import math
from pathlib import Path

import pandas as pd

FAMILIES = [
    "Kinase/phosphatase", "Transferase", "Redox/cofactor enzyme",
    "ATPase/GTPase/signaling", "Peptidase", "Other enzyme",
    "Nucleic-acid/metal binding", "Interaction module",
    "Structural", "Disordered/low-complexity", "PTM/targeting",
]
ROLES = ["catalytic", "binding", "structural", "PTM", "targeting", "disorder"]

# ---------------------------------------------------------------------------
# Inherited. Copied verbatim from documentation/scripts/category_scheme_balance.py
# in the paper repo, which stays the record for the auxfix analysis.
# ---------------------------------------------------------------------------
SEED = {
    "Coiled coil": ("Structural", "structural"),
    "Compositional bias_Acidic residues": ("Disordered/low-complexity", "disorder"),
    "Disulfide bond": ("PTM/targeting", "PTM"),
    "Domain_AB hydrolase-1": ("Other enzyme", "catalytic"),
    "Domain_B30.2/SPRY": ("Interaction module", "binding"),
    "Domain_C-type lectin": ("Interaction module", "binding"),
    "Domain_Collagen-like": ("Structural", "structural"),
    "Domain_F-box": ("Interaction module", "binding"),
    "Domain_FAD-binding FR-type": ("Redox/cofactor enzyme", "binding"),
    "Domain_G-alpha": ("ATPase/GTPase/signaling", "catalytic"),
    "Domain_GST C-terminal": ("Transferase", "catalytic"),
    "Domain_Globin": ("Interaction module", "binding"),
    "Domain_Glutamine amidotransferase type-1": ("Other enzyme", "catalytic"),
    "Domain_HD": ("Other enzyme", "catalytic"),
    "Domain_Helicase ATP-binding": ("ATPase/GTPase/signaling", "catalytic"),
    "Domain_Helicase C-terminal": ("ATPase/GTPase/signaling", "catalytic"),
    "Domain_IF rod": ("Structural", "structural"),
    "Domain_J": ("Interaction module", "binding"),
    "Domain_KARI C-terminal knotted": ("Redox/cofactor enzyme", "catalytic"),
    "Domain_KARI N-terminal Rossmann": ("Redox/cofactor enzyme", "catalytic"),
    "Domain_N-acetyltransferase": ("Transferase", "catalytic"),
    "Domain_NR LBD": ("Nucleic-acid/metal binding", "binding"),
    "Domain_Nudix hydrolase": ("Other enzyme", "catalytic"),
    "Domain_PDZ": ("Interaction module", "binding"),
    "Domain_PPIase cyclophilin-type": ("Other enzyme", "catalytic"),
    "Domain_Peptidase A1": ("Peptidase", "catalytic"),
    "Domain_Peptidase M12B": ("Peptidase", "catalytic"),
    "Domain_Peptidase S1": ("Peptidase", "catalytic"),
    "Domain_Protein kinase": ("Kinase/phosphatase", "catalytic"),
    "Domain_Radical SAM core": ("Redox/cofactor enzyme", "catalytic"),
    "Domain_Response regulatory": ("ATPase/GTPase/signaling", "catalytic"),
    "Domain_Rhodanese": ("Other enzyme", "catalytic"),
    "Domain_Rieske": ("Redox/cofactor enzyme", "binding"),
    "Domain_SH3": ("Interaction module", "binding"),
    "Domain_Sm": ("Nucleic-acid/metal binding", "binding"),
    "Domain_THUMP": ("Nucleic-acid/metal binding", "binding"),
    "Domain_Thioredoxin": ("Redox/cofactor enzyme", "catalytic"),
    "Domain_Tyrosine-protein phosphatase": ("Kinase/phosphatase", "catalytic"),
    "Domain_UBC core": ("Transferase", "catalytic"),
    "Domain_bHLH": ("Nucleic-acid/metal binding", "binding"),
    "Glycosylation_N-linked (GlcNAc...) asparagine": ("PTM/targeting", "PTM"),
    "Modified residue_N6-(pyridoxal phosphate)lysine": ("PTM/targeting", "PTM"),
    "Motif_Q motif": ("ATPase/GTPase/signaling", "binding"),
    "Region_CPSase": ("Other enzyme", "catalytic"),
    "Region_Cytidylyltransferase": ("Transferase", "catalytic"),
    "Region_Disordered": ("Disordered/low-complexity", "disorder"),
    "Region_I-domain": ("Interaction module", "binding"),
    "Region_N-acetyltransferase": ("Transferase", "catalytic"),
    "Region_N-domain": ("Structural", "structural"),
    "Region_Precorrin-2 dehydrogenase /sirohydrochlorin ferrochelatase":
        ("Redox/cofactor enzyme", "catalytic"),
    "Region_Pyrophosphorylase": ("Transferase", "catalytic"),
    "Region_Ribokinase": ("Kinase/phosphatase", "catalytic"),
    "Region_Uroporphyrinogen-III C-methyltransferase": ("Transferase", "catalytic"),
    "Transit peptide_any": ("PTM/targeting", "targeting"),
    "Zinc finger_NR C4-type": ("Nucleic-acid/metal binding", "binding"),
    "Zinc finger_RING-type": ("Nucleic-acid/metal binding", "binding"),
    "Zinc finger_any": ("Nucleic-acid/metal binding", "binding"),
}

# ---------------------------------------------------------------------------
# Rules. The Swiss-Prot field decides these, so no per-name judgment is involved.
# ---------------------------------------------------------------------------
FIELD_RULES = {
    "Active site": ("Other enzyme", "catalytic"),
    "Modified residue": ("PTM/targeting", "PTM"),
    "Glycosylation": ("PTM/targeting", "PTM"),
    "Lipidation": ("PTM/targeting", "PTM"),
    "Zinc finger": ("Nucleic-acid/metal binding", "binding"),
    "Compositional bias": ("Disordered/low-complexity", "disorder"),
    "Transit peptide": ("PTM/targeting", "targeting"),
    "Signal peptide": ("PTM/targeting", "targeting"),
    "Helix": ("Structural", "structural"),
    "Beta strand": ("Structural", "structural"),
    "Turn": ("Structural", "structural"),
}

# ---------------------------------------------------------------------------
# Hand calls. One per name, for the Domain, Region and Motif concepts that the
# field cannot settle. A third element marks the ones worth arguing about.
# ---------------------------------------------------------------------------
K, T, RX = "Kinase/phosphatase", "Transferase", "Redox/cofactor enzyme"
G, P, OE = "ATPase/GTPase/signaling", "Peptidase", "Other enzyme"
NA, IM = "Nucleic-acid/metal binding", "Interaction module"
ST, DIS, PT = "Structural", "Disordered/low-complexity", "PTM/targeting"

HAND = {
    # --- enzymes, by family ------------------------------------------------
    "Domain_Histidine kinase": (K, "catalytic"),
    "Domain_PPM-type phosphatase": (K, "catalytic"),
    "Domain_DPCK": (K, "catalytic"),
    "Domain_SET": (T, "catalytic"),
    "Domain_BPL/LPL catalytic": (T, "catalytic"),
    "Domain_MTTase N-terminal": (T, "catalytic"),
    "Domain_GST N-terminal": (T, "catalytic"),
    "Domain_DHHC": (T, "catalytic"),
    "Domain_CoA carboxyltransferase C-terminal": (T, "catalytic"),
    "Domain_CoA carboxyltransferase N-terminal": (T, "catalytic"),
    "Domain_Pyruvate carboxyltransferase": (T, "catalytic"),
    "Domain_PABS": (T, "catalytic"),
    "Domain_YrdC-like": (T, "catalytic"),
    "Domain_FAD-binding PCMH-type": (RX, "catalytic"),
    "Domain_Fe2OG dioxygenase": (RX, "catalytic"),
    "Domain_FMN hydroxy acid dehydrogenase": (RX, "catalytic"),
    "Domain_MsrB": (RX, "catalytic"),
    "Domain_Ferritin-like diiron": (RX, "catalytic",
                                    "PRU00085: ferroxidase activity, EC 1.16.3.1"),
    "Domain_Peptidase S8": (P, "catalytic"),
    "Domain_MPN": (P, "catalytic"),
    "Domain_ATP-grasp": (OE, "catalytic"),
    "Domain_RNase H type-1": (OE, "catalytic"),
    "Domain_RNase H type-2": (OE, "catalytic"),
    "Domain_RNase III": (OE, "catalytic"),
    "Domain_CN hydrolase": (OE, "catalytic"),
    "Domain_Exonuclease": (OE, "catalytic"),
    "Domain_C-type lysozyme": (OE, "catalytic"),
    "Domain_GH16": (OE, "catalytic"),
    "Domain_GH18": (OE, "catalytic"),
    "Domain_UmuC": (OE, "catalytic"),
    "Domain_Deacetylase sirtuin-type": (OE, "catalytic"),
    "Domain_PPIase FKBP-type": (OE, "catalytic"),
    "Domain_CMP/dCMP-type deaminase": (OE, "catalytic"),
    "Domain_GS catalytic": (OE, "catalytic"),
    "Domain_GS beta-grasp": (OE, "catalytic"),
    "Domain_TRUD": (OE, "catalytic"),
    "Domain_CheB-type methylesterase": (OE, "catalytic"),
    "Domain_DAHPS class-I TIM-barrel": (OE, "catalytic"),
    "Domain_MGS-like": (OE, "catalytic"),
    "Domain_SIS": (OE, "catalytic",
                   "IPR001347: 489 of 500 sampled Swiss-Prot SIS entries carry an EC number; "
                   "the RpiR/HexR sensing use is about 2%"),
    # --- nucleotide-driven machines and signaling --------------------------
    "Domain_ABC transporter": (G, "catalytic"),
    "Domain_ABC transporter 1": (G, "catalytic"),
    "Domain_ABC transporter 2": (G, "catalytic"),
    "Domain_Obg": (G, "catalytic"),
    "Domain_OBG-type G": (G, "catalytic"),
    "Domain_tr-type G": (G, "catalytic"),
    "Domain_CP-type G": (G, "catalytic"),
    "Domain_TrmE-type G": (G, "catalytic"),
    "Domain_Era-type G": (G, "catalytic"),
    # --- nucleic acid, metal and cofactor binding --------------------------
    "Domain_RRM": (NA, "binding"),
    "Domain_RRM 1": (NA, "binding"),
    "Domain_RRM 2": (NA, "binding"),
    "Domain_RRM 3": (NA, "binding"),
    "Domain_KH": (NA, "binding"),
    "Domain_KH type-2": (NA, "binding"),
    "Domain_DRBM": (NA, "binding"),
    "Domain_S5 DRBM": (NA, "binding"),
    "Domain_S4 RNA-binding": (NA, "binding"),
    "Domain_TRAM": (NA, "binding"),
    "Domain_PUA": (NA, "binding"),
    "Domain_MADS-box": (NA, "binding"),
    "Domain_bZIP": (NA, "binding"),
    "Domain_HTH myb-type 1": (NA, "binding"),
    "Domain_HTH myb-type 2": (NA, "binding"),
    "Domain_H15": (NA, "binding"),
    "Domain_4Fe-4S ferredoxin-type 1": (NA, "binding"),
    "Domain_4Fe-4S ferredoxin-type 2": (NA, "binding"),
    "Domain_2Fe-2S ferredoxin-type": (NA, "binding"),
    "Domain_ClpX-type ZB": (NA, "binding"),
    "Domain_EF-hand 1": (NA, "binding"),
    "Domain_EF-hand 2": (NA, "binding"),
    "Domain_EF-hand 3": (NA, "binding"),
    "Domain_EF-hand 4": (NA, "binding"),
    "Domain_Cytochrome b5 heme-binding": (RX, "binding"),
    "Domain_Flavodoxin-like": (RX, "binding"),
    "Domain_Lipoyl-binding": (RX, "binding"),
    "Domain_Carrier": (RX, "binding"),
    # --- protein interaction modules ---------------------------------------
    "Domain_SH2": (IM, "binding"),
    "Domain_PH": (IM, "binding"),
    "Domain_PX": (IM, "binding"),
    "Domain_BTB": (IM, "binding"),
    "Domain_PCI": (IM, "binding"),
    "Domain_UBA": (IM, "binding"),
    "Domain_LisH": (IM, "binding"),
    "Domain_ACT": (IM, "binding"),
    "Domain_K-box": (IM, "binding"),
    "Domain_KRAB": (IM, "binding"),
    "Domain_THD": (IM, "binding"),
    "Domain_Disintegrin": (IM, "binding"),
    "Domain_Ig-like": (IM, "binding"),
    "Domain_Ig-like V-type": (IM, "binding"),
    "Domain_Ig-like C1-type": (IM, "binding"),
    "Domain_Ig-like C2-type": (IM, "binding"),
    "Domain_Ig-like C2-type 1": (IM, "binding"),
    "Domain_Ig-like C2-type 2": (IM, "binding"),
    "Domain_EGF-like": (IM, "binding"),
    "Domain_EGF-like 1": (IM, "binding"),
    "Domain_EGF-like 2": (IM, "binding"),
    "Domain_Kazal-like": (IM, "binding"),
    "Domain_BPTI/Kunitz inhibitor": (IM, "binding"),
    "Domain_Inhibitor I9": (IM, "binding"),
    "Domain_SMP-LTD": (IM, "binding"),
    "Domain_Gla": (IM, "binding",
                   "PRU00463: calcium-dependent membrane binding; the gamma-carboxylation is "
                   "annotated separately as a MOD_RES, not as this domain"),
    "Domain_SCP": (IM, "binding",
                   "IPR014044: protease-like elements but no demonstrated activity; a binding "
                   "scaffold for protein and sterol"),
    "Domain_sHSP": (IM, "binding",
                    "PRU00285: binds non-native client protein; oligomerisation is secondary"),
    "Domain_CBS 1": (IM, "binding",
                     "PRU00703: an adenosyl-ligand regulatory module; it hydrolyses nothing "
                     "and binds no nucleic acid"),
    "Domain_CBS 2": (IM, "binding", "PRU00703: the second repeat of a Bateman pair"),
    "Domain_Ubiquitin-like": (IM, "binding",
                              "PRU00214: 60/40 embedded module against free modifier over 500 "
                              "sampled entries; the embedded use wins"),
    "Domain_LIM zinc-binding 1": (IM, "binding",
                                  "PRU00125: does not bind DNA, the zinc is structural and the "
                                  "domain is a protein-protein interface"),
    "Domain_LIM zinc-binding 2": (IM, "binding", "PRU00125: a later repeat of the same domain"),
    # --- structural ---------------------------------------------------------
    "Domain_Expansin-like EG45": (ST, "structural"),
    "Domain_LRRCT": (ST, "structural"),
    "Domain_LCN-type CS-alpha/beta": (ST, "structural"),
    "Domain_t-SNARE coiled-coil homology": (ST, "structural"),
    "Domain_CHCH": (ST, "structural",
                    "PRU01150: defined as a disulfide-stabilised fold; MIA40 import installs it "
                    "but is not its job"),
    "Domain_ABC transmembrane type-1": (ST, "structural",
                                        "PRU00441: 4 to 7 transmembrane segments, no catalytic "
                                        "or nucleotide annotation"),
    # Corrected 2026-09-07. This is not a transcription factor or a transporter: OCT is the
    # Obg C-terminal domain, found only at the C-terminus of the Obg/CgtA GTPase in 257 of 260
    # Swiss-Prot entries. The catalysis sits in the separate OBG-type G domain, so this one is
    # a non-catalytic accessory fold.
    "Domain_OCT": (G, "structural",
                   "PRU01229: the Obg C-terminal domain, a novel fold with a role in regulating "
                   "the nucleotide-binding state"),

    # --- Region: sub-domains named inside one protein -----------------------
    "Region_Large ATPase domain (RuvB-L)": (G, "catalytic"),
    "Region_Small ATPAse domain (RuvB-S)": (G, "catalytic"),
    "Region_Domain III, AAA+ region": (G, "catalytic"),
    "Region_Head domain (RuvB-H)": (ST, "structural"),
    "Region_Domain IV, binds dsDNA": (NA, "binding"),
    "Region_Alpha C-terminal domain (alpha-CTD)": (NA, "binding"),
    "Region_Alpha N-terminal domain (alpha-NTD)": (IM, "binding"),
    "Region_Domain I, interacts with DnaA modulators": (IM, "binding"),
    "Region_Basic motif": (NA, "binding"),
    "Region_DNA-binding": (NA, "binding"),
    "Region_RNA binding": (NA, "binding"),
    "Region_Interaction with DNA": (NA, "binding"),
    "Region_Interaction with RNA": (NA, "binding"),
    "Region_Interaction with tRNA": (NA, "binding"),
    "Region_Interaction with substrate tRNA": (NA, "binding"),
    "Region_Interaction with target base in tRNA": (NA, "binding"),
    "Region_Fe-S binding site A": (NA, "binding"),
    "Region_Fe-S binding site B": (NA, "binding"),
    "Region_Interaction with PCNA": (IM, "binding"),
    "Region_ACP-binding": (IM, "binding"),
    "Region_Important for dimerization": (IM, "binding"),
    "Region_Leucine-zipper": (IM, "binding"),
    "Region_N-terminal SAM-like domain": (IM, "binding"),
    "Region_Complementarity-determining-1": (IM, "binding"),
    "Region_Complementarity-determining-2": (IM, "binding"),
    "Region_Complementarity-determining-3": (IM, "binding"),
    "Region_Framework-1": (ST, "structural"),
    "Region_Framework-2": (ST, "structural"),
    "Region_Framework-3": (ST, "structural"),
    "Region_Coil 1A": (ST, "structural"),
    "Region_Coil 1B": (ST, "structural"),
    "Region_Coil 2": (ST, "structural"),
    "Region_Head": (ST, "structural"),
    "Region_Tail": (ST, "structural"),
    "Region_Alpha-1": (ST, "structural"),
    "Region_Alpha-2": (ST, "structural"),
    "Region_Hydrophobic": (ST, "structural"),
    "Region_Linker": (DIS, "disorder"),
    "Region_Linker 1": (DIS, "disorder"),
    "Region_Linker 12": (DIS, "disorder"),
    "Region_Flexible linker": (DIS, "disorder"),
    "Region_Flexible loop": (DIS, "disorder"),
    "Region_Connecting peptide": (DIS, "disorder"),
    "Region_G1": (G, "catalytic"),
    "Region_G2": (G, "catalytic"),
    "Region_G3": (G, "catalytic"),
    "Region_G4": (G, "catalytic"),
    "Region_G5": (G, "catalytic"),
    "Region_G1 motif": (G, "catalytic"),
    "Region_G2 motif": (G, "catalytic"),
    "Region_G3 motif": (G, "catalytic"),
    "Region_G4 motif": (G, "catalytic"),
    "Region_G5 motif": (G, "catalytic"),
    "Region_Switch-I": (G, "catalytic"),
    "Region_Switch-II": (G, "catalytic"),
    "Region_Involved in allosteric activation by GTP": (G, "binding"),
    "Region_NMP": (K, "binding"),
    "Region_LID": (K, "binding"),
    "Region_Important for the catalytic mechanism of both phosphorylation and dephosphorylation":
        (K, "catalytic"),
    "Region_Important for the catalytic mechanism of dephosphorylation": (K, "catalytic"),
    "Region_Catalytic": (OE, "catalytic"),
    # This concept covers two opposite things at roughly equal frequency: a folded five-helix
    # DNA-binding bundle in RuvA (about 730 Swiss-Prot entries) and an intrinsically disordered
    # linker in DnaA (about 578, median 45 residues, range 14 to 230). The bucket below follows
    # RuvA's plurality and is wrong for the DnaA half. No feature in the preprint evaluation
    # pairs with it, so nothing downstream depends on the call. Split or drop it if that changes.
    "Region_Domain II": (NA, "binding",
                         "ambiguous: RuvA DNA-binding bundle against DnaA disordered linker; "
                         "filed on RuvA's plurality"),

    # --- Motif --------------------------------------------------------------
    "Motif_Nudix box": (OE, "catalytic"),
    "Motif_'HIGH' region": (OE, "catalytic"),
    "Motif_'KMSKS' region": (OE, "catalytic"),
    "Motif_PP-loop motif": (OE, "catalytic"),
    "Motif_Meso-diaminopimelate recognition motif": (OE, "binding"),
    "Motif_Gly-cisPro motif, important for rejection of L-amino acids": (OE, "catalytic"),
    "Motif_Histidine box-1": (RX, "catalytic"),
    "Motif_Histidine box-2": (RX, "catalytic"),
    "Motif_Histidine box-3": (RX, "catalytic"),
    "Motif_HXXXXD motif": (T, "catalytic"),
    "Motif_TXY": (K, "catalytic"),
    "Motif_DEAD box": (G, "catalytic"),
    "Motif_Switch 1": (G, "catalytic"),
    "Motif_Switch 2": (G, "catalytic"),
    "Motif_Effector region": (G, "binding"),
    # All 103 Swiss-Prot entries carrying this note are rhodopsin, annotated at residues 134-136,
    # which is the E(D)RY motif of class-A GPCRs. UniProt's wording says "activated form"; the
    # literature has the Arg135-Glu247 lock stabilising the inactive dark state and breaking on
    # activation. The wording is a curation quirk and does not change the bucket.
    "Motif_'Ionic lock' involved in activated form stabilization":
        (G, "structural", "P08100: the class-A GPCR E(D)RY motif; stabilises a conformation"),
    "Motif_Cx2C motif 1": (ST, "structural"),
    "Motif_Cx2C motif 2": (ST, "structural"),
    "Motif_Cx9C motif 1": (ST, "structural"),
    "Motif_Cx9C motif 2": (ST, "structural"),
    "Motif_Selectivity filter": (ST, "structural"),
    "Motif_NPA 1": (ST, "structural"),
    "Motif_NPA 2": (ST, "structural"),
    "Motif_Nuclear localization signal": (PT, "targeting"),
    "Motif_Bipartite nuclear localization signal": (PT, "targeting"),
    "Motif_Nuclear export signal": (PT, "targeting"),
    "Motif_Microbody targeting signal": (PT, "targeting"),
    "Motif_Prevents secretion from ER": (PT, "targeting"),
    "Motif_RxLR-dEER": (PT, "targeting"),
    "Motif_Antp-type hexapeptide": (IM, "binding"),
    "Motif_Cell attachment site": (IM, "binding"),
    "Motif_PDZ-binding": (IM, "binding"),
    "Motif_9aaTAD": (DIS, "disorder"),
}


def assign(concept):
    """Return (family, role, source, note) for one concept."""
    if concept in SEED:
        return (*SEED[concept], "inherited", "")
    if concept in HAND:
        v = HAND[concept]
        return (v[0], v[1], "hand", v[2] if len(v) > 2 else "")
    field = concept.split("_")[0]
    if field in FIELD_RULES:
        return (*FIELD_RULES[field], "rule", "")
    return ("", "", "unassigned", "no call made")


def balance(labels):
    s = pd.Series(labels).value_counts()
    p = s / s.sum()
    return len(s), math.exp(-(p * p.apply(math.log)).sum()), p.max() * 100


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--pairings", type=Path, required=True,
                    help="heldout_top_pairings.csv, one row per concept")
    ap.add_argument("--all-pairings", type=Path, default=None,
                    help="heldout_all_top_pairings.csv, used only to weight the balance report")
    ap.add_argument("--out", type=Path, default=Path(__file__).parent / "concept_categories.csv")
    a = ap.parse_args()

    concepts = pd.read_csv(a.pairings, index_col=0).concept.tolist()
    rows = []
    for c in concepts:
        fam, role, src, note = assign(c)
        rows.append({"concept": c, "field": c.split("_")[0],
                     "family": fam, "role": role, "source": src, "note": note})
    df = pd.DataFrame(rows).sort_values(["family", "role", "concept"])

    bad = df[~df.family.isin(FAMILIES) | ~df.role.isin(ROLES)]
    df.to_csv(a.out, index=False)
    print(f"wrote {a.out}  ({len(df)} concepts)")
    print(df.source.value_counts().to_string())
    if len(bad):
        print(f"\n{len(bad)} concepts have no valid category:")
        print(bad[["concept", "source", "note"]].to_string(index=False))
    n_check = int(df.note.str.startswith("check").sum())
    print(f"\n{n_check} calls are marked check and want review")

    print("\n--- balance over the concepts ---")
    for col in ("field", "family", "role"):
        k, eff, top = balance(df[col])
        print(f"{col:>8}: {k:>2} buckets, {eff:.2f} effective, largest {top:.1f}%")

    if a.all_pairings and a.all_pairings.exists():
        allp = pd.read_csv(a.all_pairings)
        best = allp.sort_values("f1_per_domain", ascending=False).drop_duplicates("feature")
        m = df.set_index("concept")
        print("\n--- balance over the 1020 paired features ---")
        for col in ("field", "family", "role"):
            k, eff, top = balance([m.loc[c, col] for c in best.concept])
            print(f"{col:>8}: {k:>2} buckets, {eff:.2f} effective, largest {top:.1f}%")


if __name__ == "__main__":
    main()
