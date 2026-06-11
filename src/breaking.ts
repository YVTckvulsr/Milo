import { PRFile, BreakingChange } from './types'

const EXPORTED_SYMBOL = /^-\s*export\s+(?:default\s+)?(?:function|class|const|let|var|type|interface|enum|abstract\s+class)\s+(\w+)/

const SQL_DESTRUCTIVE = [
  { re: /^\+.*\bDROP\s+TABLE\b/i, desc: 'Table dropped' },
  { re: /^\+.*\bDROP\s+COLUMN\b/i, desc: 'Column dropped' },
  { re: /^\+.*\bTRUNCATE\b/i, desc: 'Table truncated' },
  { re: /^\+.*\bALTER\s+TABLE\b.*\bDROP\b/i, desc: 'Column/constraint dropped via ALTER TABLE' },
  { re: /^\+.*\bDROP\s+INDEX\b/i, desc: 'Index dropped' },
]

// Matches route definitions: app.get("/foo"), router.delete("/bar"), @DELETE("/baz"), etc.
const ROUTE_PATTERN = /^[-]\s*(?:app|router)\.(get|post|put|patch|delete|all)\s*\(\s*['"`]([^'"`]+)/i
const DECORATOR_ROUTE = /^[-]\s*@(?:Get|Post|Put|Patch|Delete|All)\s*\(\s*['"`]([^'"`]+)/i

export function detectBreakingChanges(files: PRFile[]): BreakingChange[] {
  const changes: BreakingChange[] = []

  for (const file of files) {
    if (!file.patch) continue

    const lines = file.patch.split('\n')

    if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(file.filename)) {
      for (let i = 0; i < lines.length; i++) {
        const m = lines[i].match(EXPORTED_SYMBOL)
        if (m) {
          changes.push({
            file: file.filename,
            line: i + 1,
            type: 'removed-export',
            description: `Exported \`${m[1]}\` was removed or renamed`,
          })
        }
      }
    }

    if (/\.(sql|migration\.(ts|js)|migrate\.(ts|js))$/.test(file.filename) || /migration/i.test(file.filename)) {
      for (let i = 0; i < lines.length; i++) {
        for (const { re, desc } of SQL_DESTRUCTIVE) {
          if (re.test(lines[i])) {
            changes.push({ file: file.filename, line: i + 1, type: 'sql-destructive', description: desc })
          }
        }
      }
    }

    if (/route|controller|router|handler/i.test(file.filename) && /\.(ts|tsx|js|py|go|rb)$/.test(file.filename)) {
      for (let i = 0; i < lines.length; i++) {
        const m = lines[i].match(ROUTE_PATTERN) || lines[i].match(DECORATOR_ROUTE)
        if (m) {
          const path = m[2] ?? m[1]
          const method = m[1]?.toUpperCase() ?? ''
          changes.push({
            file: file.filename,
            line: i + 1,
            type: 'removed-route',
            description: `${method ? method + ' ' : ''}route \`${path}\` was removed`,
          })
        }
      }
    }
  }

  return changes
}
