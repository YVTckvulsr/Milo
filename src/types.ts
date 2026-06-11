export interface PRData {
  title: string
  description: string
  diff: string
  files: PRFile[]
  additions: number
  deletions: number
  changedFiles: number
  headSha: string
}

export interface PRFile {
  filename: string
  status: 'added' | 'modified' | 'deleted' | 'renamed' | 'copied' | 'changed' | 'unchanged'
  additions: number
  deletions: number
  patch?: string
}

export interface ComplexityResult {
  score: 'low' | 'medium' | 'high' | 'very-high'
  filesChanged: number
  linesChanged: number
  areas: string[]
  estimatedReviewMinutes: number
}

export interface SecretFinding {
  file: string
  line: number
  type: string
  snippet: string
}

export interface TodoFinding {
  file: string
  line: number
  text: string
}

export interface CoverageGap {
  file: string
  hasTests: boolean
  isNewFile: boolean
}

export interface DependencyChange {
  name: string
  from: string | null
  to: string | null
  type: 'added' | 'removed' | 'major-bump' | 'upgraded' | 'downgraded'
  ecosystem: 'npm' | 'pip' | 'go' | 'cargo' | 'unknown'
  isDevDependency: boolean
}

export interface BreakingChange {
  file: string
  line: number
  type: 'removed-export' | 'sql-destructive' | 'removed-route'
  description: string
}

export interface AnalysisResults {
  complexity: ComplexityResult
  secrets: SecretFinding[]
  todos: TodoFinding[]
  coverageGaps: CoverageGap[]
  dependencies: DependencyChange[]
  breaking: BreakingChange[]
}

export interface AIAnalysis {
  summary: string
  concerns: string[]
  suggestions: string[]
  splitSuggestion?: string
}

export interface MiloConfig {
  checks: {
    secrets: boolean
    tests: boolean
    todos: boolean
    complexity: boolean
    dependencies: boolean
    breaking_changes: boolean
  }
  labels: {
    enabled: boolean
    size: boolean
    needs_tests: boolean
    security: boolean
    breaking_change: boolean
  }
  thresholds: {
    fail_on_score_below: number
    max_pr_lines: number
  }
  ignore: {
    paths: string[]
  }
  custom_secrets: Array<{ name: string; pattern: string }>
  ai: {
    model: string
  }
}

export const DEFAULT_CONFIG: MiloConfig = {
  checks: {
    secrets: true,
    tests: true,
    todos: true,
    complexity: true,
    dependencies: true,
    breaking_changes: true,
  },
  labels: {
    enabled: true,
    size: true,
    needs_tests: true,
    security: true,
    breaking_change: true,
  },
  thresholds: {
    fail_on_score_below: 0,
    max_pr_lines: 1000,
  },
  ignore: {
    paths: [],
  },
  custom_secrets: [],
  ai: {
    model: 'claude-sonnet-4-6',
  },
}
