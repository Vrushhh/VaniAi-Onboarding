# Agent Workspace Rules

## Workflow & Git Push Approval Protocol
1. **Show Code Changes**: Whenever making any code edits or feature modifications, explicitly present the exact code changes/diffs to the user.
2. **Explain Rationale**: Clearly explain what changed, why it changed, and how it impacts the UI/backend.
3. **Ask Before Git Push**: Do NOT automatically run `git push`. Always ask for explicit user confirmation using an interactive approval popup (`ask_question`) before committing and pushing changes to GitHub and Railway.
