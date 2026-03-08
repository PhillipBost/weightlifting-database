# Current Security Warnings

> [!IMPORTANT]
> Generated: 2026-02-09
> Total Warnings: **36** (Was 41)

## Function Search Path Mutable (7 warnings)

Functions where `search_path` parameter is not set, allowing potential security risks.

### High Risk - Access Tables (7 functions - CANNOT SECURE)

1. **search_athletes** - Reads `lifters`, `meet_results` tables
2. **is_admin** (SECURITY DEFINER) - Reads `profiles` table
3. **handle_new_user** (SECURITY DEFINER) - Writes to `profiles` table
4. **calculate_ytd_best** - Reads `meet_results` table
5. **recalculate_lifter_analytics** - Reads/writes `meet_results` table
6. **calculate_meet_result_analytics** - Calls `calculate_ytd_best` (inherits table access)
7. **calculate_and_set_analytics** - Calls `calculate_meet_result_analytics` (inherits risk)

**Status:** Must skip. Setting `search_path = ''` breaks these functions.

### Resolved (5 functions - SECURED)

These functions have been secured with `search_path = public` (Fixed).

1. **update_updated_at_column**
2. **update_clubs_analytics_timestamp**
3. **update_wso_analytics_updated_at**
4. **handle_manual_override**
5. **calculate_competition_age**

---

## RLS Policy Always True (8 warnings)

Tables with overly permissive RLS policies using `USING(true)`:

1. **lifters** - Policies: "Allow all access to lifters", "Full anon access"
2. **meet_locations** - Policies: "Allow all access to meet_locations", "Full anon access"  
3. **meet_results** - Policies: "Allow all access to meet_results", "Full anon access"
4. **meets** - Policies: "Allow all access to meets", "Full anon access"

**Impact:** Effectively bypasses RLS for these tables.

---

## RLS Enabled No Policy (4 warnings)

Tables with RLS enabled but no policies defined:

1. **club_rolling_metrics**
2. **clubs**
3. **wso_information**
4. **youth_factors**

**Impact:** Tables are inaccessible until policies are added.

---

## Auth Configuration (1 warning)

**Leaked Password Protection Disabled**

- HaveIBeenPwned.org password checking is currently disabled

---

## Database Version (1 warning)

**Vulnerable Postgres Version**

- Current: `supabase-postgres-17.4.1.064`
- Status: Security patches available
- Action: Upgrade database

---

## Summary

| Category | Count | Status |
|----------|-------|--------|
| Function Search Path (table access) | 7 | Skipped (High Risk) |
| Function Search Path (fixed) | 5 | **Resolved** |
| RLS Policy Always True | 8 | Pending |
| RLS Enabled No Policy | 4 | Pending |
| Auth Config | 1 | Pending |
| Database Version | 1 | Pending |
| **TOTAL REMAINING** | **36** | |

**Note:** We have successfully secured 5 trigger functions. The remaining 7 functions cannot be easily secured without refactoring. The other 29 warnings require different approaches.
