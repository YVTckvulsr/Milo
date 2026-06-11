import { PRData, AnalysisResults, ComplexityResult, SecretFinding, TodoFinding, CoverageGap } from './types'

const SECRET_PATTERNS: Array<{ type: string; pattern: RegExp }> = [
  { type: 'AWS Access Key', pattern: /AKIA[0-9A-Z]{16}/g },
  { type: 'AWS Secret Key', pattern: /(?:aws_secret_access_key|aws_secret_key)\s*[:=]\s*['"]?([A-Za-z0-9/+=]{40})['"]?/gi },
  { type: 'Private Key', pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/g },
  { type: 'GitHub Token', pattern: /ghp_[A-Za-z0-9]{36}/g },
  { type: 'GitHub OAuth Token', pattern: /gho_[A-Za-z0-9]{36}/g },
  { type: 'Slack Token', pattern: /xox[baprs]-(?:[0-9a-zA-Z]{10,48})/g },
  { type: 'Generic Secret', pattern: /(?:api[_-]?key|apikey|api[_-]?secret|client[_-]?secret)\s*[:=]\s*['"]([A-Za-z0-9_\-]{20,})['"]?/gi },
  { type: 'Database URL', pattern: /(?:postgres|mysql|mongodb)(?:\+\w+)?:\/\/[^@\s]+@[^\s'"]+/gi },
  { type: 'Google API Key', pattern: /AIza[0-9A-Za-z_\-]{35}/g },
  { type: 'Stripe Secret Key', pattern: /sk_(?:live|test)_[A-Za-z0-9]{24,}/g },
  { type: 'Anthropic API Key', pattern: /sk-ant-[A-Za-z0-9_\-]{40,}/g },
]

const TEST_FILE_PATTERNS = [
  /\.(test|spec)\.(ts|tsx|js|jsx)$/,
  /^tests?\//,
  /__tests__\//,
]

const SOURCE_DIR_PATTERNS = [
  /^src\//,
  /^lib\//,
  /^app\//,
]

export function runAnalysis(prData: PRData): AnalysisResults {
  return {
    complexity: analyzeComplexity(prData),
    secrets: detectSecrets(prData),
    todos: detectTodos(prData),
    coverageGaps: analyzeTestCoverage(prData),
  }
}

function analyzeComplexity(prData: PRData): ComplexityResult {
  const linesChanged = prData.additions + prData.deletions
  const filesChanged = prData.changedFiles
  const areas = detectAreas(prData.files.map(f => f.filename))

  let score: ComplexityResult['score']
  if (linesChanged < 50 && filesChanged <= 3) score = 'low'
  else if (linesChanged < 200 && filesChanged <= 10) score = 'medium'
  else if (linesChanged < 500 && filesChanged <= 20) score = 'high'
  else score = 'very-high'

  const estimatedReviewMinutes = Math.max(5, Math.round(
    5 + linesChanged / 20 + areas.length * 2
  ))

  return { score, filesChanged, linesChanged, areas, estimatedReviewMinutes }
}

function detectAreas(filenames: string[]): string[] {
  const areas = new Set<string>()
  for (const file of filenames) {
    if (file.match(/test|spec/i)) areas.add('tests')
    else if (file.startsWith('src/') || file.startsWith('lib/')) areas.add('source')
    if (file.startsWith('.github/')) areas.add('ci/cd')
    if (file.match(/\.(yml|yaml|toml|ini)$/i) && !file.startsWith('.github')) areas.add('config')
    if (file.match(/\.(md|txt|rst)$/i)) areas.add('docs')
    if (file.match(/\.(css|scss|html|tsx|vue|svelte)$/)) areas.add('frontend')
    if (file.match(/migration|schema\.sql/i)) areas.add('database')
  }
  return Array.from(areas)
}

function detectSecrets(prData: PRData): SecretFinding[] {
  const findings: SecretFinding[] = []

  for (const file of prData.files) {
    if (!file.patch) continue

    const addedLines = file.patch
      .split('\n')
      .map((line, idx) => ({ line, number: idx + 1 }))
      .filter(({ line }) => line.startsWith('+') && !line.startsWith('+++'))

    for (const { line, number } of addedLines) {
      for (const { type, pattern } of SECRET_PATTERNS) {
        pattern.lastIndex = 0
        if (pattern.test(line)) {
          findings.push({
            file: file.filename,
            line: number,
            type,
            snippet: line.slice(1, 80).trim(),
          })
        }
      }
    }
  }

  return findings
}

function detectTodos(prData: PRData): TodoFinding[] {
  const findings: TodoFinding[] = []
  const pattern = /^\+.*\b(TODO|FIXME|HACK|XXX)\b(?:\(.*?\))?:?\s*(.+)/i

  for (const file of prData.files) {
    if (!file.patch) continue

    const lines = file.patch.split('\n')
    for (let i = 0; i < lines.length; i++) {
      const match = lines[i].match(pattern)
      if (match && !lines[i].startsWith('+++')) {
        findings.push({
          file: file.filename,
          line: i + 1,
          text: match[2].trim().slice(0, 100),
        })
      }
    }
  }

  return findings
}

function analyzeTestCoverage(prData: PRData): CoverageGap[] {
  const gaps: CoverageGap[] = []

  const changedTestFiles = new Set(
    prData.files
      .filter(f => TEST_FILE_PATTERNS.some(p => p.test(f.filename)))
      .map(f => f.filename)
  )

  const sourceFiles = prData.files.filter(f => {
    const isSource = SOURCE_DIR_PATTERNS.some(p => p.test(f.filename))
    const isTest = TEST_FILE_PATTERNS.some(p => p.test(f.filename))
    const isConfig = /\.(json|yml|yaml|md|txt|lock)$/.test(f.filename)
    return isSource && !isTest && !isConfig
  })

  for (const file of sourceFiles) {
    const baseName = file.filename
      .replace(/^(src|lib|app)\//, '')
      .replace(/\.(ts|tsx|js|jsx)$/, '')

    const stem = baseName.split('/').pop() ?? baseName
    const hasTests = Array.from(changedTestFiles).some(
      t => t.includes(baseName) || t.includes(stem)
    )

    gaps.push({ file: file.filename, hasTests, isNewFile: file.status === 'added' })
  }

  return gaps
}
