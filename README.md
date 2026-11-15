# BearCode

BearCode is an AI coding agent for VS Code: it writes and refactors code, runs commands, and works
with your project files and MCP servers. It supports modes (Code, Architect, Ask, Debug, Orchestrator
and custom modes), many LLM providers (Anthropic, OpenAI, OpenRouter, Bedrock, Vertex, Ollama,
LM Studio and more), checkpoints, and auto-approval of actions.

## About the project

BearCode is a fork of [Roo Code](https://github.com/RooCodeInc/Roo-Code) (Apache-2.0), which itself
grew out of [Cline](https://github.com/cline/cline). In May 2026 the Roo Code team shipped the final
release of the extension (3.53) and stopped its development: it keeps working, but no longer receives
bug fixes, new features, or support for new models.

BearCode aims to continue the development and maintenance of the project:

- fix bugs and security issues;
- support new models and LLM providers;
- build new features;
- stay compatible with Roo Code configuration (`.roo/`, `.roomodes`, `.rooignore`, `.roorules`)
  so that switching is painless.

BearCode is based on Roo Code 3.53.0 (commit [`b867ec9`](https://github.com/RooCodeInc/Roo-Code/commit/b867ec9)).
Many thanks to the Roo Code and Cline teams for their work.

Bug reports and feature requests: [issues](https://github.com/veniaminlunyov/bear-code/issues).

## Installation

Build the VSIX (see below) and install it via `Extensions → … → Install from VSIX…`
or from the command line:

```sh
code --install-extension bin/bear-code-<version>.vsix
```

BearCode has its own extension ID (`bearcode.bear-code`) and can be installed side by side with Roo Code.

### Migrating from Roo Code

BearCode reads Roo Code project configuration files (`.roo/`, `.roomodes`, etc.) as is. Extension
settings and API keys are stored separately and are not migrated automatically: in Roo Code open
Settings → About → Export, then in BearCode use Settings → About → Import.
The exported file contains your API keys — do not share it, and delete it after importing.

## Project configuration files

| BearCode            | Purpose                             | Legacy (Roo Code)  |
| ------------------- | ----------------------------------- | ------------------ |
| `.bear/`            | rules, commands, skills, `mcp.json` | `.roo/`            |
| `.bearmodes`        | project custom modes                | `.roomodes`        |
| `.bearignore`       | files the agent must not access     | `.rooignore`       |
| `.bearrules[-mode]` | single-file rules                   | `.roorules[-mode]` |
| `~/.bear/`          | global rules, commands, skills      | `~/.roo/`          |

If the BearCode file or directory does not exist but the legacy one does, BearCode reads the legacy one.
New files are always created with BearCode names. The fallback applies to the whole directory:
if `.bear/` exists, `.roo/` in the same location is ignored.

## Building

Requirements: Node.js 20.19.2 (see `.nvmrc`), pnpm 10.8.1.

```sh
pnpm install
pnpm vsix          # → bin/bear-code-<version>.vsix
pnpm test          # unit tests
```

Debugging: open the folder in VS Code and start the "Run Extension" launch configuration (F5).

## Releases

Releases are managed with [changesets](https://github.com/changesets/changesets):

1. Add a changeset to your pull request: `pnpm changeset` (choose patch/minor/major and describe the change).
2. When a pull request with changesets is merged into `main`, the "Changeset Release" workflow opens a
   "Changeset version bump" pull request that bumps the version and updates `CHANGELOG.md`.
3. Merging the version bump pull request triggers the "Publish Extension" workflow: it publishes the extension
   to the VS Code Marketplace and Open VSX, creates the `v<version>` tag, and creates a
   [GitHub Release](https://github.com/veniaminlunyov/bear-code/releases) with the VSIX attached.

Publishing requires the `VSCE_PAT` and `OVSX_PAT` repository secrets.

## License

Apache License 2.0 — see the `LICENSE` and `NOTICE` files shipped with the extension.
