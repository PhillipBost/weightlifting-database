# Suggested Commands

## Scraping & Importing
- `npm run scrape`: Run the 2025 meet scraper (`node scripts/production/meet_scraper_2025.js`).
- `npm run import`: Run the database importer (`node scripts/production/database-importer.js`).
- `npm run test`: Run both scrape and import.
- `npm run division-scraper`: Run the legacy division scraper.

## Maintenance & Debugging
- `node scripts/get-meet-stats.js`: Get statistics about the `usaw_meets` table.
- `node scripts/maintenance/daily_scraper.js`: Main entry point for daily scraping.

## System Commands (Windows PowerShell)
- `ls` or `Get-ChildItem`: List files.
- `cat` or `Get-Content`: Read file content.
- `grep` or `Select-String`: Search for patterns in files.
- `rm` or `Remove-Item`: Delete files.
- `mkdir` or `New-Item -ItemType Directory`: Create directories.
