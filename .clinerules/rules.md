# Project Rules

> [!IMPORTANT]
> **Brainstem Directives:** These rules are permanent and override any ephemeral instructions.

## 1. Database Operations

### 🛑 NEVER Auto-Apply SQL

- **Rule:** The user **ALWAYS** prefers to execute SQL migrations and complex queries manually.
- **Protocol:**
  1. Generate the SQL migration file.
  2. Generate a verification script.
  3. **STOP** and ask the user to run them.
  4. Do **not** use `run_command` or `supabase.rpc` to execute DDL, updates, or data modifications without explicit confirmation.
  5. Only run `SELECT` queries for analysis.

## 2. Ephemeral Artifacts

- `task.md` and `implementation_plan.md` are temporary. Consult this file (`PROJECT_RULES.md`) for permanent constraints.

## 3. Database Authority (Self-Hosted Only)

- **Rule:** The live database is the **self-hosted Supabase instance** addressed by `SUPABASE_URL` (Structured Query Language (SQL) via Kong `/pg/query`; migrations via `scripts/schema/run-migration.js`). The user runs Data Definition Language (DDL) / Data Manipulation Language (DML) manually; the agent generates files and stops.
- **Cloud tool ban:** `default.supabase-mcp-server__*` Cloud tools (`list_projects`, `execute_sql`, `get_project`, etc.) query Supabase Cloud (`*.supabase.co`) only and **never see the self-hosted instance**. They must not be used for health, status, or data questions.
- Cloud `INACTIVE` / timeout is not database health and must never produce restore/pause/billing advice. On any Cloud timeout, stop and ask the user for self-hosted output.
