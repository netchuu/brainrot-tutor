# MANDATORY RULES (all agents)

## COMMUNICATION
- Direct, concise, formal
- No pleasantries, apologies, or emotional language
- No preambles ("Let me...", "Sure...", "I'll help...")
- Factual accuracy is the absolute priority
- Do not acknowledge merit in incorrect statements before correcting them
- The best answer is always preferred over the most acceptable answer
- If two options exist and one is clearly better, say so - do not present both as equal
- When the user proposes a solution, evaluate it against alternatives first, then state whether it is optimal, suboptimal, or wrong - before implementing it
- If the user contradicts facts: re-assert with evidence
- Reply in the user's language; code, comments, commits and docs in English

## SCOPE
- Edit only your own folder (ownership table in the root CLAUDE.md) and only what the task needs
- Do not refactor, rename, or "improve" unrelated code
- Do not add features that are not in your plan
- If you find an issue outside your folder, report it - do not fix it

## CODEBASE FIRST
- Before adding a helper, pattern or dependency, search the repo for an existing one
- Before adding a dependency, say why no existing one covers it
- Prefer editing existing files over creating new ones
- No new .md files unless the user asks; one-line entries in `docs/decisions.md` are allowed

## CODE
- Production code only - no placeholders, stubs, TODO or FIXME
- Fixture mode and missing-asset fallbacks are features, not stubs
- No docstrings; a comment only for a non-obvious why, one line
- Specific exception and error types only; catch only what you handle; no catch-log-continue
- No secrets in code, logs, fixtures or commits; read keys from env; never open `.env` files

## CONTRACT
- `contracts/` is the single source of truth for every request, response and stream event
- Never change a field name, type, enum value or event order on one side only
- To change the contract: stop, tell the user what and why, and wait for approval
- An approved change updates `contracts/api.md`, `contracts/schemas/contract.schema.json` and the fixtures in one commit
- Run `uv run --with jsonschema python contracts/tools/validate.py` after any change, then add one line to `docs/decisions.md`

## MCP DOCUMENTATION
- Before using any third-party library API, fetch current docs via Context7 MCP (`resolve-library-id`, then `query-docs`)
- Do not write library code from memory - training data is outdated

## VERIFICATION
- Run your side's checks (listed in your plan) before declaring a task done
- If a check fails, fix it before reporting done
- Never claim completion without verification output
- Before reporting a milestone done, run the `reviewer` subagent on your diff and fix what it finds

## DESTRUCTIVE ACTIONS
- Require explicit confirmation before: deleting files, major dependency upgrades, force-push, contract changes, deploy settings changes
- Never run these autonomously even if the task implies them

## ENVIRONMENT
- Do not assume localhost in deployed code: API base URL and allowed origins come from env
- Always verify deployment context before suggesting URLs, env vars, or network config

## AGENT BUDGET
- At most 2 subagents per task, `reviewer` included; no "second opinion" agents unless the user asks
- Never stop or relaunch a running subagent; reuse its result

## MEMORY SEARCH
- When context is missing - no in-session information about a design decision, past behaviour, or architectural choice - invoke the `claude-mem:mem-search` skill before guessing
- In-session context always takes precedence over memory; memory is a fallback for gaps, not a substitute
- If in-session context and memory contradict each other, explicitly flag the inconsistency before proceeding - do not silently pick one
