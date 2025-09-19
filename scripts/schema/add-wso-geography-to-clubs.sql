-- Add WSO geography field to clubs table
-- This field will contain the WSO geographic region based on boundary definitions

ALTER TABLE clubs ADD COLUMN IF NOT EXISTS wso_geography TEXT;

-- Add comment to document the new field
COMMENT ON COLUMN clubs.wso_geography IS 'WSO geographic region based on boundary definitions from wso_information table';