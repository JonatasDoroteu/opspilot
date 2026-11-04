import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buscarIncidentes, buscarRunbook } from './api'
import App from './App'
import type { Incident } from './types'

vi.mock('./api', () => ({
  buscarIncidentes: vi.fn(),
  buscarRunbook: vi.fn(),
}))

function incidente(): Incident {
  return {
    id: 'incident-1',
    title: 'Banco lento',
    severity: 'high',
    status: 'open',
    source: 'monitoramento',
    category: 'database',
    created_at: '2026-11-03T12:00:00Z',
    resolved_at: null,
  }
}

async function aguardarAtualizacao(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

function alternarAtualizacaoAutomatica(): void {
  fireEvent.click(screen.getByRole('checkbox', { name: 'Atualização automática (60 segundos)' }))
}

function formatarHorario(data: Date): string {
  return new Intl.DateTimeFormat('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(data)
}

beforeEach(() => {
  vi.mocked(buscarIncidentes).mockReset()
  vi.mocked(buscarRunbook).mockReset().mockResolvedValue(null)
  window.history.replaceState(null, '', '/')
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    value: 'visible',
  })
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
  Reflect.deleteProperty(document, 'visibilityState')
})

describe('atualização de incidentes', () => {
  it('começa desligada e não consulta novamente sem polling ativado', async () => {
    vi.useFakeTimers()
    vi.mocked(buscarIncidentes).mockResolvedValue([incidente()])
    render(<App />)
    await aguardarAtualizacao()

    expect(
      screen.getByRole('checkbox', { name: 'Atualização automática (60 segundos)' }),
    ).not.toBeChecked()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(120_000)
    })

    expect(buscarIncidentes).toHaveBeenCalledTimes(1)
  })

  it('consulta novamente após 60 segundos quando a atualização automática é ligada', async () => {
    vi.useFakeTimers()
    vi.mocked(buscarIncidentes).mockResolvedValue([incidente()])
    render(<App />)
    await aguardarAtualizacao()
    alternarAtualizacaoAutomatica()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(59_999)
    })
    expect(buscarIncidentes).toHaveBeenCalledTimes(1)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
    })
    expect(buscarIncidentes).toHaveBeenCalledTimes(2)
  })

  it('pausa na aba oculta e atualiza imediatamente quando ela volta', async () => {
    vi.useFakeTimers()
    vi.mocked(buscarIncidentes).mockResolvedValue([incidente()])
    render(<App />)
    await aguardarAtualizacao()
    alternarAtualizacaoAutomatica()

    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
    fireEvent(document, new Event('visibilitychange'))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(120_000)
    })
    expect(buscarIncidentes).toHaveBeenCalledTimes(1)

    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
    fireEvent(document, new Event('visibilitychange'))
    await aguardarAtualizacao()
    expect(buscarIncidentes).toHaveBeenCalledTimes(2)
  })

  it('mantém os dados anteriores quando uma atualização automática falha', async () => {
    vi.useFakeTimers()
    vi.mocked(buscarIncidentes)
      .mockResolvedValueOnce([incidente()])
      .mockRejectedValueOnce(new Error('API indisponível'))
    render(<App />)
    await aguardarAtualizacao()
    alternarAtualizacaoAutomatica()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000)
    })

    expect(screen.getByText('Banco lento')).toBeInTheDocument()
    expect(screen.getByText(/os dados exibidos foram mantidos/i)).toBeInTheDocument()
  })

  it('altera o horário somente depois de uma resposta válida', async () => {
    vi.useFakeTimers()
    const dataInicial = new Date('2026-11-04T15:00:00')
    vi.setSystemTime(dataInicial)
    vi.mocked(buscarIncidentes)
      .mockResolvedValueOnce([incidente()])
      .mockResolvedValueOnce([incidente()])
      .mockRejectedValueOnce(new Error('API indisponível'))
    render(<App />)
    await aguardarAtualizacao()

    expect(screen.getByText(`Atualizado às ${formatarHorario(dataInicial)}`)).toBeInTheDocument()
    alternarAtualizacaoAutomatica()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000)
    })
    const dataValida = new Date(dataInicial.getTime() + 60_000)
    expect(screen.getByText(`Atualizado às ${formatarHorario(dataValida)}`)).toBeInTheDocument()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000)
    })
    expect(screen.getByText(`Atualizado às ${formatarHorario(dataValida)}`)).toBeInTheDocument()
  })
})
