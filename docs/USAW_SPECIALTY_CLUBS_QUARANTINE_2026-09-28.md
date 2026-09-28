# USAW Specialty Clubs — Quarantine Evidence Table (2026-09-28)

Status: FORENSIC INPUT ONLY. No clearing migration generated. All 14 rows below are
quarantined suspects: frontend must not render them as vetted until each is proven
against the live row or USAW. Verbatim-only rule holds throughout; boolean flags are
deprecated and frozen.

Acronyms: USA Weightlifting (USAW); Black, Indigenous, and People of Color (BIPOC);
Lesbian, Gay, Bisexual, Transgender, Queer, Intersex, Asexual plus (LGBTQIA+).

## Live page (23 rows, re-fetched 2026-09-28)

Abstract Barbell; Alpha Uno Athletics; Barbarian Barbell; Bexar Barbell; Blaze Barbell;
Brave Barbell N Sprinkles; Brightside Barbell; CHFP Weightlifting; EastSide Barbell;
Heartland Strength; Industrial Strength; Maximum Weightlifting; McKenna's Gym;
Monument Weightlifting (Brian Leung & Lauren McHugh, Asian American owned/LGBTQIA+);
Murder of Crows; NXT LVL Barbell Club; Ong Weightlifting; Orlando Strength;
Polarize Barbell Club; PXM Weightlifting; Trident Weightlifting Club;
Tough Temple Barbell Club; Vice Weightlifting.

## Suspect rows (14, all created_at 2026-09-25 17:51 UTC = local specialty run)

| # | DB club_name | DB designation | Contact / handle duplicated from any live row? | Column-alignment note | Verdict |
|---|---|---|---|---|---|
| 1 | B3 Better Sport Performance | Black owned | No (Jerrian Sanders / @B3Better, unique) | Coherent | Suspect — do not display as vetted |
| 2 | Bearproof Weightlifting Club | Black owned | No (Brandon Davis / @bearproofweightlifting) | Coherent | Suspect — do not display as vetted |
| 3 | Desert Dome Weightlifting | LGBTQIA+ owned | No (Jessica Pine / @desertdomecrossfit) | ADDRESS CELL HOLDS COUNTRY ('United Arab Emirates'), state null — possible column shift; manual review required | Suspect — do not auto-clear |
| 4 | Diamond Fit Weightlifting Club | LGBTQIA+ | No (Jesse King/Calvin Miller, Raleigh NC) | Coherent | Suspect — do not display as vetted |
| 5 | Golden State Barbell | Black owned | No (Nerissa Zhang / @Goldenstatebb, San Francisco) | Coherent | Suspect — do not display as vetted |
| 6 | ISA Barbell Club | Black owned/LGBTQIA+ | No (Hillary Herring / @innerstallionathletics, Ferndale MI) | Designation string has no live counterpart — manual review required | Suspect — do not auto-clear |
| 7 | Liberation Barbell Club | LGBTQIA+ | No (Tyler Jacob Villarreal, Austin TX) | Distinct club from Liberty Barbell (below), not a collision pair | Suspect — do not display as vetted |
| 8 | Liberty Barbell | LGBTQIA+ | No (Wylie Belasik, Philadelphia PA) | Distinct club from Liberation (above) | Suspect — do not display as vetted |
| 9 | Olde City Barbell | LGBTQIA+ | No (William Vicinus / @FearlessPHL, Philadelphia) | Coherent | Suspect — do not display as vetted |
| 10 | Olympus Weightlifting and Fitness Center | Black owned | No (Kent Eghomwanre / @Olympuswfc, Baytown TX) | Coherent | Suspect — do not display as vetted |
| 11 | Set Fire Barbell | LGBTQIA+ | No (Raquel Theodeosopoulos / @setfireathletics, Newport KY) | Coherent | Suspect — do not display as vetted |
| 12 | Team Kansas City Barbell | LGBTQIA+ | No (Jay Ashman / @kansascitybarbell, Kansas City MO) | Coherent | Suspect — do not display as vetted |
| 13 | Tri Peak Athlete | LGBTQIA+ | No (Hector Torres / @tripeakathlete, Orlando FL) | Coherent | Suspect — do not display as vetted |
| 14 | Urban Power House | Black owned | No (Joseph Stephen / @urbanpowerhouse, Boston MA) | Coherent | Suspect — do not display as vetted |

## Provenance notes

* Zero GitHub Actions runs have ever fired for `usaw-specialty-clubs-pipeline.yml`
  (0 workflow runs page, schedule first eligible 2026-10-01). The 2026-09-25
  population was a local `node` run; no run log exists anywhere and none can be pulled.
* Stub-creation requires a scraped page name matching no directory row, so each stub's
  cells were read from some rendered table on 2026-09-25 — but absent a run log this is
  strong-but-circumstantial, not proof. Hence quarantine, not "likely delisted" labels.
* Second-source/manual-seed path cannot be excluded: the page invites owner
  questionnaire intake via usaw@usaweightlifting.org after vetting.
* `updated_at` batch 2026-09-28 00:08–00:09 UTC on 9 rows is attributed to the daily
  directory/geocoder pipeline (designation-inert), not a specialty run — corroborated by
  Monument Weightlifting still absent from the DB (a second specialty run would have
  inserted it).

## Acceptance row for the pipeline test (not manually inserted, per owner ruling)

Monument Weightlifting | Asian American owned/LGBTQIA+ | Brian Leung & Lauren McHugh |
info@monumentweightlifting | 614-A S Pickett St, Alexandria, VA 22304 |
@monumentweightlifting. Expected dry-run output: NEW STUB with byte-verbatim
designation incl. `&` in contact; flags untouched.
