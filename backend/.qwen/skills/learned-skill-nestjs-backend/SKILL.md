---
name: nestjs-backend
description: Playbook for building NestJS features (modules, DI, controllers, pipes/validation, config, Prisma, queues, lifecycle enhancers) per the official docs, including v11-vs-v12 API drift checks.
source: learned
---

# NestJS Backend Playbook

Знание дистиллировано из официальной документации https://docs.nestjs.com (полный текст глав доступен как `https://docs.nestjs.com/llms.txt` — индекс и `https://docs.nestjs.com/llms-full.txt` — вся документация одним файлом; сами страницы рендерятся JS-приложением, поэтому `web_fetch` по URL глав отдаёт пустой каркас).

Идентификаторы сверены с установленным в этом репозитории `@nestjs/common@11.2.3`. Живая документация описывает **NestJS v12**, проект — на **v11**: перед использованием нового API проверяй его наличие (см. Pitfalls).

## When to Use

- Реализуешь новую фичу в NestJS-модуле: контроллер + сервис + DTO + доступ к БД.
- Проектируешь границы модулей, разделяешь провайдеры, решаешь `Nest can't resolve dependencies`.
- Настраиваешь валидацию входа, обработку ошибок, форматирование ответа, guards/interceptors/pipes/middleware.
- Добавляешь конфигурацию (`@nestjs/config`), Prisma/PostgreSQL, очереди/фоновые задачи, кеширование, Swagger, тесты.
- Отлаживаешь «задумавшийся» запрос, неверный порядок выполнения enhancer'ов или конфликтующие маршруты.

## Procedure

### 1. Держи в голове карту request lifecycle

Документация (`faq/request-lifecycle`) задаёт точный порядок:

1. Входящий запрос
2. Middleware — сначала глобально привязанные (`app.use`), затем привязанные к модулям; внутри — по порядку привязки, модули в порядке `imports`
3. Guards — global → controller → route
4. Interceptors (pre-controller) — global → controller → route
5. Pipes — global → controller → route → route parameter pipes
6. Controller (method handler)
7. Service (if exists)
8. Interceptors (post-request) — **наоборот**: route → controller → global (FILO, т.к. это RxJS-observables)
9. Exception filters — **тоже наоборот**: route → controller → global
10. Server response

Дополнительные правила из той же главы:
- Pipes на уровне метода обходят аргументы в порядке `@Query` → `@Param` → `@Body`; параметр-пайпы идут после controller/route-пайпов и применяются от последнего параметра к первому.
- Ошибки, выброшенные pipes / controller / service, видны в `catchError` интерцептора.
- Filters не умеют передавать исключение дальше по цепочке: поймал route-filter — controller/global уже не сработают (для этого — наследование фильтров). Срабатывают только на **непойманные** исключения; `try/catch` в обработчике отключает фильтр.
- Исключения из middleware обрабатывает exceptions layer, но применяются **только глобальные** фильтры (route ещё не выбран).

### 2. Оформляй фичу как модуль

- Модуль — класс с `@Module({...})`; ключи метаданных: `providers`, `controllers`, `imports`, `exports`. Каждый корневой `AppModule` — стартовая точка «application graph».
- Провайдеры инкапсулированы по умолчанию: внедрить можно только провайдер текущего модуля либо явно экспортированный импортируемым модулем. `exports` — это публичный API модуля; указывать можно сам провайдер или его `provide`-токен.
- Модули — синглтоны, поэтому экспорт + импорт даёт один общий экземпляр. Регистрировать один и тот же сервис в `providers` каждого модуля можно, но это отдельные экземпляры (лишняя память + рассинхрон состояния).
- Можно ре-экспортировать чужой модуль: `imports: [CommonModule], exports: [CommonModule]`.
- Класс модуля может внедрять провайдеры в конструктор, но сам модуль как провайдер внедряемым не является (circular dependency).
- `@Global()` — только при реальной необходимости, регистрируется один раз (обычно в root/core модуле). Документация прямо называет «сделать всё глобальным» плохим дизайн-решением.
- Динамический модуль: `static forRoot(...): DynamicModule` (может возвращать `Promise`). Возвращаемые свойства **расширяют**, а не перекрывают метаданные `@Module()`. Глобальность — свойство `global: true` в возвращаемом объекте. Ре-экспорт динамического модуля — `exports: [DatabaseModule]` без вызова `forRoot()`. Для конфигурируемых модулей есть `ConfigurableModuleBuilder`.
- CLI: `nest g module|controller|service|resource` (в проекте есть алиас `pnpm nest:gen-res`).

### 3. Провайдеры и DI

- Делегирование: контроллер принимает/отдаёт HTTP, сервис — логика. Документация рекомендует SOLID.
- Токеном по умолчанию является класс: `constructor(private readonly catsService: CatsService) {}`. `private` — TS parameter property; рантайм-связь строится на `emitDecoratorMetadata`, поэтому в аннотации должен быть **класс**.
- Интерфейс/`type`-алиас стирается при компиляции → `Nest can't resolve dependencies of ...`. Для «неклассов» нужен токен + явный `@Inject('TOKEN')`.
- Кастомные провайдеры: `useValue` / `useClass` / `useFactory` / `useExisting` (детали — см. шаг «Async/фабрики»).
- `@Optional()` меняет поведение только при отсутствии провайдера: внедрится `undefined`, и класс сам обязан дать fallback (например, смёржить с дефолтами).
- Property-based injection (`@Inject()` над полем) — исключение для случаев наследования; иначе предпочитай конструктор.
- Область жизни: `@Injectable({ scope: Scope.DEFAULT | Scope.TRANSIENT | Scope.REQUEST })` — `Scope` экспортируется из `@nestjs/common` (в этом билде `ScopeEnum` отсутствует). `DEFAULT` — singleton на всё приложение; `TRANSIENT` — новый экземпляр на каждое использование; `REQUEST` — на каждый запрос. `durable: true` имеет смысл только вместе с `Scope.REQUEST`.
- Почти всё в Nest shared между запросами (Node не использует модель «поток на запрос»), поэтому singleton-сервисы и пул соединений безопасны. REQUEST-скоуп нужен лишь для per-request кеша, трассировки, мультитенантности — и он дорог.
- Достать провайдер вручную: `ModuleRef.get()`; получить провайдер внутри `bootstrap()` — standalone-подход.

### 4. Контроллер: маршрутизация и контракт ответа

- `@Controller('prefix')`, методы `@Get/@Post/@Put/@Patch/@Delete/@All/@Options/@Head` с опциональным сегментом пути.
- Порядок объявления важен: Nest регистрирует маршруты в порядке объявления, и на Express-адаптере `@Get(':id')` молча затмит объявленный ниже `@Get('me')`. Пайпы тут не спасают — маршрут выбирается **до** выполнения пайпов. Держи конкретные литеральные пути выше параметрических.
- Статус по умолчанию: 200, для POST — 201; меняется `@HttpCode(...)`. Заголовок — `@Header('Cache-Control', 'no-store')`.
- Инъекция `@Res()` или `@Next()` переводит маршрут на library-specific подход: стандартная сериализация отключается, и ответ обязан отправить сам код. Если нужен и объект ответа, и стандартная обработка — `@Res({ passthrough: true })`.
- Обработчики могут быть `async` (возвращают `Promise`) или возвращать RxJS `Observable` — Nest подписывается сам и берёт финальное значение; поток обязан завершиться (FILO).
- Всё в приложении shared между запросами — состояние в singleton-сервисе допустимо и не «протечёт» между потоками.

### 5. Вход: DTO и pipes

- DTO — **класс**, а не интерфейс: пайпам нужен runtime-`metatype`.
- Встроенные пайпы из `@nestjs/common`: `ValidationPipe`, `ParseIntPipe`, `ParseFloatPipe`, `ParseBoolPipe`, `ParseArrayPipe`, `ParseUUIDPipe`, `ParseEnumPipe`, `DefaultValuePipe`, `ParseFilePipe`, `ParseDatePipe`.
- Привязка: `@Param('id', ParseIntPipe)` — передаёшь класс, экземпляр создаёт фреймворк (значит внутри пайпа работает DI). Инстанс (`new ParseIntPipe({ errorHttpStatusCode: HttpStatus.NOT_ACCEPTABLE })`) нужен, когда передаёшь опции.
- `Parse*` падают на `null`/`undefined`. Для значений по умолчанию ставь `DefaultValuePipe` **перед** `Parse*`: `@Query('page', new DefaultValuePipe(0), ParseIntPipe) page: number`.
- Кастомный пайп: `class X implements PipeTransform<In, Out>` с `transform(value, metadata: ArgumentMetadata)`; возвращаемое значение **полностью заменяет** аргумент — на этом построены и валидация, и трансформация (например `UserByIdPipe`, достающий сущность из БД по id).
- Глобальный `ValidationPipe` с `whitelist: true` молча вырезает поля, не описанные в DTO; `forbidNonWhitelisted` превращает это в ошибку. Глобальное назначение — либо `app.useGlobalPipes()` в `main.ts`, либо провайдер `APP_PIPE` (тогда доступен DI).

### 6. Ошибки

- Бросай встроенные HTTP-исключения (`BadRequestException`, `UnauthorizedException`, `ForbiddenException`, `NotFoundException`, `ConflictException`, `NotAcceptableException`, `InternalServerErrorException`, `ServiceUnavailableException` и др. из `@nestjs/common`) — встроенные фильтры сериализуют их в стандартный ответ.
- Кастомный фильтр: `@Catch(HttpException)` + `implements ExceptionFilter`, `catch(exception, host: ArgumentsHost)` → `host.switchToHttp()` → `getResponse()`. `@Catch()` без аргументов ловит всё.
- Порядок фильтров и «один фильтр на исключение» — см. шаг 1.
- Исключения вне контекста запроса (например из фонового таска) в HTTP-фильтр не попадают.

### 7. Куда вешать enhancer'ы

- Два способа: `app.useGlobalGuards/Pipes/Interceptors/Filters()` в `main.ts` или провайдеры с токенами `APP_GUARD` / `APP_PIPE` / `APP_INTERCEPTOR` / `APP_FILTER` (токены — из `@nestjs/core`). Только второй даёт внедрение зависимостей.
- `@UseGuards/@UsePipes/@UseInterceptors/@UseFilters` — на уровне контроллера или метода.
- Собственные декораторы-метаданные: `SetMetadata(KEY, value)` + чтение через `Reflector` (из `@nestjs/core`), обычно `reflector.getAllAndOverride<boolean>(KEY, [context.getHandler(), context.getClass()])`. В v12 для этого рекомендуют `Reflector.createDecoration()` (в v11 его нет).
- `ExecutionContext` — platform-agnostic обёртка: `switchToHttp()/switchToRpcContext()/switchToWsContext()`.

### 8. Конфигурация и БД

- `ConfigModule.forRoot({ isGlobal: true })` — чтобы не импортировать `ConfigModule` в каждый модуль; без `isGlobal` импорт обязателен в каждом потребителе.
- Доступ — `ConfigService.get<T>('KEY')` / `getOrThrow<T>('KEY')` (в проекте `PrismaService` уже делает `configService.getOrThrow<string>('DATABASE_URL')`).
- `expandVariables: true` включает подстановку `${...}` из других переменных (внутри используется `dotenv-expand`).
- Документация предупреждает: конфигурационные файлы **не** валидируются автоматически даже при заданном `validationSchema` — валидация/трансформация делается в фабричной функции.
- Схема БД в проекте — Prisma (`prisma/prisma.schema`), сервис `PrismaService extends PrismaClient` с драйвером `PrismaPg`, коннект в `onModuleInit` (`$connect`), разрыв в `onModuleDestroy`.

### 9. Долгие операции и фоновые задачи

- Очереди: `@nestjs/bullmq` — `BullModule.forRoot(...)` (подключение к Redis), `BullModule.registerQueue({ name: 'audio' })`, внедрение `@InjectQueue('audio') audioQueue: Queue`, обработчик — класс с `@Processor('audio')` и метод с `@Process(...)`.
- `@nestjs/schedule` — `@Cron()` / `CronExpression`, `SchedulerRegistry` для управления задачами по имени (релевантно напоминаниям интервального повторения).
- `@nestjs/event-emitter` — `EventEmitterModule.forRoot()` регистрирует декларативных слушателей на `onApplicationBootstrap`; `@OnEvent('order.created')`, эммит через внедрённый `EventEmitter2`. Подписчики **не могут** быть request-scoped. События, выпущенные до завершения `onApplicationBootstrap`, теряются — жди `EventEmitterReadinessWatcher.waitUntilReady()`.
- В обработчиках запросов не блокируй event loop: только async I/O (`fs/promises`, стримы), никакого `*Sync`.

### 10–12. Ответ / Swagger / Тесты

_(детали по конкретным API — уточняются; см. ссылки в Source map)_

- Форма ответа в проекте унифицирована глобальным интерцептором `TransformResponseInterceptor` (`src/interceptors/`).
- Swagger поднят в `main.ts`: `DocumentBuilder().addBearerAuth()`, `SwaggerModule.setup('/docs', ...)` с `jsonDocumentUrl`/`yamlDocumentUrl`.
- Тестов в репозитории пока нет; Jest настроен в `package.json` (`rootDir: src`, `testRegex: .*\.spec\.ts$`), e2e — `supertest`.

### 13. Проверка

```bash
pnpm build            # nest build — единственный обязательный gate (приложение сам не запускаю)
pnpm format           # prettier --write src/**/*.ts test/**/*.ts
pnpm exec jest        # unit-тесты (script "test" в package.json отсутствует)
```

`lint`-скрипт в проекте не настроен (eslint-конфиг лежит как `eslint.config.backup.mjs`), поэтому ориентир — `pnpm build` + `.prettierrc` (табы, `tabWidth: 4`, `printWidth: 120`, двойные кавычки).

## Pitfalls

- **Дрейф версии.** Актуальная документация описывает v12. В установленных v11.2.3 **нет**: `StandardSchemaValidationPipe`, `RouteConflictException`, опций `routeConflictPolicy` / `routeResolutionStrategy`, опции `schema` у `@Body()/@Query()/@Param()`, `StandardSchemaSerializerInterceptor`, `HttpExceptionOptions.errorCode`, `structuredParams` у `ConsoleLogger`. Проверяй перед применением:
  ```bash
  node -e "const c=require('@nestjs/common'); console.log('StandardSchemaValidationPipe' in c)"
  ```
- **`ScopeEnum` vs `Scope`.** В этом билде из `@nestjs/common` экспортируется enum `Scope` (`DEFAULT=0, TRANSIENT=1, REQUEST=2`); `ScopeEnum` не существует — импорт «как в старых примерах» не скомпилируется.
- **Не тот пакет импорта.** `Reflector`, `ModuleRef`, `DiscoveryService`, `HttpAdapterHost`, `NestFactory` и токены `APP_GUARD/APP_PIPE/APP_INTERCEPTOR/APP_FILTER` — из `@nestjs/core`; декораторы, пайпы, исключения, `Logger` — из `@nestjs/common`.
- **Интерфейс как токен.** Внедрение по `interface`/`type` даёт `Nest can't resolve dependencies of X (...); please make sure the argument is valid` — нужен `@Inject(TOKEN)`.
- **`@Res()` без `passthrough`.** Смешивание «вернуть значение» и «записать в response» ломает стандартную обработку; без отправки ответа запрос висит. Незавершающийся `Observable` — та же проблема.
- **Тень маршрутов.** `@Get(':id')` перед `@Get('me')` на Express перехватывает `/me`. Диагностика (`routeConflictPolicy`) есть только в v12, так что в v11 порядок объявления — часть ревью.
- **`whitelist: true` без `forbidNonWhitelisted`** тихо вырезает неизвестные поля: клиент думает, что что-то сохранилось.
- **Глобальные фильтры/пайпы через `app.useGlobal*()` не получают DI.** Нужен DI — регистрируй `APP_FILTER`/`APP_PIPE` провайдером в модуле, где определён сам пайп/фильтр.
- **`@Global()` вместо `imports`.** Быстро снимает boilerplate и так же быстро плодит неконтролируемую связанность; документация это не рекомендует.
- **Request-scoped провайдеры** тянут за собой весь граф потребителей на каждый запрос — не «бесплатная» фича.
- **Исключения из `bootstrap()`, репозиториев и фоновых задач** не проходят через контроллерные фильтры — для них свой error handling.
- **События раньше `onApplicationBootstrap`** теряются; слушатели ещё не зарегистрированы.
- **Секреты.** Значения только в `.env`, документировать ключ в `.env.example`.

## Source map

Разделы официальной документации, из которых собрано это знание (slug после `docs.nestjs.com/`):
`controllers`, `providers`, `modules`, `middleware`, `exception-filters`, `pipes`, `guards`, `interceptors`, `custom-decorators`, `fundamentals/custom-providers`, `fundamentals/async-providers`, `fundamentals/dynamic-modules`, `fundamentals/injection-scopes`, `fundamentals/circular-dependency`, `fundamentals/module-ref`, `fundamentals/lazy-loading-modules`, `fundamentals/execution-context`, `fundamentals/lifecycle-events`, `fundamentals/discovery-service`, `fundamentals/testing`, `techniques/configuration`, `techniques/database`, `techniques/validation`, `techniques/caching`, `techniques/serialization`, `techniques/task-scheduling`, `techniques/queues`, `techniques/logger`, `techniques/http-module`, `techniques/events`, `recipes/prisma`, `openapi/introduction`, `faq/request-lifecycle`, `faq/http-adapter`, `faq/global-prefix`, `faq/keep-alive-connections`, `migration-guide` (v11 → v12).
