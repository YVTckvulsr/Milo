import * as githubActions from '@actions/github'
import { PRData, PRFile } from './types'
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
    owner,
    repo,
    issue_number: prNumber,
    per_page: 100,
  })

  const existing = comments.find(c => c.body?.includes(MILO_MARKER))

  if (existing) {
    await octokit.rest.issues.updateComment({ owner, repo, comment_id: existing.id, body })
  } else {
    await octokit.rest.issues.createComment({ owner, repo, issue_number: prNumber, body })
  }
}
