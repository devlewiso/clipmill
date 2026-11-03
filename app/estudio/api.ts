// Llamadas a la API del estudio.
const base = '/__fotograma/api/'

export const api = async <T = any>(ruta: string, opciones?: { metodo?: string; cuerpo?: unknown; bytes?: Blob }): Promise<T> => {
  const res = await fetch(base + ruta, {
    method: opciones?.metodo ?? (opciones?.cuerpo || opciones?.bytes ? 'POST' : 'GET'),
    headers: opciones?.cuerpo ? { 'Content-Type': 'application/json' } : undefined,
    body: opciones?.bytes ?? (opciones?.cuerpo ? JSON.stringify(opciones.cuerpo) : undefined),
  })
  const d = await res.json().catch(() => ({}))
  if (!res.ok || (d && typeof d === 'object' && 'error' in d && d.error)) throw new Error(d?.error || `Error ${res.status}`)
  return d as T
}

export const tiempo = (frame: number, fps: number) => {
  const s = Math.max(0, frame) / fps
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${(s % 60).toFixed(2).padStart(5, '0')}`
}
