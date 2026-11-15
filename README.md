# BearCode

BearCode — AI-агент для разработки прямо в VS Code: пишет и рефакторит код, запускает команды,
работает с файлами проекта и MCP-серверами. Поддерживает режимы (Code, Architect, Ask, Debug,
Orchestrator и пользовательские), подключение к разным LLM-провайдерам (Anthropic, OpenAI,
OpenRouter, Bedrock, Vertex, Ollama, LM Studio и др.), чекпоинты и автоодобрение действий.

BearCode — форк [Roo Code](https://github.com/RooCodeInc/Roo-Code) (Apache-2.0).

## Установка

Соберите VSIX (см. ниже) и установите его: `Extensions → … → Install from VSIX…`
или командой:

```sh
code --install-extension bin/bear-code-<версия>.vsix
```

BearCode имеет собственный ID (`bearcode.bear-code`) и может стоять рядом с Roo Code.

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
