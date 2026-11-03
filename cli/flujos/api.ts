// API de Flujos (se monta en el servidor del estudio): editor, eventos en vivo, credenciales, n8n y webhooks.
import express, { type Request, type Response } from 'express'
import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { dirname, join, resolve } from 'node:path'
import type { EventoMotor, Flujo } from '../../src/flujos/tipos'
import { tipoPorId, valoresPorDefecto } from '../../src/flujos/catalogo'
import {
  borrarFlujo,
  guardarFlujo,
  leerEjecucion,
  guardarEjecucion,
  leerFlujo,
  leerTabla,
  listarEjecuciones,
  listarFlujos,
  listarTablas,
  nuevoId,
  existeTabla,
  guardarTabla,
} from './almacen'
import { listarBiblioteca, rutaBiblioteca } from '../biblioteca'
import { borrarCredencial, guardarCredencial, listarCredenciales } from './credenciales'
import { importarWorkflowN8n, listarWorkflowsN8n } from './importar-n8n'
import { enCurso, ultimaSalida } from './motor'
import { bus, buscarWebhook, lanzar, sincronizar, sincronizarTodos } from './programador'
import { PLANTILLAS, aplicarIdioma, idiomaBase } from './plantillas'
import { estadoConexion, iniciarConexionYoutube } from './youtube-oauth'
import { decidir, listarPendientes } from './aprobaciones'
import { R, RUTAS_N8N } from './rutas'

export const crearApiFlujos = () => {
// Al arrancar, nada puede estar corriendo: lo que quedó "corriendo" se cortó con un reinicio.
// Se marca como error para que no parezca trabado y se pueda reanudar desde ese punto.
for (const r of listarEjecuciones(undefined, 200).filter((e) => e.estado === 'corriendo')) {
  const e = leerEjecucion(r.id)
  if (!e) continue
  e.estado = 'error'
  e.error = 'Interrumpida: el estudio se reinició mientras corría. Usa "Reanudar desde el error".'
  e.fin = new Date().toISOString()
  const hechos = new Set(e.corridas.map((c) => c.nodo))
  const siguiente = e.corridas.length ? undefined : 'inicio'
  if (!siguiente && !e.corridas.some((c) => c.estado === 'error')) {
    // El nodo que estaba trabajando (sin corrida) queda como el que falló, para poder reanudar desde él.
    const f = leerFlujo(e.flujoId)
    const ultimo = f?.nodos.find((n) => n.nombre === e.corridas.at(-1)?.nodo)
    const sig = ultimo && f?.nodos.find((n) => n.id === f.conexiones.find((c) => c.origen === ultimo.id)?.destino && !hechos.has(n.nombre))
    if (sig) e.corridas.push({ nodo: sig.nombre, inicio: e.fin, ms: 0, estado: 'error', error: e.error, entrada: [], salidas: [] } as any)
  }
  guardarEjecucion(e)
}
const app = express()
app.use(express.json({ limit: '20mb' }))

// Los errores de las rutas async se responden como JSON en vez de tumbar el servidor.
const r = (fn: (req: Request, res: Response) => Promise<any> | any) => async (req: Request, res: Response) => {
  try {
    const out = await fn(req, res)
    if (out !== undefined && !res.headersSent) res.json(out)
  } catch (e: any) {
    if (!res.headersSent) res.status(400).json({ error: e.message || String(e) })
  }
}

const resumen = (f: Flujo) => ({
  id: f.id,
  nombre: f.nombre,
  activo: f.activo,
  actualizado: f.actualizado,
  nodos: f.nodos.filter((n) => n.tipo !== 'nota').length,
  origenN8n: f.origenN8n,
})

const flujoNuevo = (nombre: string): Flujo => {
  const t = tipoPorId('manual')!
  return {
    id: nuevoId(),
    nombre,
    activo: false,
    nodos: [{ id: nuevoId(), nombre: 'Trigger manual', tipo: 'manual', posicion: { x: 0, y: 0 }, params: valoresPorDefecto(t) }],
    conexiones: [],
  }
}

// ───────── Flujos ─────────
app.get('/flujos', r(() => listarFlujos().map(resumen)))

app.post(
  '/flujos',
  r((req) => guardarFlujo(req.body?.nodos ? { ...req.body, id: nuevoId(), activo: false } : flujoNuevo(req.body?.nombre || 'Flujo nuevo'))),
)

app.get(
  '/flujos/:id',
  r((req, res) => leerFlujo(String(req.params.id)) ?? res.status(404).json({ error: 'No existe ese flujo.' })),
)

app.put(
  '/flujos/:id',
  r((req) => {
    const f: Flujo = { ...req.body, id: String(req.params.id) }
    const nombres = f.nodos.map((n) => n.nombre)
    const repetido = nombres.find((n, i) => nombres.indexOf(n) !== i)
    if (repetido) throw new Error(`Hay dos nodos llamados "${repetido}". Los nombres deben ser únicos.`)
    guardarFlujo(f)
    return { flujo: f, avisos: sincronizar(f) }
  }),
)

app.delete(
  '/flujos/:id',
  r((req) => {
    sincronizar(null, String(req.params.id))
    borrarFlujo(String(req.params.id))
    return { ok: true }
  }),
)

app.post(
  '/flujos/:id/duplicar',
  r((req) => {
    const f = leerFlujo(String(req.params.id))
    if (!f) throw new Error('No existe ese flujo.')
    return guardarFlujo({ ...structuredClone(f), id: nuevoId(), nombre: f.nombre + ' (copia)', activo: false })
  }),
)

app.post(
  '/flujos/:id/ejecutar',
  r(async (req) => {
    const f = leerFlujo(String(req.params.id))
    if (!f) throw new Error('No existe ese flujo.')
    const { id } = await lanzar(f, 'manual', req.body?.desde, req.body?.datos)
    return { ejecucion: id }
  }),
)

// Reanuda una ejecución con error desde el nodo que falló (reutiliza lo que ya se hizo y pagó).
app.post(
  '/ejecuciones/:id/reanudar',
  r(async (req) => {
    const previa = leerEjecucion(String(req.params.id))
    if (!previa) throw new Error('No existe esa ejecución.')
    if (previa.estado !== 'error') throw new Error('Solo se pueden reanudar ejecuciones que fallaron.')
    const f = leerFlujo(previa.flujoId)
    if (!f) throw new Error('El flujo de esa ejecución ya no existe.')
    const { id } = await lanzar(f, 'manual', undefined, undefined, previa)
    return { ejecucion: id }
  }),
)

// Rehace un nodo de una ejecución terminada (solo ese nodo, o ese y lo que sigue), reutilizando el resto.
app.post(
  '/ejecuciones/:id/rehacer',
  r(async (req) => {
    const previa = leerEjecucion(String(req.params.id))
    if (!previa) throw new Error('No existe esa ejecución.')
    if (previa.estado === 'corriendo') throw new Error('Esa ejecución todavía está corriendo.')
    const f = leerFlujo(previa.flujoId)
    if (!f) throw new Error('El flujo de esa ejecución ya no existe.')
    const nodo = String(req.body?.nodo || '')
    if (!nodo) throw new Error('Falta el nodo a rehacer.')
    const { id } = await lanzar(f, 'manual', undefined, undefined, previa, { nodo, solo: req.body?.solo === true })
    return { ejecucion: id }
  }),
)

// ───────── Ejecuciones ─────────
app.get('/ejecuciones', r((req) => listarEjecuciones(req.query.flujo as string | undefined)))
app.get(
  '/ejecuciones/:id',
  r((req, res) => leerEjecucion(String(req.params.id)) ?? res.status(404).json({ error: 'No existe esa ejecución.' })),
)
app.post(
  '/ejecuciones/:id/cancelar',
  r((req) => {
    enCurso.get(String(req.params.id))?.abort()
    return { ok: true }
  }),
)

// Eventos en vivo (Server-Sent Events).
app.get('/eventos', (req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' })
  res.write(': conectado\n\n')
  const enviar = (e: EventoMotor) => res.write(`data: ${JSON.stringify(e)}\n\n`)
  const latido = setInterval(() => res.write(': latido\n\n'), 25_000)
  bus.on('evento', enviar)
  req.on('close', () => {
    clearInterval(latido)
    bus.off('evento', enviar)
  })
})

// ───────── Credenciales y tablas ─────────
app.get('/credenciales', r(() => listarCredenciales()))
app.post(
  '/credenciales',
  r((req) => {
    const { nombre, header, valor } = req.body || {}
    if (!nombre || !header || !valor) throw new Error('Faltan nombre, header o valor.')
    guardarCredencial(String(nombre), { tipo: 'header', header: String(header), valor: String(valor) })
    return { ok: true }
  }),
)
app.delete(
  '/credenciales/:nombre',
  r((req) => {
    borrarCredencial(String(req.params.nombre))
    return { ok: true }
  }),
)

app.get('/tablas', r(() => listarTablas()))
app.get('/tablas/:nombre', r((req) => leerTabla(String(req.params.nombre))))

// ───────── Vistas previas pendientes ─────────
app.get('/aprobaciones', r(() => listarPendientes()))
app.post('/aprobaciones/:id', r((req) => decidir(String(req.params.id), req.body?.decision === 'rechazado' ? 'rechazado' : 'aprobado')))

// ───────── Conectar canal de YouTube ─────────
app.post('/youtube/conectar', r(() => iniciarConexionYoutube()))
app.get('/youtube/estado', r(() => estadoConexion()))

// ───────── Plantillas ─────────
app.get('/plantillas', r(() => PLANTILLAS.map(({ crear, ...tarjeta }) => ({ ...tarjeta, idiomaBase: tarjeta.idioma ? idiomaBase(tarjeta) : undefined }))))
app.post(
  '/plantillas/:id',
  r((req) => {
    const p = PLANTILLAS.find((x) => x.id === String(req.params.id))
    if (!p) throw new Error('No existe esa plantilla.')
    const o = req.body?.opciones || {}
    const flujo = p.crear({ revisar: o.revisar !== false, youtube: o.youtube !== false, tiktok: o.tiktok !== false, duracion: o.duracion })
    // Otro idioma que el de la plantilla (español ↔ inglés).
    if (p.idioma && (o.idioma === 'es' || o.idioma === 'en') && o.idioma !== idiomaBase(p)) aplicarIdioma(flujo, o.idioma)
    if (req.body?.nombre) flujo.nombre = String(req.body.nombre)
    // El historial arranca con los videos que ya están en la biblioteca (para no repetir temas).
    if (p.historial && !existeTabla(p.historial.tabla)) {
      const carpeta = p.historial.canal
      const campo = p.historial.campo || 'tema'
      const filas = listarBiblioteca()
        .filter((v) => v.canal === carpeta)
        .reverse()
        .map((v, i) => ({ id: i + 1, creado: v.fecha, createdAt: v.fecha, fecha: v.fecha.slice(0, 10), [campo]: v.titulo, titulo: v.titulo, youtube: v.plataformas.youtube?.url || '', origen: 'biblioteca' }))
      guardarTabla(p.historial.tabla, filas)
    }
    return guardarFlujo(flujo)
  }),
)

// ───────── n8n ─────────
app.get('/n8n/workflows', r(() => listarWorkflowsN8n()))
app.post(
  '/n8n/importar',
  r(async (req) => {
    const { flujo, avisos } = await importarWorkflowN8n(String(req.body?.id || ''))
    guardarFlujo(flujo)
    return { flujo: resumen(flujo), avisos }
  }),
)

// Vista previa de archivos generados (solo dentro de las carpetas conocidas).
const CARPETAS_PERMITIDAS = () => [R.DIR_ARCHIVOS, resolve(R.proyecto, 'out'), resolve(R.proyecto, 'public'), ...RUTAS_N8N.map(([, host]) => host), ...(rutaBiblioteca() ? [rutaBiblioteca()!] : [])]
app.get('/archivo', (req, res) => {
  const ruta = resolve(String(req.query.ruta || ''))
  if (!CARPETAS_PERMITIDAS().some((c) => ruta.startsWith(c + '/')) || !existsSync(ruta)) {
    res.status(404).json({ error: 'Archivo no disponible.' })
    return
  }
  // Los archivos de las ejecuciones viven en .fotograma/ (carpeta oculta): send los rechaza si no se permite.
  res.sendFile(ruta, { dotfiles: 'allow' }, (err) => {
    if (err && !res.headersSent) res.status(404).json({ error: 'Archivo no disponible.' })
  })
})

// Lo que generaron los flujos (imágenes de Cloudflare/Kie, videos, voces), por ejecución y más nuevo primero,
// para verlo en la pestaña Recursos. Solo lectura: se sirve con /archivo.
const MEDIOS_GENERADOS = /\.(png|jpe?g|webp|gif|avif|mp4|webm|mov|mp3|wav|ogg|m4a)$/i
app.get(
  '/generados',
  r(() => {
    if (!existsSync(R.DIR_ARCHIVOS)) return []
    const salida: { ruta: string; bytes: number; fecha: string; ejecucion: string; flujo: string }[] = []
    for (const ej of readdirSync(R.DIR_ARCHIVOS, { withFileTypes: true })) {
      if (!ej.isDirectory()) continue
      const dir = join(R.DIR_ARCHIVOS, ej.name)
      const flujo = leerEjecucion(ej.name)?.flujoNombre || 'Ejecución ' + ej.name
      const recorrer = (d: string, prof: number) => {
        for (const e of readdirSync(d, { withFileTypes: true })) {
          const p = join(d, e.name)
          if (e.isDirectory() && prof < 3) recorrer(p, prof + 1)
          else if (e.isFile() && MEDIOS_GENERADOS.test(e.name)) {
            const st = statSync(p)
            salida.push({ ruta: p, bytes: st.size, fecha: st.mtime.toISOString(), ejecucion: ej.name, flujo })
          }
        }
      }
      try {
        recorrer(dir, 0)
      } catch {}
    }
    return salida.sort((a, b) => b.fecha.localeCompare(a.fecha)).slice(0, 1000)
  }),
)

// Miniatura de un video (un cuadro en JPG, en caché): el lienzo no tiene que bajar videos enteros.
const permitido = (ruta: string) => CARPETAS_PERMITIDAS().some((c) => ruta.startsWith(c + '/')) && existsSync(ruta)
app.get('/miniatura', (req, res) => {
  const ruta = resolve(String(req.query.ruta || ''))
  if (!permitido(ruta)) {
    res.status(404).json({ error: 'Archivo no disponible.' })
    return
  }
  const clave = createHash('sha1').update(ruta + statSync(ruta).mtimeMs).digest('hex').slice(0, 16)
  const jpg = join(dirname(R.DIR_ARCHIVOS), 'miniaturas', clave + '.jpg')
  const enviar = () => res.sendFile(jpg, { dotfiles: 'allow', maxAge: '1d' }, (e) => e && !res.headersSent && res.status(404).end())
  if (existsSync(jpg)) return enviar()
  mkdirSync(dirname(jpg), { recursive: true })
  execFile(process.env.FOTOGRAMA_FFMPEG || 'ffmpeg', ['-v', 'error', '-y', '-ss', '1', '-i', ruta, '-frames:v', '1', '-vf', 'scale=320:-2', jpg], { timeout: 20_000 }, (e) =>
    e || !existsSync(jpg) ? res.status(404).json({ error: 'No se pudo sacar la miniatura.' }) : enviar(),
  )
})

// ───────── Webhooks ─────────
const webhook = (prueba: boolean) =>
  r(async (req, res) => {
    const ruta = String(req.params.ruta || '')
    const hit = buscarWebhook(ruta, req.method, prueba)
    if (!hit) {
      res.status(404).json({ error: `No hay un webhook ${req.method} activo en /${prueba ? 'webhook-test' : 'webhook'}/${ruta}.` })
      return
    }
    const datos = { body: req.body, query: req.query, headers: req.headers, metodo: req.method }
    const { id, fin } = await lanzar(hit.flujo, 'webhook', hit.nodo.id, datos)
    if (hit.nodo.params.respuesta === 'final') {
      const ej = await fin
      res.status(ej.estado === 'ok' ? 200 : 500).json(ej.estado === 'ok' ? ultimaSalida(ej) : { error: ej.error })
      return
    }
    return { ok: true, ejecucion: id }
  })
app.all('/webhook/:ruta', webhook(false))
app.all('/webhook-test/:ruta', webhook(true))
return app
}

// Arranca los triggers programados de los flujos activos.
export { sincronizarTodos }
