## Why

The stock sandbox has no native browser, so browser-capable agents must download one at runtime; on arm64, Chrome-for-Testing fallback can resolve to an incompatible x86-64 executable. Bundling an architecture-matched browser makes browser automation available immediately and consistently to any agent running in the sandbox.

## What Changes

- Install native Google Chrome packages for both amd64 and arm64 stock images and verify the executable during the image build.
- Bump the stock image generation to 5 so existing installations rebuild instead of reusing a browserless image.
- Document the browser as general agent infrastructure rather than tying it to one agent implementation.
- Do not bundle Firefox: the current automation integrations use Chrome DevTools Protocol, while a second browser would materially increase image size without a supported execution path.

## Capabilities

### New Capabilities
<!-- None: this extends the existing stock image capability. -->

### Modified Capabilities
- `stock-sandbox-image`: The versioned stock image includes native Google Chrome on amd64 and arm64 for agent browser automation.

## Impact

- `src/stock-image/Containerfile`: Downloads and installs the package matching the image architecture.
- `src/stock-image/constants.ts`: Advances the image generation to 5.
- `tests/stock-image.test.ts`: Covers the bundled-browser build contract.
- `docs/usage.md`: Documents the v5 browser runtime and migration steps.
