import path from 'node:path'
import { commandExists } from '../core/shell.js'
import { listMcpEntries, loadMcpState } from '../core/mcpCrud.js'
import type { McpServerDefinition } from '../types.js'

export interface McpTestOptions {
  projectRoot: string
  name?: string
  json: boolean
}

interface ServerTestResult {
  name: string
  status: 'ok' | 'error'
  messages: string[]
}

export async function runMcpTest(options: McpTestOptions): Promise<void> {
  const state = await loadMcpState(options.projectRoot)
  const entries = listMcpEntries(state)
  const filtered = options.name
    ? entries.filter((entry) => entry.name === options.name)
    : entries

  if (options.name && filtered.length === 0) {
    throw new Error(`MCP server "${options.name}" does not exist.`)
  }

  const results: ServerTestResult[] = filtered.map((entry) => testServer(entry.name, entry.mergedServer))
  const errors = results.filter((result) => result.status === 'error')

  const payload = {
    projectRoot: path.resolve(options.projectRoot),
    tested: results.length,
    errors: errors.length,
    results
  }

  if (options.json) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`)
  } else if (results.length === 0) {
    process.stdout.write('No MCP servers configured.\n')
  } else {
    process.stdout.write(`MCP test results (${String(results.length)}):\n`)
    for (const result of results) {
      process.stdout.write(`- ${result.name}: ${result.status}\n`)
      for (const message of result.messages) {
        process.stdout.write(`  - ${message}\n`)
      }
    }
  }

  if (errors.length > 0) {
    process.exitCode = 1
  }
}

function testServer(name: string, server: McpServerDefinition): ServerTestResult {
  const messages: string[] = []

  if (server.enabled === false) {
    return {
      name,
      status: 'ok',
      messages: ['disabled']
    }
  }

  const missingEnv = (server.requiredEnv ?? []).filter((entry) => !process.env[entry])
  if (missingEnv.length > 0) {
    messages.push(`missing required env: ${missingEnv.join(', ')}`)
  }

  if (server.transport === 'stdio') {
    if (!server.command) {
      messages.push('missing command')
    } else if (!commandExists(server.command)) {
      messages.push(`command not found in PATH: ${server.command}`)
    }
  } else {
    if (!server.url) {
      messages.push('missing url')
    } else if (!isValidHttpUrl(server.url)) {
      messages.push(`invalid URL: ${server.url}`)
    }
  }

  const status: 'ok' | 'error' = messages.length > 0 ? 'error' : 'ok'
  return {
    name,
    status,
    messages: messages.length > 0 ? messages : ['ok']
  }
}

function isValidHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}
