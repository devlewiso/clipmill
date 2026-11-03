// Esperas de carga: mientras haya alguna pendiente, el renderer no captura el frame.
// Imágenes, videos, fuentes y datos externos registran una espera y la liberan al estar listos.
import { useEffect, useState } from 'react'

const pendientes = new Map<number, { etiqueta: string; desde: number }>()
let siguiente = 1
const oyentes = new Set<() => void>()

export const esperarCarga = (etiqueta = 'carga') => {
  const id = siguiente++
  pendientes.set(id, { etiqueta, desde: Date.now() })
  return id
}

export const continuarCarga = (id: number) => {
  if (!pendientes.delete(id)) return
  if (!pendientes.size) oyentes.forEach((o) => o())
}

export const cargasPendientes = () => [...pendientes.values()]

// Resuelve cuando no queda ninguna espera pendiente (o falla al pasar el tiempo límite).
export const todoCargado = (limiteMs = 30_000) =>
  new Promise<void>((ok, mal) => {
    if (!pendientes.size) return ok()
    const t = setTimeout(() => {
      oyentes.delete(listo)
      mal(new Error('Tiempo agotado esperando: ' + cargasPendientes().map((p) => p.etiqueta).join(', ')))
    }, limiteMs)
    const listo = () => {
      clearTimeout(t)
      oyentes.delete(listo)
      ok()
    }
    oyentes.add(listo)
  })

// Hook para datos asíncronos: retiene el render hasta que la promesa termine.
export const useCarga = <T,>(cargar: () => Promise<T>, deps: unknown[] = [], etiqueta = 'datos') => {
  const [valor, setValor] = useState<T | undefined>(undefined)
  useEffect(() => {
    const id = esperarCarga(etiqueta)
    let vivo = true
    cargar()
      .then((v) => vivo && setValor(v))
      .catch((e) => console.error(`[fotograma] Falló la carga "${etiqueta}":`, e))
      .finally(() => continuarCarga(id))
    return () => {
      vivo = false
      continuarCarga(id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  return valor
}
