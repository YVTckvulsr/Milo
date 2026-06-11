import * as githubActions from '@actions/github'
import * as core from '@actions/core'
import { PRData, PRFile, AnalysisResults } from './types'
import { MILO_MARKER } from './reporter'

export async function fetchPRData(
  owner: string,
  repo: string,
  prNumber: number,
  token: string
): Promise<PRData> {
  const octokit = githubActions.getOctokit(token)

  const [{ data: pr }, { data: files }] = await Promise.all([
    octokit.rest.pulls.get({ owner, repo, pull_number: prNumber }),
    octokit.rest.pulls.listFiles({ owner, repo, pull_number: prNumber, per_page: 100 }),
  ])

  const diff = files
    .filter(f => f.patch)
    .map(f => `--- a/${f.filename}\n+++ b/${f.filename}\n${f.patch}`)
    .join('\n\n')

  return {
    title: pr.title,
    description: pr.body ?? '',
    diff,
    headSha: pr.head.sha,
    files: files.map(f => ({
      filename: f.filename,
      status: f.status as PRFile['status'],
      additions: f.additions,
      deletions: f.deletions,
      patch: f.patch,
    })),
    additions: pr.additions,
    deletions: pr.deletions,
    changedFiles: pr.changed_files,
  }
}

export async function upsertComment(
  owner: string,
  repo: string,
  prNumber: number,
  body: string,
  token: string
): Promise<void> {
  const octokit = githubActions.getOctokit(token)

  const { data: comments } = await octokit.rest.issues.listComments({
    owner, repo, issue_number: prNumber, per_page: 100,
  })

  const existing = comments.find(c => c.body?.includes(MILO_MARKER))

  if (existing) {
    await octokit.rest.issues.updateComment({ owner, repo, comment_id: existing.id, body })
  } else {
    await octokit.rest.issues.createComment({ owner, repo, issue_number: prNumber, body })
  }
}

export async function createCheckRun(
  owner: string,
  repo: string,
  headSha: string,
  analysis: AnalysisResults,
  healthScore: number,
  token: string
): Promise<void> {
  const octokit = githubActions.getOctokit(token)

  const uncovered = analysis.coverageGaps.filter(g => !g.hasTests)
  const hasFailure = analysis.secrets.length > 0
  const conclusion = hasFailure ? 'failure' : healthScore < 5 ? 'neutral' : 'success'

  type Annotation = {
    path: string; start_line: number; end_line: number
    annotation_level: 'failure' | 'warning' | 'notice'
    title: string; message: string
  }
  const annotations: Annotation[] = [
    ...analysis.secrets.map(s => ({
      path: s.file,
      start_line: s.line,
      end_line: s.line,
      annotation_level: 'failure' as const,
      title: `🚨 Potential ${s.type}`,
      message: `Milo detected a possible ${s.type}. Review and remove before merging.\n\`${s.snippet}\``,
    })),
    ...analysis.breaking.map(b => ({
      path: b.file,
      start_line: b.line,
      end_line: b.line,
      annotation_level: 'warning' as const,
      title: `⚠️ Possible breaking change`,
      message: b.description,
    })),
    ...uncovered.slice(0, 10).map(gap => ({
      path: gap.file,
      start_line: 1,
      end_line: 1,
      annotation_level: 'warning' as const,
      title: '🧪 No test coverage',
      message: `${gap.isNewFile ? 'New file' : 'Modified file'} has no corresponding test changes.`,
    })),
  ]

  const problems = [
    analysis.secrets.length > 0   && `${analysis.secrets.length} secret(s) detected`,
    uncovered.length > 0           && `${uncovered.length} file(s) without tests`,
    analysis.breaking.length > 0   && `${analysis.breaking.length} breaking change(s)`,
  ].filter(Boolean).join(' · ')

  try {
    await octokit.rest.checks.create({
      owner, repo,
      name: 'Milo PR Health',
      head_sha: headSha,
      status: 'completed',
      conclusion,
      output: {
        title: `Health Score: ${healthScore}/10${problems ? ' · ' + problems : ''}`,
        summary: `Milo analyzed this PR and assigned a health score of **${healthScore}/10**.\n\n${problems || 'No major issues found.'}`,
        annotations: annotations.slice(0, 50),
      },
    })
    core.info('✅ GitHub Check Run created.')
  } catch (err) {
    // checks:write permission not granted — silently degrade
    core.debug(`Check run skipped (checks:write not available): ${err}`)
  }
}
