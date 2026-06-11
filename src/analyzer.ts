import { PRData, AnalysisResults, ComplexityResult, SecretFinding, TodoFinding, CoverageGap, MiloConfig } from './types'
import { parseDependencyChanges } from './dependencies'
import { detectBreakingChanges } from './breaking'

// ─── Shannon entropy ──────────────────────────────────────────────────────────

export function shannonEntropy(s: string): number {
  if (!s) return 0
  const freq = new Map<string, number>()
  for (const ch of s) freq.set(ch, (freq.get(ch) ?? 0) + 1)
  let entropy = 0
  for (const count of freq.values()) {
    const p = count / s.length
    entropy -= p * Math.log2(p)
  }
  return entropy
}

function extractToken(line: string, match: RegExpExecArray): string {
  // Prefer capture group 1 (the actual secret value), otherwise use full match
  const raw = match[1] ?? match[0]
  // Strip surrounding quotes/whitespace
  return raw.replace(/^['"\s]+|['"\s]+$/g, '')
}

// ─── Secret patterns ──────────────────────────────────────────────────────────

interface SecretPattern {
  type: string
  pattern: RegExp
  /** If true, the matched token must exceed entropyThreshold */
  requireEntropy: boolean
  entropyThreshold: number
}

// High-specificity patterns never need entropy checks.
// Medium/low specificity patterns require entropy to filter example/placeholder values.
const BUILTIN_PATTERNS: SecretPattern[] = [
  { type: 'AWS Access Key',    pattern: /AKIA[0-9A-Z]{16}/g,                                                    requireEntropy: false, entropyThreshold: 0 },
  { type: 'GitHub Token',      pattern: /gh[pousr]_[A-Za-z0-9]{36,}/g,                                         requireEntropy: false, entropyThreshold: 0 },
  { type: 'Google API Key',    pattern: /AIza[0-9A-Za-z_\-]{35}/g,                                             requireEntropy: false, entropyThreshold: 0 },
  { type: 'Stripe Secret Key', pattern: /sk_(?:live|test)_[A-Za-z0-9]{24,}/g,                                  requireEntropy: false, entropyThreshold: 0 },
  { type: 'Anthropic API Key', pattern: /sk-ant-[A-Za-z0-9_\-]{40,}/g,                                         requireEntropy: false, entropyThreshold: 0 },
  { type: 'Slack Token',       pattern: /xox[baprs]-(?:[0-9a-zA-Z]{10,48})/g,                                  requireEntropy: false, entropyThreshold: 0 },
  { type: 'Twilio Token',      pattern: /SK[0-9a-fA-F]{32}/g,                                                  requireEntropy: false, entropyThreshold: 0 },
  { type: 'SendGrid Key',      pattern: /SG\.[A-Za-z0-9_\-]{22}\.[A-Za-z0-9_\-]{43}/g,                        requireEntropy: false, entropyThreshold: 0 },
  { type: 'Private Key',       pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/g,             requireEntropy: false, entropyThreshold: 0 },
  { type: 'AWS Secret Key',    pattern: /(?:aws_secret(?:_access)?_key)\s*[:=]\s*['"]?([A-Za-z0-9/+=]{40})['"]?/gi, requireEntropy: true, entropyThreshold: 4.0 },
  { type: 'Database URL',      pattern: /(?:postgres|mysql|mongodb)(?:\+\w+)?:\/\/[^@\s"']+@[^\s'"]+/gi,       requireEntropy: true, entropyThreshold: 3.0 },
  { type: 'Generic Secret',    pattern: /(?:api[_-]?key|api[_-]?secret|client[_-]?secret|auth[_-]?token)\s*[:=]\s*['"]([A-Za-z0-9_\-]{20,})['"]?/gi, requireEntropy: true, entropyThreshold: 3.8 },
]

// ─── Language-aware test file patterns ───────────────────────────────────────

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
  const extMap: Record<string, string> = {
    ts: 'ts', tsx: 'ts', js: 'ts', jsx: 'ts', mjs: 'ts',
    py: 'py', go: 'go',
    java: 'java', kt: 'java',
    rb: 'rb', php: 'php', rs: 'rs',
    c: 'cpp', cpp: 'cpp', cc: 'cpp', h: 'cpp', hpp: 'cpp',
  }
  return TEST_PATTERNS[extMap[ext] ?? 'ts'] ?? TEST_PATTERNS.ts
}

export function isTestFile(filename: string): boolean {
  return Object.values(TEST_PATTERNS).flat().some(p => p.test(filename))
}

function isIgnored(filename: string, ignorePaths: string[]): boolean {
  return ignorePaths.some(pattern => {
    const re = new RegExp(
      '^' + pattern.replace(/\./g, '\\.').replace(/\*\*/g, '.*').replace(/\*/g, '[^/]*') + '$'
    )
    return re.test(filename)
  })
}

// ─── Main entry ───────────────────────────────────────────────────────────────

export function runAnalysis(prData: PRData, config: MiloConfig): AnalysisResults {
  const allPatterns: SecretPattern[] = [
    ...BUILTIN_PATTERNS,
    ...config.custom_secrets.map(s => ({
      type: s.name,
      pattern: new RegExp(s.pattern, 'g'),
      requireEntropy: s.require_entropy ?? false,
      entropyThreshold: config.thresholds.secret_entropy_min,
    })),
  ]

  const files = prData.files.filter(f => !isIgnored(f.filename, config.ignore.paths))
  const filtered = { ...prData, files }

  return {
    complexity:   analyzeComplexity(filtered, config),
    secrets:      config.checks.secrets         ? detectSecrets(filtered, allPatterns, config.thresholds.secret_entropy_min) : [],
    todos:        config.checks.todos            ? detectTodos(filtered)                    : [],
    coverageGaps: config.checks.tests            ? analyzeTestCoverage(filtered)            : [],
    dependencies: config.checks.dependencies     ? parseDependencyChanges(filtered.files)   : [],
    breaking:     config.checks.breaking_changes ? detectBreakingChanges(filtered.files)    : [],
  }
}

// ─── Complexity ───────────────────────────────────────────────────────────────

function analyzeComplexity(prData: PRData, config: MiloConfig): ComplexityResult {
  const linesChanged = prData.additions + prData.deletions
  const filesChanged = prData.changedFiles
  const areas = detectAreas(prData.files.map(f => f.filename))

  let score: ComplexityResult['score']
  if (linesChanged < 50 && filesChanged <= 3)                          score = 'low'
  else if (linesChanged < 200 && filesChanged <= 10)                   score = 'medium'
  else if (linesChanged < config.thresholds.max_pr_lines / 2)         score = 'high'
  else                                                                   score = 'very-high'

  const estimatedReviewMinutes = Math.max(5, Math.round(5 + linesChanged / 20 + areas.length * 2))
  return { score, filesChanged, linesChanged, areas, estimatedReviewMinutes }
}

function detectAreas(filenames: string[]): string[] {
  const areas = new Set<string>()
  for (const f of filenames) {
    if (isTestFile(f))                                                areas.add('tests')
    else if (SOURCE_DIRS.some(p => p.test(f)))                        areas.add('source')
    if (f.startsWith('.github/'))                                     areas.add('ci/cd')
    if (/\.(yml|yaml|toml|ini)$/i.test(f) && !f.startsWith('.github')) areas.add('config')
    if (/\.(md|txt|rst|mdx)$/i.test(f))                               areas.add('docs')
    if (/\.(css|scss|sass|html|svelte|vue)$/.test(f))                 areas.add('frontend')
    if (/migration|schema\.sql/i.test(f))                             areas.add('database')
  }
  return Array.from(areas)
}

// ─── Secrets ─────────────────────────────────────────────────────────────────

const SKIP_FILES = /\.(lock|snap)$|package-lock\.json$|yarn\.lock$|pnpm-lock\.yaml$/

function detectSecrets(prData: PRData, patterns: SecretPattern[], globalEntropyMin: number): SecretFinding[] {
  const findings: SecretFinding[] = []
  const seen = new Set<string>()

  for (const file of prData.files) {
    if (!file.patch || SKIP_FILES.test(file.filename)) continue

    const addedLines = file.patch
      .split('\n')
      .map((line, idx) => ({ line, lineNum: idx + 1 }))
      .filter(({ line }) => line.startsWith('+') && !line.startsWith('+++'))

    for (const { line, lineNum } of addedLines) {
      for (const p of patterns) {
        p.pattern.lastIndex = 0
        const match = p.pattern.exec(line)
        if (!match) continue

        const token = extractToken(line, match)
        const entropy = shannonEntropy(token)

        if (p.requireEntropy && entropy < p.entropyThreshold) continue

        // Deduplicate identical token in same file
        const key = `${file.filename}:${token}`
        if (seen.has(key)) continue
        seen.add(key)

        findings.push({
          file: file.filename,
          line: lineNum,
          type: p.type,
          snippet: line.slice(1, 80).trim(),
          entropy: Math.round(entropy * 100) / 100,
        })
      }
    }
  }

  return findings
}

// ─── TODOs ────────────────────────────────────────────────────────────────────

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

// ─── Coverage gaps ────────────────────────────────────────────────────────────

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
    const ext = file.filename.split('.').pop() ?? 'ts'
    const withoutExt = file.filename.replace(/\.[^.]+$/, '')
    const stem = withoutExt.split('/').pop() ?? ''

    // Match against language-specific patterns for the source file's language
    const testPatterns = getTestPatterns(file.filename)
    const hasTests = Array.from(changedTestFiles).some(tf => {
      if (testPatterns.some(p => p.test(tf))) {
        // Test file language matches — check name similarity
        const tfStem = tf.replace(/\.[^.]+$/, '').split('/').pop() ?? ''
        return tf.includes(withoutExt.replace(/^(?:src|lib|app)\//, ''))
          || tfStem.includes(stem)
          || stem.includes(tfStem)
      }
      return false
    })

    void ext // suppress unused warning
    return { file: file.filename, hasTests, isNewFile: file.status === 'added' }
  })
}
