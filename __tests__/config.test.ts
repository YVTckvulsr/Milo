// Tests for config merging — the YAML parsing itself is tested by js-yaml's own suite
import { DEFAULT_CONFIG } from '../src/types'

// replicate mergeDeep from config.ts for unit testing
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

describe('config merging', () => {
  it('returns defaults when no overrides', () => {
    const cfg = mergeDeep(DEFAULT_CONFIG, {})
    expect(cfg.checks.secrets).toBe(true)
    expect(cfg.skip_drafts).toBe(true)
  })

  it('merges nested checks object', () => {
    const cfg = mergeDeep(DEFAULT_CONFIG, { checks: { secrets: false } } as never)
    expect(cfg.checks.secrets).toBe(false)
    expect(cfg.checks.tests).toBe(true)  // untouched
  })

  it('overrides scalar values', () => {
    const cfg = mergeDeep(DEFAULT_CONFIG, { skip_drafts: false } as never)
    expect(cfg.skip_drafts).toBe(false)
  })

  it('overrides nested scalar', () => {
    const cfg = mergeDeep(DEFAULT_CONFIG, { thresholds: { fail_on_score_below: 7 } } as never)
    expect(cfg.thresholds.fail_on_score_below).toBe(7)
    expect(cfg.thresholds.max_pr_lines).toBe(DEFAULT_CONFIG.thresholds.max_pr_lines)
  })

  it('handles ignore paths array', () => {
    const cfg = mergeDeep(DEFAULT_CONFIG, { ignore: { paths: ['vendor/**', 'dist/**'] } } as never)
    expect(cfg.ignore.paths).toEqual(['vendor/**', 'dist/**'])
  })

  it('handles custom secrets array', () => {
    const cfg = mergeDeep(DEFAULT_CONFIG, {
      custom_secrets: [{ name: 'Internal Token', pattern: 'INT_[A-Z0-9]{32}' }],
    } as never)
    expect(cfg.custom_secrets).toHaveLength(1)
    expect(cfg.custom_secrets[0].name).toBe('Internal Token')
  })

  it('does not mutate the defaults object', () => {
    mergeDeep(DEFAULT_CONFIG, { skip_drafts: false } as never)
    expect(DEFAULT_CONFIG.skip_drafts).toBe(true)
  })
})

describe('DEFAULT_CONFIG completeness', () => {
  it('has all required check flags', () => {
    const keys = Object.keys(DEFAULT_CONFIG.checks)
    expect(keys).toContain('secrets')
    expect(keys).toContain('tests')
    expect(keys).toContain('todos')
    expect(keys).toContain('complexity')
    expect(keys).toContain('dependencies')
    expect(keys).toContain('breaking_changes')
  })

  it('has sane defaults', () => {
    expect(DEFAULT_CONFIG.thresholds.fail_on_score_below).toBe(0)
    expect(DEFAULT_CONFIG.thresholds.secret_entropy_min).toBe(3.5)
    expect(DEFAULT_CONFIG.skip_drafts).toBe(true)
  })
})
