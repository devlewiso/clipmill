import type { Item } from '../../../src/flujos/tipos'
import type { Ejecutor } from '../motor'
import { aItems, dormir, porItem } from './util'
import { revisarCodigo } from '../../seguridad'

const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor

const pasar: Ejecutor = async (c) => [c.items]

const si: Ejecutor = async (c) => {
  const verdadero: Item[] = []
  const falso: Item[] = []
  c.items.forEach((it, i) => {
    const r = c.param('condicion', i)
    ;(r === true || r === 'true' ? verdadero : falso).push(it)
  })
  return [verdadero, falso]
}

const esperar: Ejecutor = async (c) => {
  const s = Number(c.param('segundos')) || 0
  c.log(`Esperando ${s} s`)
  await dormir(s * 1000, c.senal)
  return [c.items]
}

// Loop como el "Loop Over Items" de n8n: salida 1 = siguiente lote, salida 0 = todo lo procesado al terminar.
// La primera llegada trae la lista completa; las siguientes son los resultados que vuelven del recorrido.
const loop: Ejecutor = async (c) => {
  const e = c.estado
  const lote = Math.max(1, Number(c.param('lote')) || 1)
  if (!e.activo) {
    e.activo = true
    e.pendientes = [...c.items]
    e.hechos = []
    e.vuelta = 0
  } else {
    e.hechos.push(...c.items)
  }
  if (e.pendientes.length) {
    const siguiente = e.pendientes.splice(0, lote)
    c.log(`Vuelta ${++e.vuelta}: ${siguiente.length} item(s), quedan ${e.pendientes.length}`)
    return [[], siguiente]
  }
  e.activo = false
  return [e.hechos, []]
}

const unir: Ejecutor = async (c) => {
  const e = c.estado
  e[c.entrada] = c.items
  if (!e[0] || !e[1]) {
    c.log(`Esperando la entrada ${e[0] ? 2 : 1}`)
    return null
  }
  const [a, b] = [e[0] as Item[], e[1] as Item[]]
  delete e[0]
  delete e[1]
  if (c.param('modo') === 'combinar') {
    const n = Math.max(a.length, b.length)
    return [Array.from({ length: n }, (_, i) => ({ json: { ...a[i]?.json, ...b[i]?.json }, archivo: b[i]?.archivo ?? a[i]?.archivo }))]
  }
  return [[...a, ...b]]
}

// Código JavaScript. Las variables de n8n ($input, $json, $('Nodo'), $runIndex…) están disponibles.
const codigo: Ejecutor = async (c) => {
  const fuente = String(c.crudo('codigo') || '')
  revisarCodigo(fuente)
  const consola = { log: (...a: any[]) => c.log(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')) }
  const correr = async (i: number) => {
    const ctx = { ...c.contexto(i), console: consola, items: c.items }
    const fn = new AsyncFunction(...Object.keys(ctx), fuente)
    return fn(...Object.values(ctx))
  }
  if (c.crudo('modo') === 'porItem') {
    return porItem(c, async (it, i) => aItems(await correr(i)).map((x) => ({ ...x, archivo: x.archivo ?? it.archivo })))
  }
  return [aItems(await correr(0))]
}

const establecer: Ejecutor = async (c) =>
  porItem(c, async (it, i) => {
    const campos = c.json('campos', i) || {}
    const base = c.param('soloEstos') === true ? {} : it.json
    return { json: { ...base, ...campos }, archivo: it.archivo }
  })

const n8n: Ejecutor = async (c) => {
  throw new Error(
    `El nodo "${c.nodo.nombre}" viene de n8n (${c.crudo('tipoN8n')}) y todavía no tiene equivalente aquí. Reemplázalo o desactívalo.`,
  )
}

export const basicos: Record<string, Ejecutor> = {
  manual: pasar,
  programado: pasar,
  webhook: pasar,
  si,
  esperar,
  loop,
  unir,
  codigo,
  establecer,
  n8n,
}
