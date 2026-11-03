import type { Category, Incident, IncidentStatus, Severity } from './types'

export function filtrarIncidentes(
  incidentes: Incident[],
  filtros: {
    status: IncidentStatus | ''
    category: Category | ''
    severity: Severity | ''
  },
): Incident[] {
  return incidentes.filter(
    (incidente) =>
      (!filtros.severity || incidente.severity === filtros.severity) &&
      (!filtros.status || incidente.status === filtros.status) &&
      (!filtros.category || incidente.category === filtros.category),
  )
}
