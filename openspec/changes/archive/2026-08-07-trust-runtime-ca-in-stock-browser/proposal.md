## Why

The stock image now includes architecture-matched Google Chrome, but Chrome cannot navigate HTTPS through microsandbox because the runtime interception CA is installed in the system trust store and not Chrome's NSS shared database. Browser-capable agents therefore encounter `ERR_CERT_AUTHORITY_INVALID` until someone manually installs NSS tooling, imports the CA, and restarts Chrome.

## What Changes

- Install the NSS certificate tooling required to manage Chrome's Linux shared trust database in the stock image.
- Add an idempotent stock bootstrap stage that imports runtime-provided local CA certificates into the NSS database Chrome will use after trusted personal bootstrap establishes user certificate state and before project or user commands can start a browser.
- Preserve existing legacy NSS databases when present; otherwise initialize Chrome's current default NSS database location.
- Replace wrapper-owned certificate entries when their source certificates change, while treating an empty local CA directory as a clean no-op.
- Keep certificate verification enabled; do not use global ignore-certificate-errors flags or agent-specific launch configuration.
- Advance the stock image generation and document that existing stock sandboxes must be recreated to receive the browser trust bootstrap.
- Verify the observable contract with a fresh-sandbox Chrome HTTPS smoke scenario rather than executable presence alone.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `stock-sandbox-image`: Strengthen stock browser support so native Chrome trusts runtime-provided local CAs and can navigate allowed HTTPS destinations through microsandbox networking without disabling certificate verification.

## Impact

- `src/stock-image/Containerfile`: NSS tooling dependency and stock generation content.
- `src/stock-image/mise-msb-bootstrap`: browser trust initialization and idempotent certificate replacement.
- `src/msb/lifecycle.ts`: stock bootstrap ordering before personal and project bootstrap.
- `src/stock-image/constants.ts`: stock image generation bump.
- `tests/stock-image.test.ts` and `tests/lifecycle.test.ts`: image content, bootstrap behavior, and stage-order coverage.
- `docs/usage.md`: browser trust behavior and stock image migration guidance.
- Fresh stock images grow by the `libnss3-tools` package; custom images remain responsible for their own browser and certificate integration.
