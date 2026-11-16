# BearCode Changelog

## 0.2.0

### Minor Changes

Fixes ported from Zoo-Code, plus fixes found while verifying them.

#### Security

- Command and skill files can no longer run code through `---js` frontmatter.
- `apply_diff` asks before editing files outside the workspace.
- File links in chat cannot open paths outside the workspace.
- Text typed while the model is responding no longer approves creating or finishing a subtask.
- Dependencies updated to close known advisories. The unused puppeteer packages are removed, and zod is upgraded to 4.

#### Subtasks

- A delegated subtask runs with its own mode and API profile, and delegating no longer changes the global mode or the profile saved for a mode.
- The handoff between a parent and its subtask is atomic and survives navigating away, reloads and crashes:
    - A result is only handed back to a parent that still waits for that subtask.
    - Resuming the parent by hand, or deleting the subtask, releases the parent.
- A pending subtask approval is asked again after a reload. The restored approval always needs a manual click.
- Fixed duplicate tool results sent to the API when the parent called other tools in the same turn as `new_task`.
- "Go to subtask" links point to the right subtask after a rejected `new_task`.
- Opening a task that another BearCode panel already shows reveals that panel instead of opening a second copy.

#### Terminal

- Cancelling a task stops its running command, and Ctrl+C is retried for commands that ignore the first one.
- Fast commands no longer hang, and finished commands are no longer reported as still running.
- The Proceed/Kill controls only appear for commands that are still running after 5 seconds.
- The inline terminal keeps the system's UTF-8 locale.

#### Windows

- The system prompt no longer starts PowerShell on every request. It could freeze the extension for seconds.
- The inline terminal runs in the configured shell instead of `cmd.exe`, and defaults to PowerShell when no terminal profile is set.

#### Other

- Fixed the gray screen (out of memory) on long, tool-heavy tasks.
- Ripgrep is found in newer VS Code versions.
- Fixed the "Mode settings" tooltip covering the mode list.
- Settings import errors now use zod 4 wording, for example "Invalid input: expected string, received undefined".

## 0.1.1

### Patch Changes

- Localize built-in mode names and descriptions in the WebView UI, and add the missing `customModes` translations for all non-English locales so the translation check passes.

## 0.1.0

- First BearCode release — a fork of Roo Code 3.53.0 (upstream commit b867ec9).
- New extension ID `benjy-the-bear.bear-code`; commands and settings `bear-code.*`.
- New name, icons, and UI strings in all languages.
- Project configuration: `.bear/`, `.bearmodes`, `.bearignore`, `.bearrules` with fallback to `.roo*`.

The Roo Code changelog prior to the fork is in `CHANGELOG.roo-code.md`.
