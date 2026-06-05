#!/usr/bin/env bash
# TrimToken installer for macOS / Linux
set -e

GREEN='\033[0;32m'; CYAN='\033[0;36m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'

echo ""
echo -e "${CYAN}TrimToken Installer${NC}"
echo -e "${CYAN}===================${NC}"
echo ""

# 1. Node
if ! command -v node >/dev/null 2>&1; then
  echo -e "${RED}[X] Node.js nao encontrado. Instale em https://nodejs.org${NC}"
  exit 1
fi
echo "[OK] Node: $(node --version)"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_DIR="$HOME/.trimtoken"

if [ ! -f "$HERE/package.json" ]; then
  echo -e "${RED}[X] Rode este script de dentro da pasta do projeto.${NC}"
  exit 1
fi

# 2. Build
echo "[..] Instalando dependencias e compilando..."
( cd "$HERE" && npm install --silent && npm run build --silent )
if [ ! -f "$HERE/dist/index.js" ]; then
  echo -e "${RED}[X] Build falhou.${NC}"; exit 1
fi

# 3. Copia e instala deps de producao
mkdir -p "$INSTALL_DIR"
cp -R "$HERE/dist" "$INSTALL_DIR/"
cp "$HERE/package.json" "$INSTALL_DIR/"
[ -f "$INSTALL_DIR/config.yaml" ] || cp "$HERE/config.yaml" "$INSTALL_DIR/"
( cd "$INSTALL_DIR" && npm install --omit=dev --silent )
echo "[OK] Instalado em: $INSTALL_DIR"

# 4. Launcher
LAUNCHER="$INSTALL_DIR/trimtoken"
cat > "$LAUNCHER" <<EOF
#!/usr/bin/env bash
node "$INSTALL_DIR/dist/index.js" "\$@"
EOF
chmod +x "$LAUNCHER"

# 5. PATH
if [[ ":$PATH:" != *":$INSTALL_DIR:"* ]]; then
  SHELL_RC="$HOME/.bashrc"; [ -f "$HOME/.zshrc" ] && SHELL_RC="$HOME/.zshrc"
  { echo ""; echo "# TrimToken"; echo "export PATH=\"\$PATH:$INSTALL_DIR\""; } >> "$SHELL_RC"
  echo "[OK] Adicionado ao PATH em $SHELL_RC (reabra o shell)"
fi

echo ""
echo -e "${GREEN}Pronto!${NC}"
echo -e "${YELLOW}  1. Inicie:${NC} trimtoken"
echo -e "${YELLOW}  2. Aponte o Claude Code:${NC} export ANTHROPIC_BASE_URL=http://localhost:8019"
echo -e "${YELLOW}  3. Dashboard:${NC} http://localhost:8019/dashboard"
echo ""
