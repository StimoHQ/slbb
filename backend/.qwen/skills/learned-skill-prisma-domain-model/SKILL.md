---
name: prisma-domain-model
description: Карта доменной модели SLBB (Prisma schema): сущности, инварианты, соглашения нейминга и типовой цикл чтения/словаря — куда писать данные и как менять схему без нарушения целостности.
source: learned
---

# Prisma Domain Model (SLBB)

Знание дистиллировано из `prisma/schema.prisma` и практики его использования в `src/modules/*` (Prisma 7 + PostgreSQL + driver adapter `@prisma/adapter-pg`).

## When to Use

- Реализуешь фичу, которая читает/пишет в БД: загрузка книги, извлечение слов, личный словарь, интервальное повторение.
- Решаешь, в какую таблицу положить новое поле (Text vs TextContent vs LexicalUnit vs UserLexicalUnit).
- Меняешь `prisma/schema.prisma`: добавляешь модель, enum, уникальное ограничение или relation.
- Отлаживаешь `P2002` / дубликаты при импорте контента или добавлении слова в словарь.

## Procedure

### 1. Держи в голове граф сущностей

```
User 1──* UserLexicalUnit *──1 LexicalUnit 1──* LexicalUnitOccurrence *──1 Text 1──1 TextContent
```

| Модель | Роль | Ключевые поля |
|---|---|---|
| `User` (`users`) | Аккаунт | `email @unique`, `name?`, `nativeLanguage: NativeLanguage` (default `RU`) |
| `Text` (`texts`) | Метаданные книги/статьи | `title`, `language: LearningLanguage` (default `ENG`), `source` (default `GUTENBERG`), `sourceObjId`, `sourceMeta Json? @db.JsonB` |
| `TextContent` (`text_contents`) | Тяжёлый текст, **1:1 с Text** | `textId @unique`, `content @db.Text` |
| `LexicalUnit` (`lexical_units`) | Глобальный словарь лемм/фраз | `value` — `@@unique([value])` |
| `LexicalUnitOccurrence` (`lexical_unit_occurrences`) | Вхождение слова в конкретный текст | `lexicalUnitStartPos`, `lexicalUnitTranslation`, `context @db.Text` |
| `UserLexicalUnit` (`user_lexical_units`) | Прогресс пользователя по слову | `status: StudyStatus` (default `LEARNING`), `userNote?` |

Enums (все четыре — `StudyStatus`, `LearningLanguage`, `NativeLanguage`, `Source`):

```prisma
enum StudyStatus     { LEARNING REVIEWING MASTERED }
enum LearningLanguage { ENG }   // язык изучаемого контента (Text.language)
enum NativeLanguage  { RU }     // родной язык пользователя (User.nativeLanguage)
enum Source          { GUTENBERG }
```

> Срез схемы от 2026-09-03: прежний общий `Language { ENG, RU }` разделён на `LearningLanguage`/`NativeLanguage`, а `TextType { BOOK, ARTICLE, RSS_FEED }` и `TextFormat { TXT, HTML, MARKDOWN, PDF }` **удалены вместе с колонками `Text.type` и `Text.format`**. `type`/`format` в модели нет — см. п. 2.

### 2. Соблюдай инварианты модели

- **Контент отдельно от метаданных.** Полный текст живёт только в `TextContent` (`@db.Text`) — в `Text` его не дублировать. `Text → TextContent` каскадируется (`onDelete: Cascade`), поэтому создание книги = `prisma.text.create({ data: { ..., content: { create: {...} } } })`, а удаление книги само чистит контент и все `occurrences`.
- **Два разных enum для двух разных смыслов языка.** `Text.language` — язык того, что изучают (`LearningLanguage`, сейчас только `ENG`); `User.nativeLanguage` — язык интерфейса/переводов пользователя (`NativeLanguage`, сейчас только `RU`). Это разные TS-типы: присвоить одно другому не даст компилятор, и не надо «склеивать» их обратно в один `Language` — `RU` в контенте и `ENG` у носителя-новичка семантически неравнозначны.
- **Формат и тип контента в БД не хранится.** `Text` не имеет `format`/`type`: на MVP источник один (`Source.GUTENBERG`), формат один (plain-text), а всё остальное, что отличает книги друг от друга, ездит в `sourceMeta` (`Json? @db.JsonB`). Не «восстанавливать» `TextFormat` для полноты; если реально понадобится второй формат/тип — это отдельное решение с миграцией, а не свободная колонка.
- **Слово дедуплицируется глобально по `value`.** Одно и то же слово в разных текстах — одна `LexicalUnit`. Перед вставкой — `upsert` по `where: { value }` (уникальное поле, не `id`).
- **Перевод привязан к вхождению, не к слову.** `lexicalUnitTranslation` лежит в `LexicalUnitOccurrence`, потому что у слова контекстные переводы. В `LexicalUnit` перевод не добавлять.
- **Импорт идемпотентен по `@@unique([source, sourceObjId])`.** `sourceObjId` — внешний id источника (для Gutenberg — номер книги из URL `epub/79501/pg79501.txt`). Повторный импорт той же книги должен давать upsert по этому составному ключу, а не новую строку.
- **Один прогресс на пару пользователь+слово:** `@@unique([userId, lexicalUnitId])` в `UserLexicalUnit` → добавление слова в словарь = `upsert({ where: { userId_lexicalUnitId: { userId, lexicalUnitId } } })`.
- **Удаление слова не должно ронять словарь пользователя:** у `UserLexicalUnit.lexicalUnit` стоит `onDelete: NoAction` (в то время как всё остальное каскадируется). Не «улучшать» до Cascade — это защищённая ссылка.

### 3. Следуй соглашениям оформления схемы

- Таблицы — `@@map("snake_case_plural")`, колонки — `@map("snake_case")` для составных (`sourceObjId → source_obj_id`, `nativeLanguage → native_language`).
- PK: `Int @id @default(autoincrement())` (не cuid/uuid — не менять без причины).
- Обязательная пара `createdAt @default(now()) @map("created_at")` + `updatedAt @updatedAt @map("updated_at")` в каждой модели.
- Комментарии на русском после полей, секции `// Fields`, `// Relations`, `//Table Meta`.
- Для сырых JSON-полей — `@db.JsonB`, для больших текстов — `@db.Text`.
- Enum'ы — по смыслу, а не по значению: новые значения только в конец списка (Postgres-enum), значения в верхнем регистре.

### 4. Правильно импортируй сгенерированный клиент (Prisma 7)

Генератор `prisma-client`, `output = "./generated"`, `moduleFormat = "cjs"`. В `datasource db` строки подключения **нет** — она приходит из `prisma.config.ts` (`url: env('DATABASE_URL')`). Где что лежит:

```ts
import { PrismaClient, Text, TextContent } from "prisma/generated/client"; // клиент + типы моделей
import { LearningLanguage, NativeLanguage, Source, StudyStatus } from "prisma/generated/enums"; // values+types enum'ов
import type { TextCreateInput, UserWhereInput } from "prisma/generated/models"; // input/args-типы (barrel моделей)
import { PrismaClientKnownRequestError } from "prisma/generated/internal/prismaNamespace";
```

- Типы моделей (`Text`, `User`, …) экспортируются и из `client`, и из `browser` — `prisma/generated/browser` годится для type-only импортов, которые могут уехать в общую с фронтом сборку (так сделано в `src/modules/text/interfaces/text-loader.interface.ts`).
- `client.ts` сам реэкспортирует enum'ы (`export * from "./enums.js"`), но держать enum'ы на `prisma/generated/enums`, а модели на `client` — текущее соглашение проекта.
- `PrismaService extends PrismaClient` создаётся через адаптер `new PrismaPg({ connectionString: configService.getOrThrow<string>("DATABASE_URL") })` — голый `new PrismaClient()` без адаптера в Prisma 7 не работает.
- `DATABASE_URL` читается в `prisma.config.ts` через `env('DATABASE_URL')`; в коде — только через `ConfigService`, не `process.env`.
- После любой правки схемы — `pnpm prisma:generate`. Из prisma-скриптов в `package.json` только `prisma:generate`; путей миграций в скриптах нет, каталог `prisma/migrations` (зарезервирован в `prisma.config.ts` → `migrations.path`) пока не создан. Команды prisma CLI (`migrate dev`, `db push`) запускает пользователь; сервер приложения не поднимать.
- DTO/интерфейсы сервисов переиспользуют сгенерированные типы (`Text`, `TextContent`, enum'ы) вместо ручных дублей.

### 5. Типовой цикл фич (куда писать)

1. **Поиск/загрузка книги** → `Text` (метаданные + `sourceMeta` из Gutenberg) + `TextContent` (полный текст грузить только после проверки, что контент английский; см. `TextLoader`/`TextLoadResult` в `src/modules/text/interfaces/`). Запись — через upsert по `source_sourceObjId` с вложенным `content: { create: {...} }`.
2. **Извлечение слов (очередь/BullMQ)** → upsert `LexicalUnit` по `value` + вставка `LexicalUnitOccurrence` (позиция, контекст, перевод).
3. **«Добавить в словарь»** → upsert `UserLexicalUnit` (`status = LEARNING`).
4. **Интервальное повторение (SM-2)** → состояние расписания кладётся в `UserLexicalUnit` (это единственная «пользовательская» таблица прогресса); сейчас полей расписания (`nextReviewAt`, `interval`, `easeFactor`) в схеме **нет** — при реализации добавлять их туда через миграцию.
5. **Отдача контента клиенту** → чанками (`GetTextChunkDto`/`GetTextChunkResponseDto` в `src/modules/text/dto/get-text.dto.ts`: `offset`/`limit`/`nextOffset`/`isEnd`), целиком книгу в API не отдавать.

## Pitfalls

- **`P2002` на гонке upsert'ов.** Параллельные воркеры очереди, пишущие одно `value`/одну пару user+word, словят unique violation. Обработать `PrismaClientKnownRequestError` (`code === "P2002"` → повторить как read) и не превращать в 500.
- **Дублирование книг** при импорте: искать по составному `source_sourceObjId`, а не по `title` и не по одному `sourceObjId` (он уникален только в рамках источника).
- **Загрузка `content` в списках.** `Text.include: { content: true }` тянет книгу целиком — для лент/поиска брать только метаданные; `select` вместо `include`.
- **Перевод в `LexicalUnit`** — архитектурная ошибка: потеряешь контекстные значения и раздуешь словарь дублями.
- **Смена `onDelete: NoAction` → `Cascade`** у `UserLexicalUnit.lexicalUnit`: удаление слова «почистит» личные словари пользователей незаметно.
- **Импорт удалённых enum'ов.** `Language`, `TextType`, `TextFormat` в схеме больше нет: после `pnpm prisma:generate` любой остаточный импорт (`prisma/generated/enums`, `src/**`) упадёт в `tsc`/линтере. После смены enum'ов — грепать `src/` на старые имена и править DTO/интерфейсы, а не откатывать схему.
- **Смешивание `LearningLanguage` и `NativeLanguage`:** `User.nativeLanguage = LearningLanguage.ENG` не соберётся, и наоборот; язык пользователя не выводится из языка контента.
- **Ложное чувство безопасности у `language @default(ENG)`:** enum с одним значением + default — это не валидация, а запись «по умолчанию». `RU`-текст в `Text` положить нельзя, поэтому не-английский контент просто не должен попасть в загрузку: язык подтверждается эвристикой до скачивания полного текста (см. QWEN.md).
- **Отсутствие `updatedAt`/`@map`** в новой модели — рассогласование стиля и битые SQL-имена колонок в `$queryRaw`.
- **Импорт не из `prisma/generated/*`**: `@prisma/client` в Prisma 7 с кастомным `output` типов не даёт; линтер/`tsc` упадут.
