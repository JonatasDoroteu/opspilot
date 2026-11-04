import type { Incident, Severity } from './types'

export type OrdenacaoIncidentes = 'recentes' | 'antigos' | 'severidade'

const prioridadeSeveridade: Record<Severity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
}

export function ordenarIncidentes(
  incidentes: Incident[],
  ordenacao: OrdenacaoIncidentes,
): Incident[] {
  return [...incidentes].sort((a, b) => {
    if (ordenacao === 'severidade') {
      return prioridadeSeveridade[a.severity] - prioridadeSeveridade[b.severity]
    }

    const diferenca = Date.parse(a.created_at) - Date.parse(b.created_at)
    return ordenacao === 'recentes' ? -diferenca : diferenca
  })
}
