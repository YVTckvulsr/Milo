import Anthropic from '@anthropic-ai/sdk'
import { PRData, AnalysisResults, AIAnalysis, MiloConfig } from './types'

const MAX_DIFF_CHARS = 18000

export async function getAIAnalysis(
  prData: PRData,
  analysis: AnalysisResults,
  apiKey: string,
  config: MiloConfig
): Promise<AIAnalysis> {
  const client = new Anthropic({ apiKey })

  const diff = prData.diff.length > MAX_DIFF_CHARS
    ? prData.diff.slice(0, MAX_DIFF_CHARS) + '\n\n[diff truncated for length]'
    : prData.diff

  const staticContext = [
    analysis.secrets.length > 0          && `- ${analysis.secrets.length} potential secret(s): ${analysis.secrets.map(s => s.type).join(', ')}`,
    analysis.breaking.length > 0         && `- ${analysis.breaking.length} possible breaking change(s): ${analysis.breaking.map(b => b.description).slice(0, 3).join('; ')}`,
    analysis.dependencies.length > 0     && `- Dependency changes: ${analysis.dependencies.map(d => `${d.name} (${d.type})`).slice(0, 5).join(', ')}`,
    analysis.coverageGaps.filter(g => !g.hasTests).length > 0 && `- ${analysis.coverageGaps.filter(g => !g.hasTests).length} file(s) changed without test updates`,
    analysis.todos.length > 0            && `- ${analysis.todos.length} new TODO/FIXME added`,
  ].filter(Boolean).join('\n') || '  Nothing flagged by static analysis'

  const prompt = `You are a senior software engineer doing a first-pass review of a pull request.

PR Title: ${prData.title}
PR Description: ${prData.description || '(none provided)'}
Changed files (${prData.changedFiles}, +${prData.additions}/-${prData.deletions} lines):
${prData.files.slice(0, 30).map(f => `  ${f.status === 'added' ? '+' : f.status === 'deleted' ? '-' : ' '} ${f.filename} (+${f.additions}/-${f.deletions})`).join('\n')}

Static analysis already found:
${staticContext}

Diff:
\`\`\`diff
${diff}
\`\`\`

Respond with ONLY a valid JSON object — no markdown fences, no explanation:
{
  "summary": "2-3 sentences on WHAT this PR does and WHY (not how)",
  "concerns": ["specific, actionable concern", "..."],
  "suggestions": ["specific suggestion referencing actual code", "..."],
  "splitSuggestion": "concrete split recommendation if the PR mixes unrelated concerns"
}

Rules:
- summary: non-obvious context only — what problem does this solve?
- concerns: real code issues, logic bugs, security risks, performance (max 4, skip trivial style)
- suggestions: reference actual function names, file names, or patterns in the diff (max 4)
- splitSuggestion: omit the key entirely if the PR is focused
- Each item under 130 characters`

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
