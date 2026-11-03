// Estudio: el servidor Vite + una pequeña API para renderizar desde la interfaz.
import { createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { basename, join, relative, resolve } from 'node:path'
import { crearApiGuiones } from './guiones'
import { crearApiPublicar } from './publicar'
import { marcarFacebook, pendientesFacebook } from './biblioteca'
import { crearApiFlujos, sincronizarTodos } from './flujos/api'
import { crearAgente } from './agente'
import { estudio } from './flujos/contexto'
import { iniciarRutas } from './flujos/rutas'
import { crearCola, type Cola } from './cola'
import { crearRemoto, enviarVideo, type Remoto } from './remoto'
import { crearApiLimpieza } from './limpieza'
import { analizarRitmo } from './ritmo'
import { abrirServidor, type OpcionesServidor } from './servidor'

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
  let remoto: Remoto | null = null
  let srv: Awaited<ReturnType<typeof abrirServidor>> | null = null
  let guiones: ReturnType<typeof crearApiGuiones> | null = null
  let agenteEstudio: ReturnType<typeof crearAgente> | null = null
  const proyecto = resolve(o.proyecto || process.cwd())
  iniciarRutas(proyecto)
  const limpieza = crearApiLimpieza(proyecto)
  const flujos = crearApiFlujos()
  const publicar = crearApiPublicar(proyecto)

  srv = await abrirServidor({
    ...o,
    proyecto,
    recargaEnVivo: true,
    alRecibir: (server) => {
      // Flujos (editor tipo n8n) y sus webhooks públicos.
      server.middlewares.use('/__fotograma/flujos', flujos)
      server.middlewares.use((req, res, next) => (/^\/webhook(-test)?\//.test(req.url || '') ? flujos(req as any, res as any, next) : next()))
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
          // ───── Limpiar tomas a cámara (muletillas, tomas repetidas…) ─────
          if (ruta === 'limpieza') return json(res, { tomas: limpieza.tomas(), videos: limpieza.videos(), luts: limpieza.luts() })
          const mr = ruta.match(/^limpieza\/([\w-]+)\/ruido(?:\/(antes|despues))?$/)
          if (mr) {
            if (!mr[2] && req.method === 'POST') {
              const b = await leerCuerpo(req)
              return json(res, limpieza.muestraRuido(mr[1], String(b.nivel), Number(b.desde) || 0))
            }
            if (mr[2]) return enviarVideo(req, res, limpieza.archivoMuestra(mr[1], mr[2]))
          }
          const ml = ruta.match(/^limpieza\/([\w-]+)(?:\/(video|analizar|aplicar))?$/)
          if (ml) {
            const [, slug, accion] = ml
            if (!accion && req.method === 'GET') return json(res, limpieza.leer(slug))
            if (!accion && req.method === 'PUT') {
              const b = await leerCuerpo(req)
              return json(res, limpieza.guardar(slug, b.cortes, b.movidos))
            }
            if (accion === 'video') return enviarVideo(req, res, limpieza.videoDe(slug))
            if (accion === 'analizar' && req.method === 'POST') {
              const b = await leerCuerpo(req)
              const video = b.video ? String(b.video) : limpieza.videoDe(slug)
              if (b.video && !limpieza.videoPermitido(video)) throw new Error('El video tiene que estar en uploads/.')
              return json(res, cola.encolarLimpieza({ accion: 'analizar', slug, video, retranscribir: !!b.retranscribir }))
            }
            if (accion === 'aplicar' && req.method === 'POST') {
              const b = await leerCuerpo(req)
              return json(res, cola.encolarLimpieza({ accion: 'aplicar', slug, video: limpieza.videoDe(slug), look: ['natural', 'cine', 'noche'].includes(b.look) ? b.look : 'natural', pausa: Number(b.pausa) || 0.3, audio: b.audio === 'original' ? 'original' : 'pro', destino: b.destino === 'noticiero' ? 'noticiero' : 'tutorial', ruido: ['no', 'suave', 'normal', 'fuerte'].includes(b.ruido) ? b.ruido : 'suave', lut: b.lut ? limpieza.rutaLut(String(b.lut)) : undefined }))
            }
          }
          // ───── Reencuadrar un video a otro formato siguiendo la cara ─────
          if (ruta === 'reencuadrar' && req.method === 'POST') {
            const b = await leerCuerpo(req)
            if (!limpieza.videoPermitido(String(b.video || '')) && !publicar.permitido(String(b.video || ''))) throw new Error('El video tiene que estar en uploads/, out/ o la biblioteca.')
            return json(res, cola.encolarReencuadre({ video: String(b.video), formato: b.formato, zoom: b.zoom }))
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
          // ───── Remoto (el estudio desde el teléfono) ─────
          if (ruta === 'remoto' && remoto) return json(res, remoto.estado())
          if (ruta.startsWith('remoto/') && req.method === 'POST' && remoto) {
            const b = await leerCuerpo(req)
            if (ruta === 'remoto/activar') return json(res, await remoto.activar(!!b.activo))
            if (ruta === 'remoto/codigo') return json(res, await remoto.nuevoCodigo())
            if (ruta === 'remoto/revocar') return json(res, remoto.revocar(String(b.id || '')))
          }

          // ───── Guiones ─────
          const g = (guiones ??= crearApiGuiones(srv!.proyecto))
          // ───── Asistente (chat con herramientas) ─────
          if (ruta === 'agente' && req.method === 'POST') {
            const cuerpo = await leerCuerpo(req)
            const agente = (agenteEstudio ??= crearAgente(srv!.proyecto, () => guiones!))
            return json(res, await agente.conversar(cuerpo.historial || [], cuerpo.contexto || {}, cuerpo.decision))
          }
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

          // ───── Facebook Reels: los sube otra IA (extensión de Chrome); aquí solo la cola y la marca ─────
          if (ruta === 'facebook/pendientes') return json(res, pendientesFacebook(url.searchParams.get('canal') || undefined))
          if (ruta === 'facebook/marcar' && req.method === 'POST') {
            const b = await leerCuerpo(req)
            return json(res, marcarFacebook(String(b.video || ''), b))
          }

          // ───── Publicar en YouTube / TikTok ─────
          if (ruta === 'videos') return json(res, { videos: publicar.videos(), canales: publicar.canales(), tiktok: publicar.tiktokDisponible(), enCurso: publicar.publicaciones() })
          if (ruta === 'publicar' && req.method === 'POST') return json(res, publicar.publicar(await leerCuerpo(req)))
          if (ruta === 'video') {
            const archivo = String(url.searchParams.get('ruta') || '')
            if (!publicar.permitido(archivo)) return json(res, { error: 'No existe.' }, 404)
            res.setHeader('Content-Type', 'video/mp4')
            res.setHeader('Content-Length', String(statSync(archivo).size))
            return createReadStream(archivo).pipe(res)
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
            if (!(archivo.startsWith(join(srv!.proyecto, 'out') + '/') || publicar.permitido(archivo)) || !existsSync(archivo)) return json(res, { error: 'No existe.' }, 404)
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
  estudio.cola = cola
  remoto = crearRemoto({ proyecto: srv.proyecto, cola, agente: () => (agenteEstudio ??= crearAgente(srv!.proyecto, () => guiones!)) })
  estudio.servidor = srv
  estudio.guiones = guiones
  sincronizarTodos()
  return srv
}
