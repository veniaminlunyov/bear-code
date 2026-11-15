# BearCode Changelog

## 0.1.1

### Patch Changes

- Security: update simple-git to 4.0.2 (GHSA-x6jw-m9v5-85vh, GHSA-r275-fr43-pm7q). Checkpoints no longer pass editor, pager, ssh, askpass and GIT_CONFIG\* environment variables to the shadow git repository, and the checkpoint log lists only the names of removed variables
- Security: update vulnerable dependencies within their current major versions, including @modelcontextprotocol/sdk 1.32, axios, undici, ws, dompurify, markdown-it, js-yaml, lodash, tar and others (dependency audit: 344 → 53 known vulnerabilities)
- MCP: tool results with `resource_link` content are now passed to the model instead of being dropped

## 0.1.0

- First BearCode release — a fork of Roo Code 3.53.0 (upstream commit b867ec9).
- New extension ID `bearcode.bear-code`; commands and settings `bear-code.*`.
- New name, icons, and UI strings in all languages.
- Project configuration: `.bear/`, `.bearmodes`, `.bearignore`, `.bearrules` with fallback to `.roo*`.

The Roo Code changelog prior to the fork is in `CHANGELOG.roo-code.md`.
