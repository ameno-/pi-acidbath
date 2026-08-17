# Context Budget

Govern session length and token spend.

## Rules

1. **Restart at task boundaries** — Session length is the largest lever. Don't carry old transcript through the next task.
2. **Keep the payload small** — Load skills, runbooks, and docs only when triggered by the task.
3. **Use the hard read budget** — Read no more than 120-line slices. One file per call unless comparing tiny snippets.
4. **Route reconnaissance to a lighter lane** — Send file discovery, symbol lookup, and status checks to a lighter model.
5. **Deduplicate reads** — Before re-reading a file, check whether the prior slice already answered the question.
