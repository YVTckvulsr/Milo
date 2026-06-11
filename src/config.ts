import * as githubActions from '@actions/github'
import * as core from '@actions/core'
import * as yaml from 'js-yaml'
import { MiloConfig, DEFAULT_CONFIG } from './types'

function mergeDeep<T>(defaults: T, overrides: Partial<T>): T {
  const result = { ...defaults }
  for (const key of Object.keys(overrides ?? {}) as (keyof T)[]) {
    const val = overrides[key]
    if (val !== null && typeof val === 'object' && !Array.isArray(val) && typeof defaults[key] === 'object') {
      result[key] = mergeDeep(defaults[key] as object, val as object) as T[keyof T]
    } else if (val !== undefined) {
      result[key] = val as T[keyof T]
    }
  }
  return result
}

export async function loadConfig(owner: string, repo: string, token: string): Promise<MiloConfig> {
  const octokit = githubActions.getOctokit(token)

  try {
    const { data } = await octokit.rest.repos.getContent({ owner, repo, path: '.milo.yml' })
    if (!('content' in data)) return DEFAULT_CONFIG

    const raw = Buffer.from(data.content, 'base64').toString('utf-8')
    const parsed = yaml.load(raw)

    if (typeof parsed !== 'object' || parsed === null) {
      core.warning('.milo.yml is not a valid YAML object — using defaults')
      return DEFAULT_CONFIG
    }

    const config = mergeDeep(DEFAULT_CONFIG, parsed as Partial<MiloConfig>)
    core.info('📄 Loaded .milo.yml')
    return config
  } catch (err: unknown) {
    const status = (err as { status?: number })?.status
    if (status !== 404) core.warning(`Could not load .milo.yml: ${err}`)
    return DEFAULT_CONFIG
  }
}
