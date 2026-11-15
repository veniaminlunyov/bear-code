# BearCode

BearCode — AI-агент для разработки прямо в VS Code: пишет и рефакторит код, запускает команды,
работает с файлами проекта и MCP-серверами. Поддерживает режимы (Code, Architect, Ask, Debug,
Orchestrator и пользовательские), подключение к разным LLM-провайдерам (Anthropic, OpenAI,
OpenRouter, Bedrock, Vertex, Ollama, LM Studio и др.), чекпоинты и автоодобрение действий.

## О проекте

BearCode — форк [Roo Code](https://github.com/RooCodeInc/Roo-Code) (Apache-2.0), который, в свою очередь,
вырос из [Cline](https://github.com/cline/cline). В мае 2026 года авторы Roo Code выпустили последнюю
версию расширения (3.53) и прекратили его развитие: оно продолжает работать, но больше не получает
исправлений, новых возможностей и поддержки новых моделей.

Цель BearCode — продолжить развитие и поддержку этого проекта:

- исправлять ошибки и проблемы безопасности;
- поддерживать новые модели и LLM-провайдеров;
- развивать новые возможности;
- сохранять совместимость с конфигурацией Roo Code (`.roo/`, `.roomodes`, `.rooignore`, `.roorules`),
  чтобы переход был безболезненным.

BearCode основан на коде Roo Code 3.53.0 (commit [`b867ec9`](https://github.com/RooCodeInc/Roo-Code/commit/b867ec9)).
Спасибо командам Roo Code и Cline за их работу.

Ошибки и предложения — в [issues](https://github.com/veniaminlunyov/bear-code/issues).

## Установка

Соберите VSIX (см. ниже) и установите его: `Extensions → … → Install from VSIX…`
или командой:

```sh
code --install-extension bin/bear-code-<версия>.vsix
```

BearCode имеет собственный ID (`bearcode.bear-code`) и может стоять рядом с Roo Code.

### Переход с Roo Code

Файлы конфигурации проекта (`.roo/`, `.roomodes` и т.д.) BearCode читает как есть. Настройки расширения
и API-ключи хранятся отдельно и автоматически не переносятся: в Roo Code откройте
Settings → About → Export, затем в BearCode — Settings → About → Import.
Файл экспорта содержит API-ключи — не публикуйте его и удалите после импорта.

## Файлы конфигурации проекта

| BearCode            | Назначение                           | Legacy (Roo Code)  |
| ------------------- | ------------------------------------ | ------------------ |
| `.bear/`            | правила, команды, skills, `mcp.json` | `.roo/`            |
| `.bearmodes`        | пользовательские режимы проекта      | `.roomodes`        |
| `.bearignore`       | файлы, недоступные агенту            | `.rooignore`       |
| `.bearrules[-mode]` | однофайловые правила                 | `.roorules[-mode]` |
| `~/.bear/`          | глобальные правила, команды, skills  | `~/.roo/`          |

Если файла/папки с именем BearCode нет, а legacy-вариант существует, BearCode читает legacy-вариант.
Новые файлы всегда создаются с именами BearCode. Правило работает на уровне папки целиком:
если существует `.bear/`, то `.roo/` в этом же месте не читается.

## Сборка

Требования: Node.js 20.19.2 (см. `.nvmrc`), pnpm 10.8.1.

```sh
pnpm install
pnpm vsix          # → bin/bear-code-<версия>.vsix
pnpm test          # юнит-тесты
```

Отладка: откройте папку в VS Code и запустите конфигурацию «Run Extension» (F5).

## Лицензия

Apache License 2.0 — см. файлы `LICENSE` и `NOTICE` в составе расширения.
