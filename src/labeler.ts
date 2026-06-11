import * as githubActions from '@actions/github'
import * as core from '@actions/core'
import { AnalysisResults, PRData, MiloConfig } from './types'

interface LabelDef {
  name: string
  color: string
  description: string
}

const LABEL_DEFS: Record<string, LabelDef> = {
  'size/XS':              { name: 'size/XS',              color: 'c2e0c6', description: 'PR changes < 10 lines' },
  'size/S':               { name: 'size/S',               color: '73c7c7', description: 'PR changes < 50 lines' },
  'size/M':               { name: 'size/M',               color: '88e088', description: 'PR changes < 200 lines' },
  'size/L':               { name: 'size/L',               color: 'ffd569', description: 'PR changes < 500 lines' },
  'size/XL':              { name: 'size/XL',              color: 'c44d29', description: 'PR changes 500+ lines' },
  'milo/needs-tests':     { name: 'milo/needs-tests',     color: 'fbca04', description: 'Source files changed without test coverage' },
  'milo/secrets-found':   { name: 'milo/secrets-found',   color: 'd93f0b', description: 'Potential secrets detected by Milo' },
  'milo/breaking-change': { name: 'milo/breaking-change', color: 'b60205', description: 'Possible breaking changes detected' },
}

function getSizeLabel(linesChanged: number): string {
  if (linesChanged < 10) return 'size/XS'
  if (linesChanged < 50) return 'size/S'
  if (linesChanged < 200) return 'size/M'
  if (linesChanged < 500) return 'size/L'
  return 'size/XL'
}

async function ensureLabelExists(
  octokit: ReturnType<typeof githubActions.getOctokit>,
  owner: string,
  repo: string,
  labelName: string
): Promise<void> {
  const def = LABEL_DEFS[labelName]
  if (!def) return

  try {
    await octokit.rest.issues.getLabel({ owner, repo, name: labelName })
  } catch {
    try {
      await octokit.rest.issues.createLabel({
        owner, repo,
        name: def.name,
        color: def.color,
        description: def.description,
      })
    } catch (err) {
      core.debug(`Could not create label ${labelName}: ${err}`)
    }
  }
}

export async function applyLabels(
  owner: string,
  repo: string,
  prNumber: number,
  prData: PRData,
  analysis: AnalysisResults,
  config: MiloConfig,
  token: string
): Promise<string[]> {
  if (!config.labels.enabled) return []

  const octokit = githubActions.getOctokit(token)
  const labelsToApply: string[] = []

  if (config.labels.size) {
    labelsToApply.push(getSizeLabel(prData.additions + prData.deletions))
  }

  if (config.labels.needs_tests && analysis.coverageGaps.some(g => !g.hasTests)) {
    labelsToApply.push('milo/needs-tests')
  }

  if (config.labels.security && analysis.secrets.length > 0) {
    labelsToApply.push('milo/secrets-found')
  }

  if (config.labels.breaking_change && analysis.breaking.length > 0) {
    labelsToApply.push('milo/breaking-change')
  }

  for (const label of labelsToApply) {
    await ensureLabelExists(octokit, owner, repo, label)
  }

  try {
    await octokit.rest.issues.addLabels({
      owner, repo, issue_number: prNumber, labels: labelsToApply,
    })
    core.info(`🏷️  Labels applied: ${labelsToApply.join(', ')}`)
  } catch (err) {
    core.warning(`Could not apply labels: ${err}`)
  }

  return labelsToApply
}
