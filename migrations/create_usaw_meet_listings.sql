-- Migration: Create usaw_meet_listings table
-- Captures Sport80 meet announcements/listings, separate from actual meet results
BEGIN;
create table IF NOT EXISTS public.usaw_meet_listings (
    listing_id serial not null,
    meet_name text not null,
    event_date text null,
    meet_type text null,
    address text null,
    organizer text null,
    contact_phone text null,
    contact_email text null,
    registration_open text null,
    registration_close text null,
    entries_on_platform text null,
    has_entry_list boolean null default false,
    meet_id integer null,
    first_discovered_at timestamp without time zone null default now(),
    last_seen_at timestamp without time zone null default now(),
    last_scraped_at timestamp without time zone null,
    meet_match_status text null,
    meet_description text null,
    entry_count integer null default 0,
    start_date date null,
    end_date date null,
    constraint usaw_meet_listings_pkey primary key (listing_id),
    constraint usaw_meet_listings_unique_name_date unique (meet_name, event_date),
    constraint usaw_meet_listings_meet_id_fkey foreign KEY (meet_id) references usaw_meets (meet_id) on delete
    set null
);
create index IF not exists idx_meet_listings_meet_id on public.usaw_meet_listings (meet_id);
create index IF not exists idx_meet_listings_has_entry_list on public.usaw_meet_listings (has_entry_list);
create index IF not exists idx_meet_listings_unmatched on public.usaw_meet_listings (meet_id)
where (meet_id is null);
create index IF not exists idx_meet_listings_event_date on public.usaw_meet_listings (event_date);
create index IF not exists idx_meet_listings_start_date on public.usaw_meet_listings (start_date);
create index IF not exists idx_meet_listings_end_date on public.usaw_meet_listings (end_date);
-- Enable RLS
ALTER TABLE public.usaw_meet_listings ENABLE ROW LEVEL SECURITY;
-- Policy: Allow read access to authenticated users
CREATE POLICY "Allow read access to authenticated users" ON public.usaw_meet_listings FOR
SELECT TO authenticated USING (true);
-- Policy: Allow insert/update for service role
CREATE POLICY "Allow insert/update for service role" ON public.usaw_meet_listings FOR ALL TO service_role USING (true) WITH CHECK (true);
COMMIT;