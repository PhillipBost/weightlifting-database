-- Approved affiliation corrections. Run manually; the seeder does not remove old edges.
-- Directory absence supports removing an unsubstantiated seeded assertion, not a historical claim.
BEGIN;

UPDATE public.federation_registry SET official_website = 'https://awf.sport/'
WHERE short_code = 'AWF';
UPDATE public.federation_registry SET official_website = 'https://panampesas.org/'
WHERE short_code = 'PAWF';

-- North Macedonia: retain international membership and categorization.
DELETE FROM public.federation_affiliations a
USING public.federation_registry r, public.federation_registry p
WHERE a.child_id = r.id AND a.parent_id = p.id
  AND r.short_code = 'MKD' AND p.short_code = 'EWF'
  AND a.relationship_type = 'continental_member';

-- Norfolk Island: retain international membership and categorization.
DELETE FROM public.federation_affiliations a
USING public.federation_registry r, public.federation_registry p
WHERE a.child_id = r.id AND a.parent_id = p.id
  AND r.short_code = 'NRF' AND p.short_code = 'OWF'
  AND a.relationship_type = 'continental_member';

-- Home Nations: retain continental affiliations, remove unsupported international edges.
DELETE FROM public.federation_affiliations a
USING public.federation_registry r, public.federation_registry p
WHERE a.child_id = r.id AND a.parent_id = p.id
  AND r.short_code IN ('NIR', 'SCO', 'WAL') AND p.short_code = 'IWF'
  AND a.relationship_type = 'international_member';

COMMIT;
