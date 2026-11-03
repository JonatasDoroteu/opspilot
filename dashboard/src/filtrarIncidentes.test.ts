import { describe, expect, it } from 'vitest'
import { filtrarIncidentes } from './filtrarIncidentes'
import type { Incident } from './types'

const incidentes: Incident[] = [
  {
    id: 'open-db',
    title: 'Aberto banco',
    severity: 'high',
    status: 'open',
    source: 'monitoramento',
    category: 'database',
    created_at: '2026-11-03T12:00:00Z',
    resolved_at: null,
  },
  {
    id: 'resolved-deploy',
    title: 'Deploy resolvido',
    severity: 'low',
    status: 'resolved',
    source: 'manual',
    category: 'deploy',
    created_at: '2026-11-03T11:00:00Z',
    resolved_at: null,
  },
  {
    id: 'unknown-network',
    title: 'Rede com status inesperado',
    severity: 'medium',
    status: 'pending',
    source: 'monitoramento',
    category: 'network',
    created_at: '2026-11-03T10:00:00Z',
    resolved_at: null,
  },
]

describe('filtrarIncidentes', () => {
  it('filtra por status e mantém status inesperado apenas sem filtro de status', () => {
    expect(
      filtrarIncidentes(incidentes, { status: '', category: '', severity: '' }).map(
        (incidente) => incidente.id,
      ),
    ).toEqual(['open-db', 'resolved-deploy', 'unknown-network'])
    expect(
      filtrarIncidentes(incidentes, { status: 'open', category: '', severity: '' }).map(
        (incidente) => incidente.id,
      ),
    ).toEqual(['open-db'])
    expect(
      filtrarIncidentes(incidentes, { status: 'resolved', category: '', severity: '' }).map(
        (incidente) => incidente.id,
      ),
    ).toEqual(['resolved-deploy'])
  })

  it('filtra por categoria e severidade', () => {
    expect(
      filtrarIncidentes(incidentes, { status: '', category: 'network', severity: '' }).map(
        (incidente) => incidente.id,
      ),
    ).toEqual(['unknown-network'])
    expect(
      filtrarIncidentes(incidentes, { status: '', category: '', severity: 'low' }).map(
        (incidente) => incidente.id,
      ),
    ).toEqual(['resolved-deploy'])
  })

  it('combina filtros', () => {
    expect(
      filtrarIncidentes(incidentes, {
        status: 'open',
        category: 'database',
        severity: 'high',
      }).map((incidente) => incidente.id),
    ).toEqual(['open-db'])
  })
})
