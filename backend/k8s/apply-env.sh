#!/usr/bin/env bash
# Выводит из .env объекты кластера: Secret slbb-secrets, ConfigMap'ы slbb-config, kafka-config,
# pgadmin-servers.
# Единственный источник значений — .env (он в .gitignore), поэтому секретов в git не появляется.
# Идемпотентен: запускайте после любой правки .env, затем kubectl -n slbb rollout restart ...
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(dirname "$SCRIPT_DIR")"
ENV_FILE="${ENV_FILE:-$REPO_DIR/.env}"

if [[ ! -f "$ENV_FILE" ]]; then
	echo "✗ Не найден $ENV_FILE — скопируйте .env.example в .env и заполните значения." >&2
	exit 1
fi

if ! command -v kubectl >/dev/null 2>&1; then
	echo "✗ kubectl не найден в PATH." >&2
	exit 1
fi

# Читает значение ключа из .env: без комментария, с обрезкой пробелов и внешних кавычек.
# Всегда возвращает 0, чтобы отсутствие ключа не рвало set -e у вызывающего присваивания.
env_get() {
	local key="$1" line val=""
	if line="$(grep -E "^[[:space:]]*${key}[[:space:]]*=" "$ENV_FILE" | tail -n 1)"; then
		val="${line#*=}"
		val="${val#"${val%%[![:space:]]*}"}"
		val="${val%"${val##*[![:space:]]}"}"
		val="${val%\"}"
		val="${val#\"}"
		val="${val%\'}"
		val="${val#\'}"
	fi
	printf '%s' "$val"
	return 0
}

env_require() {
	local value
	value="$(env_get "$1")"
	if [[ -z "$value" ]]; then
		echo "✗ В $(basename "$ENV_FILE") не задан обязательный ключ $1" >&2
		exit 1
	fi
	printf '%s' "$value"
	return 0
}

# Манифесты фиксируют и порт контейнера, и hostPort ServiceLB. *_PORT в .env описывают то же:
# если значения разъехались, предупреждаем, а не подключаемся молча не туда.
check_port() {
	local key="$1" expected="$2" manifest="$3" actual
	actual="$(env_get "$key")"
	if [[ -n "$actual" && "$actual" != "$expected" ]]; then
		echo "⚠ $key=$actual, а в $manifest зафиксирован порт $expected." >&2
		echo "   Поменяйте port/targetPort в $manifest или верните $key=$expected в $(basename "$ENV_FILE")." >&2
	fi
	return 0
}

NAMESPACE="$(env_get K8S_NAMESPACE)"
if [[ -z "$NAMESPACE" ]]; then
	NAMESPACE="slbb"
fi

POSTGRES_USER="$(env_require POSTGRES_USER)"
POSTGRES_DB="$(env_require POSTGRES_DB)"
POSTGRES_PASSWORD="$(env_require POSTGRES_PASSWORD)"
DATABASE_URL="$(env_require DATABASE_URL)"
PGADMIN_DEFAULT_EMAIL="$(env_require PGADMIN_DEFAULT_EMAIL)"
PGADMIN_DEFAULT_PASSWORD="$(env_require PGADMIN_DEFAULT_PASSWORD)"
# Kafka без CLUSTER_ID форматирует storage на новый random-uuid при каждом старте контейнера.
KAFKA_CLUSTER_ID="$(env_require CLUSTER_ID)"

check_port POSTGRES_PORT 5432 "k8s/base/postgres.yaml"
check_port PGADMIN_PORT 8080 "k8s/base/pgadmin.yaml"
check_port LIBRETRANSLATE_PORT 5000 "k8s/base/libretranslate.yaml"
check_port KAFKA_PORT 9092 "k8s/base/kafka.yaml"

# NestJS и Prisma живут на хосте, поэтому DATABASE_URL должна вести на hostPort, а не в DNS кластера.
if [[ ! "$DATABASE_URL" =~ ^postgresql(\+pg)?://[^/]*@localhost:[0-9]+/ ]]; then
	echo "⚠ DATABASE_URL указывает не на localhost — приложение на хосте не подключится." >&2
	echo "   Ожидается вид postgresql://user:pass@localhost:5432/db?schema=public" >&2
fi

SECRET_ARGS=(
	--from-literal="DATABASE_URL=$DATABASE_URL"
	--from-literal="POSTGRES_PASSWORD=$POSTGRES_PASSWORD"
	--from-literal="PGADMIN_DEFAULT_PASSWORD=$PGADMIN_DEFAULT_PASSWORD"
)

CONFIG_ARGS=()
for key in POSTGRES_USER POSTGRES_DB PGADMIN_DEFAULT_EMAIL LT_LOAD_ONLY HTTP_HOST HTTP_PORT POSTGRES_PORT PGADMIN_PORT LIBRETRANSLATE_PORT K8S_NAMESPACE; do
	value="$(env_get "$key")"
	if [[ -n "$value" ]]; then
		CONFIG_ARGS+=(--from-literal="$key=$value")
	fi
done

# kafka-config — отдельный ConfigMap только для контейнера Kafka: entrypoint образа превращает
# ЛЮБУЮ переменную KAFKA_* в конфиг брокера, поэтому общий slbb-config ей показывать нельзя
# (KAFKA_PORT из .env дал бы нелегальное свойство port, удалённое в Kafka 4.x).
KAFKA_ARGS=(--from-literal="CLUSTER_ID=$KAFKA_CLUSTER_ID")
for key in KAFKA_PROCESS_ROLES KAFKA_NODE_ID KAFKA_LISTENERS KAFKA_ADVERTISED_LISTENERS KAFKA_CONTROLLER_LISTENER_NAMES KAFKA_LISTENER_SECURITY_PROTOCOL_MAP KAFKA_CONTROLLER_QUORUM_VOTERS KAFKA_LOG_DIRS KAFKA_OFFSETS_TOPIC_REPLICATION_FACTOR KAFKA_TRANSACTION_STATE_LOG_REPLICATION_FACTOR KAFKA_TRANSACTION_STATE_LOG_MIN_ISR KAFKA_HEAP_OPTS; do
	value="$(env_get "$key")"
	if [[ -n "$value" ]]; then
		KAFKA_ARGS+=(--from-literal="$key=$value")
	fi
done

# pgAdmin читает servers.json только при первой инициализации конфига; PGADMIN_REPLACE_SERVERS_ON_STARTUP
# в k8s/base/pgadmin.yaml делает его декларативным, поэтому сервер здесь — единственный источник правды.
SERVERS_JSON="$(
	cat <<JSON
{
	"Servers": {
		"1": {
			"Name": "slbb-postgres",
			"Group": "Servers",
			"Host": "postgres.${NAMESPACE}.svc.cluster.local",
			"Port": 5432,
			"Username": "${POSTGRES_USER}",
			"MaintenanceDB": "${POSTGRES_DB}",
			"Comment": "Регистрируется из ConfigMap pgadmin-servers (k8s/apply-env.sh)",
			"ConnectionParameters": {
				"sslmode": "prefer",
				"connect_timeout": 10
			}
		}
	}
}
JSON
)"

echo "→ kube context: $(kubectl config current-context), namespace: $NAMESPACE"

kubectl create namespace "$NAMESPACE" --dry-run=client -o yaml | kubectl apply -f -
kubectl -n "$NAMESPACE" create secret generic slbb-secrets "${SECRET_ARGS[@]}" --dry-run=client -o yaml | kubectl apply -f -
kubectl -n "$NAMESPACE" create configmap slbb-config "${CONFIG_ARGS[@]}" --dry-run=client -o yaml | kubectl apply -f -
kubectl -n "$NAMESPACE" create configmap kafka-config "${KAFKA_ARGS[@]}" --dry-run=client -o yaml | kubectl apply -f -
printf '%s\n' "$SERVERS_JSON" |
	kubectl -n "$NAMESPACE" create configmap pgadmin-servers --from-file=servers.json=/dev/stdin --dry-run=client -o yaml |
		kubectl apply -f -

echo "✓ slbb-secrets, slbb-config, kafka-config, pgadmin-servers обновлены из $(basename "$ENV_FILE")"
echo "  После смены значений на живом кластере: kubectl -n $NAMESPACE rollout restart statefulset/postgres statefulset/kafka deployment/pgadmin deployment/libretranslate"
