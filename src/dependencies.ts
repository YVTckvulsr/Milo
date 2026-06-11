import { PRFile, DependencyChange } from './types'

function parseMajor(version: string): number {
  return parseInt(version.replace(/^[\^~>=<v*]/, '').split('.')[0] ?? '0', 10) || 0
}

function classifyChange(from: string, to: string): DependencyChange['type'] {
  const fromMajor = parseMajor(from)
  const toMajor = parseMajor(to)
  if (toMajor > fromMajor) return 'major-bump'

  const fromNums = from.replace(/^[\^~>=<v]/, '').split('.').map(Number)
  const toNums = to.replace(/^[\^~>=<v]/, '').split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    const a = fromNums[i] ?? 0
    const b = toNums[i] ?? 0
    if (b > a) return 'upgraded'
    if (b < a) return 'downgraded'
  }
  return 'upgraded'
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

    const [, sign, name, version] = m
    const ver = version.replace(/^["']|["']$/g, '')
    if (sign === '-') removed.set(name, { ver, dev: inDev })
    else added.set(name, { ver, dev: inDev })
  }

  const changes: DependencyChange[] = []

  for (const [name, { ver, dev }] of added) {
    if (!removed.has(name)) {
      changes.push({ name, from: null, to: ver, type: 'added', ecosystem: 'npm', isDevDependency: dev })
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
      ecosystem: 'npm', isDevDependency: dev,
    })
  }

  return changes
}

function parsePipChanges(file: PRFile): DependencyChange[] {
  if (!file.patch) return []

  const removed = new Map<string, string>()
  const added = new Map<string, string>()

  for (const line of file.patch.split('\n')) {
    const m = line.match(/^([+-])([A-Za-z0-9_\-]+)(==|>=|~=|<=)?(.+)?/)
    if (!m) continue
    const [, sign, name, , version] = m
    const ver = version?.trim() ?? '*'
    if (sign === '-') removed.set(name.toLowerCase(), ver)
    else added.set(name.toLowerCase(), ver)
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
    const m = line.match(/^([+-])\s*require\s+(\S+)\s+(\S+)/) || line.match(/^([+-])\t(\S+)\s+(\S+)/)
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

const DEP_FILE_PARSERS: Array<{ match: RegExp; parse: (f: PRFile) => DependencyChange[] }> = [
  { match: /(^|\/)package\.json$/, parse: parseNpmChanges },
  { match: /(^|\/)requirements.*\.txt$/, parse: parsePipChanges },
  { match: /(^|\/)go\.mod$/, parse: parseGoChanges },
]

export function parseDependencyChanges(files: PRFile[]): DependencyChange[] {
  const all: DependencyChange[] = []
  for (const file of files) {
    for (const { match, parse } of DEP_FILE_PARSERS) {
      if (match.test(file.filename)) {
        all.push(...parse(file))
      }
    }
  }
  return all
}
