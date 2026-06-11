export interface PRData {
  title: string
  description: string
  diff: string
  files: PRFile[]
  additions: number
  deletions: number
  changedFiles: number
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

export interface AnalysisResults {
  complexity: ComplexityResult
  secrets: SecretFinding[]
  todos: TodoFinding[]
  coverageGaps: CoverageGap[]
}

export interface AIAnalysis {
  summary: string
  concerns: string[]
  suggestions: string[]
  splitSuggestion?: string
}
