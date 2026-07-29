# writable-personal-bootstrap Design

## Context

Stock-mode sandboxes mount the operator's personal bootstrap directory
(`~/.config/mise-msb/bootstrap/`, discovered by `discoverPersonalBootstrap` in
`src/bootstrap/discovery.ts`) read-only at `/etc/mise-msb/personal`, and set
`MISE_GLOBAL_CONFIG_FILE=/etc/mise-msb/personal/mise.toml`. The read-only mount
is a documented security property (`docs/security.md`), and the docs already
describe a richer `[bootstrap]` surface (packages, dotfiles, hooks) that is not
yet implemented — the dir-wide mount and recursive content hash
(`hashBootstrapDir`) exist in anticipation of it.

The ro mount breaks `mise use -g` inside sandboxes (`failed write … Read-only
file system`), which is the natural way to add a global tool. The operator wants
global writes to land on the host bootstrap file, and wants to be able to edit
bootstrap content (including future sibling files) from inside a sandbox.

Verified by spike on this machine (msb 0.6.7, `mise-msb-base:v2`, mise
2026.7.15):

- `--mount-dir <src>:/spike` (rw) + `MISE_GLOBAL_CONFIG_FILE=/spike/mise.toml`
  → `mise use -g jq@1.8.1` and `mise use -g usage@2.5.0` succeed and write
  through to the host file in place; file mode preserved; **no sibling
  lockfile or temp files created**.
- Guest-created sibling files (`/spike/guest-note.txt`) appear on the host.
- An rw **file** mount also works for current mise (it writes in place, no
  temp+rename over the mountpoint), but only for the single file.
- msb dir mounts fail with `mount …: Not a directory (os error 20)` when the
  **source path traverses a symlink** (e.g. macOS `/tmp` → `/private/tmp`).
  File mounts are unaffected. The real source `~/.config/mise-msb/bootstrap`
  is not symlinked on macOS, but Linux setups with symlinked `$HOME` or
  `XDG_CONFIG_HOME` components would hit this.

## Goals / Non-Goals

**Goals:**

- `mise use -g` works inside stock sandboxes and persists to the host
  bootstrap file.
- Guest edits to *any* file under the bootstrap dir (future dotfiles, hook
  scripts, notes) land on the host — the sandbox can be used to work on the
  bootstrap itself.
- Host-side changes keep propagating exactly as today via the existing
  content-hash / marker mechanism (no changes to hashing or bootstrap stages).
- Documentation states the new trust boundary honestly.

**Non-Goals:**

- Sync-back / promote flows, shadow copies, or per-sandbox isolation of the
  global config (considered and rejected — the operator wants
  straight-to-host writes).
- Concurrency control for simultaneous `mise use -g` from multiple sandboxes
  (last-writer-wins is accepted).
- Implementing the documented-but-unbuilt `[bootstrap]` packages/dotfiles/
  hooks processing.
- An opt-in/opt-out config knob — writability is unconditional.

## Decisions

### D1: Keep the dir mount; drop `:ro`

Change `configurePersonalBootstrap` to register the bootstrap dir mount
without options (rw is the msb default). One-line change:

```ts
config.mounts[PERSONAL_BOOTSTRAP_MOUNT_NAME] = {
  kind: "dir",
  source: personal.dir,
  target: PERSONAL_MOUNT_TARGET,
};
```

**Why dir over file mount:** a file mount (`--mount-file mise.toml:…:rw`)
works with today's mise (verified), but (a) it breaks the moment mise switches
to atomic temp+rename writes — rename over a mountpoint fails with EBUSY —
(b) it hides sibling files, defeating the "work on the bootstrap in-sandbox"
goal and the future `[bootstrap]` dotfiles/hooks design the dir mount and
recursive hash were built for. The dir mount has neither problem.

**Why unconditional rw over a config knob:** the personal bootstrap is already
modeled as trusted operator-owned code (its content runs in every sandbox).
The added risk is guest code *modifying* that trusted content; the operator
accepts this trade for the workflow it unlocks, and a knob would add config
surface for a personal preference.

### D2: Canonicalize the mount source with `realpath`

Resolve symlinks in the bootstrap dir path before registering the mount
(`realpathSync` on `personal.dir` in `configurePersonalBootstrap`), so
symlinked `$HOME`/`XDG_CONFIG_HOME` setups don't hit the msb `ENOTDIR` dir
mount failure found in the spike.

**Alternative considered:** leave as-is and document. Rejected — one line,
removes a confusing platform-specific failure.

### D3: Propagation semantics stay exactly as they are

No changes to `hashBootstrapDir`, the marker file, or bootstrap stage
planning. Guest edits mutate host content → hash changes → any sandbox's next
`exec`/`shell`/`run`/`create` re-runs `mise-msb-bootstrap personal <hash>` and
installs the new tool. The editing sandbox already has the tool because
`mise use -g` installs it immediately.

## Risks / Trade-offs

- [Sandboxed (potentially prompt-injected) code can edit host bootstrap
  content; a malicious tool added there is installed into **every** sandbox on
  next invocation — supply-chain amplification] → Accepted by the operator
  (personal bootstrap is already trusted code executed in sandboxes);
  mitigated socially by documenting the boundary in `docs/security.md` and by
  the hash mechanism making changes visible (bootstrap re-runs are observable
  in stage output).
- [Two sandboxes running `mise use -g` concurrently race on the host file —
  last-writer-wins] → Accepted; mise's in-place write keeps the file valid
  TOML for the winner's content; no corruption observed in spike.
- [Future mise version writes a sibling `mise.lock` next to the global config]
  → With a dir mount this lands in the host bootstrap dir, gets hashed, and is
  shared — harmless and consistent; no action needed (this is another point
  in favor of the dir mount over the file mount).
- [Guest can delete `mise.toml` or other bootstrap files] → Same trust
  acceptance as above; the file is operator-managed and recoverable (VCS or
  recreation); `discoverPersonalBootstrap` simply treats a missing file as "no
  personal bootstrap" on the next run.
- [Security docs previously promised ro] → `docs/security.md` is rewritten to
  describe the writable boundary explicitly rather than silently dropping the
  property.

## Migration Plan

- No data or state migration. Existing sandboxes pick up the rw mount on next
  `create`/`run` (mounts are resolved at sandbox creation); already-running
  sandboxes keep their ro mount until recreated — acceptable, no forced
  recreate.
- Rollback: restore `options: "ro"`; no persisted state depends on rw.

## Open Questions

(none — write semantics, mount kind, and unconditionally were decided with the
operator; spike evidence is captured above)
