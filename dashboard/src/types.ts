export type Severity = 'critical' | 'high' | 'medium' | 'low'
export type Category = 'database' | 'deploy' | 'network' | 'other'
export type IncidentStatus = 'open' | 'resolved'

export interface Incident {
  id: string
  title: string
  severity: Severity
  status: IncidentStatus
  source: string
  category: Category
  created_at: string
  resolved_at: string | null
}

export interface Runbook {
  id: string
  category: Category
  title: string
  steps: string
  severity: Severity
  created_at: string
}
