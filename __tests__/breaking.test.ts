import { detectBreakingChanges } from '../src/breaking'
import { PRFile } from '../src/types'

function file(filename: string, patch: string): PRFile {
  return { filename, status: 'modified', additions: 1, deletions: 1, patch }
}

describe('removed exports', () => {
  it('detects removed exported function', () => {
    const patch = '-export function createUser(name: string) {}'
    const changes = detectBreakingChanges([file('src/users.ts', patch)])
    expect(changes).toHaveLength(1)
    expect(changes[0].type).toBe('removed-export')
    expect(changes[0].description).toContain('createUser')
  })

  it('detects removed exported class', () => {
    const patch = '-export class UserService {}'
    const changes = detectBreakingChanges([file('src/service.ts', patch)])
    expect(changes[0].description).toContain('UserService')
  })

  it('ignores non-exported removal', () => {
    const patch = '-function internalHelper() {}'
    expect(detectBreakingChanges([file('src/x.ts', patch)])).toHaveLength(0)
  })

  it('ignores non-ts files for export check', () => {
    const patch = '-export function foo() {}'
    expect(detectBreakingChanges([file('README.md', patch)])).toHaveLength(0)
  })
})

describe('SQL breaking changes', () => {
  it('detects DROP TABLE', () => {
    const patch = '+DROP TABLE users;'
    const changes = detectBreakingChanges([file('migrations/001_drop.sql', patch)])
    expect(changes).toHaveLength(1)
    expect(changes[0].type).toBe('sql-destructive')
  })

  it('detects DROP COLUMN via ALTER TABLE', () => {
    const patch = '+ALTER TABLE users DROP COLUMN email;'
    const changes = detectBreakingChanges([file('db/migration.sql', patch)])
    expect(changes[0].type).toBe('sql-destructive')
  })

  it('ignores SELECT statements', () => {
    const patch = '+SELECT * FROM users;'
    expect(detectBreakingChanges([file('db/query.sql', patch)])).toHaveLength(0)
  })
})

describe('removed routes', () => {
  it('detects removed express route', () => {
    const patch = "-app.delete('/users/:id', deleteUser)"
    const changes = detectBreakingChanges([file('src/routes/users.ts', patch)])
    expect(changes).toHaveLength(1)
    expect(changes[0].type).toBe('removed-route')
    expect(changes[0].description).toContain('/users/:id')
  })
})
