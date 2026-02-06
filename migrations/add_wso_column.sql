-- Migration: Add WSO column to usaw_meet_entries - CORRECTED VERSION
-- Based EXACTLY on wso_information table query results (26 active WSOs)
BEGIN;
-- Add wso column
ALTER TABLE public.usaw_meet_entries
ADD COLUMN IF NOT EXISTS wso TEXT;
-- Create function to map state to WSO
-- Uses ONLY the exact mappings from wso_information table
CREATE OR REPLACE FUNCTION get_wso_from_state(state_input TEXT) RETURNS TEXT AS $$ BEGIN IF state_input IS NULL
    OR state_input = '' THEN RETURN NULL;
END IF;
CASE
    UPPER(TRIM(state_input)) -- Single-state WSOs (from wso_information)
    WHEN 'ALABAMA',
    'AL' THEN RETURN 'Alabama';
WHEN 'FLORIDA',
'FL' THEN RETURN 'Florida';
WHEN 'GEORGIA',
'GA' THEN RETURN 'Georgia';
WHEN 'ILLINOIS',
'IL' THEN RETURN 'Illinois';
WHEN 'INDIANA',
'IN' THEN RETURN 'Indiana';
WHEN 'MICHIGAN',
'MI' THEN RETURN 'Michigan';
WHEN 'NEW JERSEY',
'NJ' THEN RETURN 'New Jersey';
WHEN 'NEW YORK',
'NY' THEN RETURN 'New York';
WHEN 'OHIO',
'OH' THEN RETURN 'Ohio';
WHEN 'WISCONSIN',
'WI' THEN RETURN 'Wisconsin';
-- Multi-state/Regional WSOs (from wso_information)
WHEN 'NORTH CAROLINA',
'NC',
'SOUTH CAROLINA',
'SC' THEN RETURN 'Carolina';
WHEN 'DELAWARE',
'DE',
'MARYLAND',
'MD',
'VIRGINIA',
'VA',
'DISTRICT OF COLUMBIA',
'DC' THEN RETURN 'DMV';
WHEN 'HAWAII',
'HI' THEN RETURN 'Hawaii and International';
WHEN 'MINNESOTA',
'MN',
'NORTH DAKOTA',
'ND',
'SOUTH DAKOTA',
'SD' THEN RETURN 'Minnesota-Dakotas';
WHEN 'MISSOURI',
'MO',
'KANSAS',
'KS' THEN RETURN 'Missouri Valley';
WHEN 'IOWA',
'IA',
'NEBRASKA',
'NE' THEN RETURN 'Iowa-Nebraska';
WHEN 'MONTANA',
'MT',
'IDAHO',
'ID',
'COLORADO',
'CO',
'WYOMING',
'WY' THEN RETURN 'Mountain North';
WHEN 'UTAH',
'UT',
'ARIZONA',
'AZ',
'NEW MEXICO',
'NM',
'NEVADA',
'NV' THEN RETURN 'Mountain South';
WHEN 'MAINE',
'ME',
'NEW HAMPSHIRE',
'NH',
'VERMONT',
'VT',
'MASSACHUSETTS',
'MA',
'RHODE ISLAND',
'RI',
'CONNECTICUT',
'CT' THEN RETURN 'New England';
WHEN 'WASHINGTON',
'WA',
'OREGON',
'OR',
'ALASKA',
'AK' THEN RETURN 'Pacific Northwest';
WHEN 'PENNSYLVANIA',
'PA',
'WEST VIRGINIA',
'WV' THEN RETURN 'Pennsylvania-West Virginia';
WHEN 'LOUISIANA',
'LA',
'MISSISSIPPI',
'MS',
'ARKANSAS',
'AR' THEN RETURN 'Southern';
WHEN 'TENNESSEE',
'TN',
'KENTUCKY',
'KY' THEN RETURN 'Tennessee-Kentucky';
WHEN 'TEXAS',
'TX',
'OKLAHOMA',
'OK' THEN RETURN 'Texas-Oklahoma';
-- California: Cannot determine without county (has 2 county-based WSOs)
WHEN 'CALIFORNIA',
'CA' THEN RETURN NULL;
-- Any other state not listed above returns NULL
ELSE RETURN NULL;
END CASE
;
END;
$$ LANGUAGE plpgsql IMMUTABLE;
-- Backfill existing rows
UPDATE public.usaw_meet_entries
SET wso = get_wso_from_state(state)
WHERE wso IS NULL;
-- Create index for faster WSO lookups
CREATE INDEX IF NOT EXISTS idx_meet_entries_wso ON public.usaw_meet_entries(wso)
WHERE wso IS NOT NULL;
COMMIT;