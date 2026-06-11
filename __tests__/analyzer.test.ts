import { runAnalysis } from '../src/analyzer'
import { PRData, DEFAULT_CONFIG } from '../src/types'

const cfg = DEFAULT_CONFIG

const basePR: PRData = {
  title: 'feat: add auth',
  description: 'Adds JWT auth',
  diff: '',
  headSha: 'abc123',
  files: [],
  additions: 0,
  deletions: 0,
  changedFiles: 0,
}

// ─── Secrets ─────────────────────────────────────────────────────────────────

describe('secret detection', () => {
  it('detects AWS access key in added line', () => {
    const pr: PRData = { ...basePR, files: [{ filename: 'cfg.ts', status: 'modified', additions: 1, deletions: 0, patch: '+const k = "AKIAIOSFODNN7EXAMPLE"' }] }
    expect(runAnalysis(pr, cfg).secrets).toHaveLength(1)
    expect(runAnalysis(pr, cfg).secrets[0].type).toBe('AWS Access Key')
  })

  it('ignores removed lines', () => {
    const pr: PRData = { ...basePR, files: [{ filename: 'cfg.ts', status: 'modified', additions: 0, deletions: 1, patch: '-const k = "AKIAIOSFODNN7EXAMPLE"' }] }
    expect(runAnalysis(pr, cfg).secrets).toHaveLength(0)
  })

  it('skips lockfiles', () => {
    const pr: PRData = { ...basePR, files: [{ filename: 'package-lock.json', status: 'modified', additions: 1, deletions: 0, patch: '+  "integrity": "AKIAIOSFODNN7EXAMPLE"' }] }
    expect(runAnalysis(pr, cfg).secrets).toHaveLength(0)
  })

  it('respects ignore paths', () => {
    const pr: PRData = { ...basePR, files: [{ filename: 'vendor/foo.ts', status: 'modified', additions: 1, deletions: 0, patch: '+const k = "AKIAIOSFODNN7EXAMPLE"' }] }
    const customCfg = { ...cfg, ignore: { paths: ['vendor/**'] } }
    expect(runAnalysis(pr, customCfg).secrets).toHaveLength(0)
  })
})

// ─── TODOs ────────────────────────────────────────────────────────────────────

describe('TODO detection', () => {
  it('detects new TODO', () => {
    const pr: PRData = { ...basePR, files: [{ filename: 'src/auth.ts', status: 'modified', additions: 1, deletions: 0, patch: '+// TODO: handle refresh' }] }
    const result = runAnalysis(pr, cfg)
    expect(result.todos).toHaveLength(1)
    expect(result.todos[0].text).toBe('handle refresh')
  })

  it('detects FIXME', () => {
    const pr: PRData = { ...basePR, files: [{ filename: 'src/x.ts', status: 'modified', additions: 1, deletions: 0, patch: '+// FIXME: broken edge case' }] }
    expect(runAnalysis(pr, cfg).todos).toHaveLength(1)
  })

  it('ignores existing TODOs (removed lines)', () => {
    const pr: PRData = { ...basePR, files: [{ filename: 'src/x.ts', status: 'modified', additions: 0, deletions: 1, patch: '-// TODO: old' }] }
    expect(runAnalysis(pr, cfg).todos).toHaveLength(0)
  })
})

// ─── Test coverage ───────────────────────────────────────────────────────────

describe('test coverage gaps', () => {
  it('flags new source file with no test changes (TypeScript)', () => {
    const pr: PRData = { ...basePR, files: [{ filename: 'src/auth/jwt.ts', status: 'added', additions: 50, deletions: 0, patch: '+export function sign() {}' }] }
    const gaps = runAnalysis(pr, cfg).coverageGaps
    expect(gaps).toHaveLength(1)
    expect(gaps[0].hasTests).toBe(false)
    expect(gaps[0].isNewFile).toBe(true)
  })

  it('does not flag source file when test file also changed', () => {
    const pr: PRData = { ...basePR, files: [
      { filename: 'src/auth/jwt.ts', status: 'modified', additions: 10, deletions: 2, patch: '+export function sign() {}' },
      { filename: 'src/auth/jwt.test.ts', status: 'modified', additions: 5, deletions: 0, patch: '+it("signs", () => {})' },
    ] }
    expect(runAnalysis(pr, cfg).coverageGaps[0].hasTests).toBe(true)
  })

  it('detects Python test gaps', () => {
    const pr: PRData = { ...basePR, files: [{ filename: 'src/utils.py', status: 'added', additions: 30, deletions: 0, patch: '+def helper(): pass' }] }
    const gaps = runAnalysis(pr, cfg).coverageGaps
    expect(gaps).toHaveLength(1)
    expect(gaps[0].hasTests).toBe(false)
  })

  it('passes Python file when test_*.py changed', () => {
    const pr: PRData = { ...basePR, files: [
      { filename: 'src/utils.py', status: 'modified', additions: 5, deletions: 0, patch: '+def helper(): pass' },
      { filename: 'tests/test_utils.py', status: 'modified', additions: 3, deletions: 0, patch: '+def test_helper(): pass' },
    ] }
    expect(runAnalysis(pr, cfg).coverageGaps[0].hasTests).toBe(true)
  })
})

// ─── Complexity ───────────────────────────────────────────────────────────────

describe('complexity', () => {
  it('low for small PR', () => {
    expect(runAnalysis({ ...basePR, additions: 20, deletions: 5, changedFiles: 2 }, cfg).complexity.score).toBe('low')
  })

  it('very-high for large PR', () => {
    expect(runAnalysis({ ...basePR, additions: 400, deletions: 200, changedFiles: 25 }, cfg).complexity.score).toBe('very-high')
  })
})
