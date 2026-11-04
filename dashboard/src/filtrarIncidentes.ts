import type { Category, Incident, IncidentStatus, Severity } from './types'

export function filtrarIncidentes(
  incidentes: Incident[],
  filtros: {
    status: IncidentStatus | ''
    category: Category | ''
    severity: Severity | ''
    search: string
  },
): Incident[] {
  const busca = normalizarTexto(filtros.search.trim())

  return incidentes.filter(
    (incidente) =>
      (!filtros.severity || incidente.severity === filtros.severity) &&
      (!filtros.status || incidente.status === filtros.status) &&
      (!filtros.category || incidente.category === filtros.category) &&
      (!busca || normalizarTexto(incidente.title).includes(busca)),
  )
}

function normalizarTexto(texto: string): string {
  return texto.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
}
