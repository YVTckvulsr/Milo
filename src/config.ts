import * as github from '@actions/github'
import * as core from '@actions/core'
import { MiloConfig, DEFAULT_CONFIG } from './types'

function mergeDeep<T>(defaults: T, overrides: Partial<T>): T {
  const result = { ...defaults }
  for (const key of Object.keys(overrides) as (keyof T)[]) {
    const val = overrides[key]
    if (val !== null && typeof val === 'object' && !Array.isArray(val)) {
      result[key] = mergeDeep(defaults[key] as object, val as object) as T[keyof T]
    } else if (val !== undefined) {
      result[key] = val as T[keyof T]
    }
  }
  return result
}

function parseSimpleYaml(content: string): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  const lines = content.split('\n')
  const stack: Array<{ obj: Record<string, unknown>; indent: number }> = [
    { obj: result, indent: -1 },
  ]

  for (const raw of lines) {
    if (!raw.trim() || raw.trim().startsWith('#')) continue

    const indent = raw.length - raw.trimStart().length
    const line = raw.trim()

    while (stack.length > 1 && stack[stack.length - 1].indent >= indent) {
      stack.pop()
    }

    const current = stack[stack.length - 1].obj

    if (line.endsWith(':') && !line.includes(': ')) {
      const key = line.slice(0, -1)
      const child: Record<string, unknown> = {}
      current[key] = child
      stack.push({ obj: child, indent })
      continue
    }

    const colonIdx = line.indexOf(': ')
    if (colonIdx !== -1) {
      const key = line.slice(0, colonIdx).trim()
      const rawVal = line.slice(colonIdx + 2).trim()

      let value: unknown = rawVal
      if (rawVal === 'true') value = true
      else if (rawVal === 'false') value = false
      else if (!isNaN(Number(rawVal)) && rawVal !== '') value = Number(rawVal)
      else if (rawVal.startsWith('"') || rawVal.startsWith("'")) {
        value = rawVal.slice(1, -1)
      }

      current[key] = value
      continue
    }

    if (line.startsWith('- ')) {
      const parentKey = Object.keys(current).pop()
      if (parentKey) {
        if (!Array.isArray(current[parentKey])) current[parentKey] = []
        ;(current[parentKey] as string[]).push(line.slice(2).trim())
      }
    }
  }

  return result
}

export async function loadConfig(
  owner: string,
  repo: string,
  token: string
): Promise<MiloConfig> {
  const octokit = github.getOctokit(token)

  try {
    const { data } = await octokit.rest.repos.getContent({ owner, repo, path: '.milo.yml' })
    if (!('content' in data)) return DEFAULT_CONFIG

    const raw = Buffer.from(data.content, 'base64').toString('utf-8')
    const parsed = parseSimpleYaml(raw) as Partial<MiloConfig>
    core.info('📄 Loaded .milo.yml config')
    return mergeDeep(DEFAULT_CONFIG, parsed)
  } catch {
    return DEFAULT_CONFIG
  }
}
