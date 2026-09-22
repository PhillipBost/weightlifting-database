# WFA Continental Membership Verification Report

**Date:** 2026-09-21
**Scope:** Verification of the 39 active `continental_member` edges pointing to the
Weightlifting Federation of Africa (WFA) in `public.federation_affiliations` — the last
unverified continental assignment group (after AWF 45/45, EWF, OWF, and PAWF were
verified and corrected in prior sessions).

**Outcome: 39/39 CONFIRMED. Discrepancy list is EMPTY. No migration required.**

---

## 1. Verification standard (established in prior sessions)

- A continental federation's own directory is authoritative for its membership edges.
- Missing directory entry means the edge is *unconfirmed*, not *disproven*.
- Competition participation is corroboration only, never sole proof.

**Adaptation for Africa (agreed):** the WFA (official site `www.wfa.com.ly`, ruled
outdated but valid and not abandoned) publishes no member roster — its template pages
are abandoned and only contact details plus stale 2024-era news are authentic.
Therefore verification used: (1) external directories and championship documentation,
(2) participant sets from the ingested `iwf_meet_results` African championship family,
and (3) spot-checks of national federation websites/announcements.

## 2. Database state (confirmed via read-only SELECT)

- Exactly 39 active `continental_member` edges -> WFA, matching the expected list
  character-for-character:
  `ALG BDI BOT CGO CMR COD COM CPV EGY ETH GAM GEQ GHA GUI KEN LBA LBR LES MAD MAR
  MAW MLI MRI MTN NGR RSA RWA SEN SEY SLE SOM SUD SWZ TAN TUN UGA ZAM ZAN ZIM`
- All 39 codes resolve to genuinely African entities: ZAN = Zanzibar, GEQ = Equatorial
  Guinea, MAW = Malawi, SWZ = Eswatini (formerly Swaziland), etc.
- Ingested African championship family: 52 meets (2008-2026), 3,327 result rows.
  Participant union = 36 codes; **zero participant codes outside the 39** (no guest
  or misassigned nations).

## 3. Source-provenance clarification (important)

The `continent` field in `scratch/iwf-2026-members.json` (seed source) was **not**
derived from the ITA "2026 List of Categorised IWF Member Federations" PDF — that
document is organized by category (A/B/C) only, with no continental grouping. The
grouping was assigned in `scratch/build-members-json.js` from the Wikipedia
"National members of the IWF" template, with manual placement of PDF-only members
(BDI, CPV, FRO->EWF, GEQ, RWA, WLF->OWF). This verification supplies the independent
evidentiary basis that the grouping previously lacked.

## 4. Evidence matrix (union of sources covers 39/39)

| Source | Coverage | Gaps | Notes |
|---|---|---|---|
| IWRP (iwrp.net) WFA directory — https://iwrp.net/public/federacja-glowna/5-wfa | 36/39 | BDI, CPV, RWA | Lists "Mali (MLI)", "Somalia (SOM)", "Zimbabwe (ZIM)" with zero/low result counts; contains a "Morocco (MOR)" duplicate data artifact (MAR is the correct entry); Somalia page explicitly tagged "WFA . SOM", Zimbabwe page "WFA . ZIM" |
| Ingested African championships (`iwf_meet_results`, 2008-2026) | 36/39 | MLI, SOM, ZIM | Covers all three IWRP gaps: BDI + CPV at 2025 Moka; CPV again 2026; RWA at 2017 Junior and 2022 Championships |
| Wikipedia "National members of the IWF" template | 35/39 subset | BDI, CPV, GEQ, RWA (the four "PDF-only members") | Each of the four gaps corroborated by championship participation (see section 5) |
| Press/Grokipedia cross-check | — | — | 2025 Moka championships: "22 countries" matches ingested 22 codes exactly, validating ingestion completeness; Grokipedia's unsourced "38 member nations" claim noted but not relied upon |

### Per-code corroboration summary

| Code | Entity | IWF 2026 cat. | IWRP WFA roster | African-champ participation (ingested) |
|---|---|---|---|---|
| ALG | Algeria | C | yes | 40 events, 2008-2026 |
| BDI | Burundi | C | **no** | **2025 senior championships** |
| BOT | Botswana | C | yes | 21 events, 2014-2026 |
| CGO | Republic of the Congo | C | yes | 3 events (2014, 2015, 2017) |
| CMR | Cameroon | C | yes | 38 events, 2008-2026 |
| COD | DR Congo | C | yes | 4 events (2017, 2022-2024) |
| COM | Comoros | C | yes | 2018 African Youth Games |
| CPV | Cape Verde | C | **no** | **2025 and 2026 senior championships** |
| EGY | Egypt | A | yes | 38 events, 2008-2026 |
| ETH | Ethiopia | C | yes | 2 events (2015 African Games, 2025) |
| GAM | Gambia | C | yes | 2025 senior championships |
| GEQ | Equatorial Guinea | C | yes | 4 events (2014, 2016, 2025, 2026) |
| GHA | Ghana | C | yes | 26 events, 2010-2026 |
| GUI | Guinea | C | yes | 2025 senior championships (3 bronzes, first participation per fr.wikipedia) |
| KEN | Kenya | C | yes | 28 events, 2009-2026 |
| LBA | Libya | B | yes | 43 events, 2008-2026 |
| LBR | Liberia | C | yes | 2025 senior championships |
| LES | Lesotho | C | yes | 8 events, 2017-2025 |
| MAD | Madagascar | B | yes | 29 events, 2008-2026 |
| MAR | Morocco | C | yes | 29 events, 2008-2026 |
| MAW | Malawi | C | yes | 5 events (2009, 2010) |
| MLI | Mali | C | yes | none in ingested window — see section 6 |
| MRI | Mauritius | B | yes | 39 events, 2008-2026 |
| MTN | Mauritania | C | yes | 2 events (2025, 2026) |
| NGR | Nigeria | A | yes | 22 events, 2008-2026 |
| RSA | South Africa | C | yes | 46 events, 2008-2026 (most of any member) |
| RWA | Rwanda | C | **no** | **2017 Junior, 2022 senior; 1 medal in Wikipedia all-time table** |
| SEN | Senegal | C | yes | 3 events (2015, 2025, 2026) |
| SEY | Seychelles | B | yes | 28 events, 2008-2024 |
| SLE | Sierra Leone | C | yes | 7 events, 2014-2025 |
| SOM | Somalia | C | yes | none in ingested window — see section 6 |
| SUD | Sudan | C | yes | 5 events, 2012-2022 |
| SWZ | Eswatini | C | yes | 4 events (2008, 2018, 2019, 2025) |
| TAN | Tanzania | C | yes | 2025 senior championships |
| TUN | Tunisia | B | yes | 45 events, 2008-2026 |
| UGA | Uganda | C | yes | 35 events, 2008-2026 |
| ZAM | Zambia | C | yes | 5 events, 2018-2026 |
| ZAN | Zanzibar | C | yes | **all three 2009 events (Senior, Junior, Youth) — confirms Zanzibar competes as a distinct WFA entity** |
| ZIM | Zimbabwe | C | yes | none in ingested window — see section 6 |

## 5. The four "PDF-only members" (not in the Wikipedia template) — all corroborated

These were manually placed under WFA during seeding because they appear in the
IWF/ITA 2026 categorized list but not the Wikipedia template. Each now has direct
African-championship participation evidence:

- **BDI (Burundi):** competed at the 2025 African Championships (Moka, Mauritius).
- **CPV (Cape Verde):** competed at the 2025 and 2026 African Championships.
- **GEQ (Equatorial Guinea):** competed 2014 Youth Games, 2016, 2025, 2026
  Championships; also listed in the IWRP WFA roster.
- **RWA (Rwanda):** competed 2017 Junior and 2022 Championships; 1 bronze in
  Wikipedia's all-time African Championships medal table.

## 6. The three no-participation codes — MLI/SOM/ZIM corroboration

MLI (Mali), SOM (Somalia), ZIM (Zimbabwe) have no results in any ingested African
championship meet (2008-2026). Per the standard, missing participation is **not**
disproof. Each is corroborated by an independent directory entry:

- **MLI:** listed in the IWRP WFA roster ("Mali (MLI)"); the Fédération Malienne
  d'Haltérophilie runs documented domestic competitions (e.g., Bamako tournament
  coverage on maliactu.net).
- **SOM:** listed in the IWRP WFA roster with 4 male athletes (born 1988-1992);
  IWRP federation page explicitly tagged "WFA . SOM"; the Somali Weightlifting
  Federation maintains an official site (somaliweightlifting.org).
- **ZIM:** listed in the IWRP WFA roster; the Weightlifting Federation of Zimbabwe
  (President Claude Shambare) is a recognized national association per the Sports
  and Recreation Commission (SRC) of Zimbabwe —
  https://src.org.zw/dt_team/weightlifting-federation-of-zimbabwe/

## 7. Completeness check (members possibly missing from the 39)

No source lists any current African IWF/WFA member outside the 39:

- The IWRP WFA roster contains no additional African federations.
- The Wikipedia template Africa (WFA) group (35 entries) is a strict subset.
- The ITA 2026 categorized list contributes only BDI/CPV/GEQ/RWA beyond the template.
- The IWF site directory (`iwf.sport/focus-on-iwf/federations/?federation=africa`) is
  Cloudflare-blocked (HTTP 403) and could not be consulted — **residual limitation**.
  Historically inactive African federations (e.g., Angola, Mozambique, Namibia, Togo)
  appear in none of the accessible current sources and no supplementary registry
  entities are proposed.

## 8. Data-quality footnotes (NOT edge issues; no action proposed)

1. 2025 African Championships: fr.wikipedia records **23 nations / 94 participants**;
   our ingested data has 22 codes / 91 result rows. One nation may have entered
   without producing result rows (or the scrape missed DNS — Did Not Start — athletes).
2. 2026 African Championships: ingested meet dated "May 10, 2026"; actual dates were
   12-16 May 2026 (Ismailia, Egypt). Minor date imprecision in the meet metadata.
3. 2011 African Senior Championships (Cape Town): ingested with only 3 codes
   (NGR, RSA, SEY) — likely an incomplete scrape of that edition.
4. IWRP lists Morocco twice ("Maroc (MAR)" and "Morocco (MOR)") — a data artifact in
   that source; our registry correctly has a single MAR entity.

## 9. Conclusion

- **WFA continental membership: 39/39 confirmed.** No edge corrections were needed;
  the expected `WFA=39` in `migrations/verify-iwf-countries-seed.sql` (check #6)
  is correct as-is.
- **Follow-up (user-approved):** affiliation edges carried no verification state in
  the schema (`federation_affiliations` had no `is_verified`/`citation` columns), so
  the verification outcome is persisted via
  `migrations/add-affiliation-verification-and-backfill-2026-09-21.sql`: it adds
  `is_verified`, `citation`, and `verified_on` columns (with a CHECK that verified
  edges must carry a citation) and backfills all 388 verified membership edges
  (192 international_member with the ITA 2026 list citation + 196 continental_member
  with per-confederation directory citations, including the WFA 39).
  Read-only checks: `migrations/verify-affiliation-verification-2026-09-21.sql`.
- With this, all five continental confederation groups are verified:
  AWF (45/45 exact), EWF (exact after MKD removal), OWF (exact after NRF removal),
  PAWF (37 confirmed + GRN/GPE/LCA supplementary), WFA (39/39 confirmed).

## 10. Sources consulted

- IWRP WFA directory: https://iwrp.net/public/federacja-glowna/5-wfa
- IWRP Somalia: https://iwrp.net/public/federacja/143-somalia
- IWRP Zimbabwe: https://iwrp.net/public/federacja/152-zimbabwe
- Wikipedia: African Weightlifting Championships; 2026 African Weightlifting
  Championships; Weightlifting Federation of Africa; Template:National members of
  the International Weightlifting Federation
- fr.wikipedia: Championnats d'Afrique d'haltérophilie 2025
- Grokipedia: African Weightlifting Championships
- SRC Zimbabwe (national recognition of ZIM federation):
  https://src.org.zw/dt_team/weightlifting-federation-of-zimbabwe/
- WFA official site (ruled valid, no roster): https://www.wfa.com.ly
- WFA-published championship documents located on the official site (image-scan
  PDFs, not text-extractable; corroborate editions already confirmed via ingested
  data): 2021 ASWC start book (wp-content/uploads/2021/05/Start-book-ASWC-2021.pdf),
  2022 start book (wp-content/uploads/2022/10/Startbook-28-10-2022_*.pdf),
  2023 result book (wp-content/uploads/2023/05/ResultBook-SENIOR-AFRICAN-
  CHAMPIONSHIPS-_MFs.pdf); 2026 "African Senior Championships - Start Book"
  (cited by Wikipedia, dated 13 May 2026).
- Ingested data: `public.iwf_meets` / `public.iwf_meet_results` (52 African-family
  meets, 2008-2026, 3,327 result rows), queried read-only via supabase-js.

