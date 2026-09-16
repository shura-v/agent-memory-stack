> Placement update: [select-deployment-services](../2026-09-16-select-deployment-services/proposal.md) now defines selectable services, optional integrations, and authenticated remote dependencies. The full server stack remains the default selection. Acceptance for both archived changes is limited to building images and starting containers. Comprehensive validation is deferred until Supergateway and the remaining connection work are implemented.

## Context

The motivation is described in [proposal.md](proposal.md). The `agent-memory-stack` npm package configures one Compose project on the current machine. Agents connect through the documented service APIs using their own configuration.

Аудит `../TencentDB-Agent-Memory` выполнен на commit `0468a2a5b50eaafc54758ed1e2e6609472e5b6ce`. Upstream совмещает генерацию конфигов, создание администратора и запуск процессов в установочных shell-скриптах. Core поддерживает env и файловую конфигурацию, Panel требует JSON registry, Knowledge сохраняет собственные LLM bindings, CLIProxyAPI изменяет OAuth-файлы. Эти различия учитываются отдельными модулями упаковки.

`tdai-recap.md` (operator-maintained installation notes) используется как источник регрессионных сценариев Forge. Исторический успешный HTTP-запрос, запись L0 и доступность Panel не доказывают L1/L2/L3, перенос факта между агентами или работоспособность новой установки на VPS. Локальные черновики реализации отражают предыдущие решения; при расхождении реализация приводится к этому плану. Установка и содержательная приёмка на VPS пока не выполнены.

## Goals / Non-Goals

**Goals:**

- Разделить интерактивную настройку, конфигурацию, bootstrap, сборку и запуск на понятные TypeScript-модули; предоставить установку из npm tarball без соседнего checkout.
- Запустить Core, Knowledge, Panel, MemoryProxy и CLIProxyAPI одним серверным Compose с постоянными данными и проверяемым порядком готовности.
- Собрать все реальные пользовательские параметры мастером, безопасно сформировать `.env` и машинные конфиги, передать первоначальный admin key только временным каналом.
- Дать клиентам проверенные HTTP/HTTPS-адреса и пользовательскую авторизацию для модели и Knowledge; публикацией доменов управляет собственный reverse proxy пользователя.
- Проверить смысловую работу памяти, доступ между разрешёнными участниками, запреты посторонним и восстановление согласованного состояния.

**Non-Goals:**

- Контейнеры, локальный relay, OAuth-хранилище или настройка VPN на клиенте.
- Caddy внутри Compose, управление ACME/TLS, DNS-автоматизация и автоматическая публикация сервисов в Интернет.
- HA, Redis, MongoDB, внешний IdP, полноценная многотенантная платформа или расширенный аудит всей upstream-системы безопасности.
- Автоматическая перезапись существующих конфигов агента без явного выбора, перенос данных Forge, npm/image publication, commit, push и удалённое развёртывание без отдельного поручения.

## Decisions

### 1. Direct stack setup and modular npm CLI

The package is named `agent-memory-stack` and exposes `ams`. Running `ams` enters stack setup directly without an action menu. `ams apply server` applies saved settings from the remembered installation location. Provider login and readiness checks belong to that setup/application flow.

Реализация использует TypeScript `strict`, ESM и `NodeNext`. Зависимость интерактивного интерфейса — `@clack/prompts` версии `1.8.1`, последней стабильной на момент проверки npm; версия фиксируется lockfile. Из `aict-cli` берётся принцип разделения ответственности: тонкая CLI-точка входа, слой взаимодействия с Clack, прикладные сценарии setup, модель и проверка конфигурации, адаптер контейнерного runtime и слой сборки/поставки. Доменные операции не импортируют prompt API. Shell-команды запускаются аргументами процесса, без интерполяции секретов в строку оболочки.

Пакет включает скомпилированный CLI, серверный Compose, runtime-ресурсы, Dockerfile/build assets, патчи и необходимые шаблоны. Пути ресурсов разрешаются относительно установленного пакета; изменяемый каталог установки выбирается отдельно. The packed archive must contain the assets required to run independently of the source checkout. Рабочие `.env`, базы, OAuth, резервные копии, кеши и любые секретные временные файлы исключаются из tarball и build context.

Авторские исходники располагаются в `src/`, скомпилированные entrypoints — в `dist/`; шаблоны и build assets принадлежат `server/`, `docker/` и `patches/`, проверки — `tests/`. Параллельные ручные JS-реализации в `runtime/` и `scripts/` заменяются скомпилированными модулями, чтобы изменения имели один источник.

| Область | Ответственность |
| --- | --- |
| `src/cli.ts`, `src/cli/` | Argument routing, direct setup entry, Clack interaction, cancellation |
| `src/setup/` | Stack setup and application through the interaction boundary |
| `src/config/` | типы и проверка параметров, чтение/запись env, генерация конфигов |
| `src/runtime/` | вызовы Compose, bootstrap, access adapter, загрузка окружения |
| `src/build/`, `src/patches/` | закреплённые исходники, сборка и manifest образов, применение патчей |

Это границы конкретных обязанностей; отдельные классы и универсальные фреймворки не требуются. Сценарии тестируются без терминала и настоящего контейнерного runtime.

### 2. Один серверный Compose и три loopback-входа

| Сервис | Ответственность | Доступ с хоста |
| --- | --- | --- |
| Core | Память и метаданные, bootstrap API | Порт не публикуется |
| Knowledge | Внутренняя обработка знаний и Wiki | Raw API не публикуется |
| Panel | Пользовательский интерфейс и собственный вход | Только `127.0.0.1:<panel-port>` |
| MemoryProxy | Запросы к модели с подключением памяти | Только `127.0.0.1:<proxy-port>` |
| CLIProxyAPI | Доступ к ChatGPT через Codex OAuth | Порт не публикуется |

В тот же Compose входят подготовка конфигов, явная одноразовая bootstrap-операция и адаптер доступа к Knowledge. Адаптер слушает только `127.0.0.1:<knowledge-port>` на хосте и обращается к raw Knowledge внутри Compose-сети. Служебные endpoints и дополнительные внутренние listeners не публикуются. Количество образов не ограничено; отдельные процессы имеют собственный жизненный цикл. Core использует штатный внутренний порт `8420`, CLIProxyAPI — `8317`; другие внутренние адреса задаются упаковкой.

Пользователь на своём хостовом reverse proxy, например Caddy, настраивает три независимых домена/HTTPS-адреса на соответствующие loopback-порты: API модели, Knowledge и Panel. Мастер спрашивает каждый внешний URL отдельно. Их нельзя выводить из общего `STACK_DOMAIN`: домены могут иметь разные зоны. Внешние URL используются в инструкциях клиента и сообщаемых сервисам адресах; ввод URL сам по себе не открывает порт и не изменяет Caddy/DNS. CLI может показать соответствие «внешний URL → loopback upstream» для ручной настройки. Для локальной проверки доступны прямые HTTP origins на loopback-портах без reverse proxy; схема, hostname/IP и порт задаются пользователем. Проверка сертификатов для HTTPS сохраняется.

The three `*_PUBLIC_URL` settings are service origins: `http://host[:port]` or `https://host[:port]`, without credentials, query, fragment, or API paths. Reverse proxies preserve the request path. Knowledge uses one `/v3` prefix followed by `/tools/list` or `/tools/call`. Manual agent configuration uses the documented MemoryProxy API base: `/codex/ams/v1` for Responses or `/hermes/ams/v1` for Chat Completions; the agent appends the operation suffix. `LLM_BASE_URL` instead holds the actual OpenAI-compatible provider base, preserving its required path. URL composition checks prevent duplicate prefixes.

При работе через существующий reverse proxy отдельно проверяются TLS, длинные ответы, SSE, используемый агентом WebSocket Upgrade, отмена запроса и cookies/redirects Panel. Владение сертификатами и конфигурацией reverse proxy остаётся вне пакета. Альтернатива с встроенным Caddy расширяет согласованную ответственность и конфликтует с управлением хостом пользователя.

### 3. Setup server собирает полную конфигурацию

Мастер спрашивает все пользовательские параметры: каталог установки и данных, выбранный runtime/provider, три loopback-порта, три внешних URL, реальные LLM endpoints/API keys и модели, а также необходимые прикладные настройки. Для операционных параметров разрешены понятные defaults, но пользователь видит и подтверждает итоговые значения. Секретные ответы скрываются при вводе и не попадают в summary; API-ключ провайдера сохраняется без изменения его значения и префикса.

Port questions precede service URL questions. Without a saved URL, setup suggests `http://127.0.0.1:<selected-port>` using initial ports `8096`, `8422`, and `8123` for MemoryProxy, Knowledge, and Panel. Saved URLs take precedence even after a port changes. Before URL questions, setup explains that Enter accepts same-machine HTTP and remote agents need reachable service origins.

Контракт persistent server settings задаётся одним типизированным описанием полей, которое используют мастер и валидатор:

| Группа | Поля `.env` |
| --- | --- |
| Внешние адреса | `MEMORY_PROXY_PUBLIC_URL`, `KNOWLEDGE_PUBLIC_URL`, `PANEL_PUBLIC_URL` — полные независимые URL |
| Локальные входы и данные | `MEMORY_PROXY_PORT`, `KNOWLEDGE_PORT`, `PANEL_PORT`, `DATA_DIR`; bind всегда `127.0.0.1` |
| Внутренний LLM | `LLM_BASE_URL`, `LLM_API_KEY`, `MEMORY_LLM_MODEL`, `KNOWLEDGE_LLM_MODEL` |
| Служебные ключи | `CORE_API_KEY`, `CLIPROXY_API_KEY` — ввод или сохранение/генерация по умолчанию |
| Поведение | `MEMORY_PROMPT_MODE`, `LOG_LEVEL`, `MEMORY_LLM_MAX_TOKENS`, `KNOWLEDGE_LLM_MAX_TOKENS`, `MEMORY_LLM_TIMEOUT_MS`, `KNOWLEDGE_LLM_TIMEOUT_MS` |

The installation directory and runtime/provider select how setup runs. Container DNS names, the `ams` service identity, and component protocols belong to packaging. Image delivery records immutable identities in the manifest. `STACK_DOMAIN`, `ACME_EMAIL`, and a persistent administrator key setting are not part of the server environment.

Для внутренних вызовов Core и Knowledge используется общий Z.ai endpoint/API key и отдельные настройки модели памяти и модели Knowledge. Стартовый endpoint обычного API — `https://api.z.ai/api/paas/v4`; мастер позволяет указать фактический endpoint пользователя и не предполагает, что Coding Plan покрывает фоновую обработку памяти. Knowledge работает в режиме `custom`, а Panel получает `KNOWLEDGE_LLM_BINDING_SYNC=false`. Существующий persisted binding Knowledge проверяется отдельно: он не должен незаметно отменять значения `.env`.

Сгенерированные внутренние ключи используют `sk-ams-<purpose>-<64 lowercase hex>`, по 32 независимых случайных байта; назначения Core и CLIProxyAPI — `core` и `cliproxy`. Они сохраняются в рабочем `.env` и повторно используются при старте. Provider keys и OAuth сохраняют исходный формат. Admin key имеет отдельный временный жизненный цикл из следующего раздела.

Конфигурационный модуль валидирует весь набор до изменения runtime и атомарно записывает `.env` с ограниченными правами. Ошибка записи или отмена мастера завершают setup до инициализации администратора. Диагностика показывает имена ошибочных переменных, а не их значения. Получаемые машинные конфиги — производные данные. JSON сериализуется штатными средствами; runtime preloader применяет проверенную структуру там, где upstream требует файловый конфиг, чтобы YAML/env-подстановка не переинтерпретировала символы в provider secret. Минимальные изменения upstream для этого хранятся отдельными патчами с тестами.

Изменённый `.env` применяется повторной генерацией конфигов и пересозданием соответствующих контейнеров. Обычный `restart` не перечитывает окружение Compose. Применение конфигурации и обычный запуск не меняют внутренние ключи и не требуют первоначального admin secret.

### 4. Admin key вводится или генерируется один раз и передаётся через stdin

В явном первоначальном `Setup server` пользователь может ввести admin key; выбор по умолчанию — генерация `sk-ams-admin-<64 lowercase hex>` из 32 случайных байт. До первого запроса инициализации CLI один раз показывает выбранный ключ в отдельном осознанном шаге, позволяя пользователю сохранить его у себя. Этот показ — единственное предусмотренное раскрытие; ключ исключён из прогресс-сообщений, отладочного вывода, ошибок и итогового summary.

Пакет не записывает admin key в `.env`, `.admin-key`, generated config, аргументы процесса или container environment. После подтверждения CLI держит ключ только в памяти и передаёт bootstrap-процессу временным stdin-каналом, например через `compose run --rm -T`, с закрытием stdin после записи. Интерактивное отображение в терминале не означает гарантированного удаления ключа из терминальной истории или памяти процесса; интерфейс не обещает таких гарантий. Core по своей модели обязательно сохраняет пользовательский ключ в metadata DB. Это единственное постоянное хранилище admin key внутри поставляемого стека.

Bootstrap использует внутренний `POST /v3/internal/meta/user/init-admin` с `{ username, user_key }`, Bearer Core key и `x-tdai-service-id: ams`. До мутации проверяется состояние экземпляра через внутренний список пользователей. При пустой базе выполняется создание; при `409` явный setup проверяет переданный ключ через `/v3/meta/auth/verify`, его роль `system_admin` и правильный instance. Несовпадение ключа не вызывает смену существующего ключа, очистку базы или создание заменяющего администратора.

После успешной проверки bootstrap подтверждает default team и agent. Upstream создаёт их best-effort, поэтому недостающие сущности восстанавливаются штатными API и перечитываются; неподходящая роль, владельцы, статус или неоднозначность дают конкретную инструкцию по исправлению. Вывод содержит только несекретные идентификаторы. Секрет инициализации после окончания операции больше не нужен CLI.

Обычный запуск существующего экземпляра проверяет наличие ранее созданного `system_admin` и пропускает создание администратора без повторного ввода ключа. Если первоначальная инициализация не завершена, он сообщает о необходимости `Setup server`; наличие произвольного пользователя не считается завершённым bootstrap. Потеря пользователем admin key решается отдельным восстановлением доступа средствами приложения; автоматическая ротация через `.env` не вводится. Альтернатива с `.admin-key` упрощала повторную проверку, но не соответствует выбранному пользователем хранению секрета.

### 5. Порядок запуска и OAuth

Граф готовности: подготовка конфигов → Core → явный bootstrap при первой установке → Knowledge, Panel, CLIProxyAPI, адаптер Knowledge и MemoryProxy с необходимыми зависимостями. Готовность процесса и возможность сделать авторизованный model request проверяются раздельно. CLI выполняет этот граф явными стадиями с проверкой health/exit status. Для managed `up` применяется `--no-deps` и пересоздание: проверенный Podman 6.1.1 иначе переводит завершённые init-сервисы в native `--requires`, повторно запускает их и срывает старт зависимых приложений. Зависимости остаются описаны в Compose; CLI проверяет каждую границу готовности самостоятельно. После первоначальной установки обычный запуск использует сохранённые базы и OAuth, обходя требование временного admin key.

CLIProxyAPI использует встроенный Codex OAuth для аккаунта ChatGPT. Мастер запускает серверный device-code login выбранной закреплённой версии и показывает URL/код. Пользователь подтверждает вход браузером на своём устройстве; браузер или callback listener на VPS для этого flow не нужен. Авторизационные файлы принадлежат отдельному постоянному RW-каталогу сервера. API-key CLIProxyAPI защищает внутренний вызов от MemoryProxy и отличается от OAuth-токенов.

Модель агента приходит в запросе клиента. Отдельный глобальный `CHATGPT_API_KEY` или обязательная фиксированная `CHATGPT_MODEL` для OAuth-провайдера не требуется. Отсутствие авторизованного аккаунта отображается как необходимость закончить login, а не как доказательство неисправности Core/Knowledge.

### 6. Ограниченные маршруты и Knowledge ACL

Установка обслуживает один согласованный service instance `ams`; Panel registry, MemoryProxy и адаптеры используют один идентификатор. Loopback-вход API модели допускает только необходимые маршруты MemoryProxy с проверкой пользовательского ключа. Служебные bridge-вызовы имеют фиксированные upstream и собственную проверку пользователя/полномочий; входящий URL не превращается в произвольный адрес проксирования. Internal metadata, destroy, management, OAuth/auth-file endpoints Core/CLIProxyAPI не становятся доступными через публичные входы.

Текущий `MemoryProxy/src/auth.ts` не передаёт Core Bearer при `verifyUserKey`. Закреплённый патч добавляет Bearer в этот вызов; Core API key остаётся серверным секретом. Другие уже совместимые вызовы продолжают использовать штатные заголовки. Allowlist маршрутов также применяется перед обработчиками MemoryProxy: удаление встроенного Caddy не должно открыть `/direct/*`, admin или другие обходные пути через loopback-порт. Проверки не полагаются только на недоступность порта снаружи.

Raw Knowledge не имеет достаточной собственной публичной авторизации. Перед ним работает адаптер, который проверяет user key через Core, принадлежность запросу instance `ams`, ACL запрашиваемого asset и актуальное активное членство пользователя в соответствующей команде для командного доступа. Проверяется право на конкретное действие; обработка write маршрутов не следует автоматически из права читать. Недостающий identity/resource context, запрещённый маршрут или неподтверждённое разрешение дают отказ до пересылки. Scope адаптера ограничен путями, реально используемыми Knowledge tools и приёмкой; это не перенос всей модели авторизации TencentDB в новую платформу.

Инъекция Knowledge tools сообщает внешний Knowledge URL и команды с буквальной ссылкой на переменную `AMS_USER_KEY`. Реальное значение пользовательского ключа не включается в model-visible инструкции. Клиент получает секрет в своём окружении/настройках секретов; инструмент подставляет его при HTTP-запросе. Model-visible instruction and HTTP tool execution validation belongs to the later integration phase. Proxy logs сами по себе не доказывают корректную инъекцию. Panel открывается по заданному HTTP/HTTPS-адресу и использует штатный пользовательский вход; добавочный локальный relay для браузера отсутствует.

### 7. Manual agent connections and session identity

Operators configure their agent with the documented MemoryProxy URL, protocol-specific API base, selected model, and authorized team/agent context. They supply the memory-user credential through their own environment or secret management, including `AMS_USER_KEY` for injected HTTP tool commands. Provider keys, Core service keys, CLIProxyAPI service keys, and OAuth files remain with the stack.

New conversations use distinct identifiers; resumed conversations reuse their existing identifier. Team and agent context is checked against authenticated metadata and access grants. A task identifier remains optional where supported by the upstream session contract. Functional validation of separate sessions, agent sharing, and unrelated-user rejection is deferred to the later integration phase.

### 8. Сборка, данные и восстановление

Собственные образы собираются из полного закреплённого TencentDB commit и версии/commit CLIProxyAPI; базовые образы фиксируются digest, зависимости — lockfiles и строгой установкой. Архитектура VPS проверяется отдельно от компьютера разработчика. Сборка не берёт случайные файлы соседнего checkout, runtime не скачивает исходники и не устанавливает зависимости при старте. Публикация образов и npm-пакета остаётся отдельным действием; локальные image build и `.tgz` являются проверяемыми артефактами до публикации.

Постоянные каталоги включают Core data/metadata SQLite, Knowledge DB/файлы, сохраняемые шаблоны Panel, подтверждённое состояние MemoryProxy и серверный OAuth. Явно согласуются `TDAI_DATA_DIR`, `TDAI_METADATA_SQLITE_BASE_DIR`, `KNOWLEDGE_DATA_DIR`, `KNOWLEDGE_DB_PATH` и `TDAI_AGENT_TEMPLATE_DIR`. Mounts must preserve application state across container recreation. Сгенерированные конфиги хранятся отдельно и восстанавливаются из `.env`.

Холодная резервная копия создаётся после остановки писателей. Она содержит согласованные данные, OAuth, рабочий `.env`, необходимые секретные конфиги и manifest версий. Отдельного `.admin-key` в ней нет; metadata DB содержит пользовательские ключи и поэтому считается секретной. Данные Caddy/TLS принадлежат внешней системе пользователя и не добавляются в backup-контракт пакета. Restoration uses isolated directories and one active CLIProxyAPI OAuth refresher. End-to-end recovery validation is deferred to the later integration phase.

Rollback возвращает совместимую пару «предыдущие образы + данные до обновления». Совместимость старого образа с новой схемой данных не предполагается. Демонстрационные model allowlists, внешняя credit reporting и rate limit без Redis отключаются конфигурацией или минимальными проверяемыми патчами; они не становятся причинами скрытого отказа новой установки.

### 9. Acceptance scope

Build the required images and start the Compose deployment: selected long-lived application/support containers run, and required initialization jobs exit successfully. Record the actual engine/platform and observed container outcomes; this criterion does not establish functional correctness or production readiness.

Comprehensive functional validation is deferred until Supergateway and the remaining connection work are implemented. It includes real-provider and agent requests, streaming/cancellation/session behavior, model-visible memory and tool instructions, semantic extraction/recall and authorized sharing, Wiki ingestion/read, external Caddy access, and complete backup/restore with administrator, conversation, Wiki, and OAuth state. These scenarios are outside this archived change's acceptance checklist and are not claimed as passed.

Existing automated and local integration results remain historical evidence in `VALIDATION.md`; they do not add acceptance gates to this archived change. Runtime preflight, authentication, authorization, readiness sequencing, and integrity checks remain product requirements.

## Risks / Trade-offs

- Operator-managed reverse proxy configuration may be incorrect: expose accurate loopback targets and defer external TLS/streaming validation to the later integration phase.
- [Пользователь теряет показанный admin key или прерывает setup] → Ключ показывается до init; отмена и ошибка записи не создают администратора; последующий запуск не требует bootstrap secret, восстановление доступа остаётся отдельным действием.
- Upstream/native dependency incompatibility may prevent startup: pin source and dependency inputs and record container startup failures explicitly.
- OAuth device login may be unavailable or duplicate refreshers may conflict: use one persistent credential store and one active refresher; real-provider validation follows in the later phase.
- Successful container startup does not establish useful memory/Wiki behavior or VPS capacity: defer semantic, provider, recovery, and workload validation, and avoid production-readiness claims.

## Migration Plan

1. Deliver the modular TypeScript package, pinned image inputs, transient administrator initialization, one Compose project, and loopback service publication.
2. Build the required images and start the selected deployment, recording running long-lived containers and successful initialization jobs for the actual engine/platform.
3. Keep VPS deployment, provider login, Caddy configuration, and publication separately authorized. Full functional and recovery validation will follow Supergateway and the remaining connection work.
