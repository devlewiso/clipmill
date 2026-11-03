// Triggers automáticos: cron de los flujos activos y búsqueda del flujo que atiende un webhook.
import cron, { type ScheduledTask } from 'node-cron'
import { EventEmitter } from 'node:events'
import type { Ejecucion, EventoMotor, Flujo } from '../../src/flujos/tipos'
import { leerFlujo, listarFlujos } from './almacen'
import { ejecutarFlujo } from './motor'

// Todos los eventos del motor pasan por aquí; el servidor los reenvía al navegador.
export const bus = new EventEmitter()
bus.setMaxListeners(100)

// Arranca una ejecución y devuelve su id en cuanto existe, más una promesa que termina con ella.
export const lanzar = (flujo: Flujo, modo: Ejecucion['modo'], desde?: string, datos?: Record<string, any>, reanudar?: Ejecucion, rehacer?: { nodo: string; solo?: boolean }) => {
  let avisarId!: (id: string) => void
  const id = new Promise<string>((ok) => (avisarId = ok))
  const fin = ejecutarFlujo(flujo, { modo, desde, datos, reanudar, rehacer, emitir: (e: EventoMotor) => bus.emit('evento', e), alCrear: (x) => avisarId(x) })
  return id.then((x) => ({ id: x, fin }))
}

const tareas = new Map<string, ScheduledTask[]>()

export const sincronizar = (flujo: Flujo | null, id?: string) => {
  const clave = flujo?.id ?? id!
  for (const t of tareas.get(clave) || []) t.stop()
  tareas.delete(clave)
  if (!flujo?.activo) return []
  const errores: string[] = []
  const nuevas: ScheduledTask[] = []
  for (const n of flujo.nodos.filter((x) => x.tipo === 'programado' && !x.desactivado)) {
    const expr = String(n.params.cron || '').trim()
    if (!cron.validate(expr)) {
      errores.push(`"${n.nombre}": la expresión cron "${expr}" no es válida.`)
      continue
    }
    nuevas.push(
      cron.schedule(
        expr,
        () => {
          // Se relee el flujo por si cambió desde que se programó.
          const actual = leerFlujo(clave)
          if (actual?.activo) lanzar(actual, 'programado', n.id)
        },
        { timezone: n.params.zona || 'UTC' },
      ),
    )
  }
  tareas.set(clave, nuevas)
  return errores
}

export const sincronizarTodos = () => listarFlujos().forEach((f) => sincronizar(f))

// Busca el nodo webhook que corresponde a una ruta. En modo prueba vale aunque el flujo no esté activo.
export const buscarWebhook = (ruta: string, metodo: string, prueba: boolean) => {
  for (const f of listarFlujos()) {
    if (!prueba && !f.activo) continue
    const n = f.nodos.find(
      (x) => x.tipo === 'webhook' && !x.desactivado && String(x.params.ruta || '').replace(/^\/+/, '') === ruta && String(x.params.metodo || 'POST') === metodo,
    )
    if (n) return { flujo: f, nodo: n }
  }
  return null
}
