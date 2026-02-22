const vscode = require('vscode');
const path = require('path');
const fs = require('fs');

/**
 * Given a document and cursor position, extract the ◊-function name under
 * the cursor, or null if the cursor isn't on one.
 *
 * Handles all three forms:
 *   ◊(foo.bar)   → "foo.bar"
 *   ◊foo: arg    → "foo"
 *   ◊foo         → "foo"
 */
function extractFunctionName(document, position) {
    const line = document.lineAt(position.line).text;
    const col = position.character;

    // Find all ◊-token matches on this line and check if cursor is within one.
    // ◊ is a multi-byte character (3 bytes in UTF-8, 1 JS char U+25CA).
    const patterns = [
        // ◊(foo.bar) — parenthesized form; dots allowed
        /◊\(([a-zA-Z_.][a-zA-Z0-9_.]*)\)/g,
        // ◊foo: arg — colon form
        /◊([a-zA-Z_][a-zA-Z0-9_-]*)(?=\s*:)/g,
        // ◊foo or ◊foo{...} — basic form (must come last)
        /◊([a-zA-Z_][a-zA-Z0-9_-]*)/g,
    ];

    for (const re of patterns) {
        let m;
        re.lastIndex = 0;
        while ((m = re.exec(line)) !== null) {
            const start = m.index;
            const end = m.index + m[0].length;
            if (col >= start && col <= end) {
                return m[1];
            }
        }
    }
    return null;
}

/**
 * Try to resolve `name` as a .dryck file relative to `fromDir`, then
 * its parent, then anywhere in the workspace.
 * Returns a vscode.Uri or null.
 */
async function findDryckFile(name, fromDir) {
    const filenames = [name + '.dryck', '_' + name + '.dryck'];

    // 1. Current directory
    for (const filename of filenames) {
        const candidate = path.join(fromDir, filename);
        if (fs.existsSync(candidate)) {
            return vscode.Uri.file(candidate);
        }
    }

    // 2. Parent directory
    for (const filename of filenames) {
        const candidate = path.join(fromDir, '..', filename);
        if (fs.existsSync(candidate)) {
            return vscode.Uri.file(candidate);
        }
    }

    // 3. Workspace-wide search
    for (const filename of filenames) {
        const results = await vscode.workspace.findFiles('**/' + filename, null, 1);
        if (results.length > 0) {
            return results[0];
        }
    }

    return null;
}

/**
 * Fall back to the workspace symbol provider (typically the Python extension)
 * to find `def name` in Python files.
 */
async function findPythonDefinition(name) {
    const symbols = await vscode.commands.executeCommand(
        'vscode.executeWorkspaceSymbolProvider',
        name
    );
    if (!symbols || symbols.length === 0) return [];

    return symbols
        .filter(s => s.name === name && s.kind === vscode.SymbolKind.Function)
        .map(s => new vscode.Location(s.location.uri, s.location.range));
}

async function provideDefinition(document, position) {
    const name = extractFunctionName(document, position);
    if (!name) return null;

    const fromDir = path.dirname(document.uri.fsPath);
    const uri = await findDryckFile(name, fromDir);
    if (uri) {
        return new vscode.Location(uri, new vscode.Position(0, 0));
    }

    // Only try Python fallback for simple names (no dots — dotted names are
    // always file references like foo.bar.dryck, never Python functions).
    if (!name.includes('.')) {
        return findPythonDefinition(name);
    }

    return null;
}

function activate(context) {
    const selector = [{ language: 'dryck' }, { language: 'html-dryck' }];
    context.subscriptions.push(
        vscode.languages.registerDefinitionProvider(selector, { provideDefinition })
    );
}

function deactivate() {}

module.exports = { activate, deactivate };
