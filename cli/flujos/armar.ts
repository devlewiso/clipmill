// Arma un flujo a partir de una lista de pasos (nodos con nombre único) y enlaces entre nombres.
import type { Conexion, Flujo, NodoFlujo } from '../../src/flujos/tipos'
import { tipoPorId, valoresPorDefecto } from '../../src/flujos/catalogo'
import { nuevoId } from './almacen'

export type Paso = { nombre: string; tipo: string; params?: Record<string, any>; desactivado?: boolean; siempreSalida?: boolean; continuarEnError?: boolean; x: number; y: number }

export const armar = (nombre: string, pasos: Paso[], enlaces: [string, string, number?][]): Flujo => {
  const nodos: NodoFlujo[] = pasos.map((p) => ({
    id: nuevoId(),
    nombre: p.nombre,
    tipo: p.tipo,
    posicion: { x: p.x, y: p.y },
    params: { ...valoresPorDefecto(tipoPorId(p.tipo)!), ...(p.params || {}) },
    desactivado: p.desactivado || undefined,
    siempreSalida: p.siempreSalida || undefined,
    continuarEnError: p.continuarEnError || undefined,
  }))
  const id = (n: string) => nodos.find((x) => x.nombre === n)!.id
  const conexiones: Conexion[] = enlaces.map(([a, b, salida = 0]) => ({ id: nuevoId(), origen: id(a), salida, destino: id(b), entrada: 0 }))
  return { id: nuevoId(), nombre, activo: false, nodos, conexiones }
}
