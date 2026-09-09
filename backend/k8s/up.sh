#!/usr/bin/env bash
# Поднимает инфраструктуру slbb: объекты из .env, затем манифесты, и ждёт готовности всех четырёх Pod'ов.
# Повторный запуск безопасен (всё через kubectl apply).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(dirname "$SCRIPT_DIR")"
cd "$REPO_DIR"

if [[ ! -f .env ]]; then
	echo "✗ Нет .env — скопируйте .env.example в .env." >&2
	exit 1
fi

NAMESPACE="$(grep -E '^[[:space:]]*K8S_NAMESPACE=' .env | tail -n 1 | cut -d= -f2- | tr -d "\" " || true)"
NAMESPACE="${NAMESPACE:-slbb}"

if ! kubectl get --raw /readyz >/dev/null 2>&1; then
	echo "✗ Кластер недоступен (context: $(kubectl config current-context 2>/dev/null || echo 'нет'))." >&2
	echo "   Проверьте: systemctl status k3s --no-pager" >&2
	exit 1
fi

echo "→ namespace $NAMESPACE"
kubectl apply -f k8s/base/namespace.yaml

echo "→ slbb-secrets / slbb-config / kafka-config / pgadmin-servers из .env"
bash k8s/apply-env.sh

echo "→ манифесты k8s/base"
kubectl apply -k k8s/base

echo "→ ждёт postgres"
kubectl -n "$NAMESPACE" rollout status statefulset/postgres --timeout=300s

echo "→ ждёт kafka (первый старт качает образ ~450 МБ)"
kubectl -n "$NAMESPACE" rollout status statefulset/kafka --timeout=900s

echo "→ ждёт pgadmin"
kubectl -n "$NAMESPACE" rollout status deployment/pgadmin --timeout=300s

echo "→ ждёт libretranslate (первый старт качает модели, до 15 минут)"
kubectl -n "$NAMESPACE" rollout status deployment/libretranslate --timeout=900s

echo
kubectl -n "$NAMESPACE" get pods,svc,pvc
echo
echo "Следующий шаг: pnpm prisma db push   (схема из prisma/schema.prisma на localhost:5432)"
echo "pgAdmin: http://localhost:8080   LibreTranslate: http://localhost:5000   Kafka (KRaft): localhost:9092"
