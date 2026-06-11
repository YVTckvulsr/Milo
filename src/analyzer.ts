import { PRData, AnalysisResults, ComplexityResult, SecretFinding, TodoFinding, CoverageGap, MiloConfig } from './types'
import { parseDependencyChanges } from './dependencies'
import { detectBreakingChanges } from './breaking'

const BUILTIN_SECRET_PATTERNS: Array<{ type: string; pattern: RegExp }> = [
  { type: 'AWS Access Key',     pattern: /AKIA[0-9A-Z]{16}/g },
  { type: 'AWS Secret Key',     pattern: /(?:aws_secret(?:_access)?_key)\s*[:=]\s*['"]?([A-Za-z0-9/+=]{40})['"]?/gi },
  { type: 'Private Key',        pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/g },
  { type: 'GitHub Token',       pattern: /gh[pousr]_[A-Za-z0-9]{36,}/g },
  { type: 'Slack Token',        pattern: /xox[baprs]-(?:[0-9a-zA-Z]{10,48})/g },
  { type: 'Google API Key',     pattern: /AIza[0-9A-Za-z_\-]{35}/g },
  { type: 'Stripe Secret Key',  pattern: /sk_(?:live|test)_[A-Za-z0-9]{24,}/g },
  { type: 'Anthropic API Key',  pattern: /sk-ant-[A-Za-z0-9_\-]{40,}/g },
  { type: 'Database URL',       pattern: /(?:postgres|mysql|mongodb)(?:\+\w+)?:\/\/[^@\s]+@[^\s'"]+/gi },
  { type: 'Generic Secret',     pattern: /(?:api[_-]?key|api[_-]?secret|client[_-]?secret|auth[_-]?token)\s*[:=]\s*['"]([A-Za-z0-9_\-]{20,})['"]?/gi },
  { type: 'Bearer Token',       pattern: /Authorization:\s*Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi },
  { type: 'Basic Auth',         pattern: /Authorization:\s*Basic\s+[A-Za-z0-9+/]+=*/gi },
  { type: 'SSH Private Key',    pattern: /(?:-----BEGIN OPENSSH PRIVATE KEY-----|PuTTY-User-Key-File)/g },
  { type: 'Twilio Token',       pattern: /SK[0-9a-fA-F]{32}/g },
  { type: 'SendGrid Key',       pattern: /SG\.[A-Za-z0-9_\-]{22}\.[A-Za-z0-9_\-]{43}/g },
  { type: 'Azure Storage Key',  pattern: /DefaultEndpointsProtocol=https;AccountName=\w+;AccountKey=[A-Za-z0-9+/=]{88}/g },
]

// Per-language test file patterns
const TEST_PATTERNS: Record<string, RegExp[]> = {
  ts:   [/\.(test|spec)\.(ts|tsx|js|jsx)$/, /__tests__\//, /\.test$/, /\.spec$/],
  py:   [/(?:^|\/)test_[^/]+\.py$/, /(?:^|\/)[^/]+_test\.py$/, /(?:^|\/)tests?\//],
  go:   [/_test\.go$/],
  java: [/(?:Test|Tests|IT|Spec)\.(java|kt)$/, /\/src\/test\//],
  rb:   [/_spec\.rb$/, /(?:^|\/)spec\//],
  php:  [/Test\.php$/, /(?:^|\/)tests?\//],
  rs:   [/(?:^|\/)tests?\//],
  cpp:  [/[_.](?:test|spec)\.(c|cpp|cc|h|hpp)$/, /(?:^|\/)tests?\//],
}

const SOURCE_DIRS = [/^src\//, /^lib\//, /^app\//, /^packages\/[^/]+\/src\//]

function getTestPatterns(filename: string): RegExp[] {
  const ext = filename.split('.').pop() ?? ''
  const map: Record<string, string> = {
    ts: 'ts', tsx: 'ts', js: 'ts', jsx: 'ts', mjs: 'ts',
    py: 'py',
    go: 'go',
    java: 'java', kt: 'java',
    rb: 'rb',
    php: 'php',
    rs: 'rs',
    c: 'cpp', cpp: 'cpp', cc: 'cpp', h: 'cpp', hpp: 'cpp',
  }
  return TEST_PATTERNS[map[ext] ?? 'ts'] ?? TEST_PATTERNS.ts
}

function isTestFile(filename: string): boolean {
  const patterns = Object.values(TEST_PATTERNS).flat()
  return patterns.some(p => p.test(filename))
}

function isIgnored(filename: string, ignorePaths: string[]): boolean {
  return ignorePaths.some(pattern => {
    const re = new RegExp(
      '^' + pattern.replace(/\./g, '\\.').replace(/\*\*/g, '.*').replace(/\*/g, '[^/]*') + '$'
    )
    return re.test(filename)
  })
}

export function runAnalysis(prData: PRData, config: MiloConfig): AnalysisResults {
  const secretPatterns = [
    ...BUILTIN_SECRET_PATTERNS,
    ...config.custom_secrets.map(s => ({
      type: s.name,
      pattern: new RegExp(s.pattern, 'g'),
    })),
  ]

  const filteredFiles = prData.files.filter(f => !isIgnored(f.filename, config.ignore.paths))
  const filteredData = { ...prData, files: filteredFiles }

  return {
    complexity: analyzeComplexity(filteredData, config),
    secrets:    config.checks.secrets     ? detectSecrets(filteredData, secretPatterns)         : [],
    todos:      config.checks.todos       ? detectTodos(filteredData)                           : [],
    coverageGaps: config.checks.tests     ? analyzeTestCoverage(filteredData)                   : [],
    dependencies: config.checks.dependencies ? parseDependencyChanges(filteredData.files)       : [],
    breaking:   config.checks.breaking_changes ? detectBreakingChanges(filteredData.files)      : [],
  }
}

function analyzeComplexity(prData: PRData, config: MiloConfig): ComplexityResult {
  const linesChanged = prData.additions + prData.deletions
  const filesChanged = prData.changedFiles
  const areas = detectAreas(prData.files.map(f => f.filename))

  let score: ComplexityResult['score']
  const maxLines = config.thresholds.max_pr_lines
  if (linesChanged < 50 && filesChanged <= 3)                             score = 'low'
  else if (linesChanged < 200 && filesChanged <= 10)                      score = 'medium'
  else if (linesChanged < maxLines / 2 && filesChanged <= 20)             score = 'high'
  else                                                                      score = 'very-high'

  const estimatedReviewMinutes = Math.max(5, Math.round(5 + linesChanged / 20 + areas.length * 2))

  return { score, filesChanged, linesChanged, areas, estimatedReviewMinutes }
}

function detectAreas(filenames: string[]): string[] {
  const areas = new Set<string>()
  for (const f of filenames) {
    if (isTestFile(f))                                                   areas.add('tests')
    else if (SOURCE_DIRS.some(p => p.test(f)))                           areas.add('source')
    if (f.startsWith('.github/'))                                        areas.add('ci/cd')
    if (/\.(yml|yaml|toml|ini|env\.example)$/i.test(f) && !f.startsWith('.github')) areas.add('config')
    if (/\.(md|txt|rst|mdx)$/i.test(f))                                  areas.add('docs')
    if (/\.(css|scss|sass|less|html|svelte|vue)$/.test(f))               areas.add('frontend')
    if (/migration|schema\.sql/i.test(f))                                areas.add('database')
  }
  return Array.from(areas)
}

function detectSecrets(prData: PRData, patterns: typeof BUILTIN_SECRET_PATTERNS): SecretFinding[] {
  const findings: SecretFinding[] = []

  for (const file of prData.files) {
    if (!file.patch) continue
    // Skip lockfiles — lots of hashes that trigger false positives
    if (/\.(lock|snap)$/.test(file.filename) || /package-lock\.json$/.test(file.filename)) continue

    const addedLines = file.patch
      .split('\n')
      .map((line, idx) => ({ line, number: idx + 1 }))
      .filter(({ line }) => line.startsWith('+') && !line.startsWith('+++'))

    for (const { line, number } of addedLines) {
      for (const { type, pattern } of patterns) {
        pattern.lastIndex = 0
        if (pattern.test(line)) {
          findings.push({ file: file.filename, line: number, type, snippet: line.slice(1, 80).trim() })
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
      const m = lines[i].match(pattern)
      if (m && !lines[i].startsWith('+++')) {
        findings.push({ file: file.filename, line: i + 1, text: m[2].trim().slice(0, 100) })
      }
    }
  }

  return findings
}

function analyzeTestCoverage(prData: PRData): CoverageGap[] {
  const changedTestFiles = new Set(
    prData.files.filter(f => isTestFile(f.filename)).map(f => f.filename)
  )

  const sourceFiles = prData.files.filter(f => {
    const isSource = SOURCE_DIRS.some(p => p.test(f.filename))
    const isTest = isTestFile(f.filename)
    const isConfig = /\.(json|yml|yaml|md|txt|lock|snap)$/.test(f.filename)
    return isSource && !isTest && !isConfig
  })

  return sourceFiles.map(file => {
    const base = file.filename.replace(/^(?:src|lib|app)\//, '').replace(/\.(ts|tsx|js|jsx|py|go|java|rb|php|rs)$/, '')
    const stem = base.split('/').pop() ?? base

    const hasTests = Array.from(changedTestFiles).some(t => t.includes(base) || t.includes(stem))
    return { file: file.filename, hasTests, isNewFile: file.status === 'added' }
  })
}
