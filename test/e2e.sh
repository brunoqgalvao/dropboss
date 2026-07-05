#!/usr/bin/env bash
# e2e: dois syncthings isolados em localhost fazem share → join → accept → sync → history → leave.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="${DROPBOSS_E2E_TMP:-$(mktemp -d)}"
HA="$TMP/home-a" HB="$TMP/home-b"
FA="$TMP/proj-a" FB="$TMP/proj-b"
GUI_A=8391 GUI_B=8392 PORT_A=22101 PORT_B=22102
PIDS=()

say()  { printf '\033[1;35m[e2e]\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31m[e2e]\033[0m FAIL: %s\n' "$*"; exit 1; }
cleanup() { for p in "${PIDS[@]:-}"; do kill "$p" 2>/dev/null || true; done; }
trap cleanup EXIT

mkdir -p "$HA" "$HB" "$FA"
echo "conteudo inicial" > "$FA/hello.txt"

say "gerando identidades…"
syncthing generate --home="$HA" >/dev/null 2>&1 || syncthing --home="$HA" generate >/dev/null 2>&1
syncthing generate --home="$HB" >/dev/null 2>&1 || syncthing --home="$HB" generate >/dev/null 2>&1

tune() { # home, gui-port, listen-port
  local cfg="$1/config.xml"
  grep -qE '<address>127\.0\.0\.1:[0-9]+</address>' "$cfg" || fail "config inesperado em $cfg"
  sed -i '' -E \
    -e "s|<address>127\.0\.0\.1:[0-9]+</address>|<address>127.0.0.1:$2</address>|" \
    -e "s|<listenAddress>tcp://0\.0\.0\.0:[0-9]+</listenAddress>|<listenAddress>tcp://127.0.0.1:$3</listenAddress>|" \
    -e '/relays\.syncthing\.net/d' \
    -e '/<listenAddress>quic:/d' \
    -e 's|<globalAnnounceEnabled>true|<globalAnnounceEnabled>false|' \
    -e 's|<localAnnounceEnabled>true|<localAnnounceEnabled>false|' \
    -e 's|<relaysEnabled>true|<relaysEnabled>false|' \
    -e 's|<natEnabled>true|<natEnabled>false|' \
    -e 's|<crashReportingEnabled>true|<crashReportingEnabled>false|' \
    -e 's|<urAccepted>0|<urAccepted>-1|' \
    -e 's|<autoUpgradeIntervalH>12|<autoUpgradeIntervalH>0|' \
    -e 's|<startBrowser>true|<startBrowser>false|' \
    "$cfg"
}
tune "$HA" $GUI_A $PORT_A
tune "$HB" $GUI_B $PORT_B

say "subindo daemons…"
syncthing serve --home="$HA" --no-browser --no-restart >"$TMP/a.log" 2>&1 & PIDS+=($!)
syncthing serve --home="$HB" --no-browser --no-restart >"$TMP/b.log" 2>&1 & PIDS+=($!)

api() { # home, gui-port, method, path [, body]
  local key; key=$(grep -o '<apikey>[^<]*' "$1/config.xml" | cut -d'>' -f2)
  if [ $# -ge 5 ]; then
    curl -sf -X "$3" -H "X-API-Key: $key" -H 'Content-Type: application/json' -d "$5" "http://127.0.0.1:$2$4"
  else
    curl -sf -X "$3" -H "X-API-Key: $key" "http://127.0.0.1:$2$4"
  fi
}

for i in $(seq 1 30); do api "$HA" $GUI_A GET /rest/system/ping >/dev/null 2>&1 && break; sleep 1; done
for i in $(seq 1 30); do api "$HB" $GUI_B GET /rest/system/ping >/dev/null 2>&1 && break; sleep 1; done
api "$HA" $GUI_A GET /rest/system/ping >/dev/null || fail "daemon A não subiu ($TMP/a.log)"
api "$HB" $GUI_B GET /rest/system/ping >/dev/null || fail "daemon B não subiu ($TMP/b.log)"

DBOSS="node $ROOT/bin/dropboss.js"

say "share na máquina A…"
OUT=$(DROPBOSS_SYNCTHING_HOME="$HA" $DBOSS share "$FA" --no-wait)
echo "$OUT" | sed 's/^/    /'
CODE=$(echo "$OUT" | grep -o 'db1-[A-Za-z0-9_-]*' | head -1)
[ -n "$CODE" ] || fail "share não imprimiu convite"

say "join na máquina B…"
DROPBOSS_SYNCTHING_HOME="$HB" $DBOSS join "$CODE" --path "$FB" --no-wait | sed 's/^/    /'

ID_A=$(api "$HA" $GUI_A GET /rest/system/status | python3 -c 'import json,sys;print(json.load(sys.stdin)["myID"])')
ID_B=$(api "$HB" $GUI_B GET /rest/system/status | python3 -c 'import json,sys;print(json.load(sys.stdin)["myID"])')

say "apontando endereços localhost (sem discovery no teste)…"
api "$HB" $GUI_B PATCH "/rest/config/devices/$ID_A" "{\"addresses\":[\"tcp://127.0.0.1:$PORT_A\"]}" >/dev/null

say "porteiro na máquina A (auto-accept, convite single-use)…"
KEY_A=$(grep -o '<apikey>[^<]*' "$HA/config.xml" | cut -d'>' -f2)
FID=$(python3 -c "
import base64, json
c = '$CODE'.split('db1-', 1)[1]
print(json.loads(base64.urlsafe_b64decode(c + '=' * (-len(c) % 4)))['f'])")
cat > "$TMP/porteiro.json" <<EOF
{"gui":{"base":"http://127.0.0.1:$GUI_A","key":"$KEY_A"},"open":{"$FID":{"label":"proj-a","until":9999999999999,"uses":1}}}
EOF
consumed() { python3 -c "import json;d=json.load(open('$TMP/porteiro.json'));exit(0 if not d['open'] else 1)"; }
for i in 1 2 3 4 5; do
  DROPBOSS_PORTEIRO_STATE="$TMP/porteiro.json" node "$ROOT/src/porteiro.mjs" | sed 's/^/    /'
  consumed && break
  sleep 8
done
consumed || fail "porteiro não consumiu o convite single-use"
say "porteiro aceitou 1 peer e fechou a porta sozinho ✓"

say "esperando A→B sincronizar…"
for i in $(seq 1 60); do [ -f "$FB/hello.txt" ] && break; sleep 1; done
[ -f "$FB/hello.txt" ] || fail "hello.txt não chegou em B"
grep -q "conteudo inicial" "$FB/hello.txt" || fail "conteúdo errado em B"
say "A→B ✓"

[ -f "$FB/.claude/skills/dropboss/SKILL.md" ] || fail "SKILL.md não sincronizou para B"
say "skill sincronizou ✓"

say "escrevendo em B → A…"
echo "resposta de B" > "$FB/reply.txt"
for i in $(seq 1 60); do [ -f "$FA/reply.txt" ] && break; sleep 1; done
[ -f "$FA/reply.txt" ] || fail "reply.txt não chegou em A"
say "B→A ✓"

say "versionamento: A sobrescreve hello.txt, versão antiga deve aparecer em B…"
sleep 2
echo "conteudo novo v2" > "$FA/hello.txt"
FOUND=""
for i in $(seq 1 60); do
  if ls "$FB/.stversions"/hello*~* >/dev/null 2>&1; then FOUND=yes; break; fi
  sleep 1
done
[ -n "$FOUND" ] || fail "versão antiga não apareceu em $FB/.stversions"
grep -q "conteudo novo v2" "$FB/hello.txt" || fail "novo conteúdo não chegou em B"
say "versionamento ✓"
(cd "$FB" && DROPBOSS_SYNCTHING_HOME="$HB" $DBOSS history hello) | sed 's/^/    /'

say "restore em B…"
V=$(basename "$(ls "$FB/.stversions"/hello*~* | head -1)")
(cd "$FB" && DROPBOSS_SYNCTHING_HOME="$HB" $DBOSS restore "$V" --force) | sed 's/^/    /'
grep -q "conteudo inicial" "$FB/hello.txt" || fail "restore não trouxe o conteúdo antigo de volta"
say "restore ✓"

say "status em A…"
DROPBOSS_SYNCTHING_HOME="$HA" $DBOSS status | sed 's/^/    /'

say "leave em B…"
DROPBOSS_SYNCTHING_HOME="$HB" $DBOSS leave "$FB" | sed 's/^/    /'
api "$HB" $GUI_B GET /rest/config/folders | python3 -c 'import json,sys; sys.exit(1 if json.load(sys.stdin) else 0)' \
  || fail "B ainda tem a pasta na config depois do leave"
[ -f "$FB/hello.txt" ] || fail "leave apagou arquivos (não devia!)"
say "leave ✓ (arquivos intactos)"

say ""
say "TUDO PASSOU 🕶  (logs e sandbox: $TMP)"
