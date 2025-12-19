# Project Purpose
The Weightlifting Database project is a system for scraping, storing, and analyzing USA Weightlifting (USAW) competition data. It includes tools for scraping meet metadata, individual results, and athlete profiles, and storing them in a Supabase database.

# Tech Stack
- **Runtime**: Node.js
- **Database**: Supabase (PostgreSQL)
- **Scraping**: Puppeteer, Cheerio
- **Automation**: GitHub Actions
- **Data Processing**: CSV (csv-parser, csv-writer, papaparse), Turf.js (geospatial)
- **Environment**: dotenv for configuration

# Key Tables
- `usaw_meets`: Competition metadata (meet_id, name, date, location, etc.)
- `usaw_lifters`: Athlete profiles (lifter_id, name, membership number, etc.)
- `usaw_meet_results`: Individual performance data linked to meets and lifters.
- `usaw_clubs`: Club information.

# Development Workflow
- Daily scrapes are automated via GitHub Actions.
- Manual scripts exist for maintenance, debugging, and specific data analysis tasks.
- Environment variables are stored in `.env`.
