-- Create table for IWF Sanctions
create table if not exists iwf_sanctions (
    id uuid primary key default gen_random_uuid(),
    name text not null,
    gender text,
    nation text,
    start_date text,
    -- Text because 'RETIRED' is a possible value
    end_date text,
    -- Text because 'LIFE' is a possible value
    event_type text,
    substance text,
    sanction_year_group text,
    -- e.g. "2022", "2021"
    db_lifter_id bigint,
    -- Link to iwf_lifters.db_lifter_id (nullable)
    created_at timestamptz default now(),
    constraint unique_sanction unique (name, start_date, substance)
);
-- Add index for matching
create index if not exists idx_iwf_sanctions_name_nation on iwf_sanctions (name, nation);