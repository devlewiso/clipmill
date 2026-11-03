// Guarda flujos, ejecuciones y tablas como archivos JSON en data/.
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { Ejecucion, Flujo } from '../../src/flujos/tipos'
import { R } from './rutas'
import { aPapelera } from '../seguridad'


const leerJson = <T>(ruta: string, porDefecto: T): T => {
  try {
    return JSON.parse(readFileSync(ruta, 'utf8'))
  } catch {
    return porDefecto
  }
}

// Escritura atómica: nunca queda un JSON a medias si el proceso se corta.
const escribirJson = (ruta: string, datos: unknown) => {
  const tmp = ruta + '.tmp'
  writeFileSync(tmp, JSON.stringify(datos, null, 2))
  renameSync(tmp, ruta)
}

export const nuevoId = () => randomUUID().slice(0, 8)
const seguro = (id: string) => id.replace(/[^\w-]/g, '')

// ───────── Flujos ─────────
export const listarFlujos = (): Flujo[] =>
  readdirSync(R.DIR_FLUJOS)
    .filter((f) => f.endsWith('.json'))
    .map((f) => leerJson<Flujo | null>(join(R.DIR_FLUJOS, f), null))
    .filter((f): f is Flujo => !!f)
    .sort((a, b) => (b.actualizado || '').localeCompare(a.actualizado || ''))

export const leerFlujo = (id: string) => leerJson<Flujo | null>(join(R.DIR_FLUJOS, seguro(id) + '.json'), null)

export const guardarFlujo = (f: Flujo) => {
  f.actualizado = new Date().toISOString()
  escribirJson(join(R.DIR_FLUJOS, seguro(f.id) + '.json'), f)
  return f
}

// No se borra: va a la papelera del proyecto (.fotograma/papelera/flujos).
export const borrarFlujo = (id: string) => aPapelera(R.proyecto, 'flujos', join(R.DIR_FLUJOS, seguro(id) + '.json'))

// ───────── Ejecuciones ─────────
export const guardarEjecucion = (e: Ejecucion) => escribirJson(join(R.DIR_EJECUCIONES, seguro(e.id) + '.json'), e)

export const leerEjecucion = (id: string) => leerJson<Ejecucion | null>(join(R.DIR_EJECUCIONES, seguro(id) + '.json'), null)

export const listarEjecuciones = (flujoId?: string, limite = 50) =>
  readdirSync(R.DIR_EJECUCIONES)
    .filter((f) => f.endsWith('.json'))
    .map((f) => leerJson<Ejecucion | null>(join(R.DIR_EJECUCIONES, f), null))
    .filter((e): e is Ejecucion => !!e && (!flujoId || e.flujoId === flujoId))
    .sort((a, b) => b.inicio.localeCompare(a.inicio))
    .slice(0, limite)
    // La lista no necesita los datos de cada nodo.
    .map(({ corridas, ...resto }) => ({ ...resto, nodos: corridas.length }))

// ───────── Tablas ─────────
export type Fila = Record<string, any> & { id: number; creado: string }

const rutaTabla = (nombre: string) => join(R.DIR_TABLAS, seguro(nombre) + '.json')

export const leerTabla = (nombre: string): Fila[] => leerJson<Fila[]>(rutaTabla(nombre), [])
export const guardarTabla = (nombre: string, filas: Fila[]) => escribirJson(rutaTabla(nombre), filas)
export const existeTabla = (nombre: string) => existsSync(rutaTabla(nombre))

export const listarTablas = () =>
  readdirSync(R.DIR_TABLAS)
    .filter((f) => f.endsWith('.json') && !f.startsWith('_'))
    .map((f) => {
      const nombre = f.replace(/\.json$/, '')
      return { nombre, filas: leerTabla(nombre).length }
    })

// Carpeta de archivos de una ejecución (videos, audios, renders).
export const carpetaEjecucion = (id: string) => {
  const d = join(R.DIR_ARCHIVOS, seguro(id))
  mkdirSync(d, { recursive: true })
  return d
}

export { leerJson, escribirJson }
