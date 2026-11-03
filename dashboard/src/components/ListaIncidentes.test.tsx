import { render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ListaIncidentes } from './ListaIncidentes'
import type { Incident } from '../types'

function incidente(status: string = 'open'): Incident {
  return {
    id: 'incident-1234',
    title: 'Banco lento',
    severity: 'high',
    status,
    source: 'monitoramento',
    category: 'database',
    created_at: '2026-11-03T12:00:00Z',
    resolved_at: null,
  }
}

describe('ListaIncidentes', () => {
  it('renderiza título, severidade e status e permite selecionar o incidente', async () => {
    const user = userEvent.setup()
    const onSelecionar = vi.fn()
    const item = incidente()
    render(
      <ListaIncidentes
        incidentes={[item]}
        incidenteSelecionadoId={null}
        onSelecionar={onSelecionar}
      />,
    )

    expect(screen.getByText('Banco lento')).toBeInTheDocument()
    expect(screen.getByText('Alta')).toBeInTheDocument()
    expect(screen.getByText('Aberto')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Banco lento/ }))
    expect(onSelecionar).toHaveBeenCalledWith(item)
  })

  it('mostra Desconhecido para status inesperado', () => {
    render(
      <ListaIncidentes
        incidentes={[incidente('pending')]}
        incidenteSelecionadoId={null}
        onSelecionar={() => undefined}
      />,
    )

    expect(screen.getByText('Desconhecido')).toBeInTheDocument()
  })

  it('mostra o estado de lista vazia', () => {
    render(
      <ListaIncidentes
        incidentes={[]}
        incidenteSelecionadoId={null}
        onSelecionar={() => undefined}
      />,
    )

    expect(screen.getByText('Nenhum incidente corresponde aos filtros.')).toBeInTheDocument()
  })
})
