---
"bear-code": patch
---

- Security: update simple-git to 4.0.2 (GHSA-x6jw-m9v5-85vh, GHSA-r275-fr43-pm7q). Checkpoints no longer pass editor, pager, ssh, askpass and GIT_CONFIG\* environment variables to the shadow git repository, and the checkpoint log lists only the names of removed variables
- Security: update vulnerable dependencies within their current major versions, including @modelcontextprotocol/sdk 1.32, axios, undici, ws, dompurify, markdown-it, js-yaml, lodash, tar and others (dependency audit: 344 → 53 known vulnerabilities)
- MCP: tool results with `resource_link` content are now passed to the model instead of being dropped
