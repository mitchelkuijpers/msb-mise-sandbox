# Mise OCI Experiment

This experiment evaluates `mise oci` as an alternative to the conventional
`Containerfile` for building the agent sandbox image.

## Status

**Experimental.** `mise oci` is an experimental mise feature that builds OCI
container images directly from `mise.toml`. It is not the primary build method
for the agent sandbox. The conventional `Containerfile` at the project root is
the stable, supported build path.

## What is mise oci?

`mise oci build` generates an OCI image from a `mise.toml` config file. Each
tool version becomes its own content-addressable OCI layer. Bumping a tool
version only invalidates that tool's layer — other tools, the base image, and
config are reused unchanged.

The feature requires `MISE_EXPERIMENTAL=1` or `mise settings experimental=true`.

## Evaluation Results

| Criterion | Result | Notes |
|---|---|---|
| Podman compatibility | Yes | Output consumable via `skopeo copy` or `mise oci run --engine podman` |
| Custom Ubuntu base | Yes | `--from ubuntu:24.04` or `[oci].from` |
| OS packages (apt) | Yes | `[bootstrap.packages]` with `"apt:pkg" = "latest"` (apt only) |
| Image loading workflow | Extra step | `skopeo copy oci:./dir containers-storage:...` (podman load expects tar) |
| Build caching | Layer dedup | Content-addressable layers; reproducible on same host |
| Apple Silicon | Problematic | Must build on Linux host — macOS binaries are host-native, fail with `Exec format error` |
| Layer reuse | Yes | Per-tool layers; swapping one tool only invalidates that layer |
| Root as default user | Yes | Omit `[oci].user`; `--owner 0:0` default |
| Persistent /root volume | Works | Volume shadows image content (same as Containerfile approach) |
| Env/entrypoint config | Yes | `[oci]` section supports `env`, `entrypoint`, `cmd`, `workdir` |

## Key Limitations

1. **No cross-platform builds**: Must build on a Linux host. On macOS, the
   image contains host-native (darwin/arm64) binaries that fail inside the
   container. Workaround: build inside a Linux container.
2. **apt only**: No dnf, apk, pacman, or brew for system packages.
3. **No authenticated base pulls**: `--from` only supports anonymous registry
   pulls.
4. **No bootstrap tasks**: `[system.defaults]` and bootstrap tasks are not
   executed during OCI builds.
5. **Active development**: Flags and output layout may change between versions.

## Build Workflow (on a Linux host or inside a Linux container)

```bash
# Enable experimental mode
export MISE_EXPERIMENTAL=1

# Build the OCI image layout
mise oci build --from ubuntu:24.04 --tag agent-dev:latest -o ./mise-oci-output

# Load into Podman via skopeo
skopeo copy oci:./mise-oci-output containers-storage:localhost/agent-dev:latest

# Verify
podman images | grep agent-dev

# Run
podman run -it localhost/agent-dev:latest bash
```

## Building on macOS

On macOS, you must build inside a Linux container:

```bash
# Build inside a Linux container that has mise installed
podman run --rm -v "$PWD:/src" -w /src debian:bookworm bash -c '
  apt-get update && apt-get install -y curl ca-certificates
  curl https://mise.run | sh
  export MISE_EXPERIMENTAL=1
  mise oci build --from ubuntu:24.04 --tag agent-dev:latest -o ./mise-oci-output
'

# Load the output into Podman
skopeo copy oci:./mise-oci-output containers-storage:localhost/agent-dev:latest
```

Note: `skopeo` must be installed on the host or inside the Podman machine.

## Comparison with Containerfile

| Aspect | Containerfile | mise oci |
|---|---|---|
| Maturity | Stable | Experimental |
| macOS build | Direct | Requires Linux container |
| OS packages | Full apt in RUN | `[bootstrap.packages]` (apt only) |
| Entrypoint | ENTRYPOINT directive | `[oci].entrypoint` |
| Layer caching | Dockerfile layer cache | Per-tool content-addressable layers |
| Custom scripts | Full RUN commands | Limited (no bootstrap tasks) |
| Root seeding | Entrypoint script | Would need `[oci].entrypoint` + external seeding |

## Conclusion

The conventional `Containerfile` remains the primary build method. It provides
full control over the image, including the entrypoint seeding logic that
handles the `/root` volume shadow problem. `mise oci` is promising for the
future (especially per-tool layer reuse), but the macOS build limitation and
experimental status make it unsuitable as the primary method today.

This experiment should be revisited when:
- mise oci reaches stable status
- Cross-platform builds are supported
- Bootstrap tasks are supported in OCI builds
