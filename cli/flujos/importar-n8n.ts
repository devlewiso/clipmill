// Importa workflows, tablas y credenciales desde el n8n local.
// - Workflows y tablas: API pública de n8n (llave en ~/.config/flujos/n8n.json).
// - Credenciales: `n8n export:credentials --decrypted` dentro del contenedor; se guardan en
//   ~/.config/flujos/credenciales.json y nunca pasan por el navegador ni por los logs.
import { execFile } from 'node:child_process'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { Conexion, Flujo, NodoFlujo } from '../../src/flujos/tipos'
import { existeTabla, guardarTabla, leerJson, nuevoId, type Fila } from './almacen'
import { guardarCredencial, type Credencial } from './credenciales'
import { DIR_SECRETOS, RUTAS_N8N } from './rutas'

const sh = promisify(execFile)

type ConfigN8n = { url: string; apiKey: string; contenedor: string }
const config = (): ConfigN8n => {
  const c = leerJson<ConfigN8n | null>(join(DIR_SECRETOS, 'n8n.json'), null)
  if (!c?.apiKey) throw new Error('Falta ~/.config/flujos/n8n.json con la llave de la API de n8n.')
  return c
}

const api = async (ruta: string) => {
  const c = config()
  const res = await fetch(c.url + '/api/v1' + ruta, { headers: { 'X-N8N-API-KEY': c.apiKey } })
  if (!res.ok) throw new Error(`n8n ${res.status} en ${ruta}`)
  return res.json() as Promise<any>
}

// Recorre todas las páginas de un listado de la API.
const todo = async (ruta: string) => {
  const lista: any[] = []
  let cursor = ''
  do {
    const sep = ruta.includes('?') ? '&' : '?'
    const d = await api(`${ruta}${sep}limit=250${cursor ? '&cursor=' + encodeURIComponent(cursor) : ''}`)
    lista.push(...(d.data || []))
    cursor = d.nextCursor || ''
  } while (cursor)
  return lista
}

export const listarWorkflowsN8n = async () =>
  (await todo('/workflows')).map((w) => ({ id: w.id, nombre: w.name, activo: w.active, nodos: w.nodes?.length ?? 0, actualizado: w.updatedAt }))

// ───────── Tablas ─────────
let tablasN8n: Record<string, string> | null = null
const nombreTabla = async (id: string) => {
  const mapa = (tablasN8n ??= Object.fromEntries((await todo('/data-tables')).map((t) => [t.id, t.name])))
  return mapa[id] || id
}

// Copia las filas de una tabla de n8n a una tabla local (solo si la local no existe, para no pisar datos).
const copiarTabla = async (id: string, nombre: string, avisos: string[]) => {
  if (existeTabla(nombre)) return
  const filas = (await todo(`/data-tables/${id}/rows`)).map(({ id: fid, createdAt, updatedAt, ...resto }: any) => ({
    id: fid,
    creado: createdAt,
    actualizado: updatedAt,
    ...resto,
  })) as Fila[]
  guardarTabla(nombre, filas)
  avisos.push(`Tabla "${nombre}" copiada de n8n (${filas.length} filas).`)
}

// ───────── Credenciales ─────────
const convertirCredencial = (tipo: string, d: any): Credencial | null => {
  if (tipo === 'httpHeaderAuth' && d.name) return { tipo: 'header', header: d.name, valor: d.value }
  if (tipo === 'httpBearerAuth' && d.token) return { tipo: 'header', header: 'Authorization', valor: 'Bearer ' + d.token }
  if ((tipo === 'openRouterApi' || tipo === 'openAiApi') && d.apiKey) return { tipo: 'header', header: 'Authorization', valor: 'Bearer ' + d.apiKey }
  if (/OAuth2Api$/.test(tipo) && d.oauthTokenData?.refresh_token)
    return {
      tipo: 'oauth2',
      clientId: d.clientId,
      clientSecret: d.clientSecret,
      tokenUrl: d.accessTokenUrl || 'https://oauth2.googleapis.com/token',
      refreshToken: d.oauthTokenData.refresh_token,
      accessToken: d.oauthTokenData.access_token,
      expira: 0, // se renueva en el primer uso
    }
  return null
}

const importarCredenciales = async (nombres: Set<string>, avisos: string[]) => {
  if (!nombres.size) return
  const { contenedor } = config()
  const { stdout } = await sh('docker', ['exec', contenedor, 'n8n', 'export:credentials', '--all', '--decrypted'], {
    maxBuffer: 20_000_000,
  })
  const inicio = stdout.indexOf('[')
  const lista: any[] = inicio >= 0 ? JSON.parse(stdout.slice(inicio)) : []
  for (const cr of lista) {
    if (!nombres.has(cr.name)) continue
    const c = convertirCredencial(cr.type, cr.data || {})
    if (c) {
      guardarCredencial(cr.name, c)
      avisos.push(`Credencial "${cr.name}" importada (${cr.type}).`)
    } else avisos.push(`La credencial "${cr.name}" (${cr.type}) no se pudo importar: créala a mano.`)
  }
}

// ───────── Conversión de nodos ─────────

// Traduce las rutas del contenedor de n8n a rutas de esta máquina (sin tocar URLs como https://x/files/…).
const traducirRutas = (v: any): any => {
  if (typeof v === 'string')
    return RUTAS_N8N.reduce((s, [cont, host]) => s.replace(new RegExp(`(^|[^\\w.:/-])${cont.replace(/\//g, '\\/')}(?=/|\\b)`, 'g'), `$1${host}`), v)
  if (Array.isArray(v)) return v.map(traducirRutas)
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, traducirRutas(x)]))
  return v
}

const jsonTexto = (o: any) => (o === undefined || o === null || o === '' ? '' : JSON.stringify(o, null, 2))

// Parámetros [{name, value}] de n8n → objeto.
const pares = (lista: any[] | undefined) => Object.fromEntries((lista || []).filter((p) => p.name).map((p) => [p.name, p.value]))

// Valor de una condición de n8n como código JS.
const exprDe = (v: any) => {
  if (typeof v !== 'string') return JSON.stringify(v ?? null)
  const m = v.match(/^=\s*\{\{([\s\S]*)\}\}\s*$/)
  if (m) return `(${m[1].trim()})`
  if (v.startsWith('=')) return '`' + v.slice(1).replace(/`/g, '\\`').replace(/\{\{([\s\S]*?)\}\}/g, '${$1}') + '`'
  return JSON.stringify(v)
}

const condicionIf = (p: any): string => {
  const conds: any[] = p.conditions?.conditions
  if (Array.isArray(conds)) {
    const partes = conds.map((c) => {
      const L = exprDe(c.leftValue)
      const R = exprDe(c.rightValue)
      const op = c.operator?.operation
      switch (op) {
        case 'true': return `${L} === true`
        case 'false': return `${L} === false`
        case 'equals': return `${L} == ${R}`
        case 'notEquals': return `${L} != ${R}`
        case 'contains': return `String(${L}).includes(${R})`
        case 'notContains': return `!String(${L}).includes(${R})`
        case 'startsWith': return `String(${L}).startsWith(${R})`
        case 'endsWith': return `String(${L}).endsWith(${R})`
        case 'gt': return `Number(${L}) > Number(${R})`
        case 'gte': return `Number(${L}) >= Number(${R})`
        case 'lt': return `Number(${L}) < Number(${R})`
        case 'lte': return `Number(${L}) <= Number(${R})`
        case 'exists': return `(${L} !== undefined && ${L} !== null)`
        case 'notExists': return `(${L} === undefined || ${L} === null)`
        case 'empty': return `(${L} == null || ${L} === '' || (Array.isArray(${L}) && !${L}.length))`
        case 'notEmpty': return `!(${L} == null || ${L} === '' || (Array.isArray(${L}) && !${L}.length))`
        case 'regex': return `new RegExp(${R}).test(String(${L}))`
        default: return `false /* operación de n8n no soportada: ${op} */`
      }
    })
    return '{{ ' + (partes.join(p.conditions?.combinator === 'or' ? ' || ' : ' && ') || 'false') + ' }}'
  }
  // IF v1: { boolean: [{value1, value2}], string: [{value1, operation, value2}], number: [...] }
  const v1: string[] = []
  for (const c of p.conditions?.boolean || []) v1.push(`${exprDe(c.value1)} === ${exprDe(c.value2 ?? false)}`)
  for (const c of p.conditions?.string || []) {
    const [L, R] = [exprDe(c.value1), exprDe(c.value2)]
    v1.push(c.operation === 'contains' ? `String(${L}).includes(${R})` : c.operation === 'notEqual' ? `${L} != ${R}` : `${L} == ${R}`)
  }
  for (const c of p.conditions?.number || []) {
    const ops: Record<string, string> = { larger: '>', largerEqual: '>=', smaller: '<', smallerEqual: '<=', notEqual: '!=', equal: '==' }
    v1.push(`Number(${exprDe(c.value1)}) ${ops[c.operation] || '=='} Number(${exprDe(c.value2)})`)
  }
  return '{{ ' + (v1.join(p.combineOperation === 'any' ? ' || ' : ' && ') || 'false') + ' }}'
}

const cronDe = (p: any) => {
  const r = p.rule?.interval?.[0] || {}
  const h = r.triggerAtHour ?? 0
  const m = r.triggerAtMinute ?? 0
  switch (r.field) {
    case 'cronExpression': return r.expression
    case 'minutes': return `*/${r.minutesInterval || 5} * * * *`
    case 'hours': return `${m} */${r.hoursInterval || 1} * * *`
    case 'weeks': return `${m} ${h} * * ${(r.triggerAtDay || [1]).join(',')}`
    case 'months': return `${m} ${h} ${r.triggerAtDayOfMonth || 1} */${r.monthsInterval || 1} *`
    default: return `${m} ${h} ${r.daysInterval > 1 ? '*/' + r.daysInterval : '*'} * *`
  }
}

// Esquema a partir de un ejemplo (outputParserStructured con "jsonSchemaExample").
const esquemaDeEjemplo = (v: any): any => {
  if (Array.isArray(v)) return { type: 'array', items: v.length ? esquemaDeEjemplo(v[0]) : {} }
  if (v && typeof v === 'object')
    return { type: 'object', properties: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, esquemaDeEjemplo(x)])), required: Object.keys(v) }
  return { type: typeof v === 'number' ? 'number' : typeof v === 'boolean' ? 'boolean' : 'string' }
}

const credDe = (n: any, tipo?: string) => (tipo ? n.credentials?.[tipo]?.name : Object.values<any>(n.credentials || {})[0]?.name) || ''

type Ctx = { w: any; avisos: string[]; credenciales: Set<string>; tablas: Map<string, string> }

// Sub-nodos de IA conectados a un agente (modelos, parser…), ordenados por índice.
const subnodos = (ctx: Ctx, destino: string, tipo: string) => {
  const r: { nodo: any; indice: number }[] = []
  for (const [origen, salidas] of Object.entries<any>(ctx.w.connections || {}))
    for (const c of (salidas[tipo] || []).flat()) if (c?.node === destino) r.push({ nodo: ctx.w.nodes.find((n: any) => n.name === origen), indice: c.index })
  return r.filter((x) => x.nodo).sort((a, b) => a.indice - b.indice).map((x) => x.nodo)
}

const convertir = async (n: any, ctx: Ctx): Promise<Pick<NodoFlujo, 'tipo' | 'params'> | null> => {
  const t: string = n.type.replace(/^n8n-nodes-base\./, '').replace(/^@n8n\/n8n-nodes-langchain\./, 'lc.')
  const p = n.parameters || {}
  const usarCred = (nombre: string) => (nombre && ctx.credenciales.add(nombre), nombre)

  switch (t) {
    case 'manualTrigger':
      return { tipo: 'manual', params: {} }
    case 'scheduleTrigger':
      return { tipo: 'programado', params: { cron: cronDe(p), zona: 'UTC' } }
    case 'cron':
      return { tipo: 'programado', params: { cron: '0 9 * * *', zona: 'UTC' } }
    case 'webhook':
      return { tipo: 'webhook', params: { ruta: p.path || nuevoId(), metodo: p.httpMethod || 'GET', respuesta: p.responseMode === 'lastNode' ? 'final' : 'inmediato' } }
    case 'code':
      if (p.language && p.language !== 'javaScript') return null
      return { tipo: 'codigo', params: { modo: p.mode === 'runOnceForEachItem' ? 'porItem' : 'todos', codigo: p.jsCode ?? '' } }
    case 'function':
      return { tipo: 'codigo', params: { modo: 'todos', codigo: p.functionCode ?? '' } }
    case 'if':
      return { tipo: 'si', params: { condicion: condicionIf(p) } }
    case 'wait': {
      const f: Record<string, number> = { seconds: 1, minutes: 60, hours: 3600, days: 86400 }
      return { tipo: 'esperar', params: { segundos: (p.amount ?? 1) * (f[p.unit || 'hours'] || 1) } }
    }
    case 'splitInBatches':
      return { tipo: 'loop', params: { lote: p.batchSize ?? 1 } }
    case 'merge':
      return { tipo: 'unir', params: { modo: /combine/i.test(p.mode || '') ? 'combinar' : 'agregar' } }
    case 'noOp':
      return { tipo: 'establecer', params: { campos: '{}', soloEstos: false } }
    case 'set': {
      const campos = p.assignments?.assignments
        ? Object.fromEntries(p.assignments.assignments.map((a: any) => [a.name, a.value]))
        : Object.assign({}, ...['string', 'number', 'boolean'].map((k) => pares(p.values?.[k])))
      return { tipo: 'establecer', params: { campos: jsonTexto(campos), soloEstos: p.assignments ? !p.includeOtherFields : !!p.keepOnlySet } }
    }
    case 'executeCommand':
      return { tipo: 'comando', params: { comando: p.command ?? '', carpeta: '', timeout: 1800, unaVez: n.executeOnce === true } }
    case 'readWriteFile':
    case 'readBinaryFile':
    case 'writeBinaryFile': {
      const escribir = p.operation === 'write' || t === 'writeBinaryFile'
      return { tipo: 'archivo', params: { operacion: escribir ? 'guardar' : 'leer', ruta: escribir ? p.fileName : p.fileSelector ?? p.filePath } }
    }
    case 'httpRequest': {
      const credencial = usarCred(
        p.authentication === 'genericCredentialType' ? credDe(n, p.genericAuthType) : p.authentication === 'predefinedCredentialType' ? credDe(n, p.nodeCredentialType) : '',
      )
      const formato = p.options?.response?.response?.responseFormat
      let cuerpo = ''
      if (p.sendBody) cuerpo = p.specifyBody === 'json' ? p.jsonBody ?? '' : jsonTexto(pares(p.bodyParameters?.parameters))
      if (p.sendBody && p.contentType && p.contentType !== 'json')
        ctx.avisos.push(`"${n.name}": el cuerpo era ${p.contentType}; se importó como JSON, revísalo.`)
      return {
        tipo: 'http',
        params: {
          metodo: p.method || 'GET',
          url: p.url ?? '',
          credencial,
          query: p.sendQuery ? (p.specifyQuery === 'json' ? p.jsonQuery : jsonTexto(pares(p.queryParameters?.parameters))) : '',
          headers: p.sendHeaders ? (p.specifyHeaders === 'json' ? p.jsonHeaders : jsonTexto(pares(p.headerParameters?.parameters))) : '',
          cuerpo,
          respuesta: formato === 'file' ? 'archivo' : formato === 'text' ? 'texto' : 'json',
          nombreArchivo: '',
          timeout: Math.round((p.options?.timeout ?? 60000) / 1000),
        },
      }
    }
    case 'dataTable': {
      const id = p.dataTableId?.value ?? ''
      const tabla = await nombreTabla(id)
      ctx.tablas.set(id, tabla)
      const ops: Record<string, string> = { get: 'leer', insert: 'insertar', update: 'actualizar', upsert: 'actualizar', deleteRows: 'borrar' }
      const op = ops[p.operation || 'insert'] || 'leer'
      if (p.operation === 'upsert') ctx.avisos.push(`"${n.name}": "upsert" se importó como "actualizar" (no inserta si no existe).`)
      const filtro = Object.fromEntries((p.filters?.conditions || []).map((c: any) => [c.keyName, c.keyValue]))
      const fila = p.columns?.mappingMode === 'autoMapInputData' ? '{{ $json }}' : jsonTexto(p.columns?.value || {})
      return { tipo: 'tabla', params: { tabla, operacion: op, fila, filtro: Object.keys(filtro).length ? jsonTexto(filtro) : '' } }
    }
    case 'stickyNote':
      return { tipo: 'nota', params: { texto: p.content ?? '' } }
    case 'telegram':
      return { tipo: 'telegram', params: { texto: p.text ?? '', chatId: p.chatId ?? '', enviarArchivo: p.operation === 'sendDocument' || p.operation === 'sendVideo' } }
    case 'youTube':
      if (p.resource === 'video' && p.operation === 'upload') {
        const o = p.options || {}
        return {
          tipo: 'youtube',
          params: {
            credencial: usarCred(credDe(n, 'youTubeOAuth2Api')),
            titulo: p.title ?? '',
            descripcion: o.description ?? '',
            tags: o.tags ?? '',
            categoria: p.categoryId ?? '22',
            privacidad: o.privacyStatus ?? 'private',
            idioma: o.defaultLanguage ?? '',
            notificar: o.notifySubscribers ?? true,
          },
        }
      }
      return null
    case 'lc.agent':
    case 'lc.chainLlm': {
      const modelos = subnodos(ctx, n.name, 'ai_languageModel')
      const parser = subnodos(ctx, n.name, 'ai_outputParser')[0]
      const principal = modelos[0]
      const esOllama = (m: any) => /lmChatOllama|lmOllama/.test(m?.type || '')
      const esOpenRouter = (m: any) => /OpenRouter/.test(m?.type || '')
      const proveedor = principal && !esOllama(principal) ? 'openai' : 'ollama'
      const respaldo = modelos.slice(1).find((m) => (proveedor === 'ollama' ? esOllama(m) : !esOllama(m)))
      if (modelos.length > 1 && !respaldo)
        ctx.avisos.push(`"${n.name}": el modelo de respaldo era de otro proveedor; se dejó sin respaldo (puedes poner otro modelo de Ollama).`)
      let esquema = ''
      if (parser?.parameters?.inputSchema && parser.parameters.schemaType === 'manual') esquema = parser.parameters.inputSchema
      else if (parser?.parameters?.jsonSchemaExample) {
        try {
          esquema = jsonTexto(esquemaDeEjemplo(JSON.parse(parser.parameters.jsonSchemaExample)))
        } catch {}
      }
      return {
        tipo: 'llm',
        params: {
          proveedor,
          modelo: principal?.parameters?.model || 'kimi-k3:cloud',
          respaldo: respaldo?.parameters?.model || '',
          baseUrl: esOpenRouter(principal) ? 'https://openrouter.ai/api/v1' : 'https://api.openai.com/v1',
          credencial: proveedor === 'openai' ? usarCred(credDe(principal)) : '',
          sistema: p.options?.systemMessage ?? p.messages?.messageValues?.[0]?.message ?? '',
          prompt: p.promptType === 'define' || p.text ? p.text ?? '' : '={{ $json.chatInput }}',
          esquema,
          reintentos: 2,
          temperatura: principal?.parameters?.options?.temperature ?? 0.8,
        },
      }
    }
    default:
      return null
  }
}

// Tipos que se absorben dentro del nodo LLM (no se crean como nodos propios).
const esSubnodoIa = (n: any, w: any) => {
  const salidas = w.connections?.[n.name]
  return /langchain/.test(n.type) && !!salidas && !salidas.main && Object.keys(salidas).some((k) => k.startsWith('ai_'))
}

export const importarWorkflowN8n = async (id: string) => {
  const w = await api(`/workflows/${encodeURIComponent(id)}`)
  const avisos: string[] = []
  const ctx: Ctx = { w, avisos, credenciales: new Set(), tablas: new Map() }
  const ids = new Map<string, string>() // nombre n8n → id nuevo
  const nodos: NodoFlujo[] = []

  for (const n of w.nodes || []) {
    if (esSubnodoIa(n, w)) continue
    const r = await convertir(n, ctx)
    const nodo: NodoFlujo = {
      id: nuevoId(),
      nombre: n.name,
      tipo: r?.tipo ?? 'n8n',
      posicion: { x: n.position?.[0] ?? 0, y: n.position?.[1] ?? 0 },
      params: r ? traducirRutas(r.params) : { tipoN8n: n.type, parametros: jsonTexto(n.parameters) },
      desactivado: n.disabled || undefined,
      continuarEnError: n.continueOnFail || (n.onError && n.onError !== 'stopWorkflow') || undefined,
      siempreSalida: n.alwaysOutputData || undefined,
    }
    if (!r) avisos.push(`"${n.name}" (${n.type}) no tiene equivalente todavía: quedó marcado en rojo.`)
    ids.set(n.name, nodo.id)
    nodos.push(nodo)
  }

  const conexiones: Conexion[] = []
  for (const [origen, tipos] of Object.entries<any>(w.connections || {})) {
    ;(tipos.main || []).forEach((lista: any[], salida: number) => {
      for (const c of lista || []) {
        const a = ids.get(origen)
        const b = ids.get(c.node)
        if (a && b) conexiones.push({ id: nuevoId(), origen: a, salida, destino: b, entrada: c.index ?? 0 })
      }
    })
  }

  for (const [idTabla, nombre] of ctx.tablas) await copiarTabla(idTabla, nombre, avisos).catch((e) => avisos.push(`No se copió la tabla "${nombre}": ${e.message}`))
  await importarCredenciales(ctx.credenciales, avisos).catch((e) => avisos.push('No se pudieron importar las credenciales: ' + e.message))

  const flujo: Flujo = { id: nuevoId(), nombre: w.name, activo: false, nodos, conexiones, origenN8n: w.id }
  return { flujo, avisos }
}
