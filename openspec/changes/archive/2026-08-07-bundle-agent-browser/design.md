## Context

The Ubuntu 24.04 stock image does not include a browser. Browser-capable agents therefore depend on runtime downloads, and the available Chrome-for-Testing fallback can select an x86-64 executable in an arm64 sandbox. The image is built for amd64 and arm64 and must remain usable without snapd.

## Goals / Non-Goals

**Goals:**
- Provide a native browser executable on both supported stock-image architectures.
- Let browser-capable agents discover and launch the browser without per-project provisioning.
- Force existing installations to rebuild the changed stock image.

**Non-Goals:**
- Bundle every browser engine.
- Add or modify an agent-specific browser integration.
- Manage browser profiles or persistent browser state.

## Decisions

- Install Google Chrome's architecture-specific Debian package selected from `dpkg --print-architecture`. Ubuntu's `chromium-browser` package is a snap transition package and is unsuitable for this image because the sandbox does not run snapd.
- Support only `amd64` and `arm64`, matching the stock image's supported architectures, and fail the image build explicitly for any other architecture.
- Verify `google-chrome --version` during the build so an unavailable or invalid package fails setup rather than producing a browserless image.
- Do not bundle Firefox. Current agent browser automation uses Chrome DevTools Protocol and system Chrome discovery; Firefox would materially increase the image without a supported execution path. A future change can add it when an agent integration requires Firefox.
- Advance the stock image generation to 5 so warm setup cannot reuse generation 4.

## Risks / Trade-offs

- Chrome and its GUI libraries increase the compressed image size and setup download time.
- The `current` package URL makes rebuilds track Google's stable release rather than a fixed browser version; this provides security updates but reduces byte-for-byte reproducibility.
- Availability of the package URL is now a setup-time dependency, and either architecture can fail independently if Google changes distribution support.
