## Why

Stock sandboxes currently invoke `mise install` for the personal stage, so mise directives such as `[bootstrap.packages]`, repositories, dotfiles, and hooks are silently skipped even though the personal-bootstrap contract promises full provisioning. The stock image also omits `/root/.local/bin` from `PATH`, making binaries installed by user-level bootstrap commands unavailable without absolute paths.

## What Changes

- Run the personal stage with `mise bootstrap` from its existing neutral working directory so it applies bootstrap directives and installs `[tools]` in one convergent operation.
- Keep project tool provisioning as a separate `mise install` stage with its existing lockfile behavior and project context.
- Add `/root/.local/bin` to the stock image `PATH`, after mise-managed paths and before system paths.
- Bump the stock image generation so setup builds and loads an image containing the corrected helper and PATH.
- Strengthen regression tests, update the documented stock image version and personal-bootstrap example, and document the sandbox recreation needed to adopt the new image generation.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `stock-sandbox-image`: require stock sandboxes to expose `/root/.local/bin` on `PATH` while preserving mise-managed path precedence.

The existing `personal-sandbox-bootstrap` requirement already mandates packages, repositories, dotfiles, tools, and hooks; changing the helper from `mise install` to `mise bootstrap` fixes implementation conformance without changing that requirement.

## Impact

- **Runtime image**: `src/stock-image/Containerfile`, `src/stock-image/mise-msb-bootstrap`, and the stock image generation constant.
- **Tests**: stock-image assertions and full Bun test-suite verification.
- **Documentation**: stock image generation, personal bootstrap syntax and behavior, and recreation guidance for existing sandboxes.
- **Operations**: users run `mise-msb setup` to load the new generation and recreate existing stock sandboxes; persistent mise and Docker named volumes remain preserved.
