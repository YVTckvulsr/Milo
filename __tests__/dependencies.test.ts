import { parseDependencyChanges } from '../src/dependencies'
import { PRFile } from '../src/types'

function file(filename: string, patch: string): PRFile {
  return { filename, status: 'modified', additions: 1, deletions: 1, patch }
}

describe('npm dependency changes', () => {
  it('detects major version bump', () => {
    const patch = [
      ' "dependencies": {',
      '-    "express": "^4.18.0",',
      '+    "express": "^5.0.0",',
      ' }',
    ].join('\n')
    const changes = parseDependencyChanges([file('package.json', patch)])
    const express = changes.find(c => c.name === 'express')
    expect(express?.type).toBe('major-bump')
    expect(express?.from).toBe('^4.18.0')
    expect(express?.to).toBe('^5.0.0')
  })

  it('detects added dependency', () => {
    const patch = ' "dependencies": {\n+    "lodash": "^4.17.21",\n }'
    const changes = parseDependencyChanges([file('package.json', patch)])
    const lodash = changes.find(c => c.name === 'lodash')
    expect(lodash?.type).toBe('added')
    expect(lodash?.from).toBeNull()
  })

  it('detects removed dependency', () => {
    const patch = ' "dependencies": {\n-    "moment": "^2.29.0",\n }'
    const changes = parseDependencyChanges([file('package.json', patch)])
    const moment = changes.find(c => c.name === 'moment')
    expect(moment?.type).toBe('removed')
    expect(moment?.to).toBeNull()
  })
})

describe('pip dependency changes', () => {
  it('detects added pip package', () => {
    const changes = parseDependencyChanges([file('requirements.txt', '+requests==2.31.0')])
    expect(changes[0].type).toBe('added')
    expect(changes[0].name).toBe('requests')
  })
})

describe('go.mod changes', () => {
  it('detects added go module', () => {
    const patch = '+require github.com/gin-gonic/gin v1.9.0'
    const changes = parseDependencyChanges([file('go.mod', patch)])
    expect(changes[0].type).toBe('added')
    expect(changes[0].ecosystem).toBe('go')
  })
})
