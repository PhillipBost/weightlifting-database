-- ============================================================================
-- VERIFICATION (SELECT-ONLY): IWF Member Federation Seed (2026 ITA list
-- + supplementary Home Nations NIR/SCO/WAL)
-- Run each numbered block separately (self-hosted instances return only the
-- last statement's result set). No DML, no DDL.
-- Expected baseline: 198 national entities (192 categorized + 6 supplementary entities);
-- categories A=28, B=30, C=134 (Home Nations carry no categorization);
-- 388 national membership edges: 192 international and 196 continental.
-- ============================================================================

-- 1. Categorization counts per category (current period only)
SELECT category, count(*) AS federations
FROM public.federation_iwf_categorizations
WHERE valid_until IS NULL AND valid_from = '2026-01-01'
GROUP BY category
ORDER BY category;
-- Expected: A=28, B=30, C=134

-- 2. National-level entity count in federation_registry
SELECT count(*) AS national_entities
FROM public.federation_registry
WHERE level = 'national';
-- Expected: 198

-- 3. Registry rows missing verification or country code
SELECT short_code, canonical_name
FROM public.federation_registry
WHERE level = 'national'
  AND (country_code IS NULL OR short_code IS NULL
    OR (NOT is_verified AND short_code NOT IN ('NIR','SCO','WAL','GRN','GPE','LCA')));
-- Expected: no rows

-- 4. Duplicate national entities (same short_code twice)
SELECT short_code, count(*) AS n
FROM public.federation_registry
WHERE level = 'national' AND short_code IS NOT NULL
GROUP BY short_code
HAVING count(*) > 1;
-- Expected: no rows

-- 5. National edge reconciliation, including entities with zero edges.
-- Eight approved exceptions have one affiliation; all other seeded entities have two.
SELECT r.short_code, count(a.id) AS edge_count
FROM public.federation_registry r
LEFT JOIN public.federation_affiliations a
  ON a.child_id = r.id AND a.is_active = true
  AND a.relationship_type IN ('international_member','continental_member')
WHERE r.level = 'national'
GROUP BY r.id, r.short_code
HAVING count(a.id) <> CASE
  WHEN r.short_code IN ('MKD','NRF','NIR','SCO','WAL','GRN','GPE','LCA') THEN 1
  ELSE 2 END
ORDER BY r.short_code;
-- Expected: no rows

-- 6. Continental edge distribution
SELECT p.short_code AS continental_parent, count(*) AS members
FROM public.federation_affiliations a
JOIN public.federation_registry r ON r.id = a.child_id
JOIN public.federation_registry p ON p.id = a.parent_id
WHERE r.level = 'national'
  AND a.relationship_type = 'continental_member'
  AND a.is_active = true
GROUP BY p.short_code
ORDER BY p.short_code;
-- Expected: AWF=45, EWF=50, OWF=22, PAWF=40, WFA=39

-- 7. International Weightlifting Federation (IWF) membership is independent of registry inclusion
SELECT count(*) AS iwf_members
FROM public.federation_affiliations a
JOIN public.federation_registry r ON r.id = a.child_id
JOIN public.federation_registry p ON p.id = a.parent_id
WHERE r.level = 'national'
  AND p.short_code = 'IWF'
  AND a.relationship_type = 'international_member'
  AND a.is_active = true;
-- Expected: 192

-- 7b. Home Nations present with correct verification state
SELECT short_code, canonical_name, is_verified
FROM public.federation_registry
WHERE short_code IN ('NIR', 'SCO', 'WAL');
-- Expected: 3 rows, all is_verified = false

-- 7c. National entities WITHOUT a 2026 categorization (six supplementary entities)
SELECT r.short_code, r.canonical_name
FROM public.federation_registry r
WHERE r.level = 'national'
  AND NOT EXISTS (
    SELECT 1 FROM public.federation_iwf_categorizations c
    WHERE c.federation_id = r.id AND c.valid_until IS NULL AND c.valid_from = DATE '2026-01-01'
  );
-- Expected: exactly NIR, SCO, WAL, GRN, GPE, LCA

-- 8. Mutual-erasure / orphan check: categorization rows with no federation
SELECT c.id
FROM public.federation_iwf_categorizations c
LEFT JOIN public.federation_registry r ON r.id = c.federation_id
WHERE r.id IS NULL;
-- Expected: no rows (FK also guarantees this)

-- 9. PIT search spot checks (run one at a time)
SELECT * FROM public.search_federations('LBN', CURRENT_DATE);
-- Expected: Lebanese Association of Weightlifting, rank 95-100
SELECT * FROM public.search_federations('Argentina', CURRENT_DATE);
-- Expected: Federación Argentina de Pesas (common_alias), rank 100
SELECT * FROM public.search_federations('Federación Panamericana de Levantamiento de Pesas', CURRENT_DATE);
-- Expected: Pan American Weightlifting Federation (pre-existing edge), rank 100

-- 10. USAW/WCH enrichment check (aliases contain ITA codes; categorization present)
SELECT r.short_code, r.known_aliases,
       (SELECT c.category FROM public.federation_iwf_categorizations c
         WHERE c.federation_id = r.id AND c.valid_until IS NULL) AS category_2026
FROM public.federation_registry r
WHERE r.short_code IN ('USAW', 'WCH');
-- Expected: USAW -> category B; WCH -> category B; aliases include USA/CAN
