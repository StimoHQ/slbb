# Text module — жизненный цикл загрузки книги

Модуль владеет сущностью `Text` (книга, разбитая на предложения) и **ничего не скачивает сам**.
Скачивание, детекция языка, разбивка и вставка — обязанность worker-процесса, который забирает
задачу `TextDownloadTask` из Kafka. Граница проходит по процессам, а не по модулям: в HTTP-процессе
(`AppModule`) нет ни `IngestionModule`, ни `GutenbergLoaderModule`.

Главное следствие такого дележа: **строки `Text` не существует, пока задача не дошла до `READY`**.
Ни статуса, ни ошибки загрузки у текста нет — всё они на задаче.

## 1. Схема: кто что хранит

| Таблица               | Назначение                                              | Ключи                                                        |
| --------------------- | ------------------------------------------------------- | ------------------------------------------------------------ |
| `text_download_tasks` | задача конвейера: что, откуда и как скачивали           | `@@unique([source, sourceObjId])`, `text_id` — `@unique`, FK |
| `texts`               | сам текст: заголовок, язык, provenance                  | `@@unique([source, sourceObjId])`                            |
| `text_sentences`      | предложения текста, `position` — 0-based порядок чтения | `@@unique([textId, position])`, FK `texts` → `Cascade`       |

`TextDownloadTask.textId` заполняется только в момент `READY` и связан с `Text` отношением
`1:1` с `onDelete: Cascade`: удалённый текст уносит и свою задачу, иначе уникальный ключ
`@@unique([source, sourceObjId])` остался бы занят мёртвой строкой и повторная загрузка
стала бы невозможна.

Поля `source` / `sourceObjId` лежат и в задаче, и в тексте намеренно: в задаче они нужны, чтобы
дедуплицировать очередь, в тексте — это его provenance (выборка «текст книги N» идёт без join, и
одна книга не может породить два текста).

## 2. Полный путь задачи

```
HTTP-ПРОЦЕСС (pnpm start, AppModule)             WORKER-ПРОЦЕСС (pnpm start:worker, WorkerModule)

TextController.create
 └─ TextService.create
     ├─ openTask ──────▶ PrismaService.textDownloadTask   [QUEUED, текст не создан]
     └─ publish ═══════▶ Kafka: slbb.text.download        [key = textTaskId]
                             │
                             ▼
                          TextDownloadConsumer.handleMessage   (guard: isTextDownloadEvent)
                           └─ IngestionService.process(textTaskId)
                               ├─ claim ─────────▶ textDownloadTask.updateMany [PROCESSING, CAS]
                               ├─ loadBySource ──▶ GutenbergTxtLoader.load
                               │    ├─ GutenbergApiService.getBookMeta      ─▶ RapidAPI (1 запрос квоты)
                               │    ├─ GutenbergApiService.getCleanedText   ─▶ RapidAPI (2-й запрос)
                               │    └─ resolveLanguage                      ─▶ LibreTranslate /detect
                               ├─ splitIntoSentences  (wink-nlp, синхронный CPU)
                               ├─ persist ─▶ $transaction: text.create + text_sentences + task [READY]
                               └─ markFailed ▶ textDownloadTask.update                        [FAILED]

TextController.getTaskStatus
 └─ TextService.getTaskStatus ─▶ textDownloadTask.findUnique   (чтение БД, без Kafka)

TextController.getOne ─▶ TextService.getOne ─▶ text + text_sentences (текст есть только когда он готов)
```

### 2.0 Что обрабатывает каждый запрос до контроллера

Глобальные вещи из `src/entrypoints/api/main.ts`, они же формируют тело ответа:

| Компонент                                              | Эффект                                                                                                                                         |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `ValidationPipe({ whitelist: true, transform: true })` | валидация входного DTO, отсечение не описанных полей, приведение типов                                                                         |
| `TimingInterceptor`                                    | лог `METHOD url → Nms` по завершении запроса                                                                                                   |
| `TransformResponseInterceptor`                         | успех оборачивается в `{ status: "success", timestamp, message, statusCode, data }`; `message` берётся из поля `message` возвращаемого объекта |
| `HttpExceptionFilter`                                  | ошибка оборачивается в `{ status: "error", timestamp, statusCode, message }`                                                                   |
| `enableShutdownHooks()`                                | вызывает `OnModuleDestroy` (отключение Kafka/Prisma) по SIGTERM                                                                                |

### 2.1 Постановка задачи: `POST /text` (HTTP-процесс)

Вход: `CreateTextDto` (`source` — enum `Source`, `sourceObjId` — id объекта у источника).

1. `TextController.create()` — `@HttpCode(202)`.
2. `TextService.create()` → `TextService.openTask()`:
    - нет задачи по паре `(source, sourceObjId)` → `textDownloadTask.create` со
      `{ status: QUEUED, ingestError: null, finishedAt: null }`;
    - есть (`P2002`) → решение по текущему статусу найденной задачи, см. матрицу в §3.
3. `publish()` → `KafkaService.publish(KAFKA_TOPIC_TEXT_DOWNLOAD, key = String(taskId), { textTaskId, sourceObjId })`.
   Ключ = id задачи: доставки по одной задаче не переставляются между партициями.
4. Если Kafka не приняла сообщение — `rollbackQueueing()`: созданную строку удаляем,
   перепоставленную возвращаем в `FAILED` с причиной `Task has not been queued: …`. Иначе `QUEUED`
   без сообщения заняла бы уникальный ключ и отрезала бы клиенту повторный POST. Ответ — **503**.
5. Успех: **202 Accepted** с `TextTaskResponseDto` (`taskId`, `status: "QUEUED"`,
   `textId`/`textTitle` — `null`, `sentenceCount: 0`). Обращения к источнику в этом запросе нет.

> `sourceObjId` дублируется в payload, но исполнитель его не читает: `claim()` и так перечитывает
> строку задачи и берёт `sourceObjId` из БД. Поле оставлено как запас для будущего лоадера,
> который захочет стартовать без чтения БД.

### 2.2 Исполнение (`src/modules/ingestion/`)

1. `TextDownloadConsumer.onModuleInit()` → `KafkaService.createConsumer({ groupId: KAFKA_GROUP_ID, topic: KAFKA_TOPIC_TEXT_DOWNLOAD, run.eachMessage })`.
   Подписка один раз на жизнь процесса; `fromBeginning: true` по умолчанию — backlog, накопленный
   пока worker'а не было, обрабатывается.
2. `handleMessage()`: пустое тело / не-JSON / неподходящая форма (`isTextDownloadEvent`, в том
   числе legacy-payload со старым полем `textId`) → warn и **глотаем**, сообщение не возвращается
   в kafkajs.
3. `IngestionService.process(textTaskId)`:
    1. `claim()` — `textDownloadTask.updateMany` (`status in [QUEUED, PROCESSING] → PROCESSING`,
       `ingestError = null`). Это CAS: `count = 0` значит задача уже `READY`/`FAILED` или удалена →
       `false`, повторная доставка идемпотентна. Зависший `PROCESSING` (worker умер посреди задачи)
       берётся в работу повторно.
    2. `textDownloadTask.findUnique()` → полная строка задачи.
    3. `loadBySource(task)` — маршрутизация по `task.source`:
        - `GutenbergTxtLoader.load(sourceObjId)` — `src/modules/gutenberg_loader/gutenberg-txt.loader.ts`:
            1. `GutenbergApiService.getBookMeta()` → `GET https://{X-RapidAPI-Host-Gutenberg}/books/{id}`
               (1 запрос квоты); `removed_from_catalog` / `is_available === false` → `BadRequestException`.
            2. `GutenbergApiService.getCleanedText()` → `GET /books/{id}/text?cleaning_mode=simple`
               (2-й запрос). `simple` снимает Gutenberg-шапку/подвал, но оставляет заголовки и
               структуру; `super` вырезал бы сноски и мог съесть валидный контент.
            3. `metadata.original_length` ≤ 5 МБ (`MAX_SOURCE_LENGTH`);
            4. `resolveLanguage()`: по `languages[]` каталога через `toSupportedLanguage()`
               (`src/modules/text/utils/supported-language.ts`), при пустом/нераспознанном —
               фолбэк на LibreTranslate `POST {LIBRETRANSLATE_URL}/detect` по первым 2000 символов
               (порог уверенности 50 %, сбой детекции не топит загрузку); ни так ни так →
               `BadRequestException`;
            5. итог — `TextLoadResult { title, content, language }`.
    4. `splitIntoSentences(loaded.content)` — `utils/split-into-sentences.ts` на wink-nlp (движок
       лениво инициализируется один раз на процесс). **Синхронный CPU** ~0.2–0.3 с на 1 МБ — ради
       этого шага worker и вынесен в отдельный процесс. Пусто →
       `Error("No sentences recognized in the source text")`. Хард-переносы строк внутри предложения
       сохраняются как есть — их снимает клиент при рендере.
    5. `persist()` — **одна транзакция**: `text.create` (вот где текст появляется на свет) →
       `textSentence.createMany` пачками по 500 (`SENTENCES_BATCH_SIZE`) →
       `textDownloadTask.update({ status: READY, textId, finishedAt })`.
       Прежний `deleteMany` перед вставкой больше не нужен: при сбое транзакция откатывается
       целиком, и повторный старт не может застать половину вставки.
    6. Любой сбой → `markFailed()`: `status = FAILED`, `ingestError = message`, `finishedAt`.
       Ошибка **не** уходит в kafkajs: детерминированный повтор только сожрал бы квоту источника,
       поэтому задача становится терминальной и ждёт нового POST.
    7. graceful-поведение на SIGTERM держится на `enableShutdownHooks()` в `src/entrypoints/worker/main.ts`:
       `onModuleDestroy` отключает консьюмера и Prisma.

## 3. Матрица: повторный `POST /text` над существующей задачей

| Текущий статус задачи | Ответ                    | Что происходит                                                         |
| --------------------- | ------------------------ | ---------------------------------------------------------------------- |
| `QUEUED`              | **202**, тот же `taskId` | задача перепоставляется (прошлое сообщение могло потеряться)           |
| `PROCESSING`          | **409**                  | `Text download task N is already in progress`                          |
| `READY`               | **409**                  | `Text is already ingested (textId=N)` — id текста прямо в сообщении    |
| `FAILED`              | **202**, тот же `taskId` | сброс в `QUEUED`, `ingestError`/`finishedAt` очищены, новый `_publish` |

Дубль сообщения в очереди безвреден: второй доставки не будет — `claim()` не возьмёт задачу,
которая уже `PROCESSING` или `READY`.

## 4. Статусы и маршруты

| Маршрут                   | Метод                                                        | Что делает                                                                                                     |
| ------------------------- | ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| `POST /text`              | `TextController.create` → `TextService.create`               | ставит/перепоставляет задачу, **202**                                                                          |
| `GET /text/tasks/:taskId` | `TextController.getTaskStatus` → `TextService.getTaskStatus` | `textDownloadTask.findUnique` с `text { id, title, _count.sentences }`; 404, если задачи нет. Только чтение БД |
| `GET /text/:id`           | `TextController.getOne` → `TextService.getOne`               | склейка всех `text_sentences` по `position` в `content`; id берётся из `textId` предыдущего ответа             |

Поллинг: `QUEUED → PROCESSING → READY | FAILED`. Ответ обоих эндпоинтов — один и тот же
`TextTaskResponseDto`: `{ taskId, status, source, sourceObjId, textId, textTitle, sentenceCount, ingestError, finishedAt }`.
`taskId` и `textId` — id **разных** сущностей, не путать: `/text/7` и `/text/tasks/7` отвечают про
разное.

> ⚠️ **`GET /text/:id` сейчас всегда отвечает 400** (проверено живым запросом 2026-09-10):
> `@Param() params: GetTextChunkDto` тянет обязательные `offset`/`limit` из path, где их нет.
> Пагинация по предложениям (`nextOffset`/`isEnd` в `GetTextChunkResponseDto`) ещё не реализована —
> DTO пока в статусе задела.

## 5. Ошибки: что видит клиент, а что оседает в БД

| Ситуация                                                                                | HTTP                               | След в БД                                                                             |
| --------------------------------------------------------------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------- |
| невалидный `CreateTextDto`                                                              | 400                                | —                                                                                     |
| задача уже в работе / уже загружена                                                     | 409 (сообщение с `textId`, см. §3) | ничего не меняется                                                                    |
| Kafka не приняла сообщение                                                              | 503                                | новая строка удалена; перепоставленная вернулась в `FAILED` с причиной отказа очереди |
| источника нет в каталоге / квота 429 / язык не определён / текст > 5 МБ / 0 предложений | 202 (задача-то поставлена)         | `FAILED` + `ingestError`, например `Gutenberg API resource not found: /books/{id}`    |
| несуществующий `taskId`                                                                 | 404                                | —                                                                                     |

Всё, что падает **после** 202, в HTTP-код не превращается никогда: единственный способ узнать
исход — `GET /text/tasks/:taskId`.

## 6. Запуск и проверка

```bash
pnpm build                        # компилирует и API, и worker
pnpm start:dev                    # терминал 1: HTTP на :4000 (без консьюмера)
pnpm start:worker                 # терминал 2: консьюмер Kafka; без него задачи висят в QUEUED

curl -i -X POST localhost:4000/text -H 'content-type: application/json' -d '{"source":"GUTENBERG","sourceObjId":11}'
curl localhost:4000/text/tasks/1   # QUEUED → PROCESSING → READY; в READY придёт textId
curl localhost:4000/text/1         # контент по textId из предыдущего ответа
```

После правки схемы: `pnpm prisma db push` **не** перегенерирует клиент сам — нужен
`pnpm prisma generate`, иначе `nest build` падает на отсутствующем delegate.

Измерено на dev-стенде 2026-09-10 (схема с `text_download_tasks`): `POST` — **202 за 37 мс**;
`Text` создан через **6.8 с** после приёмки запроса (всё это время в `texts` было 0 строк);
`GET /text/tasks/1` — **200 за 13.7 мс**, `READY`, `textId: 1`, `sentenceCount: 1734`;
из 3 заведённых задач в БД текст имели только 1.

Без HTTP и без Kafka: `pnpm ingestion:smoke [bookId]` — ставит/перепоставляет задачу напрямую и
вызывает `IngestionService.process()`, минуя очередь.

## 7. Тесты

`src/modules/text/test/text.service.spec.ts` — открытие и перепоставка задачи, матрица конфликтов,
откат при отказе очереди, разбор статуса. Исполнитель и консьюмер: `src/modules/ingestion/test/`,
контракт события: `src/modules/kafka/test/`. Запуск `pnpm jest`.

В `package.json` → `jest.moduleNameMapper` лежат два маппера: на `prisma/generated/*`
(pnpm-симлинк пакета `prisma` не отдаёт этот сабпуть) и на ESM-расширения `.js` внутри
сгенерированного клиента — без них сюиты не падают, а **не запускаются**, при зелёном `pnpm build`.

## 8. Точки расширения

- **Второй источник:** значение в enum `Source` (изменение схемы — согласовать), реализация
  контракта `TextLoader` (`interfaces/text-loader.interface.ts`), провайдер в модуле источника и
  ветка в `IngestionService.loadBySource`. `TextService.create`, таблица задач и контракт события
  остаются источник-агностичными.
- **Пагинация выдачи:** `GetTextChunkDto`/`GetTextChunkResponseDto` уже описаны, `getOne` их
  игнорирует.
- **История попыток:** сейчас задача хранит только последнюю попытку (`ingestError`, `finishedAt`).
  Если понадобится аудит ретраев — счётчик `attempts` или отдельная таблица попыток, а не
  переустановка статусов в `POST`.
