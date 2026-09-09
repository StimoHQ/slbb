# slbb в Kubernetes

Инфраструктура (PostgreSQL, Kafka, pgAdmin 4, LibreTranslate) работает в однонодовом кластере **k3s**.
NestJS-приложение и Prisma остаются на хосте и подключаются к сервисам по `localhost` —
на стандартные порты `5432`/`9092`/`8080`/`5000`.

```
namespace slbb  →  ровно 4 Pod'а
├── StatefulSet/postgres        postgres:18            → Service postgres        :5432  → localhost:5432
├── StatefulSet/kafka           apache/kafka:4.3.1     → Service kafka           :9092  → localhost:9092
├── Deployment/pgadmin          dpage/pgadmin4:9.17    → Service pgadmin         :8080  → http://localhost:8080
└── Deployment/libretranslate   libretranslate:v1.9.6  → Service libretranslate  :5000  → localhost:5000

kube-system: pod'ы svclb-* (служебные, создаются ServiceLB под каждый LoadBalancer)
```

Порядок портов: `Service.spec.port` одновременно является и `hostPort` — это поведение k3s ServiceLB
(klipper-lb), а не NodePort-диапазон. Отсюда главное ограничение: если порт на хосте уже занят,
`EXTERNAL-IP` сервиса зависнет в `Pending`.

## Установка кластера (один раз, нужен sudo)

```bash
curl -sfL https://get.k3s.io | sudo K3S_KUBECONFIG_MODE=644 sh -s - --disable traefik
```

`--disable traefik` — Ingress не используется, pgAdmin доступен напрямую на 8080. Локальный
`local-path` provisioner остаётся включённым, именно он раздаёт PVC.

Если `~/.kube/config` не создан или принадлежит root:

```bash
mkdir -p ~/.kube && cp /etc/rancher/k3s/k3s.yaml ~/.kube/config && chmod 600 ~/.kube/config
```

Проверка: `kubectl get nodes` → Ready `k3s-<hostname>`.

k3s кладёт свой `/usr/local/bin/kubectl`, согласованный с версией API-сервера. Если выше по PATH
остался клиент из snap/apt, `kubectl` печатает предупреждение о расхождении минорных версий — на
применение манифестов это не влияет, но удобнее использовать k3s-версию (`which -a kubectl`).

## Команды

| Команда | Что делает |
| --- | --- |
| `pnpm k8s:up` | применяет namespace, объекты из `.env`, затем `k8s/base` и ждёт готовности четырёх Pod'ов |
| `pnpm k8s:env` | пересоздаёт `slbb-secrets` / `slbb-config` / `kafka-config` / `pgadmin-servers` из `.env` |
| `pnpm k8s:status` | `kubectl -n slbb get pods,svc,pvc` |
| `pnpm k8s:logs` | логи всех Pod'ов с префиксом |
| `pnpm k8s:psql` | `psql` внутри `postgres-0` |
| `pnpm k8s:kafka-topics` | список топиков Kafka (`kafka-topics.sh --list` внутри `kafka-0`) |
| `pnpm k8s:down` | снимает поды и сервисы, PVC и данные остаются |
| `bash k8s/down.sh --secrets` | то же + удаляет Secret и ConfigMap'ы |
| `bash k8s/down.sh --purge` | удаляет namespace целиком, **вместе с данными** (спрашивает подтверждение) |

Первый запуск после установки кластера:

```bash
cp .env.example .env   # при необходимости поправить значения
pnpm k8s:up
pnpm prisma:generate
pnpm db:push           # схема из prisma/schema.prisma накатывается на localhost:5432
pnpm start:dev         # в логе ожидается "Database has been connected"
```

Затем открыть [http://localhost:8080](http://localhost:8080), войти (`PGADMIN_DEFAULT_EMAIL` /
`PGADMIN_DEFAULT_PASSWORD`), выбрать в дереве сервер **slbb-postgres** и ввести `POSTGRES_PASSWORD`,
отметив «Save password» — дальше подключение сохраняется на PVC.

## Откуда берутся значения

Единственный источник — `.env` в корне `backend/` (он в `.gitignore`). `k8s/apply-env.sh` читает его
и раскладывает по объектам кластера:

| Ключи `.env` | Объект кластера |
| --- | --- |
| `DATABASE_URL`, `POSTGRES_PASSWORD`, `PGADMIN_DEFAULT_PASSWORD` | `Secret/slbb-secrets` |
| `POSTGRES_USER`, `POSTGRES_DB`, `PGADMIN_DEFAULT_EMAIL`, `LT_LOAD_ONLY`, `HTTP_*`, `*_PORT`, `K8S_NAMESPACE` | `ConfigMap/slbb-config` |
| `CLUSTER_ID` + брокерские `KAFKA_*` (кроме `KAFKA_PORT`) | `ConfigMap/kafka-config` → StatefulSet `kafka` |
| `POSTGRES_USER`, `POSTGRES_DB`, `K8S_NAMESPACE` | `ConfigMap/pgadmin-servers` → `/pgadmin4/servers.json` |

Все три контейнера (postgres, pgAdmin, LibreTranslate) получают общие наборы через `envFrom`,
поэтому дублировать значения негде. Kafka — исключение: только `kafka-config`, см. «Заметки по
манифестам». Смена значения = правка `.env` → `pnpm k8s:env` →
`kubectl -n slbb rollout restart statefulset/postgres statefulset/kafka deployment/pgadmin deployment/libretranslate`.

Манифесты фиксируют порты `5432`/`9092`/`8080`/`5000`; если `*_PORT` в `.env` с ними разъедется,
`apply-env.sh` выдаст предупреждение.

## Частые изменения

### Добавить переменную окружения

1. Прописать её в `.env` **и** в `.env.example` (в git уезжает только `.example`).
2. Решить, кто её читает:
   - **только приложение на хосте** (`ConfigModule.forRoot({ isGlobal: true })` читает `.env`) — на этом всё, достаточно перезапуска `pnpm start:dev`;
   - **контейнер в кластере** — выписать имя ключа в `k8s/apply-env.sh`: в массив `SECRET_ARGS` (если значение секрет) или в один из двух циклов `for key in …` (общий `slbb-config`, либо `kafka-config` для контейнера Kafka). Без этого ключ останется только в `.env` и в под не попадёт.

```bash
pnpm k8s:env
kubectl -n slbb rollout restart statefulset/postgres statefulset/kafka deployment/pgadmin deployment/libretranslate
```

Список ключей в скрипте намеренно явный, а не «весь `.env` → ConfigMap»: иначе любой будущий секрет молча уедет в ConfigMap, который читается всеми, у кого есть право на чтение namespace.

`envFrom` читается **только при старте пода** — поэтому нужен `rollout restart`. Обновление ConfigMap «на горячую» работает лишь когда он примонтирован как файл (том), а не как переменные окружения.

### Сменить имя базы (`POSTGRES_DB`)

`POSTGRES_DB` и хост/порт/база в `DATABASE_URL` — два места, их надо синхронизировать руками:

```bash
# 1) .env — пароль плейсхолдером, берите реальный из своего .env
POSTGRES_DB=db_v2
DATABASE_URL=postgresql://admin:<POSTGRES_PASSWORD>@localhost:5432/db_v2?schema=public

# 2) propagation
pnpm k8s:env                                          # обновит slbb-config и servers.json (MaintenanceDB)
kubectl -n slbb rollout restart deployment/pgadmin    # pgAdmin перечитает servers.json
pnpm db:push                                          # Prisma создаст отсутствующую базу сам (проверено: v7.10.0)
```

Старая база **не удаляется** и остаётся на томе с данными — это не потеря, а вторая база рядом. Перенести данные: `pg_dump`/`pg_restore` через `pnpm k8s:psql` или `kubectl cp`; удалить старое: `DROP DATABASE db_name;` внутри `pnpm k8s:psql`. Контейнер postgres переименовывать базу не будет: `POSTGRES_DB` участвует только в `initdb`.

### Сменить пароль PostgreSQL

Порядок важен: `POSTGRES_PASSWORD` в образе действует только до `initdb`, поэтому сам по себе новый Secret ничего в базе не меняет (и под с новым секретом продолжит пускать по старому паролю).

```bash
pnpm k8s:psql                       # интерактивный psql внутри postgres-0
ALTER USER admin WITH PASSWORD '<новый>';
```

Затем обновить `.env` (`POSTGRES_PASSWORD` **и** `DATABASE_URL`) → `pnpm k8s:env` → перезапустить приложение. В pgAdmin сохранённый пароль станет невалидным — ввести новый один раз при первом подключении.

### Сменить логин (`POSTGRES_USER`)

Аналогично паролю, через SQL: `CREATE ROLE new_user WITH LOGIN PASSWORD '…'; GRANT ALL ON DATABASE db_name TO new_user;` (суперюзера создаёт `initdb`, новых он не плодит), затем те же `.env` → `k8s:env` → `db push`. Либо `bash k8s/down.sh --purge` и чистая инициализация, если данные не жалко.

## Заметки по манифестам

- **kafka** — `apache/kafka:4.3.1` в KRaft combined-режиме (broker+controller одним процессом, без
  Zookeeper — с Kafka 4.x режима с ZK не существует вовсе). Из специфики образа следуют три отличия
  от остальных манифестов:
  1. Монтируется только отдельный `ConfigMap kafka-config`: entrypoint превращает **любую** переменную
     `KAFKA_*` в свойство брокера (`KAFKA_FOO_BAR` → `foo.bar`), и посторонний `KAFKA_PORT` из общего
     slbb-config дал бы свойство `port`, удалённое в 4.x, — брокер не стартует.
  2. `CLUSTER_ID` зафиксирован в `.env` и **не меняется** на живом PVC: форматирование storage
     выполняется только на пустом томе, при несовпадении id брокер уходит в crash loop
     («Inconsistent cluster id»).
  3. В штатном `server.properties` образа `log.dirs=/tmp/kraft-combined-logs` (эфемерно), поэтому
     явно задан `KAFKA_LOG_DIRS=/var/lib/kafka/data` и на этот путь смонтирован PVC. Каталог
     принадлежит root (local-path), а kafka работает от `appuser` с плавающим uid — права готовит
     root-initContainer `fix-data-permissions` из того же образа.
  `KAFKA_ADVERTISED_LISTENERS=localhost:9092` валиден ровно пока клиенты живут на хосте (та же
  схема, что с postgres). Если consumer переедет в Pod — понадобятся INTERNAL/EXTERNAL листенеры.
- **postgres** — `StatefulSet`, чтобы том назывался стабильно (`data-postgres-0`) и переживал
  пересоздание пода. PVC смонтирован в `/var/lib/postgresql`, а не в `$PGDATA`: у образа `postgres:18`
  данные лежат в `/var/lib/postgresql/18/docker`, и такой монтаж переживает смену мажорной версии.
  `POSTGRES_USER`, `POSTGRES_DB`, `POSTGRES_PASSWORD` участвуют только в `initdb`, то есть срабатывают
  один раз на пустом томе. Поэтому смена логина/пароля требует `ALTER USER` (см. «Частые изменения»),
  а удаление PVC (`bash k8s/down.sh --purge`) — крайний случай, когда нужна чистая инициализация.
- **pgAdmin** читает `servers.json` только при первой инициализации конфигурации, поэтому в
  деплойменте стоит `PGADMIN_REPLACE_SERVERS_ON_STARTUP=True`: сервер перерегистрируется из ConfigMap
  на каждом старте пода, и `servers.json` остаётся единственным источником. Пароль к базе через
  `servers.json` не передаётся (не поддерживается pgAdmin) и вводится в браузере один раз.
- **LibreTranslate** грузит модели при старте: первая загрузка скачивает их в PVC и занимает минуты,
  поэтому `startupProbe` допускает до 15 минут. Проверено на v1.9.6: `GET /healthz` отдаёт 404, а
  `GET /languages` — 200 сразу после готовности, поэтому пробы сделаны на `/languages`.
- `strategy: Recreate` у pgAdmin и LibreTranslate обязателен: доступ к PVC — `ReadWriteOnce`, и при
  обычном RollingUpdate новый Pod не встанет рядом со старым.

## Отладка

| Симптом | Причина / действие |
| --- | --- |
| `EXTERNAL-IP` сервиса в `Pending` | занят `hostPort`: посмотрите `kubectl -n kube-system get pods -o wide \| grep svclb` (под не встанет на ноду) и найдите конкурента через `ss -ltnp \| grep -E ':(5432\|9092\|8080\|5000)'`. Поднятый рядом podman-под или локальный postgres мешают именно так |
| `ss -ltn` не показывает 5432/9092/8080/5000, хотя они работают | норма: k3s публикует `hostPort` через portmap CNI (iptables DNAT на cni0), а не сокетом в host-namespace. Проверять соединением: `curl -s http://localhost:8080/misc/ping` или `timeout 3 bash -c 'cat < /dev/null > /dev/tcp/127.0.0.1/5432'` |
| kafka в `CrashLoopBackOff` с «Inconsistent cluster id» | `CLUSTER_ID` в `.env` не совпадает с отформатированным PVC (поменяли значение или том достался от другой инсталляции) — вернуть прежний `CLUSTER_ID`, либо `kubectl -n slbb delete pvc data-kafka-0` и дождаться нового тома (данные топиков потеряны) |
| `CrashLoopBackOff` с `initdb: directory not empty` | на томе осталась data от другой версии или других логина/БД → `bash k8s/down.sh --purge` и заново |
| pgAdmin: `Permission denied` на `/var/lib/pgadmin` | локальный том не принял `fsGroup: 5050`. Обход: заменить его PVC на `emptyDir` (серверы и так регистрируются декларативно) или выдать права на каталог в `/var/lib/rancher/k3s/storage` |
| `kubectl: connection refused localhost:8080` | не настроен kubeconfig → команда из раздела установки либо `export KUBECONFIG=/etc/rancher/k3s/k3s.yaml` |
| Поды в `Pending`: `persistentvolumeclaim ... not found` | k3s запущен с `--disable local-storage` → вернуть provisioner или указать `storageClassName` явно |
| `systemctl status k3s` показывает ошибки после обновления ядра | `sudo journalctl -u k3s -f` — обычно лечится `sudo systemctl restart k3s` |
| Нужно полностью снести кластер | `sudo /usr/local/bin/k3s-uninstall.sh` |

## Про доступность извне

`hostPort` публикует сервисы на **всех интерфейсах** узла, а не только на loopback: с машин в одной
сети оказываются доступны `5432`, `9092`, `8080`, `5000` с паролями из `.env`. Для dev-машины это обычно
приемлемо. Если нежелательно — у `postgres` и `libretranslate` меняется `type: LoadBalancer` на
`ClusterIP`, а доступ с хоста делается пробросом:

```bash
kubectl -n slbb port-forward svc/postgres 5432:5432
```

(тогда `pnpm start:dev` нужно запускать с активным пробросом).

## Подём — только через k3s

Podman-вариант (`compose.yml`, quadlet-юниты в `containers/`) удалён из репозитория: инфраструктура
полностью переехала в k3s. Если на хосте остались systemd-юниты `slbb*` — выключить, убрать ссылки
из `~/.config/containers/systemd/` и сделать `systemctl --user daemon-reload`, иначе юниты будут
спорить с кластером за порты `5432`/`9092`/`8080`/`5000` (`systemctl --user list-units 'slbb*'`, `podman pod ps`).
