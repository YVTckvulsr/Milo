import { PRFile, BreakingChange } from './types'

const COMMENT_PREFIXES = /^\s*(?:\/\/|#|\*|\/\*)/

function isCommentCode(line: string): boolean {
  // Strip the diff +/- prefix, then check if it's a comment
  return COMMENT_PREFIXES.test(line.slice(1))
}

// Matches removed export declarations (- prefix, export keyword, then a named symbol)
const REMOVED_EXPORT = /^-\s*export\s+(?:default\s+)?(?:(?:async\s+)?function\*?|class|const|let|var|type|interface|enum|abstract\s+class)\s+(\w+)/

// Matches export renames: `export { foo }` → line removed
const REMOVED_EXPORT_BRACE = /^-\s*export\s*\{([^}]+)\}/

const SQL_DESTRUCTIVE = [
  { re: /^\+\s*(?!--).*\bDROP\s+TABLE\b/i,              desc: 'Table dropped' },
  { re: /^\+\s*(?!--).*\bDROP\s+COLUMN\b/i,             desc: 'Column dropped' },
  { re: /^\+\s*(?!--).*\bTRUNCATE\b/i,                  desc: 'Table truncated' },
  { re: /^\+\s*(?!--).*\bALTER\s+TABLE\b.*\bDROP\b/i,   desc: 'Column or constraint dropped via ALTER TABLE' },
  { re: /^\+\s*(?!--).*\bDROP\s+INDEX\b/i,              desc: 'Index dropped' },
]

const ROUTE_REMOVED = /^-\s*(?:app|router)\.(get|post|put|patch|delete|all)\s*\(\s*['"`]([^'"`]+)/i
const DECORATOR_REMOVED = /^-\s*@(?:Get|Post|Put|Patch|Delete|All)\s*\(\s*['"`]([^'"`]+)/i

export function detectBreakingChanges(files: PRFile[]): BreakingChange[] {
  const changes: BreakingChange[] = []

  for (const file of files) {
    if (!file.patch) continue

    const lines = file.patch.split('\n')

    if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(file.filename)) {
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]
        if (!line.startsWith('-') || isCommentCode(line)) continue

        const m = line.match(REMOVED_EXPORT)
        if (m) {
          changes.push({ file: file.filename, line: i + 1, type: 'removed-export', description: `Exported \`${m[1]}\` was removed` })
          continue
        }

        const brace = line.match(REMOVED_EXPORT_BRACE)
        if (brace) {
          const names = brace[1].split(',').map(s => s.trim().split(/\s+as\s+/)[0].trim()).filter(Boolean)
          for (const name of names) {
            changes.push({ file: file.filename, line: i + 1, type: 'removed-export', description: `Exported \`${name}\` was removed from barrel export` })
          }
        }
      }
    }

    if (/(?:migration|\.sql$|migrate\.(ts|js)$)/i.test(file.filename)) {
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]
        if (isCommentCode(line)) continue
        for (const { re, desc } of SQL_DESTRUCTIVE) {
          if (re.test(line)) {
            changes.push({ file: file.filename, line: i + 1, type: 'sql-destructive', description: desc })
          }
        }
      }
    }

    if (/(?:route|controller|router|handler)/i.test(file.filename) && /\.(ts|tsx|js|py|go|rb)$/.test(file.filename)) {
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]
        if (isCommentCode(line)) continue
        const m = line.match(ROUTE_REMOVED) ?? line.match(DECORATOR_REMOVED)
        if (m) {
          const path = m[2] ?? m[1]
          const method = m[1]?.toUpperCase() ?? ''
          changes.push({ file: file.filename, line: i + 1, type: 'removed-route', description: `${method ? method + ' ' : ''}route \`${path}\` was removed` })
        }
      }
    }
  }

  return changes
}
