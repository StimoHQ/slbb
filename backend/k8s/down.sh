#!/usr/bin/env bash
# Останавливает инфраструктуру slbb, сохраняя данные (PVC) и namespace.
#   k8s/down.sh            — снять поды и сервисы, оставить PVC/секреты
#   k8s/down.sh --secrets  — плюс удалить slbb-secrets/slbb-config/kafka-config/pgadmin-servers
#   k8s/down.sh --purge    — удалить namespace целиком: вместе с ним уйдут и PVC, т.е. данные БД
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(dirname "$SCRIPT_DIR")"
cd "$REPO_DIR"

MODE="${1:-}"
NAMESPACE="$(grep -E '^[[:space:]]*K8S_NAMESPACE=' .env | tail -n 1 | cut -d= -f2- | tr -d "\" " || true)"
NAMESPACE="${NAMESPACE:-slbb}"

if [[ "$MODE" == "--purge" ]]; then
	read -rp "Удалить namespace $NAMESPACE вместе с данными PVC? Введите 'yes': " answer
	[[ "$answer" == "yes" ]] || {
		echo "Отменено."
		exit 1
	}
	echo "→ удаляю namespace $NAMESPACE (каскадно: поды, сервисы, PVC, конфиги)"
	kubectl delete namespace "$NAMESPACE" --ignore-not-found --wait=false
	exit 0
fi

if [[ "$MODE" != "" && "$MODE" != "--secrets" ]]; then
	echo "Неизвестный режим '$MODE'. Доступно: (без аргумента) | --secrets | --purge" >&2
	exit 1
fi

echo "→ удаляю workload'ы и сервисы (PVC остаются)"
kubectl -n "$NAMESPACE" delete statefulset/postgres statefulset/kafka deployment/pgadmin deployment/libretranslate --ignore-not-found
kubectl -n "$NAMESPACE" delete svc/postgres svc/kafka svc/pgadmin svc/libretranslate --ignore-not-found

# Вместе с сервисами уходят pod'ы svclb-* из kube-system — hostPort'ы 5432/9092/8080/5000 освобождаются.
kubectl -n "$NAMESPACE" get pods 2>/dev/null || true

if [[ "$MODE" == "--secrets" ]]; then
	echo "→ удаляю slbb-secrets, slbb-config, kafka-config, pgadmin-servers"
	kubectl -n "$NAMESPACE" delete secret/slbb-secrets --ignore-not-found
	kubectl -n "$NAMESPACE" delete configmap/slbb-config configmap/kafka-config configmap/pgadmin-servers --ignore-not-found
fi

echo "✓ Инфраструктура остановлена. Данные: kubectl -n $NAMESPACE get pvc"
