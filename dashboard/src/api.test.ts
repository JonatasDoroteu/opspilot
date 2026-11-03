import { afterEach, describe, expect, it, vi } from 'vitest'
import { buscarIncidentes } from './api'
import type { Incident } from './types'

function incidenteValido(): Incident {
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

function respostaApi(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('buscarIncidentes', () => {
  it('aceita payload válido', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(respostaApi([incidenteValido()]))

    await expect(buscarIncidentes()).resolves.toEqual([incidenteValido()])
  })

  it('rejeita campo obrigatório ausente', async () => {
    const { title: _title, ...semTitulo } = incidenteValido()
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(respostaApi([semTitulo]))

    await expect(buscarIncidentes()).rejects.toThrow('formato esperado')
  })

  it('rejeita campo com tipo incorreto', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      respostaApi([{ ...incidenteValido(), severity: 3 }]),
    )

    await expect(buscarIncidentes()).rejects.toThrow('formato esperado')
  })

  it('aceita status desconhecido para que a interface o apresente', async () => {
    const desconhecido = { ...incidenteValido(), status: 'pending' }
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(respostaApi([desconhecido]))

    await expect(buscarIncidentes()).resolves.toEqual([desconhecido])
  })

  it('trata resposta HTTP de erro', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(respostaApi({}, 503))

    await expect(buscarIncidentes()).rejects.toThrow('HTTP 503')
  })

  it('trata timeout/abort', async () => {
    vi.useFakeTimers()
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('Aborted', 'AbortError'))
          })
        }),
    )

    const request = buscarIncidentes()
    const rejected = expect(request).rejects.toThrow('90 segundos')
    await vi.advanceTimersByTimeAsync(90_000)
    await rejected
  })
})
