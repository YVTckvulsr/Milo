import * as githubActions from '@actions/github'
import * as core from '@actions/core'
import { PRData, PRFile, AnalysisResults, CoverageGap } from './types'
import { MILO_MARKER } from './reporter'
import { isTestFile } from './analyzer'

// ─── Retry ───────────────────────────────────────────────────────────────────

async function withRetry<T>(fn: () => Promise<T>, attempts = 3, baseMs = 1000): Promise<T> {
  let lastErr: unknown
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn()
    } catch (err: unknown) {
      lastErr = err
      const status = (err as { status?: number })?.status
      // Don't retry client errors except rate-limit (429)
      if (status && status >= 400 && status < 500 && status !== 429) throw err
      if (i < attempts - 1) await delay(baseMs * 2 ** i)
    }
  }
  throw lastErr
}

function delay(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms))
}

// ─── PR data ──────────────────────────────────────────────────────────────────

export async function fetchPRData(
  owner: string, repo: string, prNumber: number, token: string
): Promise<PRData> {
  const octokit = githubActions.getOctokit(token)

  const { data: pr } = await withRetry(() =>
    octokit.rest.pulls.get({ owner, repo, pull_number: prNumber })
  )

  // Paginate — PRs with 100+ files are common in monorepos
  const files = await withRetry(() =>
    octokit.paginate(octokit.rest.pulls.listFiles, {
      owner, repo, pull_number: prNumber, per_page: 100,
    })
  ) as Awaited<ReturnType<typeof octokit.rest.pulls.listFiles>>['data']

  const diff = files
    .filter(f => f.patch)
    .map(f => `--- a/${f.filename}\n+++ b/${f.filename}\n${f.patch}`)
    .join('\n\n')

  return {
    title: pr.title,
    description: pr.body ?? '',
    diff,
    headSha: pr.head.sha,
    isDraft: pr.draft ?? false,
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

// ─── Coverage enrichment (repo tree lookup) ───────────────────────────────────

function generateTestFileCandidates(sourceFile: string): string[] {
  const candidates: string[] = []
  const ext = sourceFile.split('.').pop() ?? 'ts'
  const withoutExt = sourceFile.replace(/\.[^.]+$/, '')
  const stem = withoutExt.split('/').pop() ?? ''
  const dir = sourceFile.split('/').slice(0, -1).join('/')

  if (['ts', 'tsx', 'js', 'jsx', 'mjs'].includes(ext)) {
    candidates.push(
      `${withoutExt}.test.${ext}`,
      `${withoutExt}.spec.${ext}`,
      withoutExt.replace(/^(src|lib|app)\//, '__tests__/') + `.test.${ext}`,
      withoutExt.replace(/^(src|lib|app)\//, 'tests/') + `.test.${ext}`,
      `__tests__/${stem}.test.${ext}`,
      `__tests__/${stem}.spec.${ext}`,
      `tests/${stem}.test.${ext}`,
    )
  } else if (ext === 'py') {
    candidates.push(
      `${dir}/test_${stem}.py`,
      `${dir}/${stem}_test.py`,
      `tests/test_${stem}.py`,
      `test/test_${stem}.py`,
    )
  } else if (ext === 'go') {
    candidates.push(`${withoutExt}_test.go`)
  } else if (ext === 'java' || ext === 'kt') {
    candidates.push(
      dir.replace('/main/', '/test/') + `/${stem}Test.${ext}`,
      dir.replace('/main/', '/test/') + `/${stem}Tests.${ext}`,
    )
  } else if (ext === 'rb') {
    candidates.push(
      withoutExt.replace(/^(lib|app)\//, 'spec/') + '_spec.rb',
      `spec/${stem}_spec.rb`,
    )
  }

  return candidates
}

/**
 * Fetches the full repo file tree once and checks which coverage gaps actually have
 * an existing test file (even if that test file wasn't changed in this PR).
 */
export async function enrichCoverageGaps(
  owner: string,
  repo: string,
  headSha: string,
  gaps: CoverageGap[],
  token: string
): Promise<CoverageGap[]> {
  const unfixedGaps = gaps.filter(g => !g.hasTests)
  if (unfixedGaps.length === 0) return gaps

  const octokit = githubActions.getOctokit(token)

  let repoFilePaths: Set<string>
  try {
    const { data: tree } = await withRetry(() =>
      octokit.rest.git.getTree({ owner, repo, tree_sha: headSha, recursive: '1' })
    )
    repoFilePaths = new Set(tree.tree.map(item => item.path ?? '').filter(Boolean))
    core.info(`🌲 Repo tree loaded (${repoFilePaths.size} files) — checking test file existence`)
  } catch (err) {
    core.debug(`Coverage enrichment skipped (tree fetch failed): ${err}`)
    return gaps
  }

  return gaps.map(gap => {
    if (gap.hasTests) return gap

    const candidates = generateTestFileCandidates(gap.file)
    const foundTestFile = candidates.find(c => repoFilePaths.has(c))
      ?? Array.from(repoFilePaths).find(p => isTestFile(p) && p.includes(gap.file.replace(/\.[^.]+$/, '').split('/').pop() ?? ''))

    if (foundTestFile) {
      return { ...gap, hasTests: true, confirmedByTree: true }
    }
    return gap
  })
}

// ─── Comment upsert ───────────────────────────────────────────────────────────

export async function upsertComment(
  owner: string, repo: string, prNumber: number, body: string, token: string
): Promise<void> {
  const octokit = githubActions.getOctokit(token)

  const { data: comments } = await withRetry(() =>
    octokit.rest.issues.listComments({ owner, repo, issue_number: prNumber, per_page: 100 })
  )

  const existing = comments.find(c => c.body?.includes(MILO_MARKER))

  if (existing) {
    await withRetry(() =>
      octokit.rest.issues.updateComment({ owner, repo, comment_id: existing.id, body })
    )
  } else {
    await withRetry(() =>
      octokit.rest.issues.createComment({ owner, repo, issue_number: prNumber, body })
    )
  }
}

// ─── GitHub Check Run with inline annotations ─────────────────────────────────

export async function createCheckRun(
  owner: string,
  repo: string,
  headSha: string,
  analysis: AnalysisResults,
  healthScore: number,
  token: string
): Promise<void> {
  const octokit = githubActions.getOctokit(token)

  type Annotation = {
    path: string; start_line: number; end_line: number
    annotation_level: 'failure' | 'warning' | 'notice'
    title: string; message: string
  }

  const uncovered = analysis.coverageGaps.filter(g => !g.hasTests)
  const conclusion = analysis.secrets.length > 0 ? 'failure' : healthScore < 5 ? 'neutral' : 'success'

  const annotations: Annotation[] = [
    ...analysis.secrets.map(s => ({
      path: s.file,
      start_line: Math.max(1, s.line),
      end_line: Math.max(1, s.line),
      annotation_level: 'failure' as const,
      title: `🚨 Potential ${s.type} (entropy: ${s.entropy})`,
      message: `Milo detected a probable ${s.type}. Rotate or remove before merging.\n\`${s.snippet}\``,
    })),
    ...analysis.breaking.map(b => ({
      path: b.file,
      start_line: Math.max(1, b.line),
      end_line: Math.max(1, b.line),
      annotation_level: 'warning' as const,
      title: '⚠️ Possible breaking change',
      message: b.description,
    })),
    ...uncovered.slice(0, 10).map(gap => ({
      path: gap.file,
      start_line: 1,
      end_line: 1,
      annotation_level: 'warning' as const,
      title: '🧪 No test file found',
      message: `${gap.isNewFile ? 'New' : 'Modified'} file has no associated test file in the repo.`,
    })),
  ]

  const problems = [
    analysis.secrets.length > 0  && `${analysis.secrets.length} secret(s)`,
    uncovered.length > 0          && `${uncovered.length} untested file(s)`,
    analysis.breaking.length > 0  && `${analysis.breaking.length} breaking change(s)`,
  ].filter(Boolean).join(' · ')

  try {
    await withRetry(() => octokit.rest.checks.create({
      owner, repo,
      name: 'Milo PR Health',
      head_sha: headSha,
      status: 'completed',
      conclusion,
      output: {
        title: `Score: ${healthScore}/10${problems ? ' · ' + problems : ''}`,
        summary: `Milo health score: **${healthScore}/10**\n\n${problems || 'No major issues found.'}`,
        annotations: annotations.slice(0, 50),
      },
    }))
    core.info('✅ GitHub Check Run posted.')
  } catch (err) {
    core.debug(`Check run skipped (checks:write not available): ${err}`)
  }
}
