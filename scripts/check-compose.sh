#!/usr/bin/env bash
# =============================================================================
# check-compose.sh - Validacao ponta a ponta do docker-compose (Linux/CI)
# =============================================================================

set -euo pipefail

API_URL="http://localhost:3333"
LANGGRAPH_URL="http://localhost:8000"
TIMEOUT_S=120
POLL_S=5

step()  { echo; echo "[>] $*"; }
ok()    { echo "[OK] $*"; }
fail()  { echo "[FAIL] $*" >&2; }
info()  { echo "     $*"; }

do_down() {
  step 'Derrubando stack...'
  docker compose down --remove-orphans >/dev/null 2>&1 || true
  ok 'Stack encerrada.'
}

cleanup() {
  local exit_code=$?
  if [ $exit_code -ne 0 ]; then
    fail "Script falhou com codigo $exit_code"
    do_down
  fi
  exit $exit_code
}
trap cleanup EXIT

# 1. Derrubar stack anterior
do_down

# 2. Subir stack com build
step 'Subindo stack com --build...'
docker compose up --build -d
ok 'Containers iniciados.'

# 3. Aguardar healthchecks
step "Aguardando todos os servicos ficarem healthy (timeout: ${TIMEOUT_S}s)..."

services=("postgres" "api" "langgraph-service" "web")
deadline=$(( $(date +%s) + TIMEOUT_S ))
all_healthy=false

while [ "$(date +%s)" -lt "$deadline" ]; do
  all_healthy=true
  for svc in "${services[@]}"; do
    status=$(docker inspect --format '{{.State.Health.Status}}' "elemento-${svc}-1" 2>/dev/null || echo "unknown")
    if [ "$status" != "healthy" ]; then
      all_healthy=false
      info "${svc}: ${status}"
    fi
  done
  if [ "$all_healthy" = "true" ]; then
    ok 'Todos os servicos estao healthy.'
    break
  fi
  sleep "$POLL_S"
done

if [ "$all_healthy" != "true" ]; then
  fail "Timeout de ${TIMEOUT_S}s atingido. Algum servico nao ficou healthy."
  docker compose ps
  exit 1
fi

# 4. Validar /health da API
step "Verificando ${API_URL}/health..."
http_code=$(curl -s -o /tmp/api_health.json -w "%{http_code}" --max-time 10 "${API_URL}/health")
if [ "$http_code" != "200" ]; then
  fail "API /health retornou HTTP ${http_code}"
  exit 1
fi
api_status=$(cat /tmp/api_health.json | grep -o '"status":"[^"]*"' | cut -d'"' -f4)
if [ "$api_status" != "ok" ]; then
  fail "API /health status inesperado: ${api_status}"
  cat /tmp/api_health.json
  exit 1
fi
ok "API /health OK - status=${api_status}"
info "Response: $(cat /tmp/api_health.json)"

# 5. Validar /health do LangGraph
step "Verificando ${LANGGRAPH_URL}/health..."
http_code=$(curl -s -o /tmp/lg_health.json -w "%{http_code}" --max-time 10 "${LANGGRAPH_URL}/health")
if [ "$http_code" != "200" ]; then
  fail "LangGraph /health retornou HTTP ${http_code}"
  exit 1
fi
ok "LangGraph /health OK - HTTP ${http_code}"
info "Response: $(cat /tmp/lg_health.json)"

# 6. Teardown
do_down

# 7. Sucesso
echo
echo '============================================================'
echo '  check-compose.sh PASSOU - todos os servicos saudaveis    '
echo '============================================================'
