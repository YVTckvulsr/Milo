import { PRFile, DependencyChange } from './types'

interface SemVer {
  major: number
  minor: number
  patch: number
  prerelease: string | null
  raw: string
}

function parseSemVer(raw: string): SemVer {
  const clean = raw.replace(/^[\^~>=<v*\s]+/, '')

  if (!clean || clean === '*' || clean === 'latest' || clean === 'next') {
    return { major: 0, minor: 0, patch: 0, prerelease: null, raw }
  }

  const [versionPart = '', prePart = null] = clean.split(/-(.+)/, 2) as [string, string | null]
  const parts = versionPart.split('.').map(p => parseInt(p, 10) || 0)

  return {
    major: parts[0] ?? 0,
    minor: parts[1] ?? 0,
    patch: parts[2] ?? 0,
    prerelease: prePart,
    raw,
  }
}

function isWildcard(v: string): boolean {
  return /^\*$|^latest$|^next$|^experimental$/.test(v.trim())
}

function classifyChange(from: string, to: string): DependencyChange['type'] {
  if (isWildcard(to)) return 'upgraded'

  const f = parseSemVer(from)
  const t = parseSemVer(to)

  if (t.major > f.major) return 'major-bump'
  if (t.major < f.major) return 'downgraded'
  if (t.minor > f.minor || (t.minor === f.minor && t.patch > f.patch)) return 'upgraded'
  if (t.minor < f.minor || (t.minor === f.minor && t.patch < f.patch)) return 'downgraded'
  return 'upgraded'
}

function isPrerelease(version: string): boolean {
  return parseSemVer(version).prerelease !== null
}

function parseNpmChanges(file: PRFile): DependencyChange[] {
  if (!file.patch) return []

  const removed = new Map<string, { ver: string; dev: boolean }>()
  const added = new Map<string, { ver: string; dev: boolean }>()
  let inDev = false

  for (const line of file.patch.split('\n')) {
    const trimmed = line.trim()
    if (trimmed.includes('"devDependencies"')) inDev = true
    if (trimmed.includes('"dependencies"') && !trimmed.includes('dev')) inDev = false

    const m = line.match(/^([+-])\s+"(@?[^"]+)":\s+"([^"]+)"/)
    if (!m || m[2] === 'name' || m[2] === 'version') continue

    const [, sign, name, ver] = m
    if (sign === '-') removed.set(name, { ver, dev: inDev })
    else added.set(name, { ver, dev: inDev })
  }

  const changes: DependencyChange[] = []

  for (const [name, { ver, dev }] of added) {
    if (!removed.has(name)) {
      changes.push({ name, from: null, to: ver, type: 'added', ecosystem: 'npm', isDevDependency: dev, isPrerelease: isPrerelease(ver) })
    }
  }
  for (const [name, { ver, dev }] of removed) {
    if (!added.has(name)) {
      changes.push({ name, from: ver, to: null, type: 'removed', ecosystem: 'npm', isDevDependency: dev })
    }
  }
  for (const [name, { ver: oldVer, dev }] of removed) {
    const entry = added.get(name)
    if (!entry) continue
    changes.push({
      name, from: oldVer, to: entry.ver,
      type: classifyChange(oldVer, entry.ver),
      ecosystem: 'npm',
      isDevDependency: dev,
      isPrerelease: isPrerelease(entry.ver),
    })
  }

  return changes
}

function parsePipChanges(file: PRFile): DependencyChange[] {
  if (!file.patch) return []

  const removed = new Map<string, string>()
  const added = new Map<string, string>()

  for (const line of file.patch.split('\n')) {
    if (line.startsWith('@@') || line.startsWith('+++') || line.startsWith('---')) continue
    const m = line.match(/^([+-])([A-Za-z0-9_\-]+(?:\[[^\]]+\])?)\s*(?:==|>=|~=|<=|!=|>|<)\s*(.+)/)
    if (!m) continue
    const [, sign, name, ver] = m
    if (sign === '-') removed.set(name.toLowerCase(), ver.trim())
    else added.set(name.toLowerCase(), ver.trim())
  }

  const changes: DependencyChange[] = []
  for (const [name, ver] of added) {
    if (!removed.has(name)) changes.push({ name, from: null, to: ver, type: 'added', ecosystem: 'pip', isDevDependency: false })
  }
  for (const [name, ver] of removed) {
    if (!added.has(name)) changes.push({ name, from: ver, to: null, type: 'removed', ecosystem: 'pip', isDevDependency: false })
  }
  for (const [name, oldVer] of removed) {
    const newVer = added.get(name)
    if (!newVer) continue
    changes.push({ name, from: oldVer, to: newVer, type: classifyChange(oldVer, newVer), ecosystem: 'pip', isDevDependency: false })
  }
  return changes
}

function parseGoChanges(file: PRFile): DependencyChange[] {
  if (!file.patch) return []

  const removed = new Map<string, string>()
  const added = new Map<string, string>()

  for (const line of file.patch.split('\n')) {
    const m = line.match(/^([+-])\s*require\s+(\S+)\s+(\S+)/)
      ?? line.match(/^([+-])\t(\S+)\s+(\S+)/)
    if (!m) continue
    const [, sign, name, ver] = m
    if (sign === '-') removed.set(name, ver)
    else added.set(name, ver)
  }

  const changes: DependencyChange[] = []
  for (const [name, ver] of added) {
    if (!removed.has(name)) changes.push({ name, from: null, to: ver, type: 'added', ecosystem: 'go', isDevDependency: false })
  }
  for (const [name, ver] of removed) {
    if (!added.has(name)) changes.push({ name, from: ver, to: null, type: 'removed', ecosystem: 'go', isDevDependency: false })
  }
  for (const [name, oldVer] of removed) {
    const newVer = added.get(name)
    if (!newVer) continue
    changes.push({ name, from: oldVer, to: newVer, type: classifyChange(oldVer, newVer), ecosystem: 'go', isDevDependency: false })
  }
  return changes
}

const DEP_PARSERS: Array<{ match: RegExp; parse: (f: PRFile) => DependencyChange[] }> = [
  { match: /(^|\/)package\.json$/,      parse: parseNpmChanges },
  { match: /(^|\/)requirements.*\.txt$/, parse: parsePipChanges },
  { match: /(^|\/)go\.mod$/,            parse: parseGoChanges },
]

export function parseDependencyChanges(files: PRFile[]): DependencyChange[] {
  return files.flatMap(file => {
    for (const { match, parse } of DEP_PARSERS) {
      if (match.test(file.filename)) return parse(file)
    }
    return []
  })
}
