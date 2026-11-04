export function formatarDataRelativa(data: string, referencia: Date): string {
  const diferenca = referencia.getTime() - Date.parse(data)
  const futuro = diferenca < 0
  const minutos = Math.max(1, Math.floor(Math.abs(diferenca) / 60_000))

  if (minutos < 60) {
    return futuro ? `em ${minutos} min` : `há ${minutos} min`
  }

  const horas = Math.floor(minutos / 60)
  if (horas < 24) {
    return futuro ? `em ${horas} h` : `há ${horas} h`
  }

  const dias = Math.floor(horas / 24)
  const unidade = dias === 1 ? 'dia' : 'dias'
  return futuro ? `em ${dias} ${unidade}` : `há ${dias} ${unidade}`
}
