import { runAnalysis } from '../src/analyzer'
import { PRData } from '../src/types'

const basePR: PRData = {
  title: 'feat: add user authentication',
  description: 'Implements JWT-based auth flow',
  diff: '',
  files: [],
  additions: 0,
  deletions: 0,
  changedFiles: 0,
}

describe('secret detection', () => {
  it('detects AWS access key in added lines', () => {
    const pr: PRData = {
      ...basePR,
      files: [{
        filename: 'config.ts',
        status: 'modified',
        additions: 1,
        deletions: 0,
        patch: '+const key = "AKIAIOSFODNN7EXAMPLE"',
      }],
    }
    const result = runAnalysis(pr)
    expect(result.secrets).toHaveLength(1)
    expect(result.secrets[0].type).toBe('AWS Access Key')
  })

  it('ignores removed lines', () => {
    const pr: PRData = {
      ...basePR,
      files: [{
        filename: 'config.ts',
        status: 'modified',
        additions: 0,
        deletions: 1,
        patch: '-const key = "AKIAIOSFODNN7EXAMPLE"',
      }],
    }
    const result = runAnalysis(pr)
    expect(result.secrets).toHaveLength(0)
  })
})

describe('TODO detection', () => {
  it('detects new TODO in added lines', () => {
    const pr: PRData = {
      ...basePR,
      files: [{
        filename: 'src/auth.ts',
        status: 'modified',
        additions: 1,
        deletions: 0,
        patch: '+// TODO: handle token refresh',
      }],
    }
    const result = runAnalysis(pr)
    expect(result.todos).toHaveLength(1)
    expect(result.todos[0].text).toBe('handle token refresh')
  })
})

describe('test coverage gaps', () => {
  it('flags a new source file with no corresponding test change', () => {
    const pr: PRData = {
      ...basePR,
      files: [{
        filename: 'src/auth/jwt.ts',
        status: 'added',
        additions: 50,
        deletions: 0,
        patch: '+export function sign() {}',
      }],
    }
    const result = runAnalysis(pr)
    expect(result.coverageGaps).toHaveLength(1)
    expect(result.coverageGaps[0].hasTests).toBe(false)
    expect(result.coverageGaps[0].isNewFile).toBe(true)
  })

  it('does not flag a source file when a test file also changed', () => {
    const pr: PRData = {
      ...basePR,
      files: [
        { filename: 'src/auth/jwt.ts', status: 'modified', additions: 10, deletions: 2, patch: '+export function sign() {}' },
        { filename: 'src/auth/jwt.test.ts', status: 'modified', additions: 5, deletions: 0, patch: '+it("signs", () => {})' },
      ],
    }
    const result = runAnalysis(pr)
    const gap = result.coverageGaps.find(g => g.file === 'src/auth/jwt.ts')
    expect(gap?.hasTests).toBe(true)
  })
})

describe('complexity analysis', () => {
  it('marks a small PR as low complexity', () => {
    const pr: PRData = { ...basePR, additions: 20, deletions: 5, changedFiles: 2 }
    const result = runAnalysis(pr)
    expect(result.complexity.score).toBe('low')
  })

  it('marks a large PR as very-high complexity', () => {
    const pr: PRData = { ...basePR, additions: 400, deletions: 200, changedFiles: 25 }
    const result = runAnalysis(pr)
    expect(result.complexity.score).toBe('very-high')
  })
})
