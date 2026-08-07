## 1. Stock Browser Trust Bootstrap

- [x] 1.1 Add `libnss3-tools` to the stock Ubuntu image prerequisites so `certutil` is available at sandbox creation time
- [x] 1.2 Add a browser-trust bootstrap command that selects an existing legacy NSS database or the modern default, initializes it when absent, and treats an empty local CA directory as a clean no-op
- [x] 1.3 Import each local `*.crt` certificate with a deterministic wrapper-owned nickname and SSL CA trust, preserving unrelated entries while making repeated and rotated imports converge
- [x] 1.4 Report certificate source and NSS database context on initialization or import failures and exit non-zero without disabling Chrome certificate verification

## 2. Lifecycle and Image Generation

- [x] 2.1 Add the stock browser-trust stage after trusted personal bootstrap and before project bootstrap in executable and printed creation plans
- [x] 2.2 Keep the browser-trust stage out of custom image mode
- [x] 2.3 Advance the stock image generation from v5 to v6 so setup cannot reuse an image without NSS tooling and the trust helper

## 3. Behavioral Coverage

- [x] 3.1 Add bootstrap tests for modern and pre-existing legacy NSS database selection, preservation of unrelated entries, repeat execution, certificate rotation, and an empty local CA directory
- [x] 3.2 Add bootstrap failure tests proving malformed or unimportable local certificates fail with actionable context before later stages
- [x] 3.3 Add lifecycle tests proving browser trust runs after personal bootstrap and before project bootstrap, appears in print mode, and is absent for custom images
- [x] 3.4 Update stock image tests for the NSS tooling dependency, browser-trust helper availability, and generation v6

## 4. Documentation and Verification

- [x] 4.1 Update browser and migration documentation to describe automatic local CA trust, retained certificate verification, and the need to recreate existing v5 sandboxes while preserving named mise and Docker volumes
- [x] 4.2 Run the focused Bun tests covering stock image, bootstrap, and lifecycle behavior
- [x] 4.3 Run the project TypeScript check and strict OpenSpec validation
- [x] 4.4 Build and recreate a fresh stock sandbox, then prove native Chrome renders expected content from an allowed HTTPS destination without certificate-ignore flags
