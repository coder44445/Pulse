export type AppStatus = 'starting' | 'running' | 'stopped' | 'stopping' | 'error' | 'unknown'

export interface Application {
  id: string
  name: string
  status: AppStatus
  description?: string
}

export interface StackInfo {
  name: string
  compose: string
  health_url?: string | null
}

export interface ApplicationDetail {
  id: string
  name: string
  status: AppStatus
  description?: string
  routes: string[]
  dependencies: string[]
  idle_timeout?: string | null
  stacks: StackInfo[]
}
