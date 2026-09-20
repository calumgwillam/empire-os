# Empire OS — Copilot Instructions

Empire OS is a long-term operating system. Preserve stability, data integrity, and existing behaviour unless the task explicitly requires a change.

## Working rules

- Make code changes only unless explicitly asked otherwise.
- Do not run terminal commands.
- Keep implementations tightly scoped to the requested feature or bug.
- Inspect existing logic before changing it; do not assume architecture or data flow.
- Do not redesign or refactor unrelated areas.
- Prefer the smallest robust change over broad restructuring.
- Preserve existing behaviour outside the requested scope.
- Never hard-code a specific record, person, action, date, or business example to make a bug appear fixed when the underlying logic should be generic.
- Preserve backward compatibility with existing localStorage data.
- When adding or changing stored fields, handle legacy records safely and avoid data loss.
- Be especially careful with hydration/load/save effects so default state cannot overwrite persisted data before loading completes.
- Reuse established helpers, state patterns, validation, and UI conventions where appropriate.
- Do not duplicate logic when an existing generic mechanism can be extended safely.
- Keep TypeScript types explicit and consistent with the existing model.
- Do not silently invent business data or fill missing operational information.

## Implementation discipline

Before editing:
1. Identify the exact code path responsible.
2. Check related callers, derived state, persistence, and downstream ranking/reporting logic.
3. Make the smallest change that fixes the root cause.

After editing:
- Summarize the exact cause or requirement addressed.
- State exactly what changed.
- Identify which code paths are affected.
- Identify important code paths intentionally left unchanged.
- Mention any migration or backward-compatibility behaviour.

Do not run validation commands. ChatGPT/user will independently run TypeScript, build, diff checks, browser testing, and Git operations.