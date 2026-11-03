// Avisos opcionales a un servicio local (POST {texto, origen} a FOTOGRAMA_PIXI_URL) cuando termina algo largo.
// Si Pixi no está corriendo no pasa nada. Se apaga con FOTOGRAMA_PIXI=0.
const URL_PIXI = process.env.FOTOGRAMA_PIXI_URL || 'http://127.0.0.1:3070/avisar'

export const avisarPixi = (texto: string) => {
  if (process.env.FOTOGRAMA_PIXI === '0') return
  fetch(URL_PIXI, {
    method: 'POST',
    body: JSON.stringify({ texto, origen: 'Fotograma' }),
    signal: AbortSignal.timeout(3000),
  }).catch(() => {})
}

// "3 minutos", "45 segundos": para que se pueda decir en voz alta.
export const duracionHablada = (ms: number) => {
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s} segundos`
  const m = Math.round(s / 60)
  return m === 1 ? 'un minuto' : `${m} minutos`
}
