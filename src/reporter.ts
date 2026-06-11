import { PRData, AnalysisResults, AIAnalysis, DependencyChange } from './types'

export const MILO_MARKER = '<!-- milo-pr-health-check -->'

// ─── Health score ─────────────────────────────────────────────────────────────
//
// Scoring rationale (documented so teams can reason about it):
//   Secrets:              -3 per unique file affected, max -4  (security blocker)
//   Untested new files:   -1 each, max -3                      (new code without tests)
//   Untested modified:    -0.5 each, max -2                    (existing code untested)
//   Breaking changes:     -0.75 each, max -2                   (API compatibility)
//   Major dep bumps:      -0.4 each, max -1                    (upgrade risk)
//   TODOs added:          -0.2 each, max -1                    (tech debt signal)
//   No description:       -0.5                                 (reviewer context)
//   Very large PR:        -0.5                                 (review difficulty)
//
// Total possible deductions: 14 — floor at 0.

export function calculateHealthScore(analysis: AnalysisResults, prData: PRData): number {
  let score = 10

  // Secrets — penalise by unique file, not by occurrence count
  const secretFiles = new Set(analysis.secrets.map(s => s.file)).size
  score -= Math.min(secretFiles * 3, 4)

  // Test coverage
  const uncoveredNew      = analysis.coverageGaps.filter(g => !g.hasTests && g.isNewFile).length
  const uncoveredModified = analysis.coverageGaps.filter(g => !g.hasTests && !g.isNewFile).length
  score -= Math.min(uncoveredNew * 1, 3)
  score -= Math.min(uncoveredModified * 0.5, 2)

  // Breaking changes
  score -= Math.min(analysis.breaking.length * 0.75, 2)

  // Dependency major bumps
  const majorBumps = analysis.dependencies.filter(d => d.type === 'major-bump').length
  score -= Math.min(majorBumps * 0.4, 1)

  // TODOs
  score -= Math.min(analysis.todos.length * 0.2, 1)

  // Missing description
  if (!(prData.description ?? '').trim()) score -= 0.5

  // Very large PR
  if (analysis.complexity.score === 'very-high') score -= 0.5

  return Math.max(0, Math.round(score * 10) / 10)
}

// ─── Comment formatter ────────────────────────────────────────────────────────

export function formatComment(
  prData: PRData,
  analysis: AnalysisResults,
  aiAnalysis: AIAnalysis | null,
  appliedLabels: string[]
): string {
  const score = calculateHealthScore(analysis, prData)
  const uncovered = analysis.coverageGaps.filter(g => !g.hasTests)
  const majorBumps = analysis.dependencies.filter(d => d.type === 'major-bump')
  const enrichedCount = analysis.coverageGaps.filter(g => g.hasTests && g.confirmedByTree).length
  const scoreEmoji = score >= 8 ? '🟢' : score >= 5 ? '🟡' : '🔴'

  const lines: string[] = [MILO_MARKER, '']
  lines.push(`## ${scoreEmoji} Milo — Health Score: **${score}/10**`)
  lines.push('')

  if (aiAnalysis?.summary) {
    lines.push('### 📋 Summary')
    lines.push(`> ${aiAnalysis.summary}`)
    lines.push('')
  }

  // Health table
  lines.push('<details open>')
  lines.push('<summary><b>🏥 Health Checks</b></summary>')
  lines.push('')
  lines.push('| | Check | Status |')
  lines.push('|--|-------|--------|')

  const hasDesc = (prData.description ?? '').trim().length > 20
  lines.push(`| ${hasDesc ? '✅' : '⚠️'} | Description | ${hasDesc ? 'Provided' : 'Missing — reviewers need context'} |`)
  lines.push(`| ${analysis.secrets.length === 0 ? '✅' : '🚨'} | Secrets | ${analysis.secrets.length === 0 ? 'None detected' : `**${analysis.secrets.length} potential secret(s)**`} |`)

  const testStatus = uncovered.length === 0 ? '✅' : '⚠️'
  const testDetail = uncovered.length === 0
    ? `All source files covered${enrichedCount > 0 ? ` (${enrichedCount} confirmed via repo tree)` : ''}`
    : `${uncovered.length} file(s) without a test file`
  lines.push(`| ${testStatus} | Tests | ${testDetail} |`)

  lines.push(`| ${analysis.todos.length === 0 ? '✅' : '⚠️'} | TODOs | ${analysis.todos.length === 0 ? 'None added' : `${analysis.todos.length} new TODO/FIXME`} |`)
  lines.push(`| ${analysis.breaking.length === 0 ? '✅' : '⚠️'} | Breaking changes | ${analysis.breaking.length === 0 ? 'None detected' : `${analysis.breaking.length} possible breaking change(s)`} |`)

  const sizeOk = analysis.complexity.score === 'low' || analysis.complexity.score === 'medium'
  lines.push(`| ${sizeOk ? '✅' : '⚠️'} | PR size | +${prData.additions}/-${prData.deletions} lines · ${prData.changedFiles} files |`)

  if (analysis.dependencies.length > 0) {
    lines.push(`| ${majorBumps.length === 0 ? '✅' : '⚠️'} | Dependencies | ${formatDepSummary(analysis.dependencies)} |`)
  }

  lines.push('')
  lines.push('</details>')
  lines.push('')

  // Secrets
  if (analysis.secrets.length > 0) {
    lines.push('### 🚨 Secrets Detected — Do Not Merge')
    lines.push('> These lines match known secret patterns with high entropy. Rotate credentials and remove before merging.')
    lines.push('')
    for (const s of analysis.secrets) {
      lines.push(`- **${s.type}** · \`${s.file}\` line ${s.line} · entropy ${s.entropy}`)
    }
    lines.push('')
  }

  // Breaking changes
  if (analysis.breaking.length > 0) {
    lines.push('<details>')
    lines.push(`<summary>⚠️ <b>${analysis.breaking.length} possible breaking change(s)</b></summary>`)
    lines.push('')
    for (const b of analysis.breaking) {
      const icon = b.type === 'sql-destructive' ? '🗄️' : b.type === 'removed-route' ? '🛣️' : '📦'
      lines.push(`- ${icon} \`${b.file}:${b.line}\` — ${b.description}`)
    }
    lines.push('')
    lines.push('</details>')
    lines.push('')
  }

  // Test coverage gaps
  if (uncovered.length > 0) {
    lines.push('<details>')
    lines.push(`<summary>🧪 <b>${uncovered.length} file(s) without a test file</b></summary>`)
    lines.push('')
    for (const gap of uncovered) {
      lines.push(`- \`${gap.file}\`${gap.isNewFile ? ' *(new)*' : ''}`)
    }
    lines.push('')
    lines.push('</details>')
    lines.push('')
  }

  // Dependencies
  if (analysis.dependencies.length > 0 && (majorBumps.length > 0 || analysis.dependencies.some(d => d.type === 'added'))) {
    lines.push('<details>')
    lines.push(`<summary>📦 <b>Dependency changes (${analysis.dependencies.length})</b></summary>`)
    lines.push('')
    lines.push('| Package | Change | Version |')
    lines.push('|---------|--------|---------|')
    for (const d of analysis.dependencies.slice(0, 15)) {
      const emoji = d.type === 'major-bump' ? '⚠️' : d.type === 'added' ? '➕' : d.type === 'removed' ? '➖' : '↑'
      const ver = d.from && d.to ? `\`${d.from}\` → \`${d.to}\`` : d.to ? `\`${d.to}\`` : `\`${d.from}\``
      const preFlag = d.isPrerelease ? ' *(prerelease)*' : ''
      lines.push(`| \`${d.name}\` | ${emoji} ${d.type}${preFlag} | ${ver} |`)
    }
    if (analysis.dependencies.length > 15) lines.push(`| *...and ${analysis.dependencies.length - 15} more* | | |`)
    lines.push('')
    lines.push('</details>')
    lines.push('')
  }

  // TODOs
  if (analysis.todos.length > 0) {
    lines.push('<details>')
    lines.push(`<summary>📌 <b>${analysis.todos.length} new TODO/FIXME</b></summary>`)
    lines.push('')
    for (const t of analysis.todos.slice(0, 6)) {
      lines.push(`- \`${t.file}:${t.line}\` — ${t.text}`)
    }
    if (analysis.todos.length > 6) lines.push(`- *...and ${analysis.todos.length - 6} more*`)
    lines.push('')
    lines.push('</details>')
    lines.push('')
  }

  // AI analysis
  if (aiAnalysis) {
    if (aiAnalysis.concerns.length > 0) {
      lines.push('### ⚠️ Concerns')
      for (const c of aiAnalysis.concerns) lines.push(`- ${c}`)
      lines.push('')
    }
    if (aiAnalysis.suggestions.length > 0) {
      lines.push('### 💡 Suggestions')
      for (const s of aiAnalysis.suggestions) lines.push(`- ${s}`)
      lines.push('')
    }
    if (aiAnalysis.splitSuggestion) {
      lines.push('### ✂️ Consider Splitting This PR')
      lines.push(aiAnalysis.splitSuggestion)
      lines.push('')
    }
  }

  const footer = [
    `⏱️ ~${analysis.complexity.estimatedReviewMinutes} min`,
    analysis.complexity.areas.length > 0 && `areas: ${analysis.complexity.areas.map(a => `\`${a}\``).join(' ')}`,
    appliedLabels.length > 0 && `labels: ${appliedLabels.map(l => `\`${l}\``).join(' ')}`,
  ].filter(Boolean).join(' · ')

  lines.push('---')
  lines.push(`*${footer} · [Milo](https://github.com/yvtckvulsr/milo)*`)

  return lines.join('\n')
}

function formatDepSummary(deps: DependencyChange[]): string {
  const parts: string[] = []
  const added   = deps.filter(d => d.type === 'added').length
  const removed = deps.filter(d => d.type === 'removed').length
  const major   = deps.filter(d => d.type === 'major-bump').length
  if (added)   parts.push(`${added} added`)
  if (removed) parts.push(`${removed} removed`)
  if (major)   parts.push(`${major} major bump${major > 1 ? 's' : ''}`)
  return parts.join(', ') || `${deps.length} change(s)`
}
