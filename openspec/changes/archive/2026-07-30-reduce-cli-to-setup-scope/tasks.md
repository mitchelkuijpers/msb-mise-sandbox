## 1. Reduce the CLI surface

- [x] 1.1 Remove `run`, `shell`, `exec`, `start`, `stop`, `remove`/`rm`, and `list`/`ls` from dispatch and usage output.
- [x] 1.2 Delete selected command entry modules that have no remaining callers while preserving shared provisioning helpers.

## 2. Verify the public contract

- [x] 2.1 Add or update CLI dispatch tests for the retained surface and rejection of every removed command and alias.
- [x] 2.2 Run `bun test` and inspect CLI help to confirm only the retained commands are exposed.
- [x] 2.3 Run `openspec validate reduce-cli-to-setup-scope --strict`.
