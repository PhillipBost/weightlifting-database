# GitHub Actions Documentation

This document provides a one-page overview of the automated workflows in this repository.

## 📅 Daily Schedule (Chronological EST)

| EST Time | UTC Time | Workflow Name | Primary Purpose | Estimated Duration |
|---|---|---|---|---|
| **3:00 AM** | 8:00 AM | `usaw-daily-division-scraper` | Scrapes athlete lists by division (rotates daily) | ~3 hours |
| **4:00 AM** | 9:00 AM | `usaw-daily-data-quality-improvement-pipeline` | Integrity checks & self-healing (Member IDs, WSO fixes) | ~30-60 mins |
| **12:00 PM** | 5:00 PM | `usaw-daily-discovery-pipeline` | **Discovery Phase**: Finds new meets & processes locations | ~20-60 mins |
| **4:00 PM** | 9:00 PM | `usaw-daily-wso-club-directory-pipeline` | **Deep Scraping**: Meet addresses & Club directory | ~6 hours (max) |
| **5:00 PM** | 10:00 PM | `usaw-daily-iwf-results-pipeline` | Scrapes international (IWF) events | ~2 hours |
| **10:30 PM** | 3:30 AM* | `usaw-daily-geospatial-analytics-pipeline` | **Analytics Phase**: WSO assignment & Rolling metrics | ~2 hours |

*UTC time is the following day.

---

## 🛠️ Workflow Details

### 1. USAW Daily Discovery Pipeline
- **File:** `.github/workflows/usaw-daily-discovery-pipeline.yml`
- **What it does:**
    - **Meet Scraper:** Finds *newly* posted meets.
    - **Missing WSO Scan:** Flags meets that need WSO assignment.
    - **Location Processing:** Geocodes addresses for new meets.

### 2. USAW Daily Division Scraper
- **File:** `.github/workflows/usaw-daily-division-scraper.yml`
- **What it does:** Scrapes athlete data from USA Weightlifting by iterating through Division IDs.
- **Schedule:** Rotates through divisions based on the day of the week (e.g., Monday = Divs 1-36, Tuesday = Divs 37-72).
- **Target:** Ensures all athlete data is refreshed weekly.

### 3. USAW Daily Data Quality Improvement Pipeline
- **File:** `.github/workflows/usaw-daily-data-quality-improvement-pipeline.yml`
- **What it does:** Runs health checks on the database.
    - **Missing Membership Scan:** Finds athletes without membership numbers.
    - **WSO Cleanup:** Fixes meets assigned to the wrong WSO.
    - **Internal ID Pipeline:** Assigns internal IDs to new records.
- **Why it matters:** Keeps the database clean and self-heals common data issues.

### 4. USAW Daily WSO & Club Directory Pipeline
- **File:** `.github/workflows/usaw-daily-wso-club-directory-pipeline.yml`
- **What it does:** Collects heavy metadata that doesn't change as often as meet results.
    - **Meet Addresses:** Scrapes physical addresses for meets (needed for WSO assignment).
    - **Clubs:** Scrapes the full club directory.
- **Note:** This acts as a feeder for the analytics pipeline that runs later in the night.

### 5. USAW Daily Geospatial & Analytics Pipeline
- **File:** `.github/workflows/usaw-daily-geospatial-analytics-pipeline.yml`
- **What it does:** Processes raw data into insights.
    - **WSO Assignment:** Assigns meets and clubs to their WSO based on geospatial boundaries.
    - **Analytics:** Calculates weekly stats (Club activity, WSO population).
    - **Rolling Metrics:** Updates 12-month rolling stats for trend analysis.
- **Timing:** Runs late at night to ensure all data collection from earlier in the day is included.

### 6. USAW Daily IWF Results Pipeline
- **File:** `.github/workflows/usaw-daily-iwf-results-pipeline.yml`
- **What it does:** Syncs international results from the IWF database.
- **Scope:** Checks for new events and results in the IWF ecosystem.

---

## ⚡ Event-Based Workflows

### Dependabot Auto-Merge
- **File:** `.github/workflows/dependabot-auto-merge.yml`
- **Trigger:** When Dependabot opens a Pull Request.
- **Action:** Automatically approves and merges PRs if they pass tests and are labeled as safe/security updates.
