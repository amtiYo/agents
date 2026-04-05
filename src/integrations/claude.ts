export const MANAGED_CLAUDE_NAME_PREFIX = 'agents__'

export function toManagedClaudeName(serverName: string): string {
  return `${MANAGED_CLAUDE_NAME_PREFIX}${serverName}`
}

export function isManagedClaudeName(serverName: string): boolean {
  return serverName.startsWith(MANAGED_CLAUDE_NAME_PREFIX)
}
