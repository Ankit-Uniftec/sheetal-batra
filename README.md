Copy-paste template for your next "apply everywhere" task:

TASK: Add <filter X> to every list/table view in the app.

1. SCOPE FIRST — no edits. Grep for all rendering sites (pages, tabs,
   modals, nested routes). Write the full checklist to SCOPE.md with counts.
2. Wait for my approval of the scope.
3. Prefer changing the shared component over per-file duplication.
4. Implement every item, checking off SCOPE.md as you go.
5. VERIFY: typecheck + tests + a grep proving no site was missed.
   Show me the command output.
6. Then use a subagent to review the diff against SCOPE.md for gaps.


Before you stop, ask for a handoff note:

Stop here. Write HANDOFF.md with:
- what's done (mark SCOPE.md checkboxes)
- what's in progress and the exact file/line you stopped at
- what's next, in order
- decisions we made and why (so you don't re-litigate them)
- known broken things / failing tests right now
- the exact commands to verify state