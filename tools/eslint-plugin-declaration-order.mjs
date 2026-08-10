/**
 * eslint-plugin-declaration-order
 *
 * Enforces module-level declaration ordering:
 *   imports → constants → types → interfaces → declare module → class → function → re-exports
 *
 * Within the same category, exported declarations come before local (non-exported) ones.
 *
 * Also checks that same-category declarations remain adjacent
 * (e.g. all interfaces together, all type aliases together).
 *
 * Fix tiers:
 *   oxlint                → report only, no modifications
 *   oxlint --fix          → report only, no modifications (safe tier has no fix for this rule)
 *   oxlint --fix-suggestions → reorder all declarations to canonical order
 *                             ⚠️ may break runtime TDZ dependencies; review after applying
 *
 * The suggestion fix resolves BOTH cross-category ordering and same-category adjacency
 * in a single pass.
 */

// Category priority — lower number means earlier in file
const ORDER = { import: 0, constant: 1, type: 2, interface: 3, "declare-module": 4, class: 5, function: 6, reexport: 7 };
const CATEGORY_LABELS = {
  import: "import",
  constant: "常量 (constant)",
  interface: "接口 (interface)",
  type: "类型 (type alias)",
  "declare-module": "declare module",
  class: "class",
  function: "function",
  reexport: "重新导出 (re-export)",
};
const EXPECTED_ORDER_HINT = "Expected: imports → constants → types → interfaces → declare module → class → function → re-exports";
const EXPORT_HINT = "Exported declarations should come before local ones within the same category";
// ─── Rule definition ────────────────────────────────────────────────────────────

const moduleDeclarationOrder = {
  meta: {
    type: "suggestion",
    hasSuggestions: true,
    docs: { description: "Enforce module-level declaration ordering and same-category adjacency" },
    messages: {
      wrongOrder: '"{{current}}" should come before "{{previous}}". {{hint}}',
      notAdjacent: '"{{category}}" declarations should be adjacent. Found {{intervening}} intervening statement(s) of other categories.',
      exportFirst: '"{{name}}" is exported but appears after a non-exported declaration in the same category. {{hint}}',
      suggestReorder: "Reorder all declarations to canonical order (⚠️ may break runtime dependencies)",
    },
    schema: [],
  },
  create(context) {
    return {
      Program(node) {
        const sourceCode = context.sourceCode || context.getSourceCode();
        const entries = []; // { node, category, priority }

        for (const stmt of node.body) {
          const cat = classify(stmt);
          if (cat === null) continue;
          entries.push({ node: stmt, category: cat, priority: ORDER[cat] });
        }

        if (entries.length === 0) return;

        // ─── Build the reorder suggestion once (shared across all violations) ──
        let reorderResult = null;
        let reorderComputed = false;

        function getReorder() {
          if (!reorderComputed) {
            reorderResult = buildReorderedSource(node, sourceCode);
            reorderComputed = true;
          }
          return reorderResult;
        }

        // ─── Check 1: Cross-category ordering ────────────────────────────────
        let highWaterMark = -1;
        let highWaterCategory = "";
        let suggestAttached = false;

        for (const entry of entries) {
          if (entry.priority < highWaterMark) {
            // Attach suggestion fix only to first violation to avoid duplicate applications
            const suggest = [];
            if (!suggestAttached) {
              const reorder = getReorder();
              if (reorder) {
                suggest.push({
                  messageId: "suggestReorder",
                  fix(fixer) {
                    return fixer.replaceTextRange(reorder.range, reorder.text);
                  },
                });
              }
              suggestAttached = true;
            }

            context.report({
              node: entry.node,
              messageId: "wrongOrder",
              data: { current: CATEGORY_LABELS[entry.category], previous: CATEGORY_LABELS[highWaterCategory], hint: EXPECTED_ORDER_HINT },
              suggest,
            });
          }
          if (entry.priority > highWaterMark) {
            highWaterMark = entry.priority;
            highWaterCategory = entry.category;
          }
        }

        // ─── Check 2: Same-category adjacency ────────────────────────────────
        const categoryIndices = {};
        entries.forEach((entry, idx) => {
          if (!categoryIndices[entry.category]) {
            categoryIndices[entry.category] = [];
          }
          categoryIndices[entry.category].push(idx);
        });

        for (const [cat, indices] of Object.entries(categoryIndices)) {
          if (indices.length < 2) continue;

          for (let i = 1; i < indices.length; i++) {
            const prevIdx = indices[i - 1];
            const currIdx = indices[i];
            let gapCount = 0;
            for (let j = prevIdx + 1; j < currIdx; j++) {
              if (entries[j].category !== cat) gapCount++;
            }
            if (gapCount > 0) {
              const stragglerNode = entries[currIdx].node;

              // Attach suggestion fix if not already attached to a cross-category report
              const suggest = [];
              if (!suggestAttached) {
                const reorder = getReorder();
                if (reorder) {
                  suggest.push({
                    messageId: "suggestReorder",
                    fix(fixer) {
                      return fixer.replaceTextRange(reorder.range, reorder.text);
                    },
                  });
                }
                suggestAttached = true;
              }

              context.report({
                node: stragglerNode,
                messageId: "notAdjacent",
                data: { category: CATEGORY_LABELS[cat], intervening: String(gapCount) },
                suggest,
              });
            }
          }
        }

        // ─── Check 3: Export-first within same category ──────────────────────
        // Within each category group, exported declarations should precede local ones.
        for (const [cat, indices] of Object.entries(categoryIndices)) {
          if (cat === "import" || cat === "reexport") continue; // imports/re-exports are always exported
          let seenNonExport = false;
          for (const idx of indices) {
            const entry = entries[idx];
            const exported = isExported(entry.node);
            if (!exported) {
              seenNonExport = true;
            } else if (seenNonExport) {
              // Exported declaration after a non-exported one — violation
              const name = getDeclarationName(entry.node);

              const suggest = [];
              if (!suggestAttached) {
                const reorder = getReorder();
                if (reorder) {
                  suggest.push({
                    messageId: "suggestReorder",
                    fix(fixer) {
                      return fixer.replaceTextRange(reorder.range, reorder.text);
                    },
                  });
                }
                suggestAttached = true;
              }

              context.report({ node: entry.node, messageId: "exportFirst", data: { name, hint: EXPORT_HINT }, suggest });
            }
          }
        }
      },
    };
  },
};
// ─── Plugin export ──────────────────────────────────────────────────────────────

const plugin = { meta: { name: "declaration-order", version: "2.0.0" }, rules: { "module-declaration-order": moduleDeclarationOrder } };
export default plugin;

/**
 * Classify a top-level statement into a category.
 * Returns null for unclassifiable statements (bare expressions, control flow, etc.).
 */
function classify(node) {
  // --- Imports ---
  if (node.type === "ImportDeclaration") return "import";

  // --- Re-exports ---
  if (node.type === "ExportAllDeclaration") return "reexport";
  if (node.type === "ExportNamedDeclaration" && !node.declaration && node.source) {
    return "reexport";
  }
  if (node.type === "ExportNamedDeclaration" && !node.declaration && !node.source) {
    return "reexport";
  }

  // --- Unwrap export wrappers ---
  let decl = node;
  if (node.type === "ExportNamedDeclaration" && node.declaration) {
    decl = node.declaration;
  }
  if (node.type === "ExportDefaultDeclaration" && node.declaration) {
    decl = node.declaration;
  }

  // --- TS-specific ---
  if (decl.type === "TSInterfaceDeclaration") return "interface";
  if (decl.type === "TSTypeAliasDeclaration") return "type";
  if (decl.type === "TSModuleDeclaration") return "declare-module";
  if (decl.type === "TSEnumDeclaration") return "type";

  // --- Class ---
  if (decl.type === "ClassDeclaration") return "class";

  // --- Function ---
  if (decl.type === "FunctionDeclaration") return "function";
  if (decl.type === "TSDeclareFunction") return "function";

  // --- Variable declarations ---
  if (decl.type === "VariableDeclaration") {
    const declarators = decl.declarations || [];
    const allFunctions =
      declarators.length > 0 &&
      declarators.every((d) => {
        if (!d.init) return false;
        return d.init.type === "ArrowFunctionExpression" || d.init.type === "FunctionExpression";
      });
    if (allFunctions) return "function";
    return "constant";
  }

  return null;
}

/**
 * Check if a top-level statement is exported.
 */
function isExported(node) {
  return node.type === "ExportNamedDeclaration" || node.type === "ExportDefaultDeclaration" || node.type === "ExportAllDeclaration";
}

/**
 * Get a human-readable name for a declaration (for error messages).
 */
function getDeclarationName(node) {
  let decl = node;
  if (node.type === "ExportNamedDeclaration" && node.declaration) decl = node.declaration;
  if (node.type === "ExportDefaultDeclaration" && node.declaration) decl = node.declaration;

  if (decl.id && decl.id.name) return decl.id.name;
  if (decl.type === "VariableDeclaration" && decl.declarations && decl.declarations[0]) {
    const d = decl.declarations[0];
    if (d.id && d.id.name) return d.id.name;
  }
  return "(anonymous)";
}
// ─── Fix helpers ────────────────────────────────────────────────────────────────

/**
 * Get full range of a statement: from start of its leading comments to end of trailing newline.
 */
function getFullRange(node, sourceCode) {
  const text = sourceCode.getText ? sourceCode.getText() : sourceCode.text;
  const comments = sourceCode.getCommentsBefore ? sourceCode.getCommentsBefore(node) : [];
  let start = node.range[0];
  if (comments.length > 0) {
    start = comments[0].range[0];
  }
  let end = node.range[1];
  // Include trailing newline
  if (text[end] === "\n") end++;
  else if (text[end] === "\r" && text[end + 1] === "\n") end += 2;
  return [start, end];
}

/**
 * Extract full text for a statement (including leading comments and trailing newline).
 */
function getStatementText(node, sourceCode) {
  const text = sourceCode.getText ? sourceCode.getText() : sourceCode.text;
  const range = getFullRange(node, sourceCode);
  return text.slice(range[0], range[1]);
}

/**
 * Build sorted source by re-arranging all classified statements to canonical order.
 * Preserves relative order within each category (stable sort).
 * Unclassified statements stay attached to the preceding classified group.
 */
function buildReorderedSource(programNode, sourceCode) {
  const body = programNode.body;
  if (body.length === 0) return null;

  // Build segments: classified statement starts a segment; unclassified attaches to previous
  const segments = [];
  for (const stmt of body) {
    const cat = classify(stmt);
    if (cat !== null) {
      segments.push({ category: cat, priority: ORDER[cat], items: [stmt] });
    } else if (segments.length > 0) {
      segments[segments.length - 1].items.push(stmt);
    } else {
      // Leading unclassified statements — keep as-is at top
      segments.push({ category: null, priority: -1, items: [stmt] });
    }
  }

  // Stable sort by priority (null/leading stays first);
  // within the same priority, exported declarations come before local ones.
  const sorted = [...segments].sort((a, b) => {
    if (a.priority === -1 && b.priority === -1) return 0;
    if (a.priority === -1) return -1;
    if (b.priority === -1) return -1;
    if (a.priority !== b.priority) return a.priority - b.priority;
    // Same category: exported before local (stable within each sub-group)
    const aExported = isExported(a.items[0]) ? 0 : 1;
    const bExported = isExported(b.items[0]) ? 0 : 1;
    return aExported - bExported;
  });

  // Check if order actually changed
  let changed = false;
  for (let i = 0; i < sorted.length; i++) {
    if (sorted[i] !== segments[i]) {
      changed = true;
      break;
    }
  }
  if (!changed) return null;

  // Rebuild source text:
  // - Imports are kept dense (no blank lines between them)
  // - One blank line between all other top-level declarations
  // Each stmtText from getStatementText already ends with \n
  const parts = [];
  let prevCategory = null;
  for (const seg of sorted) {
    for (const item of seg.items) {
      const stmtText = getStatementText(item, sourceCode);
      const itemCat = classify(item);
      // Insert blank line unless both prev and current are imports
      if (parts.length > 0) {
        const bothImports = prevCategory === "import" && itemCat === "import";
        if (!bothImports) {
          parts.push("\n");
        }
      }
      parts.push(stmtText);
      if (itemCat !== null) prevCategory = itemCat;
    }
  }

  // Full range of program body
  const firstRange = getFullRange(body[0], sourceCode);
  const lastRange = getFullRange(body[body.length - 1], sourceCode);

  return { range: [firstRange[0], lastRange[1]], text: parts.join("") };
}
