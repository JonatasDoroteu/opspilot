import type { Category, Incident, IncidentStatus, Runbook, Severity } from './types'

const severities: readonly Severity[] = ['critical', 'high', 'medium', 'low']
const categories: readonly Category[] = ['database', 'deploy', 'network', 'other']
const statuses: readonly IncidentStatus[] = ['open', 'resolved']

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isSeverity(value: unknown): value is Severity {
  return typeof value === 'string' && severities.some((severity) => severity === value)
}

function isCategory(value: unknown): value is Category {
  return typeof value === 'string' && categories.some((category) => category === value)
}

function isIncidentStatus(value: unknown): value is IncidentStatus {
  return typeof value === 'string' && statuses.some((status) => status === value)
}

function isDateString(value: unknown): value is string {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value))
}

function isIncident(value: unknown): value is Incident {
  if (!isRecord(value)) return false

  return (
    typeof value.id === 'string' &&
    typeof value.title === 'string' &&
    isSeverity(value.severity) &&
    isIncidentStatus(value.status) &&
    typeof value.source === 'string' &&
    isCategory(value.category) &&
    isDateString(value.created_at) &&
    (value.resolved_at === null || isDateString(value.resolved_at))
  )
}

function isRunbook(value: unknown): value is Runbook {
  if (!isRecord(value)) return false

  return (
    typeof value.id === 'string' &&
    isCategory(value.category) &&
    typeof value.title === 'string' &&
    typeof value.steps === 'string' &&
    isSeverity(value.severity) &&
    isDateString(value.created_at)
  )
}

async function buscarJson(path: string): Promise<Response> {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), 90_000)

  try {
    // O caminho relativo permite usar o proxy local e a mesma origem em produção.
    return await fetch(path, { signal: controller.signal })
  } catch (error: unknown) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('A API demorou mais de 90 segundos para responder.')
    }
    if (error instanceof TypeError) {
      throw new Error('Não foi possível conectar à API. Verifique a conexão e tente novamente.')
    }
    throw new Error('Ocorreu um erro inesperado ao consultar a API.')
  } finally {
    window.clearTimeout(timeout)
  }
}

async function lerJson(response: Response): Promise<unknown> {
  try {
    // O JSON externo é desconhecido até passar pelas funções de validação abaixo.
    return await response.json()
  } catch {
    throw new Error('A API retornou uma resposta que não contém JSON válido.')
  }
}

export async function buscarIncidentes(): Promise<Incident[]> {
  const response = await buscarJson('/incidents')
  if (!response.ok) {
    throw new Error(`A API respondeu com erro HTTP ${response.status} ao buscar incidentes.`)
  }

  const data = await lerJson(response)
  if (!Array.isArray(data) || !data.every(isIncident)) {
    throw new Error('A resposta de incidentes está fora do formato esperado.')
  }
  return data
}

export async function buscarRunbook(category: Category): Promise<Runbook | null> {
  const response = await buscarJson(`/runbooks/${encodeURIComponent(category)}`)
  if (response.status === 404) return null
  if (!response.ok) {
    throw new Error(`A API respondeu com erro HTTP ${response.status} ao buscar o runbook.`)
  }

  const data = await lerJson(response)
  if (!isRunbook(data)) {
    throw new Error('A resposta do runbook está fora do formato esperado.')
  }
  return data
}
