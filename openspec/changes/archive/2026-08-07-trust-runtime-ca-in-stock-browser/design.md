## Context

See `proposal.md` for motivation. The stock Ubuntu 24.04 image installs Google Chrome from Google's architecture-specific stable Debian package. Microsandbox terminates and re-signs outbound TLS with a runtime CA; it places that CA among Debian's local certificate authorities and updates the system bundle, so curl and other OpenSSL clients trust intercepted connections. Chrome on Linux instead reads locally managed roots from an NSS shared database, so the system bundle alone is insufficient.

Chrome M146 and later default to `$HOME/.local/share/pki/nssdb`, but continue using the legacy `$HOME/.pki/nssdb` when it already exists. Browser agents may use generated `--user-data-dir` profiles, but those profiles still share this home-level NSS database. The runtime CA is unavailable while the OCI image is built, so trust must be established after sandbox creation and before the agent starts Chrome.

The stock lifecycle currently runs Docker readiness, trusted personal bootstrap, and project bootstrap after creation. Trusted personal bootstrap may establish an existing NSS database or personal trust entries; stock browser trust therefore needs to run after that stage and before project bootstrap and user execution.

## Goals / Non-Goals

**Goals:**

- Align stock Chrome's locally managed CA trust with the runtime/local CA trust already available to system TLS clients.
- Preserve certificate verification and unrelated personal NSS entries.
- Select the same modern or legacy NSS database Chrome will use.
- Make initialization deterministic, repeatable, rotation-safe, and observable in printed lifecycle plans.
- Keep the behavior confined to stock image mode and complete it before untrusted project or user execution.

**Non-Goals:**

- Implement or configure microsandbox TLS interception in the wrapper.
- Copy CA private keys or host credentials into the sandbox.
- Modify public Chrome root trust or bypass certificate validation.
- Configure browsers supplied by custom images.
- Bundle or integrate Firefox.

## Decisions

### Install NSS tooling in the stock image and import trust at runtime

Add Ubuntu's `libnss3-tools` package alongside the stock prerequisites so the runtime helper can use `certutil`. The image build verifies that Chrome is executable, but does not import a CA because the microsandbox CA is supplied only when the sandbox is created.

A dedicated browser-trust subcommand in the stock bootstrap helper performs the import. The lifecycle invokes it after trusted personal bootstrap and before project bootstrap. This ordering lets personal bootstrap establish or migrate NSS state first, while ensuring committed project code and the eventual agent process see the completed trust database.

Alternatives considered:

- Baking the CA into the image cannot support runtime-specific or rotated CAs.
- Personal dotfiles repeat stock-runtime knowledge for every user and allow the bundled browser contract to regress unnoticed.
- Agent launch flags require every agent integration to rediscover the issue.
- A Chrome executable wrapper performs hidden mutation at launch, can race concurrent launches, and depends on browser path discovery.

### Import only locally supplied CA files

The helper reads individual `*.crt` files from Debian's local CA directory, `/usr/local/share/ca-certificates`, rather than importing the complete public system bundle. This covers the microsandbox interception root and other operator/runtime-installed local roots while leaving Chrome's public root program untouched.

Each imported certificate receives a wrapper-owned nickname derived deterministically from its filename and SSL CA trust attributes `C,,`. Wrapper ownership allows refresh and removal decisions without altering unrelated personal entries. The helper never imports private key material.

Importing only a hard-coded `microsandbox-ca.crt` was considered, but it couples the stock image to one runtime filename and would not align Chrome with additional local roots already trusted by the operating system. Importing every certificate under `/etc/ssl/certs` was rejected because it duplicates the public root bundle and traverses generated links rather than the operator-owned source directory.

### Follow Chrome's NSS database selection rules

If the legacy `$HOME/.pki/nssdb` already exists after personal bootstrap, the helper updates it because current Chrome preferentially continues using that database. Otherwise it initializes and uses `$HOME/.local/share/pki/nssdb`, the default since Chrome M146. Database initialization uses an empty password because the database contains public trust anchors and must be readable non-interactively by stock Chrome.

The database lives outside generated browser user-data directories, so an agent can recreate its browser profile without losing local CA trust. The stock image currently runs as root, but the helper resolves the executing user's home rather than embedding a profile-specific path.

Creating only the legacy path was rejected because it would force new Chrome installations onto a compatibility location. Creating both paths was rejected because the mere presence of the legacy database changes which database Chrome selects and can split personal trust state.

### Replace owned entries deterministically

For each local CA file, the helper removes any existing entry under the corresponding wrapper-owned nickname and imports the current certificate. A missing prior entry is an expected condition; certificate parsing, database initialization, deletion errors other than absence, and import failures remain fatal. Repeating the stage therefore converges on the current local certificates without duplicate nicknames and refreshes a rotated certificate.

If no local `*.crt` files exist, the stage exits successfully without creating trust entries or changing Chrome flags. This keeps stock sandboxes usable when microsandbox does not install a local interception root.

Hash-only nicknames were considered, but rotation would leave stale entries because each new certificate would have a new identity. A stable filename-derived nickname gives the wrapper an explicit replacement boundary.

### Treat trust setup as a stock lifecycle compatibility guarantee

The browser-trust stage is included only in stock mode and appears in print mode in execution order. A non-empty local CA set that cannot be applied blocks project bootstrap and user execution with a stage-specific error. Silently continuing would recreate the original delayed `ERR_CERT_AUTHORITY_INVALID` failure and make the stock browser guarantee unreliable.

The stock image generation advances from v5 to v6 because existing loaded v5 images lack both `certutil` and the updated helper. Existing named sandboxes must be stopped, removed, and recreated after setup loads v6; stop/start alone retains the old root filesystem.

Globally passing `--ignore-certificate-errors`, disabling Chrome's root-store behavior, or suppressing bootstrap failures were rejected because each hides the trust mismatch instead of establishing the intended CA trust.

## Risks / Trade-offs

- [A malformed local CA blocks stock creation] → Fail with the source certificate and NSS database in diagnostics; an invalid trust source is a runtime configuration error, not a condition to hide until browser launch.
- [Personal bootstrap creates or changes NSS state] → Run browser trust after personal bootstrap and select the database at that point; modify only wrapper-owned nicknames.
- [Chrome changes its Linux trust database rules again] → Keep database selection isolated in the helper and cover both the documented modern default and existing legacy database behavior.
- [Filename collisions produce nickname collisions] → Use deterministic nicknames based on each relative local-CA filename; the source directory is flat under Debian's CA convention.
- [Local CA trust expands Chrome's interception surface] → Import only roots the runtime or operator has already installed as local system trust, keep verification enabled, and never import private keys.
- [`libnss3-tools` increases image size] → Accept the small package cost as part of making the already bundled browser operational.
- [Existing v5 named sandboxes remain broken] → Bump the stock generation and document explicit recreation; do not attempt in-place mutation of old root filesystems.

## Migration Plan

1. Build and load stock image generation v6 through `mise-msb setup`.
2. Stop and remove existing v5 named sandboxes, preserving their named mise and Docker volumes.
3. Recreate each stock sandbox so the v6 helper imports the runtime local roots before project bootstrap.
4. Smoke-test native Chrome against an allowed HTTPS destination and assert destination content rather than process exit alone.

Rollback uses the existing versioned-image mechanism: restore generation v5, rerun setup, and recreate affected sandboxes. The rollback also removes the stock browser HTTPS guarantee; no persistent host data format changes are involved.
