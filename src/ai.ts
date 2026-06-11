import Anthropic from '@anthropic-ai/sdk'
import { PRData, AnalysisResults, AIAnalysis, MiloConfig, PRFile } from './types'
import { isTestFile } from './analyzer'

const MAX_DIFF_CHARS = 20000
const SOURCE_EXTENSIONS = /\.(ts|tsx|js|jsx|py|go|java|kt|rb|rs|c|cpp|cs|swift|php)$/

function filePriority(f: PRFile): number {
  if (!f.patch) return -1
  let score = f.additions + f.deletions
  if (SOURCE_EXTENSIONS.test(f.filename)) score += 200
  if (isTestFile(f.filename)) score -= 50
  if (/\.(md|txt|json|lock)$/.test(f.filename)) score -= 100
  return score
}

/** Build a diff string that fits in maxChars, prioritising high-complexity source files. */
function buildFocusedDiff(prData: PRData, maxChars: number): { diff: string; skipped: string[] } {
  const sorted = [...prData.files]
    .filter(f => f.patch)
    .sort((a, b) => filePriority(b) - filePriority(a))

  const included: string[] = []
  const skipped: string[] = []
  let total = 0

  for (const f of sorted) {
    const chunk = `--- a/${f.filename}\n+++ b/${f.filename}\n${f.patch}`
    if (total + chunk.length <= maxChars) {
      included.push(chunk)
      total += chunk.length
    } else {
      skipped.push(f.filename)
    }
  }

  if (skipped.length > 0) {
    included.push(`\n[${skipped.length} low-priority file(s) omitted: ${skipped.join(', ')}]`)
  }

  return { diff: included.join('\n\n'), skipped }
}

export async function getAIAnalysis(
  prData: PRData,
  analysis: AnalysisResults,
  apiKey: string,
  config: MiloConfig
): Promise<AIAnalysis> {
  const client = new Anthropic({ apiKey })
  const { diff, skipped } = buildFocusedDiff(prData, MAX_DIFF_CHARS)

  const staticContext = [
    analysis.secrets.length > 0         && `- ${analysis.secrets.length} potential secret(s): ${analysis.secrets.map(s => s.type).join(', ')}`,
    analysis.breaking.length > 0        && `- ${analysis.breaking.length} possible breaking change(s): ${analysis.breaking.map(b => b.description).slice(0, 3).join('; ')}`,
    analysis.dependencies.length > 0    && `- Dependency changes: ${analysis.dependencies.map(d => `${d.name} (${d.type})`).slice(0, 5).join(', ')}`,
    analysis.coverageGaps.filter(g => !g.hasTests).length > 0 && `- ${analysis.coverageGaps.filter(g => !g.hasTests).length} file(s) without test coverage`,
    analysis.todos.length > 0           && `- ${analysis.todos.length} new TODO/FIXME`,
    skipped.length > 0                  && `- Note: ${skipped.length} file(s) were not included in the diff above (too large)`,
  ].filter(Boolean).join('\n') || '  Nothing flagged'

  const prompt = `You are a senior software engineer doing a first-pass review of a pull request.

PR Title: ${prData.title}
PR Description: ${prData.description || '(none provided)'}
Changed files (${prData.changedFiles} total, +${prData.additions}/-${prData.deletions} lines):
${prData.files.slice(0, 30).map(f => `  ${f.status === 'added' ? '+' : f.status === 'deleted' ? '-' : ' '} ${f.filename} (+${f.additions}/-${f.deletions})`).join('\n')}

Static analysis already found:
${staticContext}

Diff (high-priority files first):
\`\`\`diff
${diff}
\`\`\`

Respond with ONLY a valid JSON object — no markdown, no explanation:
{
  "summary": "2-3 sentences: WHAT this PR does and WHY (not how). Be specific.",
  "concerns": ["specific issue referencing actual code", "..."],
  "suggestions": ["actionable suggestion referencing a function/file name", "..."],
  "splitSuggestion": "concrete split if PR mixes unrelated concerns"
}

Rules:
- summary: explain the problem being solved, not the implementation
- concerns: real issues only (logic bug, security risk, missing edge case) — max 4, skip style
- suggestions: reference actual symbols or files from the diff — max 4
- splitSuggestion: omit the key entirely if the PR is focused
- Each item < 130 characters`

  const message = await client.messages.create({
    model: config.ai.model,
    max_tokens: 1024,
    messages: [{ role: 'user', content: prompt }],
  })

  const content = message.content[0]
  if (content.type !== 'text') throw new Error('Unexpected AI response type')

  const jsonMatch = content.text.match(/\{[\s\S]*\}/)
  if (!jsonMatch) throw new Error('Could not extract JSON from AI response')

  return JSON.parse(jsonMatch[0]) as AIAnalysis
}
