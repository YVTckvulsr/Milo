import * as core from '@actions/core'
import * as github from '@actions/github'
import { fetchPRData, upsertComment } from './github'
import { runAnalysis } from './analyzer'
import { getAIAnalysis } from './ai'
import { formatComment } from './reporter'

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

    core.info(`🔍 Analyzing PR #${prNumber}...`)
    const prData = await fetchPRData(owner, repo, prNumber, token)

    core.info('📊 Running static analysis...')
    const analysis = runAnalysis(prData)

    let aiAnalysis = null
    if (anthropicKey) {
      core.info('🤖 Running AI analysis with Claude...')
      try {
        aiAnalysis = await getAIAnalysis(prData, analysis, anthropicKey)
      } catch (err) {
        core.warning(`AI analysis failed (static analysis still posted): ${err}`)
      }
    } else {
      core.info('ℹ️  No ANTHROPIC_API_KEY provided — running static analysis only.')
    }

    const comment = formatComment(prData, analysis, aiAnalysis)
    await upsertComment(owner, repo, prNumber, comment, token)
    core.info('✅ Milo comment posted.')

    if (failOnSecrets && analysis.secrets.length > 0) {
      core.setFailed(`🚨 ${analysis.secrets.length} potential secret(s) detected in this PR.`)
    }
  } catch (err) {
    core.setFailed(`Milo failed: ${err}`)
  }
}

run()
