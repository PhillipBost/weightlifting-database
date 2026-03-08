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
