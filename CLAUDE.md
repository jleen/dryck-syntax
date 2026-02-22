# dryck-syntax

A VS Code extension providing syntax highlighting and navigation for Dryck, a Markdown-like dialect with embedded function call syntax (using the `◊` lozenge character).

## Files

- `syntaxes/dryck.tmLanguage.json` — main grammar for `.dryck` files (`source.dryck`)
- `syntaxes/html-dryck.tmLanguage.json` — grammar for `.html.dryck` files (`text.html.dryck`); includes both `source.dryck` and `text.html.basic`
- `language-configuration.json` — shared language config for both language IDs
- `package.json` — contributes two language IDs: `dryck` and `html-dryck`; `"main"` points to `extension.js`
- `extension.js` — activation code: registers a `DefinitionProvider` for both language IDs

## Scope naming conventions

- **Markdown-style markup** uses `.markdown` as the language qualifier, not `.dryck`. This is intentional — VS Code themes target `markup.heading.1.markdown`, `markup.list.unnumbered.markdown`, etc., so we piggyback on that for theme compatibility.
- **Dryck-specific constructs** (functions, strings, keywords) use `.dryck` as the qualifier.

## Grammar structure (dryck.tmLanguage.json)

Patterns are included in this order: `headings`, `list-items`, `emphasis`, `functions`, `strings`.

### Headings
Simple `match` rules, one per level (#–######). No captures — the entire line including the `#` characters gets the heading scope uniformly, matching VS Code's built-in Markdown behavior.
Scope: `markup.heading.N.markdown` (where N is 1–6). Note: currently written as `heading.N.markdown` — check the file for the exact form in use.

### List items
Uses `begin`/`while` (not `match`) to handle continuation lines. The `while` pattern `^(?=\\s+\\S)` continues as long as subsequent lines are indented and non-blank.
- Bullet/number: `punctuation.definition.list.begin.markdown`
- Whole rule: `markup.list.unnumbered.markdown` or `markup.list.numbered.markdown`

### Emphasis
Simple `match` rules. Bold (`**`) is listed before italic (`*`) so `**` isn't consumed as two italic markers.
- `markup.bold.markdown` / `markup.italic.markdown` (outer)
- `punctuation.definition.bold.markdown` / `punctuation.definition.italic.markdown` (delimiters)

### Functions (◊ syntax)
Three forms, tried in order:
1. `◊(foo.bar)` — parenthesized; dots allowed in name
2. `◊foo: bar` — colon form; rest of line is argument
3. `◊foo` or `◊foo{...}` — basic or brace form

Scopes: `keyword.operator.dryck` (◊), `entity.name.function.dryck` (name), `punctuation.section.parens.dryck` / `punctuation.separator.dryck`.

### Strings
`begin`/`end` with `\"`. Escape sequences (`\\.`) get `constant.character.escape.dryck`.

## Go To Definition (extension.js)

`◊name` tokens support F12 navigation. The provider (in `extension.js`) resolves in this order:

1. `<currentDir>/name.dryck` or `<currentDir>/_name.dryck`
2. `<parentDir>/name.dryck` or `<parentDir>/_name.dryck`
3. Workspace-wide `**/name.dryck` or `**/_name.dryck` (via `findFiles`)
4. Python workspace symbols (`vscode.executeWorkspaceSymbolProvider`) — only for simple names (no dots); requires the Python extension to be active

The `◊(foo.bar)` parenthesized form always resolves as a file (`foo.bar.dryck`) and never falls through to Python.

Name extraction scans the current line for `◊`-tokens and checks whether the cursor falls within one. All three function forms are handled.

## Debugging tips

- Use **Developer: Inspect Editor Tokens and Scopes** to verify what scopes are assigned.
- Grammar changes usually hot-reload, but **Developer: Reload Window** is needed if something seems stale.
- If a theme isn't picking up a scope, check whether the theme uses `.markdown` or a generic qualifier.
- `extension.js` changes require **Reload Window** (or restarting the Extension Development Host) to take effect — there is no hot-reload for activation code.
