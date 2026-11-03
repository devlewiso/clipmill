import { mkdirSync } from 'node:fs'
import { dirname, isAbsolute, join } from 'node:path'
import type { Item } from '../../../src/flujos/tipos'
import type { CtxNodo } from '../motor'
import { revisarEscritura } from '../../seguridad'
import { rutaBiblioteca } from '../../biblioteca'

// Ejecuta fn por cada item de entrada y junta los resultados en la salida 0.
export const porItem = async (c: CtxNodo, fn: (item: Item, i: number) => Promise<Item | Item[]>): Promise<Item[][]> => {
  const salida: Item[] = []
  for (let i = 0; i < c.items.length; i++) {
    if (c.senal.aborted) throw new Error('Ejecución cancelada.')
    const r = await fn(c.items[i], i)
    salida.push(...(Array.isArray(r) ? r : [r]))
  }
  return [salida]
}

export const dormir = (ms: number, senal: AbortSignal) =>
  new Promise<void>((ok, mal) => {
    if (senal.aborted) return mal(new Error('Ejecución cancelada.'))
    const t = setTimeout(ok, ms)
    senal.addEventListener('abort', () => (clearTimeout(t), mal(new Error('Ejecución cancelada.'))), { once: true })
  })

// Ruta donde guardar un archivo generado: absoluta tal cual, relativa dentro de la carpeta de la ejecución.
export const rutaSalida = (c: CtxNodo, nombre: string | undefined, porDefecto: string) => {
  const n = String(nombre || '').trim() || porDefecto
  const ruta = isAbsolute(n) ? n : join(c.carpeta, n)
  revisarEscritura(ruta, rutaBiblioteca())
  mkdirSync(dirname(ruta), { recursive: true })
  return ruta
}

export const conTimeout = (senal: AbortSignal, segundos: number) =>
  AbortSignal.any([senal, AbortSignal.timeout(Math.max(1, segundos) * 1000)])

// Recorta textos largos en mensajes de error.
export const recorte = (s: string, n = 500) => (s.length > n ? s.slice(0, n) + '…' : s)

// Convierte lo que devuelve el código del usuario en items.
export const aItems = (r: any): Item[] => {
  if (r === undefined || r === null) return []
  const lista = Array.isArray(r) ? r : [r]
  return lista.map((x) => (x && typeof x === 'object' && 'json' in x && typeof x.json === 'object' ? x : { json: x && typeof x === 'object' ? x : { valor: x } }))
}
