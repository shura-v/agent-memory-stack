> Placement update: [select-deployment-services](../2026-09-16-select-deployment-services/proposal.md) now defines selectable services, optional integrations, and authenticated remote dependencies. The full server stack remains the default selection. Acceptance for both archived changes is limited to building images and starting containers. Comprehensive validation is deferred until Supergateway and the remaining connection work are implemented.

## Why

Provide a reproducible TencentDB Agent Memory deployment on a VPS or local machine. The npm package collects settings, prepares one Compose project, and keeps memory services independent of agent availability. The Forge installation experience informs explicit initialization and separate credentials; actual memory behavior will be validated in the later integration phase.

## What Changes

- Deliver the `agent-memory-stack` npm package with the `ams` executable, modular TypeScript, and `@clack/prompts`. Running `ams` enters stack setup directly without an action menu.
- **Setup server** спрашивает реальные API endpoints, ключи, модели, пути и локальные порты; подготавливает серверный `.env` и машинные конфиги. Core, Knowledge, Panel, MemoryProxy и CLIProxyAPI работают в одном Compose на VPS, каждый в отдельном образе; служебные init/access-контейнеры входят в этот же проект.
- Bind MemoryProxy, protected Knowledge API, and Panel entry points to host `127.0.0.1`. Setup asks for ports before service URLs, derives fresh local HTTP defaults, preserves saved URLs, and explains same-machine and remote access. Independent HTTP/HTTPS origins are supported. The operator manages Caddy, DNS, TLS, and external publication.
- Для внутренней обработки памяти и Wiki используется Z.ai с общими endpoint/key и отдельной моделью каждого компонента. CLIProxyAPI использует ChatGPT через Codex OAuth на сервере. При первом setup admin key вводится или генерируется по умолчанию, показывается пользователю и передаётся в bootstrap без отдельного сохранения в файлах или `.env`.
- Document manual agent connections using the deployed MemoryProxy API and authorized Knowledge tools. Accept this delivery when the required images are built and its containers start; comprehensive functional validation belongs to the later integration phase.

## Capabilities

### New Capabilities

- `server-deployment`: Compose setup and local entry points, administrator bootstrap, server OAuth, independent internal LLM, and authenticated agent/session/tool integration.

- `stack-delivery`: npm package, stack setup, image delivery, configuration/data lifecycle, and acceptance checks.

### Modified Capabilities

Нет: основной набор спецификаций в новом репозитории пока пуст.

## Impact

Работа принадлежит этому репозиторию: TypeScript-модули `src/`, шаблоны `server/`, упаковка `docker/`, проверяемые upstream-патчи `patches/`, тесты и документация. `aict-cli` служит ориентиром разделения CLI, interaction и сценариев приложения; его специфические подсистемы не переносятся.

Соседний `../TencentDB-Agent-Memory` используется для аудита. Установка npm-пакета и запуск готовых образов работают без соседнего checkout и сборочного toolchain на VPS. Образы доставляются отдельно от npm-архива, их версии и платформы фиксируются.

Пакет не управляет пользовательским Caddy, DNS, сертификатами или firewall. Исходящие соединения серверных сервисов с Z.ai и ChatGPT сохраняются. Перенос данных с Forge, публикация npm-пакета/образов, изменения VPS, commit и push требуют отдельного поручения. This archived change uses the build-and-start acceptance scope below; historical test evidence does not expand that scope.


## Acceptance scope

Build the required images and start the Compose deployment: selected long-lived application/support containers run, and required initialization jobs exit successfully. Record the actual engine/platform and observed container outcomes; this criterion does not establish functional correctness or production readiness.

Comprehensive functional validation is deferred until Supergateway and the remaining connection work are implemented. It includes real-provider and agent requests, streaming/cancellation/session behavior, model-visible memory and tool instructions, semantic extraction/recall and authorized sharing, Wiki ingestion/read, external Caddy access, and complete backup/restore with administrator, conversation, Wiki, and OAuth state. These scenarios are outside this archived change's acceptance checklist and are not claimed as passed.
