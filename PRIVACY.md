# BearCode Privacy Policy

**Last Updated: November 15th, 2026**

BearCode runs locally in your editor. The BearCode project does not operate any servers that receive
your data. Below is a breakdown of where data goes — and where it doesn't.

### Where your data goes (and where it doesn't)

- **Code & files**: BearCode reads files on your machine when needed. When you send a request, the relevant
  files and context are transmitted to the AI model provider you have configured (e.g. Anthropic, OpenAI,
  OpenRouter, or a local model). Providers may store and process this data according to their own privacy
  policies.
- **Commands**: Commands run by BearCode are executed in your local environment. Their output may be sent to
  your configured AI provider as part of the conversation context.
- **Prompts & AI requests**: Prompts and project context are sent only to the AI provider you have configured.
- **API keys & credentials**: API keys are stored locally in VS Code's secret storage and are sent only to the
  provider they belong to.
- **MCP servers & integrations**: Data sent to MCP servers, embedding providers, or vector databases that you
  configure is governed by those services.
- **Telemetry**: BearCode does **not** collect telemetry, usage analytics, or crash reports.

### Your choices & control

- Use a local model (e.g. Ollama or LM Studio) to keep prompts and code on your machine.
- Use `.bearignore` to prevent BearCode from reading specific files.
- Settings and task history are stored locally in VS Code's extension storage on your machine.

### Changes

Changes to this policy are published in this repository.

### Contact

Privacy questions: open an issue at https://github.com/veniaminlunyov/bear-code/issues.
