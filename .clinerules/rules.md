# User Preferences

## SQL Execution

- **Manual Execution Only**: The user prefers to execute SQL migrations and complex queries manually (e.g., in the Supabase SQL Editor).
- **Workflow**:
  1. Generate the SQL artifact.
  2. Verify the SQL logic (if possible via read-only checks).
  3. Notify the user to run the specific SQL file.
  4. Do *not* use `run_command` or `supabase.rpc` to execute DDL or updates without explicit confirmation.
