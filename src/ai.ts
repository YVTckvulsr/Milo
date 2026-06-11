import Anthropic from '@anthropic-ai/sdk'
import { PRData, AnalysisResults, AIAnalysis } from './types'

const MAX_DIFF_CHARS = 18000

export async function getAIAnalysis(
  prData: PRData,
  analysis: AnalysisResults,
  apiKey: string
): Promise<AIAnalysis> {
  const client = new Anthropic({ apiKey })

  const diff = prData.diff.length > MAX_DIFF_CHARS
    ? prData.diff.slice(0, MAX_DIFF_CHARS) + '\n\n[diff truncated]'
    : prData.diff

  const staticFindings = [
    analysis.secrets.length > 0 && `- ${analysis.secrets.length} potential secret(s) detected`,
    analysis.todos.length > 0 && `- ${analysis.todos.length} new TODO/FIXME added`,
    analysis.coverageGaps.filter(g => !g.hasTests).length > 0 &&
      `- Files without test coverage: ${analysis.coverageGaps.filter(g => !g.hasTests).map(g => g.file).join(', ')}`,
  ].filter(Boolean).join('\n')

  const prompt = `You are a senior software engineer doing a first-pass review of a pull request.

PR Title: ${prData.title}
PR Description: ${prData.description || '(none)'}

Changed files (${prData.changedFiles} total, +${prData.additions}/-${prData.deletions} lines):
${prData.files.slice(0, 30).map(f => `  ${f.status === 'added' ? '+ ' : f.status === 'deleted' ? '- ' : '  '}${f.filename} (+${f.additions}/-${f.deletions})`).join('\n')}

Static analysis found:
${staticFindings || '  Nothing concerning'}

Diff:
\`\`\`diff
${diff}
\`\`\`

Respond with ONLY a JSON object — no markdown, no explanation:
{
  "summary": "2-3 sentences describing what this PR does and why",
  "concerns": ["specific concern 1", "specific concern 2"],
  "suggestions": ["actionable suggestion 1", "actionable suggestion 2"],
  "splitSuggestion": "how to split this PR if it's too large (omit this key if not needed)"
}

Rules:
- summary: explain the WHAT and WHY, not how
- concerns: only real issues, not nitpicks (max 4)
- suggestions: actionable and specific (max 4)
- splitSuggestion: only include if PR has 200+ lines changed across unrelated concerns
- Keep each item under 120 characters`

  const message = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    messages: [{ role: 'user', content: prompt }],
  })

  const content = message.content[0]
  if (content.type !== 'text') throw new Error('Unexpected AI response type')

  const jsonMatch = content.text.match(/\{[\s\S]*\}/)
  if (!jsonMatch) throw new Error('Could not parse AI response as JSON')

  return JSON.parse(jsonMatch[0]) as AIAnalysis
}
