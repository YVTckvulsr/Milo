import * as core from '@actions/core'
import * as github from '@actions/github'
import { fetchPRData, upsertComment, createCheckRun } from './github'
import { runAnalysis } from './analyzer'
import { getAIAnalysis } from './ai'
import { formatComment, calculateHealthScore } from './reporter'
import { applyLabels } from './labeler'
import { loadConfig } from './config'

async function run(): Promise<void> {
  try {
    const token = core.getInput('github-token', { required: true })
    const anthropicKey = core.getInput('anthropic-api-key')
    const failOnSecrets = core.getInput('fail-on-secrets') === 'true'

    const { context } = github
    if (context.eventName !== 'pull_request') {
      core.warning('Milo only runs on pull_request events.')
      return
    }

    const prNumber = context.payload.pull_request!.number
    const { owner, repo } = context.repo

    core.info(`🔍 Milo analyzing PR #${prNumber}...`)

    const [config, prData] = await Promise.all([
      loadConfig(owner, repo, token),
      fetchPRData(owner, repo, prNumber, token),
    ])

    core.info('📊 Running static analysis...')
    const analysis = runAnalysis(prData, config)

    let aiAnalysis = null
    if (anthropicKey) {
      core.info('🤖 Running AI analysis...')
      try {
        aiAnalysis = await getAIAnalysis(prData, analysis, anthropicKey, config)
      } catch (err) {
        core.warning(`AI analysis failed — posting static results only: ${err}`)
      }
    }

    const healthScore = calculateHealthScore(analysis, prData)

    const [appliedLabels] = await Promise.all([
      applyLabels(owner, repo, prNumber, prData, analysis, config, token),
      createCheckRun(owner, repo, prData.headSha, analysis, healthScore, token),
    ])

    const comment = formatComment(prData, analysis, aiAnalysis, appliedLabels)
    await upsertComment(owner, repo, prNumber, comment, token)

    core.info(`✅ Milo done. Health score: ${healthScore}/10`)

    if (config.thresholds.fail_on_score_below > 0 && healthScore < config.thresholds.fail_on_score_below) {
      core.setFailed(`Health score ${healthScore}/10 is below threshold ${config.thresholds.fail_on_score_below}`)
      return
    }

    if (failOnSecrets && analysis.secrets.length > 0) {
      core.setFailed(`🚨 ${analysis.secrets.length} potential secret(s) detected.`)
    }
  } catch (err) {
    core.setFailed(`Milo failed: ${err}`)
  }
}

run()
