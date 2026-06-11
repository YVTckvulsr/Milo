import { PRData, AnalysisResults, AIAnalysis } from './types'

export const MILO_MARKER = '<!-- milo-pr-health-check -->'

export function formatComment(
  prData: PRData,
  analysis: AnalysisResults,
  aiAnalysis: AIAnalysis | null
): string {
  const score = calculateHealthScore(analysis, prData)
  const scoreEmoji = score >= 8 ? '🟢' : score >= 5 ? '🟡' : '🔴'
  const uncovered = analysis.coverageGaps.filter(g => !g.hasTests)

  const lines: string[] = [MILO_MARKER, '']
  lines.push(`## ${scoreEmoji} Milo — PR Health Score: **${score}/10**`)
  lines.push('')

  if (aiAnalysis?.summary) {
    lines.push('### 📋 Summary')
    lines.push(`> ${aiAnalysis.summary}`)
    lines.push('')
  }

  // Health table
  lines.push('<details open>')
  lines.push('<summary><strong>🏥 Health Checks</strong></summary>')
  lines.push('')
  lines.push('| | Check | Status |')
  lines.push('|--|-------|--------|')

  const hasDesc = (prData.description ?? '').trim().length > 20
  lines.push(`| ${hasDesc ? '✅' : '⚠️'} | Description | ${hasDesc ? 'Provided' : 'Missing or too short — reviewers need context'} |`)
  lines.push(`| ${analysis.secrets.length === 0 ? '✅' : '🚨'} | Secrets | ${analysis.secrets.length === 0 ? 'None detected' : `**${analysis.secrets.length} potential secret(s) found!**`} |`)
  lines.push(`| ${uncovered.length === 0 ? '✅' : '⚠️'} | Test coverage | ${uncovered.length === 0 ? 'All changed source files have tests' : `${uncovered.length} file(s) changed without tests`} |`)
  lines.push(`| ${analysis.todos.length === 0 ? '✅' : '⚠️'} | TODOs | ${analysis.todos.length === 0 ? 'None added' : `${analysis.todos.length} new TODO/FIXME`} |`)

  const sizeOk = analysis.complexity.score === 'low' || analysis.complexity.score === 'medium'
  lines.push(`| ${sizeOk ? '✅' : '⚠️'} | PR size | +${prData.additions}/-${prData.deletions} lines across ${prData.changedFiles} files |`)
  lines.push('')
  lines.push('</details>')
  lines.push('')

  if (analysis.secrets.length > 0) {
    lines.push('### 🚨 Potential Secrets — Review Immediately')
    for (const s of analysis.secrets) {
      lines.push(`- **${s.type}** in \`${s.file}\` line ${s.line}`)
    }
    lines.push('')
  }

  if (uncovered.length > 0) {
    lines.push('### 🧪 Missing Test Coverage')
    lines.push('These files were changed or added without corresponding test updates:')
    for (const gap of uncovered) {
      lines.push(`- \`${gap.file}\`${gap.isNewFile ? ' *(new file)*' : ''}`)
    }
    lines.push('')
  }

  if (analysis.todos.length > 0) {
    lines.push('<details>')
    lines.push(`<summary>📌 ${analysis.todos.length} new TODO/FIXME added</summary>`)
    lines.push('')
    for (const t of analysis.todos.slice(0, 6)) {
      lines.push(`- \`${t.file}:${t.line}\` — ${t.text}`)
    }
    if (analysis.todos.length > 6) lines.push(`- *...and ${analysis.todos.length - 6} more*`)
    lines.push('')
    lines.push('</details>')
    lines.push('')
  }

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

  lines.push(`### ⏱️ Estimated Review Time: ~${analysis.complexity.estimatedReviewMinutes} min`)
  if (analysis.complexity.areas.length > 0) {
    lines.push(`> Areas touched: ${analysis.complexity.areas.map(a => `\`${a}\``).join(', ')}`)
  }
  lines.push('')
  lines.push('---')
  lines.push('*[Milo](https://github.com/yvtckvulsr/milo) — zero-config AI PR health checks*')

  return lines.join('\n')
}

function calculateHealthScore(analysis: AnalysisResults, prData: PRData): number {
  let score = 10

  if (analysis.secrets.length > 0) score -= 4
  const uncoveredCount = analysis.coverageGaps.filter(g => !g.hasTests).length
  score -= Math.min(uncoveredCount * 0.5, 2)
  score -= Math.min(analysis.todos.length * 0.3, 1.5)
  if (analysis.complexity.score === 'high') score -= 0.5
  if (analysis.complexity.score === 'very-high') score -= 1.5
  if (!(prData.description ?? '').trim()) score -= 0.5

  return Math.max(0, Math.round(score * 10) / 10)
}
