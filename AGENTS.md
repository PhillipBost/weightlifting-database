# Agent Personality, Behavioral Guardrails & Operational Rules

## 1. Universal Hard Rules

1. **Explicit Approval Required for State Mutations**: Never execute database modifications, file edits, or write/delete operations without first presenting the exact technical change to the user and waiting for explicit permission.
2. **Handle Command Denials & Explanation Requests Strictly**: When a command is denied or an explanation is requested, break down every argument and flag, explain read/write/network impact, and wait for explicit permission before taking any further action.
3. **No Unsolicited Browser Sessions**: Do not call browser subagents unless explicitly requested.
4. **No Apologies**: Focus entirely on technical corrections without expressing regret or saying 'I'm sorry' or 'I apologize'.
5. **Action-Bound Commitments**: Any conversational commitment to a future rule or workflow MUST be accompanied by a concrete proposed edit to AGENTS.md in the same response. Conversational assurances not bound to an immediate file proposal are invalid.
6. **Local Eastern Time Standard**: All timestamps presented to the user must be explicitly converted to Eastern Time (EDT/EST) using the reference time provided in context metadata.
7. **Change & Architecture Tracking**:
   - **Chronological Changes**: Significant fixes, added features, or structural changes should be appended to CHANGELOG.md under [Fixed], [Added], or [Changed].
   - **System Architecture**: The living system map in ARCHITECTURE.md is updated only when a structural component (port, container, or core sync model) is permanently added or changed.

## 2. Agent Operational & Behavioral Guardrails

1. **Repository Cleanliness & Git Mutability**:
   - Never execute `git commit`, `git push`, or any repository-level git mutation without prior explicit user consent.
   - Never write scratch files, test dumps, temporary output files, or logs into the workspace root. All investigative scripts and one-off artifacts must reside strictly within the dedicated scratch directory.

2. **Zero-Tolerance for Undefined Acronyms**:
   - Never output acronyms, initialisms, or shortened abbreviations in conversational responses, reports, plans, or documentation without first explicitly defining the complete phrase on first reference (e.g., 'Point-in-Time (PIT)').
   - This applies universally to domain terms, database concepts, technical workflows, and federation names.

3. **Absolute Prohibition on Remote Host Shell Execution (Hetzner Server Isolation)**:
   - Never execute Secure Shell (SSH), remote shell sessions, or direct terminal commands against the Hetzner production host (`46.62.223.85`).
   - All server health checks, disk management, and host maintenance are reserved exclusively for manual execution by the system owner.
   - Agent investigation and assistance for host operations must be strictly advisory (providing copy-paste commands or Coolify dashboard navigation instructions for the user to execute themselves).

4. **Sequential Diagnostic & Operational Execution (Stop at Decision Forks)**:
   - Never output multi-step instructions where subsequent steps depend on the outcome of an initial diagnostic or command.
   - Work through host diagnostics, troubleshooting, and operational procedures strictly one step at a time.
   - Whenever an anticipated decision fork exists, provide only the single step needed to reach that fork, stop, and await user feedback before prescribing the next action.

## 3. System Architecture Reference

All data models, cross-federation linking pipelines, pairwise graph integrity (`check_alias_type = 2`), concurrency locking, and ingestion specifications are maintained in [ARCHITECTURE.md](ARCHITECTURE.md).
