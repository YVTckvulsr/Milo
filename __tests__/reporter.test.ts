import { calculateHealthScore } from '../src/reporter'
import { AnalysisResults, PRData } from '../src/types'

const basePR: PRData = {
  title: 'fix: update auth', description: 'Fixes auth flow', diff: '', headSha: 'abc',
  isDraft: false, files: [], additions: 50, deletions: 10, changedFiles: 3,
}

const cleanAnalysis: AnalysisResults = {
  complexity: { score: 'low', filesChanged: 3, linesChanged: 60, areas: ['source'], estimatedReviewMinutes: 8 },
  secrets: [],
  todos: [],
  coverageGaps: [],
  dependencies: [],
  breaking: [],
}

describe('health score', () => {
  it('gives 10 for a clean PR with description', () => {
    expect(calculateHealthScore(cleanAnalysis, basePR)).toBe(10)
  })

  it('penalises missing description by 0.5', () => {
    const pr = { ...basePR, description: '' }
    expect(calculateHealthScore(cleanAnalysis, pr)).toBe(9.5)
  })

  it('penalises a secret by deducting for unique file', () => {
    const analysis = {
      ...cleanAnalysis,
      secrets: [{ file: 'src/cfg.ts', line: 5, type: 'AWS Access Key', snippet: 'AKIA...', entropy: 4.2 }],
    }
    const score = calculateHealthScore(analysis, basePR)
    expect(score).toBeLessThanOrEqual(7)
  })

  it('caps secret penalty at -4 (multiple secrets same file)', () => {
    const secrets = [
      { file: 'src/cfg.ts', line: 5, type: 'AWS Access Key', snippet: 'AKIA1', entropy: 4.2 },
      { file: 'src/cfg.ts', line: 6, type: 'Stripe Key', snippet: 'sk_live_', entropy: 4.5 },
    ]
    const analysis = { ...cleanAnalysis, secrets }
    const score = calculateHealthScore(analysis, basePR)
    // 1 unique file = -3, not -6
    expect(score).toBe(7)
  })

  it('penalises new files without tests more than modified files', () => {
    const withNewFile: AnalysisResults = {
      ...cleanAnalysis,
      coverageGaps: [{ file: 'src/new.ts', hasTests: false, isNewFile: true }],
    }
    const withModifiedFile: AnalysisResults = {
      ...cleanAnalysis,
      coverageGaps: [{ file: 'src/old.ts', hasTests: false, isNewFile: false }],
    }
    const scoreNew      = calculateHealthScore(withNewFile, basePR)
    const scoreModified = calculateHealthScore(withModifiedFile, basePR)
    expect(scoreNew).toBeLessThan(scoreModified)
  })

  it('does not penalise gaps where tests were confirmed via tree', () => {
    const analysis: AnalysisResults = {
      ...cleanAnalysis,
      coverageGaps: [{ file: 'src/x.ts', hasTests: true, isNewFile: false, confirmedByTree: true }],
    }
    expect(calculateHealthScore(analysis, basePR)).toBe(10)
  })

  it('floors at 0 even with many issues', () => {
    const analysis: AnalysisResults = {
      ...cleanAnalysis,
      secrets: Array.from({ length: 10 }, (_, i) => ({ file: `src/f${i}.ts`, line: 1, type: 'AWS', snippet: 'x', entropy: 4.5 })),
      coverageGaps: Array.from({ length: 20 }, (_, i) => ({ file: `src/f${i}.ts`, hasTests: false, isNewFile: true })),
      breaking: Array.from({ length: 10 }, (_, i) => ({ file: `src/f${i}.ts`, line: 1, type: 'removed-export' as const, description: 'x' })),
      todos: Array.from({ length: 20 }, (_, i) => ({ file: 'src/x.ts', line: i, text: 'todo' })),
    }
    expect(calculateHealthScore(analysis, basePR)).toBe(0)
  })

  it('penalises very-high complexity', () => {
    const analysis: AnalysisResults = {
      ...cleanAnalysis,
      complexity: { ...cleanAnalysis.complexity, score: 'very-high' },
    }
    expect(calculateHealthScore(analysis, basePR)).toBe(9.5)
  })
})
