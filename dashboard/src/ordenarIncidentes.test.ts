import { describe, expect, it } from 'vitest'
import { ordenarIncidentes } from './ordenarIncidentes'
import type { Incident } from './types'

const incidentes: Incident[] = [
  {
    id: 'medium-old',
    title: 'Incidente médio antigo',
    severity: 'medium',
    status: 'open',
    source: 'monitoramento',
    category: 'network',
    created_at: '2026-11-01T10:00:00Z',
    resolved_at: null,
  },
  {
    id: 'critical-new',
    title: 'Incidente crítico recente',
    severity: 'critical',
    status: 'open',
    source: 'monitoramento',
    category: 'database',
    created_at: '2026-11-03T10:00:00Z',
    resolved_at: null,
  },
  {
    id: 'high-middle',
    title: 'Incidente alto intermediário',
    severity: 'high',
    status: 'open',
    source: 'monitoramento',
    category: 'deploy',
    created_at: '2026-11-02T10:00:00Z',
    resolved_at: null,
  },
]

describe('ordenarIncidentes', () => {
  it('ordena por data recente ou antiga sem alterar a lista original', () => {
    expect(ordenarIncidentes(incidentes, 'recentes').map(({ id }) => id)).toEqual([
      'critical-new',
      'high-middle',
      'medium-old',
    ])
    expect(ordenarIncidentes(incidentes, 'antigos').map(({ id }) => id)).toEqual([
      'medium-old',
      'high-middle',
      'critical-new',
    ])
    expect(incidentes.map(({ id }) => id)).toEqual(['medium-old', 'critical-new', 'high-middle'])
  })

  it('ordena por severidade com crítica primeiro', () => {
    expect(ordenarIncidentes(incidentes, 'severidade').map(({ severity }) => severity)).toEqual([
      'critical',
      'high',
      'medium',
    ])
  })
})
