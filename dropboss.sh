#!/usr/bin/env bash
#
# dropboss — sua pasta, espelhada numa VPS, com um agent morando dentro.
#
#   Syncthing (Mac ↔ VPS) + claude headless + watchdog com push (ntfy.sh).
#   Você continua escrevendo local; a VPS roda seus crons e te cutuca
#   mesmo com o laptop fechado.
#
# Uso (roda do seu Mac):
#   ./dropboss.sh --vps root@1.2.3.4 --folder ~/cosa
#
# Flags:
#   --vps <ssh>          destino SSH com root (obrigatório)
#   --folder <path>      pasta local a espelhar (obrigatório)
#   --remote-user <u>    usuário na VPS que roda tudo (default: agent; criado se não existir)
#   --no-claude          não instala claude headless na VPS
#   --no-watchdog        não instala o watchdog/ntfy
#   --watchdog-cron <c>  expressão cron do watchdog em UTC (default: "0 12,21 * * *")
#
# O que ele NÃO faz: seus crons de ingestão (slack, gmail, o que for) são seus —
# depois do install, é só jogar scripts na pasta e agendar com `crontab -e` na VPS.

set -euo pipefail

# ---------- args ----------
VPS="" FOLDER="" REMOTE_USER="agent"
WITH_CLAUDE=1 WITH_WATCHDOG=1
WATCHDOG_CRON="0 12,21 * * *"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --vps) VPS="$2"; shift 2 ;;
    --folder) FOLDER="$2"; shift 2 ;;
    --remote-user) REMOTE_USER="$2"; shift 2 ;;
    --no-claude) WITH_CLAUDE=0; shift ;;
    --no-watchdog) WITH_WATCHDOG=0; shift ;;
    --watchdog-cron) WATCHDOG_CRON="$2"; shift 2 ;;
    -h|--help) sed -n '2,22p' "$0" | sed 's/^#\{1,\} \{0,1\}//'; exit 0 ;;
    *) echo "flag desconhecida: $1 (use --help)"; exit 1 ;;
  esac
done

[[ -n "$VPS" && -n "$FOLDER" ]] || { echo "obrigatório: --vps e --folder (use --help)"; exit 1; }
FOLDER="${FOLDER/#\~/$HOME}"
FOLDER="${FOLDER%/}"
[[ -d "$FOLDER" ]] || { echo "pasta não existe: $FOLDER"; exit 1; }

FOLDER_NAME="$(basename "$FOLDER")"
REMOTE_HOME="/home/$REMOTE_USER"
REMOTE_FOLDER="$REMOTE_HOME/$FOLDER_NAME"

log()  { printf '\033[1;36m[dropboss]\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31m[dropboss]\033[0m %s\n' "$*" >&2; exit 1; }
rrun() { ssh -o ConnectTimeout=10 "$VPS" "$@"; }
urun() { rrun "sudo -u $REMOTE_USER bash -c $(printf '%q' "$*")"; }

# ---------- preflight ----------
log "preflight…"
[[ "$(uname)" == "Darwin" ]] || die "por enquanto o lado local é macOS (o lado VPS é Linux)"
command -v brew >/dev/null || die "preciso do homebrew local"
rrun "true" 2>/dev/null || die "ssh não conecta em $VPS (configura chave primeiro)"
rrun "command -v apt-get >/dev/null" || die "a VPS precisa ser Debian/Ubuntu (apt)"
if rrun "ss -tln | grep -q ':22000 '" 2>/dev/null && ! rrun "systemctl is-active -q syncthing@$REMOTE_USER" 2>/dev/null; then
  die "já existe um syncthing de outro usuário na porta 22000 dessa VPS — use o mesmo --remote-user dele ou outra VPS"
fi

# ---------- usuário remoto ----------
if ! rrun "id -u $REMOTE_USER >/dev/null 2>&1"; then
  log "criando usuário $REMOTE_USER na VPS…"
  rrun "useradd -m -s /bin/bash $REMOTE_USER"
fi

# ---------- syncthing: install ----------
log "instalando syncthing (local via brew, VPS via apt)…"
brew list --versions syncthing >/dev/null 2>&1 || brew install -q syncthing
rrun "command -v syncthing >/dev/null || (apt-get update -qq && apt-get install -y -qq syncthing)"

# ---------- syncthing: subir daemons ----------
log "subindo daemons…"
# pegadinha 1: sem identidade o daemon do brew morre silenciosamente
[[ -f "$HOME/Library/Application Support/Syncthing/cert.pem" ]] || syncthing generate >/dev/null 2>&1
# pegadinha 2: o plist do brew loga em /opt/homebrew/var/log, que pode não existir
mkdir -p "$(brew --prefix)/var/log"
brew services start syncthing >/dev/null 2>&1 || true
launchctl kickstart gui/"$(id -u)"/homebrew.mxcl.syncthing 2>/dev/null || true

rrun "systemctl enable --now syncthing@$REMOTE_USER >/dev/null 2>&1 || true"
sleep 5

LOCAL_ID="$(syncthing cli show system | python3 -c 'import json,sys;print(json.load(sys.stdin)["myID"])')" \
  || die "daemon local não respondeu (vê $(brew --prefix)/var/log/syncthing.log)"
REMOTE_ID="$(urun 'syncthing cli show system' | python3 -c 'import json,sys;print(json.load(sys.stdin)["myID"])')" \
  || die "daemon remoto não respondeu (journalctl -u syncthing@$REMOTE_USER)"
log "device local:  $LOCAL_ID"
log "device remoto: $REMOTE_ID"

# ---------- syncthing: parear + pasta ----------
log "pareando e compartilhando '$FOLDER_NAME'…"
VPS_HOST="${VPS#*@}"

# .git fora do sync: git bidirecional via syncthing corrompe repo. Commita só de um lado.
printf '.git\n.DS_Store\nnode_modules\n' > "$FOLDER/.stignore"

syncthing cli config devices add --device-id "$REMOTE_ID" --name dropboss \
  --addresses "tcp://$VPS_HOST:22000" 2>/dev/null || true
syncthing cli config folders add --id "$FOLDER_NAME" --label "$FOLDER_NAME" --path "$FOLDER" 2>/dev/null || true
syncthing cli config folders "$FOLDER_NAME" devices add --device-id "$REMOTE_ID" 2>/dev/null || true

urun "mkdir -p $REMOTE_FOLDER"
printf '.git\n.DS_Store\nnode_modules\n' | rrun "install -o $REMOTE_USER -g $REMOTE_USER -m 644 /dev/stdin $REMOTE_FOLDER/.stignore"
urun "syncthing cli config devices add --device-id $LOCAL_ID --name laptop" 2>/dev/null || true
urun "syncthing cli config folders add --id $FOLDER_NAME --label $FOLDER_NAME --path $REMOTE_FOLDER" 2>/dev/null || true
urun "syncthing cli config folders $FOLDER_NAME devices add --device-id $LOCAL_ID" 2>/dev/null || true

log "esperando conexão…"
for _ in $(seq 1 12); do
  sleep 5
  CONNECTED="$(syncthing cli show connections | python3 -c "
import json,sys
d=json.load(sys.stdin)['connections']
print(str(d.get('$REMOTE_ID',{}).get('connected',False)).lower())" 2>/dev/null || echo false)"
  [[ "$CONNECTED" == "true" ]] && break
done
[[ "$CONNECTED" == "true" ]] || die "não conectou em 60s — confere firewall da VPS (porta 22000) e tenta de novo"
log "conectado ✓ (o sync inicial segue em background)"

# ---------- claude headless ----------
if [[ "$WITH_CLAUDE" == 1 ]]; then
  log "instalando claude headless na VPS…"
  urun "command -v bun >/dev/null || curl -fsSL https://bun.sh/install | bash" >/dev/null 2>&1 || true
  urun 'export PATH=$HOME/.bun/bin:$PATH && command -v claude >/dev/null || bun install -g @anthropic-ai/claude-code' >/dev/null

  log "empurrando credenciais do Claude Code (Keychain → VPS)…"
  CREDS="$(security find-generic-password -s 'Claude Code-credentials' -w 2>/dev/null)" \
    || die "não achei credenciais no Keychain — loga no Claude Code local primeiro"
  printf '%s' "$CREDS" | rrun "install -d -o $REMOTE_USER -g $REMOTE_USER -m 700 $REMOTE_HOME/.claude && install -o $REMOTE_USER -g $REMOTE_USER -m 600 /dev/stdin $REMOTE_HOME/.claude/.credentials.json"
  unset CREDS

  OUT="$(urun 'export PATH=$HOME/.bun/bin:$PATH && cd '"$REMOTE_FOLDER"' && timeout 120 claude -p "responda apenas: ok" 2>&1 | tail -1')"
  [[ "$OUT" == "ok" ]] && log "claude headless ✓" || log "atenção: claude respondeu '$OUT' — pode precisar de re-login"
fi

# ---------- watchdog + ntfy ----------
if [[ "$WITH_WATCHDOG" == 1 ]]; then
  NTFY_TOPIC="dropboss-$(whoami)-$(openssl rand -hex 4)"
  log "instalando watchdog (ntfy topic: $NTFY_TOPIC)…"

  # arquivos gerados localmente e enviados por stdin — zero malabarismo de quoting remoto
  cat << PROMPT | rrun "install -o $REMOTE_USER -g $REMOTE_USER -m 644 /dev/stdin $REMOTE_HOME/watchdog-prompt.md"
Você é o watchdog desta pasta, rodando numa VPS. Leia o que existir aqui
(notas, TODOs, arquivos de estado) e detecte APENAS coisas que precisam de
atenção HOJE: prazo estourado, compromisso de hoje sem tratamento, processo
quebrado. Se encontrar algo, envie UMA notificação agregada (máximo 1 curl):
curl -s -H "Title: dropboss" -d "<resumo em 1-3 linhas>" https://ntfy.sh/$NTFY_TOPIC
Se não houver nada, responda apenas NADA. Nunca edite arquivo nenhum.
PROMPT

  cat << WATCHDOG | rrun "install -o $REMOTE_USER -g $REMOTE_USER -m 755 /dev/stdin $REMOTE_HOME/watchdog.sh"
#!/usr/bin/env bash
set -euo pipefail
export PATH=$REMOTE_HOME/.bun/bin:/usr/bin:/bin
cd $REMOTE_FOLDER
timeout 600 claude -p "\$(cat $REMOTE_HOME/watchdog-prompt.md)" \\
  --allowedTools 'Read,Grep,Glob,Bash(curl -s -H*)' >> $REMOTE_HOME/watchdog.log 2>&1
WATCHDOG

  urun "(crontab -l 2>/dev/null | grep -v watchdog.sh; echo '$WATCHDOG_CRON $REMOTE_HOME/watchdog.sh') | crontab -"

  curl -s -H "Title: dropboss" -d "instalado 🟢 — assine este tópico no app ntfy" \
    "https://ntfy.sh/$NTFY_TOPIC" >/dev/null && log "push de teste enviado ✓"
fi

# ---------- resumo ----------
cat << SUMMARY

┌─────────────────────────────────────────────────────────────
│ dropboss instalado 🕶
│
│ pasta:     $FOLDER  ↔  $VPS:$REMOTE_FOLDER
│ sync:      contínuo (syncthing, .git excluído — commit só de um lado)
$([[ "$WITH_CLAUDE" == 1 ]] && echo "│ agent:     claude headless na VPS (user $REMOTE_USER)")
$([[ "$WITH_WATCHDOG" == 1 ]] && echo "│ watchdog:  cron '$WATCHDOG_CRON' (UTC) → push ntfy
│ ntfy:      instale o app e assine: $NTFY_TOPIC
│ prompt:    edite $REMOTE_HOME/watchdog-prompt.md a gosto")
│
│ seus crons de ingestão: ssh $VPS, depois 'sudo -u $REMOTE_USER crontab -e'
└─────────────────────────────────────────────────────────────
SUMMARY
