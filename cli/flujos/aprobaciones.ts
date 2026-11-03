// Vistas previas pendientes: un flujo se detiene en el nodo "Vista previa" hasta que alguien
// aprueba o rechaza el video desde el estudio.
import { randomUUID } from 'node:crypto'

export type Pendiente = {
  id: string
  ejecucion: string
  flujoId: string
  flujo: string
  nodo: string
  video: string
  titulo: string
  descripcion?: string
  destino?: string // a dónde se publicará si se aprueba
  creado: string
}

type Decision = 'aprobado' | 'rechazado'
const pendientes = new Map<string, Pendiente & { resolver: (d: Decision) => void }>()

export const pedirAprobacion = (datos: Omit<Pendiente, 'id' | 'creado'>, senal: AbortSignal) =>
  new Promise<Decision>((ok, mal) => {
    const id = randomUUID().slice(0, 8)
    const fin = (d: Decision) => {
      pendientes.delete(id)
      ok(d)
    }
    pendientes.set(id, { ...datos, id, creado: new Date().toISOString(), resolver: fin })
    // Si se cancela la ejecución, la vista previa desaparece.
    senal.addEventListener(
      'abort',
      () => {
        pendientes.delete(id)
        mal(new Error('Ejecución cancelada.'))
      },
      { once: true },
    )
  })

export const listarPendientes = (): Pendiente[] => [...pendientes.values()].map(({ resolver, ...p }) => p)

export const decidir = (id: string, decision: Decision) => {
  const p = pendientes.get(id)
  if (!p) throw new Error('Esa vista previa ya no está pendiente.')
  p.resolver(decision)
  return { ok: true, decision }
}
