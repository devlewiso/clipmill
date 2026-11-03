// Expresiones {{ … }} compatibles con n8n: $json, $input, $('Nodo'), $node, $runIndex, $now, $execution.
import type { Item } from '../../src/flujos/tipos'

export type Contexto = Record<string, any>

// Construye las variables disponibles en expresiones y en el nodo Código.
export const crearContexto = (opts: {
  items: Item[]
  indice: number
  salidaDe: (nombre: string) => Item[] | undefined // última salida (principal) de un nodo
  runIndex: number
  ejecucionId: string
  flujo: { id: string; nombre: string }
}): Contexto => {
  const { items, indice, salidaDe } = opts
  const actual = items[indice] ?? items[0] ?? { json: {} }

  const referencia = (nombre: string) => {
    const salida = salidaDe(nombre)
    if (!salida) throw new Error(`El nodo "${nombre}" todavía no se ha ejecutado en esta ejecución.`)
    const vacio = () => {
      throw new Error(`El nodo "${nombre}" no devolvió items.`)
    }
    return {
      all: () => salida,
      first: () => salida[0] ?? vacio(),
      last: () => salida[salida.length - 1] ?? vacio(),
      // .item = el item de ese nodo del que viene el item actual (pairedItem de n8n).
      get item() {
        const i = actual.pareo?.[nombre] ?? 0
        return salida[i] ?? salida[0] ?? vacio()
      },
      itemMatching: (i: number) => salida[actual.pareo?.[nombre] ?? i] ?? salida[i],
      isExecuted: true,
      get json() {
        return (salida[0] ?? vacio()).json
      },
    }
  }

  const $ = (nombre: string) => referencia(nombre)
  const $node = new Proxy({}, { get: (_, nombre: string) => referencia(nombre) })

  return {
    $,
    $node,
    $json: actual.json,
    $item: (i: number) => ({ $json: items[i]?.json }),
    $input: {
      all: () => items,
      first: () => items[0],
      last: () => items[items.length - 1],
      item: actual,
      params: {},
    },
    $items: (nombre?: string) => (nombre ? salidaDe(nombre) ?? [] : items),
    $itemIndex: indice,
    $runIndex: opts.runIndex,
    $now: new Date(),
    $today: new Date(new Date().toDateString()),
    $execution: { id: opts.ejecucionId, mode: 'manual' },
    $workflow: { id: opts.flujo.id, name: opts.flujo.nombre },
    $env: process.env,
    $archivo: actual.archivo,
    JSON,
    Math,
    Date,
    Buffer,
  }
}

const cache = new Map<string, Function>()

export const evaluarJs = (expr: string, ctx: Contexto) => {
  let fn = cache.get(expr)
  if (!fn) {
    // Sin "use strict" para poder usar `with`: así las variables del contexto se usan sin prefijo.
    fn = new Function('__ctx', `with (__ctx) { return (${expr}\n) }`)
    cache.set(expr, fn)
  }
  return fn(ctx)
}

// Separa un texto en trozos literales y expresiones {{ … }}, respetando llaves y comillas internas.
const partir = (s: string): { lit: string; expr?: string }[] => {
  const partes: { lit: string; expr?: string }[] = []
  let i = 0
  let lit = ''
  while (i < s.length) {
    if (s[i] === '{' && s[i + 1] === '{') {
      let j = i + 2
      let prof = 0
      let comilla: string | null = null
      for (; j < s.length; j++) {
        const c = s[j]
        if (comilla) {
          if (c === '\\') j++
          else if (c === comilla) comilla = null
          continue
        }
        if (c === '"' || c === "'" || c === '`') comilla = c
        else if (c === '{') prof++
        else if (c === '}') {
          if (prof === 0 && s[j + 1] === '}') break
          prof--
        }
      }
      if (j >= s.length) {
        lit += s.slice(i)
        break
      }
      partes.push({ lit, expr: s.slice(i + 2, j).trim() })
      lit = ''
      i = j + 2
    } else {
      lit += s[i++]
    }
  }
  if (lit || !partes.length) partes.push({ lit })
  return partes
}

const aTexto = (v: any) => (v === undefined || v === null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v))

// Evalúa un texto con {{ }}. Si todo el texto es una sola expresión, devuelve el valor tal cual (objeto, número…).
export const evaluarTexto = (valor: string, ctx: Contexto): any => {
  // En n8n, un parámetro que empieza con "=" es una expresión; el "=" no forma parte del valor.
  const s = valor.startsWith('=') ? valor.slice(1) : valor
  if (!s.includes('{{')) return s
  const unica = partir(s.trim())
  if (unica.length === 1 && unica[0].expr !== undefined && !unica[0].lit) return evaluarJs(unica[0].expr, ctx)
  const partes = partir(s)
  return partes.map((p) => p.lit + (p.expr !== undefined ? aTexto(evaluarJs(p.expr, ctx)) : '')).join('')
}

// Evalúa en profundidad objetos/arrays: cada texto con {{ }} se resuelve.
export const evaluarProfundo = (v: any, ctx: Contexto): any => {
  if (typeof v === 'string') return evaluarTexto(v, ctx)
  if (Array.isArray(v)) return v.map((x) => evaluarProfundo(x, ctx))
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, evaluarProfundo(x, ctx)]))
  return v
}

// Campos de tipo JSON: se intenta parsear primero (y evaluar cada texto dentro); si no es JSON válido
// —como los cuerpos de n8n con {{ JSON.stringify(...) }} sin comillas— se evalúa como texto y luego se parsea.
export const evaluarJson = (v: any, ctx: Contexto): any => {
  if (v === undefined || v === null || v === '') return undefined
  if (typeof v !== 'string') return evaluarProfundo(v, ctx)
  const crudo = v.startsWith('=') ? v.slice(1) : v
  // Una sola expresión {{ … }}: su valor se usa tal cual (texto, lista u objeto).
  const t = crudo.trim()
  if (t.startsWith('{{') && t.endsWith('}}')) {
    const partes = partir(t)
    if (partes.length === 1 && partes[0].expr !== undefined && !partes[0].lit) return evaluarJs(partes[0].expr, ctx)
  }
  try {
    return evaluarProfundo(JSON.parse(crudo), ctx)
  } catch {
    const r = evaluarTexto(v.startsWith('=') ? v : '=' + v, ctx)
    if (typeof r !== 'string') return r
    try {
      return JSON.parse(r)
    } catch (e: any) {
      throw new Error('El JSON no es válido después de evaluar las expresiones: ' + e.message + '\n' + r.slice(0, 300))
    }
  }
}
