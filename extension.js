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
 * Check whether `className` in the given Python file is a subclass of
 * appeldryck.Context, using Pylance's type hierarchy analysis.
 * Handles transitive inheritance (subclass of a subclass of Context, etc.).
 */
async function isContextSubclass(fileUri, className) {
    // Get document symbols to find the class position — needed to invoke the
    // type hierarchy provider, which works on a location rather than a name.
    const docSymbols = await vscode.commands.executeCommand(
        'vscode.executeDocumentSymbolProvider',
        fileUri
    );
    if (!docSymbols) return false;

    // DocumentSymbol (modern format) has selectionRange; SymbolInformation doesn't.
    const classSym = docSymbols.find(s =>
        s.name === className && s.kind === vscode.SymbolKind.Class && s.selectionRange
    );
    if (!classSym) return false;

    // Ask Pylance to prepare a type hierarchy rooted at this class.
    const items = await vscode.commands.executeCommand(
        'vscode.prepareTypeHierarchy',
        fileUri,
        classSym.selectionRange.start
    );
    if (!items || items.length === 0) return false;

    // BFS through the supertype chain, looking for appeldryck.Context.
    const visited = new Set();
    const queue = [...items];

    while (queue.length > 0) {
        const item = queue.shift();
        const supertypes = await vscode.commands.executeCommand(
            'vscode.provideTypeHierarchySupertypes',
            item
        );
        if (!supertypes) continue;

        for (const sup of supertypes) {
            const key = sup.uri.toString() + ':' + sup.name;
            if (visited.has(key)) continue;
            visited.add(key);

            if (sup.name === 'Context' && sup.uri.fsPath.includes('appeldryck')) {
                return true;
            }
            queue.push(sup);
        }
    }

    return false;
}

/**
 * Given a position inside a Python file, return the name of the enclosing
 * class, or null if the position isn't inside any class.
 * Uses document symbols (populated by ty/Pylance for the Outline view).
 */
async function findContainingClassName(fileUri, position) {
    const docSymbols = await vscode.commands.executeCommand(
        'vscode.executeDocumentSymbolProvider',
        fileUri
    );
    if (!docSymbols) return null;

    for (const sym of docSymbols) {
        if (sym.kind !== vscode.SymbolKind.Class || !sym.range) continue;
        const r = sym.range;
        const p = position;
        // Manual range check — executeCommand results may be plain objects,
        // not vscode.Range instances with a .contains() method.
        if (p.line >= r.start.line && p.line <= r.end.line) {
            return sym.name;
        }
    }
    return null;
}

/**
 * Fall back to the workspace symbol provider (typically the Python extension)
 * to find `def name` in Python files — either as a top-level function, or as
 * a method on a subclass of appeldryck.Context.
 */
async function findPythonDefinition(name) {
    const symbols = await vscode.commands.executeCommand(
        'vscode.executeWorkspaceSymbolProvider',
        name
    );
    if (!symbols || symbols.length === 0) return [];

    const results = [];
    for (const s of symbols) {
        if (s.name !== name) continue;
        if (s.kind === vscode.SymbolKind.Function) {
            results.push(new vscode.Location(s.location.uri, s.location.range));
        } else if (s.kind === vscode.SymbolKind.Method) {
            const className = s.containerName ||
                await findContainingClassName(s.location.uri, s.location.range.start);
            if (className && await isContextSubclass(s.location.uri, className)) {
                results.push(new vscode.Location(s.location.uri, s.location.range));
            }
        }
    }
    return results;
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
