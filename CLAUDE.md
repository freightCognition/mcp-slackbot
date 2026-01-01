# CLAUDE.md Guidelines

## Scope
This file applies to the entire repository.

## Development Notes
- Keep the Slack Bolt Socket Mode flow intact, including modal-driven `/mcp` interactions.
- Preserve the `lib/riskFormatter` helper for formatting risk assessment blocks.
- When modifying modal UX, ensure loading, success, and error states are reflected in the Slack view.
- Prefer updating or adding lightweight Node tests (`npm run test:format`) when adjusting helpers or modal behavior.
