#!/usr/bin/env bash
# Install a wrapper script for agent-sandbox into ~/.local/bin.
#
# The wrapper execs the real bin/agent-sandbox by absolute path, so
# BASH_SOURCE[0] resolves to the real script and `build` finds the build
# context (Containerfile, config/, mise.toml) next to bin/.
#
# Run from the host:  mise run install
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
REAL_SCRIPT="$PROJECT_ROOT/bin/agent-sandbox"

[[ -x "$REAL_SCRIPT" ]] || { echo "Error: bin/agent-sandbox not found at $REAL_SCRIPT" >&2; exit 1; }

DEST_DIR="${HOME}/.local/bin"
mkdir -p "$DEST_DIR"

cat > "$DEST_DIR/agent-sandbox" << EOF
#!/usr/bin/env bash
exec "$REAL_SCRIPT" "\$@"
EOF
chmod +x "$DEST_DIR/agent-sandbox"

echo "Installed agent-sandbox wrapper to $DEST_DIR"

case ":$PATH:" in
  *":$DEST_DIR:"*) ;;
  *) echo "Warning: $DEST_DIR is not in your PATH. Add it to your shell profile." ;;
esac
