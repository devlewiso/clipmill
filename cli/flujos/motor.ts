// Motor de ejecución: recorre el grafo como n8n. Cada nodo recibe items, devuelve items por cada salida,
// y esos items viajan por las conexiones al siguiente nodo.
import type { CorridaNodo, Ejecucion, EventoMotor, Flujo, Item, NodoFlujo } from '../../src/flujos/tipos'
import { esTrigger, tipoPorId } from '../../src/flujos/catalogo'
import { carpetaEjecucion, guardarEjecucion, nuevoId } from './almacen'
import { crearContexto, evaluarJson, evaluarTexto, type Contexto } from './expresiones'
import { EJECUTORES } from './nodos'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { avisarPixi, duracionHablada } from '../pixi'

export type CtxNodo = {
  nodo: NodoFlujo
  flujo: Flujo
  items: Item[]
  entrada: number // por qué entrada llegaron los items
  estado: Record<string, any> // memoria privada del nodo durante la ejecución (Loop, Unir…)
  runIndex: number
  ejecucionId: string
  carpeta: string // carpeta de archivos de esta ejecución
  senal: AbortSignal
  contexto: (i?: number) => Contexto
  crudo: (clave: string) => any
  param: (clave: string, i?: number) => any
  json: (clave: string, i?: number) => any
  log: (mensaje: string) => void
}

// Devuelve los items de cada salida, o null si el nodo aún no emite (p. ej. Unir esperando la otra entrada).
export type Ejecutor = (c: CtxNodo) => Promise<Item[][] | null>

const MAX_PASOS = 5000
const MAX_ITEMS_GUARDADOS = 50

type Tarea = { nodoId: string; entrada: number; items: Item[] }

// Ejecuciones en curso, para poder cancelarlas.
export const enCurso = new Map<string, AbortController>()

export const ejecutarFlujo = async (
  flujo: Flujo,
  opts: {
    modo: Ejecucion['modo']
    desde?: string // id del nodo trigger con el que se arranca
    datos?: Record<string, any> // datos del trigger (cuerpo del webhook, etc.)
    // Reanudar una ejecución que falló: se reutilizan las salidas de los nodos que ya corrieron
    // (sin volver a gastar) y se sigue desde el nodo que falló, con la versión actual del flujo.
    reanudar?: Ejecucion
    // Rehacer un nodo concreto de esa ejecución (como "regenerar" en un lienzo): se reutiliza todo lo demás.
    // solo = true rehace únicamente ese nodo; si no, también lo que sigue después de él.
    rehacer?: { nodo: string; solo?: boolean }
    emitir: (e: EventoMotor) => void
    alCrear?: (id: string) => void
  },
): Promise<Ejecucion> => {
  const ej: Ejecucion = {
    id: nuevoId() + Date.now().toString(36).slice(-4),
    flujoId: flujo.id,
    flujoNombre: flujo.nombre,
    modo: opts.modo,
    estado: 'corriendo',
    inicio: new Date().toISOString(),
    corridas: [],
  }
  const control = new AbortController()
  enCurso.set(ej.id, control)
  opts.alCrear?.(ej.id)
  const emitir = opts.emitir
  emitir({ tipo: 'inicio', ejecucion: ej.id, flujoId: flujo.id })

  const porId = new Map(flujo.nodos.map((n) => [n.id, n]))
  const salidasDe = new Map<string, Item[][]>() // última salida de cada nodo (por nombre)
  const runs = new Map<string, number>()
  const estados = new Map<string, Record<string, any>>()
  const carpeta = carpetaEjecucion(ej.id)

  const salidaPrincipal = (nombre: string) => {
    const s = salidasDe.get(nombre)
    if (!s) return undefined
    return s[0]?.length ? s[0] : s.flat()
  }

  // Punto de partida
  const triggers = flujo.nodos.filter((n) => esTrigger(n.tipo) && !n.desactivado)
  const inicio =
    (opts.desde && porId.get(opts.desde)) ||
    triggers.find((n) => n.tipo === 'manual') ||
    triggers[0] ||
    flujo.nodos.find((n) => n.tipo !== 'nota' && !flujo.conexiones.some((c) => c.destino === n.id))
  if (!inicio) {
    ej.estado = 'error'
    ej.error = 'El flujo no tiene un nodo de inicio (agrega un Trigger).'
    ej.fin = new Date().toISOString()
    guardarEjecucion(ej)
    enCurso.delete(ej.id)
    emitir({ tipo: 'fin', ejecucion: ej.id, estado: ej.estado, error: ej.error })
    return ej
  }

  let cola: Tarea[] = [{ nodoId: inicio.id, entrada: 0, items: [{ json: opts.datos ?? {} }] }]
  let pasos = 0
  let soloNodo: string | undefined // al rehacer un solo nodo, lo que sigue no se vuelve a correr

  try {
    if (opts.reanudar) {
      const previa = opts.reanudar
      // Salidas completas (las corridas guardan como mucho MAX_ITEMS_GUARDADOS items por salida).
      const archivo = join(carpetaEjecucion(previa.id), 'salidas.json')
      const completas: Record<string, Item[][]> = existsSync(archivo) ? JSON.parse(readFileSync(archivo, 'utf8')) : {}
      const ok = previa.corridas.filter((c) => c.estado === 'ok')
      const salidaDe = (nombre: string) => completas[nombre] ?? ok.filter((c) => c.nodo === nombre).at(-1)?.salidas
      const recortada = (nombre: string) => !completas[nombre] && (salidaDe(nombre) || []).some((l) => l.length >= MAX_ITEMS_GUARDADOS)
      const porNombre = new Map(flujo.nodos.map((n) => [n.nombre, n]))
      // Por nombre; si se renombró, el que sigue al último nodo que terminó bien.
      const ultimoOk = porNombre.get(ok.at(-1)?.nodo || '')
      const fallido = opts.rehacer
        ? porNombre.get(opts.rehacer.nodo)
        : porNombre.get(previa.corridas.find((c) => c.estado === 'error')?.nodo || '') ??
          (ultimoOk ? porId.get(flujo.conexiones.find((c) => c.origen === ultimoOk.id)?.destino || '') : undefined)
      if (!fallido) throw new Error(opts.rehacer ? `No existe el nodo "${opts.rehacer.nodo}" en el flujo.` : 'Esa ejecución no tiene un nodo con error desde el cual reanudar.')
      let objetivo: NodoFlujo = fallido
      // Si lo que entra al nodo quedó recortado en el registro, se retrocede y se recalcula.
      const entradas = (n: NodoFlujo) => flujo.conexiones.filter((c) => c.destino === n.id)
      for (let k = 0; k < 20; k++) {
        const previos: NodoFlujo[] = entradas(objetivo).flatMap((c) => porId.get(c.origen) ?? [])
        const malo: NodoFlujo | undefined = previos.find((p) => !salidaDe(p.nombre) || recortada(p.nombre))
        if (!malo) break
        if (esTrigger(malo.tipo)) throw new Error('No hay datos guardados suficientes para reanudar; ejecuta el flujo de nuevo.')
        objetivo = malo
      }
      // Lo que se va a recalcular (el nodo y, salvo "solo", todo lo que cuelga de él) no se reutiliza.
      const recalcular = new Set([objetivo.id])
      if (!opts.rehacer?.solo)
        for (let cambio = true; cambio; ) {
          cambio = false
          for (const k of flujo.conexiones) if (recalcular.has(k.origen) && !recalcular.has(k.destino)) (recalcular.add(k.destino), (cambio = true))
        }
      const nombresRecalcular = new Set([...recalcular].map((id) => porId.get(id)?.nombre))
      for (const c of ok) if (!nombresRecalcular.has(c.nodo)) {
        const sal = salidaDe(c.nodo)
        if (sal) salidasDe.set(c.nodo, sal)
        runs.set(c.nodo, 1)
        ej.corridas.push({ ...c, reutilizada: true } as CorridaNodo)
        emitir({ tipo: 'nodo-fin', ejecucion: ej.id, nodo: c.nodo, ms: 0, items: c.salidas.map((x) => x.length) })
      }
      guardarEjecucion(ej) // el editor ya puede mostrar lo reutilizado mientras se rehace el nodo
      const con = entradas(objetivo)[0]
      const origen = con && porId.get(con.origen)
      const items = origen ? salidasDe.get(origen.nombre)?.[con.salida] : undefined
      if (!items?.length) throw new Error(`No hay datos de entrada guardados para "${objetivo.nombre}".`)
      cola = [{ nodoId: objetivo.id, entrada: con.entrada, items }]
      if (opts.rehacer) soloNodo = opts.rehacer.solo ? objetivo.id : undefined
      emitir({ tipo: 'log', ejecucion: ej.id, nodo: objetivo.nombre, mensaje: opts.rehacer ? `Rehaciendo "${objetivo.nombre}"${opts.rehacer.solo ? ' (solo ese nodo)' : ' y lo que sigue'}; se reutiliza el resto de la ejecución ${previa.id}.` : `Reanudando desde "${objetivo.nombre}" (se reutilizan ${ok.length} nodos de la ejecución ${previa.id}).` })
    }
    while (cola.length) {
      if (control.signal.aborted) throw new Error('Ejecución cancelada.')
      if (++pasos > MAX_PASOS) throw new Error(`Se superaron ${MAX_PASOS} pasos: probablemente hay un loop infinito.`)
      const tarea = cola.shift()!
      const nodo = porId.get(tarea.nodoId)
      if (!nodo || nodo.tipo === 'nota') continue

      const runIndex = runs.get(nodo.nombre) ?? 0
      runs.set(nodo.nombre, runIndex + 1)
      if (!estados.has(nodo.id)) estados.set(nodo.id, {})
      const items: Item[] = structuredClone(tarea.items)

      const tipo = tipoPorId(nodo.tipo)
      const contexto = (i = 0) =>
        crearContexto({ items, indice: i, salidaDe: salidaPrincipal, runIndex, ejecucionId: ej.id, flujo: { id: flujo.id, nombre: flujo.nombre } })
      const crudo = (clave: string) => nodo.params[clave] ?? tipo?.campos.find((c) => c.clave === clave)?.porDefecto
      const c: CtxNodo = {
        nodo,
        flujo,
        items,
        entrada: tarea.entrada,
        estado: estados.get(nodo.id)!,
        runIndex,
        ejecucionId: ej.id,
        carpeta,
        senal: control.signal,
        contexto,
        crudo,
        param: (clave, i = 0) => {
          const v = crudo(clave)
          if (typeof v !== 'string') return v
          const r = evaluarTexto(v, contexto(i))
          const campo = tipo?.campos.find((x) => x.clave === clave)
          return campo?.tipo === 'numero' && r !== '' ? Number(r) : r
        },
        json: (clave, i = 0) => evaluarJson(crudo(clave), contexto(i)),
        log: (mensaje) => emitir({ tipo: 'log', ejecucion: ej.id, nodo: nodo.nombre, mensaje }),
      }

      emitir({ tipo: 'nodo-inicio', ejecucion: ej.id, nodo: nodo.nombre })
      const t0 = Date.now()
      const corrida: CorridaNodo = {
        nodo: nodo.nombre,
        inicio: new Date().toISOString(),
        ms: 0,
        estado: 'ok',
        entrada: items.slice(0, MAX_ITEMS_GUARDADOS),
        salidas: [],
      }

      let salidas: Item[][] | null
      try {
        if (nodo.desactivado) salidas = [items]
        else {
          const ejecutor = EJECUTORES[nodo.tipo]
          if (!ejecutor) throw new Error(`Tipo de nodo desconocido: ${nodo.tipo}`)
          salidas = await ejecutor(c)
        }
      } catch (err: any) {
        const mensaje = String(err?.message || err)
        corrida.ms = Date.now() - t0
        corrida.estado = 'error'
        corrida.error = mensaje
        ej.corridas.push(corrida)
        emitir({ tipo: 'nodo-error', ejecucion: ej.id, nodo: nodo.nombre, error: mensaje })
        if (!nodo.continuarEnError || control.signal.aborted) throw Object.assign(new Error(mensaje), { nodo: nodo.nombre })
        salidas = [[{ json: { error: mensaje } }]]
      }

      if (salidas === null) {
        // El nodo está esperando (Unir con una sola entrada todavía).
        corrida.ms = Date.now() - t0
        ej.corridas.push(corrida)
        emitir({ tipo: 'nodo-fin', ejecucion: ej.id, nodo: nodo.nombre, ms: corrida.ms, items: [] })
        continue
      }

      if (nodo.siempreSalida && salidas.every((l) => !l?.length)) salidas = [[{ json: {} }], ...salidas.slice(1)]

      // Cada item de salida recuerda de qué item de este nodo viene ($('Nodo').item).
      salidas = salidas.map((lista) =>
        (lista || []).map((it, i) => {
          const base = it.pareo ?? items[i]?.pareo ?? items[0]?.pareo ?? {}
          return { ...it, json: it.json ?? {}, pareo: { ...base, [nodo.nombre]: i } }
        }),
      )

      if (corrida.estado === 'ok') {
        corrida.ms = Date.now() - t0
        corrida.salidas = salidas.map((s) => s.slice(0, MAX_ITEMS_GUARDADOS))
        ej.corridas.push(corrida)
        emitir({ tipo: 'nodo-fin', ejecucion: ej.id, nodo: nodo.nombre, ms: corrida.ms, items: salidas.map((s) => s.length) })
      }
      salidasDe.set(nodo.nombre, salidas)
      guardarEjecucion(ej)
      // Salidas completas, para poder reanudar esta ejecución si algo falla más adelante.
      try {
        writeFileSync(join(carpeta, 'salidas.json'), JSON.stringify(Object.fromEntries(salidasDe)))
      } catch {}

      // Encolar los siguientes nodos (como n8n, una salida sin items no continúa).
      salidas.forEach((lista, salida) => {
        if (!lista.length || nodo.id === soloNodo) return
        for (const con of flujo.conexiones.filter((x) => x.origen === nodo.id && x.salida === salida)) {
          cola.push({ nodoId: con.destino, entrada: con.entrada, items: lista })
        }
      })
    }
    ej.estado = 'ok'
  } catch (err: any) {
    ej.estado = control.signal.aborted ? 'cancelada' : 'error'
    ej.error = (err?.nodo ? `[${err.nodo}] ` : '') + String(err?.message || err)
  } finally {
    ej.fin = new Date().toISOString()
    guardarEjecucion(ej)
    enCurso.delete(ej.id)
    emitir({ tipo: 'fin', ejecucion: ej.id, estado: ej.estado, error: ej.error })
    // Pixi avisa en voz alta si el flujo tardó o falló (los rapiditos no molestan).
    const ms = Date.parse(ej.fin) - Date.parse(ej.inicio)
    if (ej.estado === 'error') avisarPixi(`El flujo ${flujo.nombre} falló.`)
    else if (ej.estado === 'ok' && ms > 30000) avisarPixi(`Terminó el flujo ${flujo.nombre}, tardó ${duracionHablada(ms)}.`)
  }
  return ej
}

// Salida del último nodo ejecutado (para responder webhooks "al terminar").
export const ultimaSalida = (ej: Ejecucion) => {
  const ultima = [...ej.corridas].reverse().find((c) => c.estado === 'ok' && c.salidas.some((s) => s.length))
  return ultima ? ultima.salidas.flat().map((i) => i.json) : []
}
