// Estudio: el servidor Vite + una pequeña API para renderizar desde la interfaz.
import { createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { basename, join, relative, resolve } from 'node:path'
import { crearApiGuiones } from './guiones'
import { crearCola, type Cola } from './cola'
import { analizarRitmo } from './ritmo'
import { abrirServidor, type OpcionesServidor } from './servidor'
import { chequeoOrigen } from './origen'

const leerCuerpo = (req: IncomingMessage) =>
  new Promise<any>((ok) => {
    let s = ''
    req.on('data', (d) => (s += d))
    req.on('end', () => {
      try {
        ok(JSON.parse(s || '{}'))
      } catch {
        ok({})
      }
    })
  })

const leerBytes = (req: IncomingMessage, max = 50_000_000) =>
  new Promise<Buffer>((ok, mal) => {
    const partes: Buffer[] = []
    let total = 0
    req.on('data', (d: Buffer) => {
      total += d.length
      if (total > max) mal(new Error('El archivo es demasiado grande (máx. 50 MB).'))
      else partes.push(d)
    })
    req.on('end', () => ok(Buffer.concat(partes)))
  })

// Archivos de public/ (para el panel de recursos), sin carpetas generadas por los guiones.
const listarPublicos = (dir: string, base = dir): { ruta: string; bytes: number }[] =>
  existsSync(dir)
    ? readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
        const p = join(dir, e.name)
        // Las carpetas pesadas (uploads, noticias…) son enlaces al disco externo: se siguen como carpetas.
        const esCarpeta = e.isDirectory() || (e.isSymbolicLink() && existsSync(p) && statSync(p).isDirectory())
        if (esCarpeta) return e.name === 'guiones' && dir === base ? [] : listarPublicos(p, base)
        return [{ ruta: '/' + relative(base, p), bytes: statSync(p).size }]
      })
    : []

const json = (res: ServerResponse, datos: unknown, codigo = 200) => {
  res.statusCode = codigo
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(datos))
}

export const iniciarEstudio = async (o: OpcionesServidor = {}) => {
  let cola: Cola | null = null
  let srv: Awaited<ReturnType<typeof abrirServidor>> | null = null
  let guiones: ReturnType<typeof crearApiGuiones> | null = null
  const proyecto = resolve(o.proyecto || process.cwd())

  srv = await abrirServidor({
    ...o,
    proyecto,
    recargaEnVivo: true,
    alRecibir: (server) => {
      // Primero: rechazar órdenes que vienen de otras páginas web (CSRF). Ver cli/origen.ts y docs/seguridad.md.
      server.middlewares.use(chequeoOrigen)
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url || '/', 'http://x')
        if (!url.pathname.startsWith('/__fotograma/api/')) return next()
        const ruta = url.pathname.slice('/__fotograma/api/'.length)
        try {
          // ───── Cola de trabajos (renders y retakes, de a uno) ─────
          if (!cola) return json(res, { error: 'El estudio está arrancando.' }, 503)
          if (ruta === 'trabajos') return json(res, cola.lista())
          if (ruta === 'cola/bases') return json(res, cola.bases(String(url.searchParams.get('composicion') || '')))
          if (req.method === 'POST' && ['render', 'retake', 'cancelar', 'cola/mover', 'cola/reintentar', 'cola/limpiar'].includes(ruta)) {
            const b = await leerCuerpo(req)
            if (ruta === 'render') return json(res, cola.encolar({ ...b, frames: Array.isArray(b.frames) ? b.frames : undefined }))
            if (ruta === 'retake') return json(res, cola.encolarRetake(b))
            if (ruta === 'cancelar') return json(res, cola.cancelar(Number(b.id)))
            if (ruta === 'cola/mover') return json(res, cola.mover(Number(b.id), b.a))
            if (ruta === 'cola/reintentar') return json(res, cola.reintentar(Number(b.id)))
            return (cola.limpiar(), json(res, { ok: true }))
          }
          // ───── Cámara lenta suave (interpolar un tramo de video de public/) ─────
          if (ruta === 'lento' && req.method === 'POST') return json(res, cola.encolarLento(await leerCuerpo(req)))
          // ───── Videos como datos (estándar de video): el inspector guarda las props en su JSON ─────
          if (ruta === 'video-datos' && req.method === 'PUT') {
            const b = await leerCuerpo(req)
            const archivo = String(b.archivo || '')
            // Solo los JSON de videos (carpetas en FOTOGRAMA_VIDEOS_DATOS, por defecto reels/ y videos/), nunca guiones, flujos ni tablas.
            const carpetas = (process.env.FOTOGRAMA_VIDEOS_DATOS || 'reels,videos').split(',').map((c) => c.trim().replace(/[^\w-]/g, '')).filter(Boolean)
            if (!new RegExp(`^(${carpetas.join('|')})/[\\w.-]+\\.json$`).test(archivo) || !b.props || typeof b.props !== 'object') throw new Error('Archivo no permitido.')
            const destino = join(srv!.proyecto, archivo)
            if (!existsSync(destino)) return json(res, { error: 'No existe.' }, 404)
            const viejo = JSON.parse(readFileSync(destino, 'utf8'))
            // La carpeta no viaja en las props: se conserva la del archivo.
            const nuevo = { ...(viejo.carpeta !== undefined ? { carpeta: viejo.carpeta } : {}), ...b.props }
            writeFileSync(destino, JSON.stringify(nuevo, null, 2) + '\n')
            return json(res, { ok: true })
          }
          // ───── Guiones ─────
          const g = (guiones ??= crearApiGuiones(srv!.proyecto))
          if (ruta === 'voces') return json(res, await g.voces(String(url.searchParams.get('proveedor') || 'kie-gemini')))
          if (ruta === 'guiones' && req.method === 'GET') return json(res, g.listar())
          if (ruta === 'guiones-completos') return json(res, g.todos())
          if (ruta === 'guiones' && req.method === 'POST') return json(res, g.crear(String((await leerCuerpo(req)).titulo || 'Guion nuevo')))
          const mg = ruta.match(/^guiones\/([\w-]+)(?:\/(imagen|audio|progreso))?$/)
          if (mg) {
            const [, id, accion] = mg
            if (!accion && req.method === 'GET') return json(res, g.leer(id))
            if (!accion && req.method === 'PUT') return json(res, g.guardar(id, await leerCuerpo(req)))
            if (!accion && req.method === 'DELETE') return (g.borrar(id), json(res, { ok: true }))
            if (accion === 'imagen' && req.method === 'POST')
              return json(res, g.subirImagen(id, String(url.searchParams.get('personaje')), String(url.searchParams.get('nombre') || 'imagen.png'), await leerBytes(req)))
            if (accion === 'audio' && req.method === 'POST') return json(res, g.generarAudio(id))
            if (accion === 'progreso') return json(res, g.progreso(id) ?? null)
          }

          // ───── Ritmo de una canción de public/ → <audio>.ritmo.json al lado (para fotograma/ritmo) ─────
          if (ruta === 'ritmo' && req.method === 'POST') {
            const b = await leerCuerpo(req)
            const publico = join(srv!.proyecto, 'public')
            const archivo = resolve(publico, String(b.archivo || '').replace(/^\/+/, ''))
            if (!archivo.startsWith(publico + '/') || !/\.(mp3|wav|m4a|ogg|flac|aac)$/i.test(archivo) || !existsSync(archivo)) throw new Error('Elegí un audio de public/.')
            const r = await analizarRitmo(archivo)
            const destino = archivo.replace(/\.\w+$/, '') + '.ritmo.json'
            writeFileSync(destino, JSON.stringify(r))
            return json(res, { ...r, json: '/' + relative(publico, destino) })
          }

          // ───── Recursos de public/ ─────
          if (ruta === 'recursos' && req.method === 'GET') return json(res, listarPublicos(join(srv!.proyecto, 'public')))
          if (ruta === 'recursos' && req.method === 'POST') {
            const nombre = basename(String(url.searchParams.get('nombre') || 'archivo')).replace(/[^\w.\- ]/g, '_')
            const dir = join(srv!.proyecto, 'public')
            mkdirSync(dir, { recursive: true })
            writeFileSync(join(dir, nombre), await leerBytes(req))
            return json(res, { ruta: '/' + nombre })
          }

          // Descarga/vista previa de los renders (solo dentro de out/).
          if (ruta === 'archivo') {
            const archivo = resolve(String(url.searchParams.get('ruta') || ''))
            if (!archivo.startsWith(join(srv!.proyecto, 'out') + '/') || !existsSync(archivo)) return json(res, { error: 'No existe.' }, 404)
            res.setHeader('Content-Length', String(statSync(archivo).size))
            return createReadStream(archivo).pipe(res)
          }
          json(res, { error: 'Ruta desconocida.' }, 404)
        } catch (e: any) {
          json(res, { error: e.message }, 400)
        }
      })
    },
  })
  guiones = crearApiGuiones(srv.proyecto)
  cola = crearCola({ proyecto: srv.proyecto, servidor: srv, guiones: () => guiones! })
  return srv
}
