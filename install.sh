#!/usr/bin/env bash
# ClaudeSave installer for macOS / Linux
# Usage: curl -sSL claudesave.io/install.sh | bash

set -e

GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo ""
echo -e "${CYAN}ClaudeSave Installer${NC}"
echo -e "${CYAN}====================${NC}"
echo ""

# 1. Check Node
if ! command -v node >/dev/null 2>&1; then
  echo -e "${RED}[X] Node.js not found. Install from https://nodejs.org${NC}"
  exit 1
fi
echo "[OK] Node detected: $(node --version)"

# 2. Install dir
INSTALL_DIR="$HOME/.claudesave"
mkdir -p "$INSTALL_DIR"
echo "[OK] Install dir: $INSTALL_DIR"

# 3. Install from local build or npm
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ -f "$HERE/package.json" ]; then
  echo "[..] Installing from local build..."
  cp -R "$HERE/dist" "$INSTALL_DIR/"
  cp "$HERE/package.json" "$INSTALL_DIR/"
  [ -f "$HERE/config.yaml" ] && cp "$HERE/config.yaml" "$INSTALL_DIR/"
  ( cd "$INSTALL_DIR" && npm install --omit=dev --silent )
else
  echo "[..] Installing from npm registry..."
  npm install -g claudesave --silent
fi

# 4. Create launcher
LAUNCHER="$INSTALL_DIR/claudesave"
cat > "$LAUNCHER" <<EOF
#!/usr/bin/env bash
node "$INSTALL_DIR/dist/index.js" "\$@"
EOF
chmod +x "$LAUNCHER"

# 5. PATH hint
if [[ ":$PATH:" != *":$INSTALL_DIR:"* ]]; then
  SHELL_RC="$HOME/.bashrc"
  [ -f "$HOME/.zshrc" ] && SHELL_RC="$HOME/.zshrc"
  echo "" >> "$SHELL_RC"
  echo "# ClaudeSave" >> "$SHELL_RC"
  echo "export PATH=\"\$PATH:$INSTALL_DIR\"" >> "$SHELL_RC"
  echo "[OK] Added to PATH in $SHELL_RC (restart shell)"
fi

echo ""
echo -e "${GREEN}Done! Next steps:${NC}"
echo ""
echo -e "${YELLOW}  1. Start the proxy:${NC}"
echo "       claudesave"
echo ""
echo -e "${YELLOW}  2. Set the env var (new terminal):${NC}"
echo "       export ANTHROPIC_BASE_URL=http://localhost:8019"
echo ""
echo -e "${YELLOW}  3. Use Claude Code normally. See savings at:${NC}"
echo "       http://localhost:8019/dashboard"
echo ""
