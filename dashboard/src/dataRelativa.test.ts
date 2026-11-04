import { describe, expect, it } from 'vitest'
import { formatarDataRelativa } from './dataRelativa'

describe('formatarDataRelativa', () => {
  const referencia = new Date('2026-11-04T15:00:00Z')

  it('formata minutos', () => {
    expect(formatarDataRelativa('2026-11-04T14:42:00Z', referencia)).toBe('há 18 min')
  })

  it('formata horas', () => {
    expect(formatarDataRelativa('2026-11-04T12:00:00Z', referencia)).toBe('há 3 h')
  })

  it('formata dias', () => {
    expect(formatarDataRelativa('2026-11-01T15:00:00Z', referencia)).toBe('há 3 dias')
  })

  it('identifica uma data futura', () => {
    expect(formatarDataRelativa('2026-11-04T16:30:00Z', referencia)).toBe('em 1 h')
  })
})
