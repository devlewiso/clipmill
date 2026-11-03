import { execFile } from 'node:child_process'
import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { ENTORNO_HERRAMIENTAS, HERRAMIENTAS_N8N } from '../rutas'
import { anotarPublicacion, listarBiblioteca } from '../../biblioteca'
import { basename, extname } from 'node:path'
import { telegramConfig, tokenOauth } from '../credenciales'
import type { Ejecutor } from '../motor'
import { conTimeout, porItem, recorte } from './util'
import { guardarTabla, leerTabla } from '../almacen'

const telegram: Ejecutor = async (c) => {
  const { token, chatId: chatGuardado } = telegramConfig()
  if (!token) throw new Error('Falta el token del bot en <herramientas>/telegram/token (FOTOGRAMA_HERRAMIENTAS).')
  const api = `https://api.telegram.org/bot${token}`
  return porItem(c, async (it, i) => {
    const chat = String(c.param('chatId', i) || chatGuardado).trim()
    if (!chat) throw new Error('Falta el chat ID.')
    const texto = String(c.param('texto', i) || '')
    let res: Response
    if (c.param('enviarArchivo', i) === true && it.archivo) {
      const esVideo = ['.mp4', '.mov', '.webm'].includes(extname(it.archivo).toLowerCase())
      const form = new FormData()
      form.set('chat_id', chat)
      form.set('caption', texto.slice(0, 1024))
      form.set(esVideo ? 'video' : 'document', new Blob([readFileSync(it.archivo)]), basename(it.archivo))
      res = await fetch(`${api}/${esVideo ? 'sendVideo' : 'sendDocument'}`, { method: 'POST', body: form, signal: conTimeout(c.senal, 300) })
    } else {
      res = await fetch(`${api}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chat, text: texto.slice(0, 4096) }),
        signal: conTimeout(c.senal, 30),
      })
    }
    const d: any = await res.json().catch(() => ({}))
    // El mensaje de error de Telegram nunca incluye el token, pero la URL sí: no se muestra.
    if (!d.ok) throw new Error(`Telegram: ${d.description || res.status}`)
    return { json: { enviado: true, mensajeId: d.result?.message_id }, archivo: it.archivo }
  })
}

export type OpcionesYoutube = {
  credencial: string
  titulo: string
  descripcion?: string
  tags?: string[]
  categoria?: string
  privacidad?: 'public' | 'unlisted' | 'private'
  idioma?: string
  notificar?: boolean
}

// Subida reanudable: primero se crea la sesión con los metadatos y luego se envía el video.
export const subirYoutube = async (archivo: string, o: OpcionesYoutube, senal?: AbortSignal, log: (m: string) => void = () => {}) => {
  const token = await tokenOauth(o.credencial)
  const tam = statSync(archivo).size
  const idioma = o.idioma || undefined
  const metadatos = {
    snippet: {
      title: o.titulo.slice(0, 100),
      description: (o.descripcion || '').slice(0, 5000),
      tags: o.tags || [],
      categoryId: o.categoria || '22',
      defaultLanguage: idioma,
      defaultAudioLanguage: idioma,
    },
    status: { privacyStatus: o.privacidad || 'private', selfDeclaredMadeForKids: false, embeddable: true },
  }
  const sesion = await fetch(`https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status&notifySubscribers=${o.notificar !== false}`, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + token,
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Type': 'video/*',
      'X-Upload-Content-Length': String(tam),
    },
    body: JSON.stringify(metadatos),
    signal: senal ? conTimeout(senal, 60) : AbortSignal.timeout(60_000),
  })
  const destino = sesion.headers.get('location')
  if (!sesion.ok || !destino) throw new Error(`YouTube no abrió la subida (${sesion.status}): ${recorte(await sesion.text())}`)
  log(`Subiendo ${(tam / 1e6).toFixed(1)} MB a YouTube…`)
  const subida = await fetch(destino, {
    method: 'PUT',
    headers: { 'Content-Type': 'video/*', 'Content-Length': String(tam) },
    body: readFileSync(archivo),
    signal: senal ? conTimeout(senal, 1800) : AbortSignal.timeout(1_800_000),
  })
  const d: any = await subida.json().catch(() => ({}))
  if (!subida.ok || !d.id) throw new Error(`YouTube rechazó el video (${subida.status}): ${recorte(JSON.stringify(d.error || d))}`)
  log(`Publicado: https://youtu.be/${d.id}`)
  return { id: d.id as string, url: `https://youtu.be/${d.id}`, estado: d.status?.uploadStatus as string, titulo: d.snippet?.title as string }
}

const youtube: Ejecutor = async (c) =>
  porItem(c, async (it, i) => {
    if (!it.archivo) throw new Error('El item no trae un video (usa Archivo → Leer, Render, Kie…).')
    const r = await subirYoutube(
      it.archivo,
      {
        credencial: String(c.param('credencial', i) || ''),
        titulo: String(c.param('titulo', i) || ''),
        descripcion: String(c.param('descripcion', i) || ''),
        tags: String(c.param('tags', i) || '').split(',').map((t) => t.trim()).filter(Boolean),
        categoria: String(c.param('categoria', i) || '22'),
        privacidad: (c.param('privacidad', i) as OpcionesYoutube['privacidad']) || 'private',
        idioma: String(c.param('idioma', i) || ''),
        notificar: c.param('notificar', i) !== false,
      },
      c.senal,
      c.log,
    )
    anotarPublicacion(it.archivo, 'youtube', { estado: 'publicado', url: r.url, id: r.id, cuenta: String(c.param('credencial', i) || '') })
    // uploadId: mismo nombre que devuelve el nodo de YouTube de n8n.
    return { json: { uploadId: r.id, ...r }, archivo: it.archivo }
  })

// TikTok con el script que ya usa n8n (Content Posting API, renueva el token solo).
export const publicarTiktok = async (archivo: string, texto: string, senal?: AbortSignal, publico = false) => {
  const caption = Buffer.from(texto.slice(0, 2200), 'utf8').toString('base64')
  const { stdout } = await promisify(execFile)('node', [join(HERRAMIENTAS_N8N, 'tiktok_post.js'), archivo, caption], {
    // Público solo si TikTok lo permite (app auditada); si no, el script publica en privado.
    env: { ...process.env, ...ENTORNO_HERRAMIENTAS, ...(publico ? { TIKTOK_PUBLIC: '1' } : {}) },
    timeout: 600_000,
    signal: senal,
  }).catch((e: any) => ({ stdout: String(e.stdout || ''), stderr: String(e.stderr || e.message) }))
  let r: any
  try {
    r = JSON.parse(stdout.trim().split('\n').pop() || '{}')
  } catch {
    throw new Error('TikTok no devolvió una respuesta válida: ' + recorte(stdout))
  }
  if (!r.ok) throw new Error('TikTok: ' + (r.error || 'falló la publicación'))
  return r as { ok: true; publish_id?: string; status?: string; privacy?: string }
}

const tiktok: Ejecutor = async (c) =>
  porItem(c, async (it, i) => {
    if (!it.archivo) throw new Error('El item no trae un video para publicar.')
    const r: any = await publicarTiktok(it.archivo, String(c.param('caption', i) || ''), c.senal)
    anotarPublicacion(it.archivo, 'tiktok', r.modo === 'draft' ? { estado: 'borrador', nota: 'En la bandeja de TikTok: terminar de publicar desde la app.' } : { estado: r.privacy === 'PUBLIC_TO_EVERYONE' ? 'publicado' : 'privado', id: r.post_id || r.publish_id })
    return { json: { ...it.json, tiktok: r }, archivo: it.archivo }
  })

// ───────── Tendencias del nicho (YouTube, solo lectura) ─────────
// Busca los videos más vistos de los últimos N días sobre el nicho y se los pasa al guionista como
// inspiración. Usa la API oficial con la credencial del canal: cada búsqueda gasta 100 de las 10,000
// unidades diarias gratis. Si algo falla, el flujo sigue sin tendencias (no se cae por esto).
const YT = 'https://www.googleapis.com/youtube/v3'
const segundosIso = (d = '') => {
  const m = d.match(/P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/) || []
  return (+(m[1] || 0)) * 86400 + (+(m[2] || 0)) * 3600 + (+(m[3] || 0)) * 60 + +(m[4] || 0)
}
const compacto = (n: number) => (n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? Math.round(n / 1e3) + 'K' : String(n))

const tendencias: Ejecutor = async (c) =>
  porItem(c, async (it, i) => {
    const busquedas = String(c.param('busquedas', i) || '')
      .split('\n')
      .map((b) => b.trim())
      .filter(Boolean)
      .slice(0, 6)
    const dias = Math.max(1, Number(c.param('dias', i)) || 30)
    const idioma = String(c.param('idioma', i) || '').trim()
    const duracion = String(c.param('duracion', i) || 'todos')
    const propio = String(c.param('canalPropio', i) || '').trim().toLowerCase()
    const cuantos = Math.max(3, Number(c.param('cuantos', i)) || 12)
    try {
      if (!busquedas.length) throw new Error('No hay búsquedas.')
      const headers = { Authorization: 'Bearer ' + (await tokenOauth(String(c.param('credencial', i) || ''))) }
      const desde = new Date(Date.now() - dias * 864e5).toISOString()
      const ids = new Map<string, string>() // id → búsqueda que lo encontró
      for (const q of busquedas) {
        // 50 resultados cuestan lo mismo que 1 (100 unidades por búsqueda).
        const p = new URLSearchParams({ part: 'snippet', q, type: 'video', order: 'viewCount', publishedAfter: desde, maxResults: '50' })
        if (duracion === 'cortos') p.set('videoDuration', 'short') // < 4 min
        if (idioma) p.set('relevanceLanguage', idioma)
        if (c.param('region', i)) p.set('regionCode', String(c.param('region', i)))
        const r = await fetch(`${YT}/search?${p}`, { headers, signal: conTimeout(c.senal, 30) })
        const d: any = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(`YouTube ${r.status}: ${recorte(d?.error?.message || '')}`)
        for (const x of d.items || []) if (x.id?.videoId && !ids.has(x.id.videoId)) ids.set(x.id.videoId, q)
      }
      const lista = [...ids.keys()]
      const videos: any[] = []
      for (let k = 0; k < lista.length; k += 50) {
        const r = await fetch(`${YT}/videos?part=snippet,statistics,contentDetails&id=${lista.slice(k, k + 50).join(',')}`, { headers, signal: conTimeout(c.senal, 30) })
        const d: any = await r.json().catch(() => ({}))
        for (const v of d.items || []) {
          const seg = segundosIso(v.contentDetails?.duration)
          const lang = String(v.snippet?.defaultAudioLanguage || v.snippet?.defaultLanguage || '')
          const edadDias = Math.max(1, (Date.now() - Date.parse(v.snippet.publishedAt)) / 864e5)
          const vistas = Number(v.statistics?.viewCount || 0)
          videos.push({
            titulo: v.snippet.title,
            canal: v.snippet.channelTitle,
            url: `https://youtu.be/${v.id}`,
            vistas,
            vistasPorDia: Math.round(vistas / edadDias),
            segundos: seg,
            idioma: lang,
            publicado: v.snippet.publishedAt.slice(0, 10),
            busqueda: ids.get(v.id),
          })
        }
      }
    const filtrados = videos
        .filter((v) => !propio || v.canal.toLowerCase() !== propio)
        .filter((v) => !idioma || !v.idioma || v.idioma.startsWith(idioma))
        .filter((v) => (duracion === 'cortos' ? v.segundos <= 180 : duracion === 'largos' ? v.segundos > 240 : true))
        .sort((a, b) => b.vistasPorDia - a.vistasPorDia)
      const top = filtrados.slice(0, cuantos)
      // Canales que más aparecen: los competidores del nicho.
      const porCanal = new Map<string, { canal: string; videos: number; vistas: number }>()
      for (const v of filtrados) {
        const x = porCanal.get(v.canal) || { canal: v.canal, videos: 0, vistas: 0 }
        x.videos++
        x.vistas += v.vistas
        porCanal.set(v.canal, x)
      }
      const competidores = [...porCanal.values()].sort((a, b) => b.vistas - a.vistas).slice(0, 10)
      const resumen = top.length
        ? top.map((v) => `- "${v.titulo}" (${v.canal}, ${compacto(v.vistas)} vistas, ${Math.round(v.segundos / 60) || '<1'} min)`).join('\n')
        : '(sin resultados)'
      const tabla = String(c.param('tabla', i) || '').trim()
      if (tabla) {
        const hoy = new Date().toISOString().slice(0, 10)
        const filas = leerTabla(tabla)
        for (const k of competidores) {
          const f: any = filas.find((x: any) => x.canal === k.canal)
          if (f) Object.assign(f, { visto: hoy, apariciones: (f.apariciones || 1) + 1, vistas: Math.max(f.vistas || 0, k.vistas) })
          else filas.push({ id: filas.length + 1, creado: new Date().toISOString(), canal: k.canal, apariciones: 1, vistas: k.vistas, primero: hoy, visto: hoy })
        }
        guardarTabla(tabla, filas)
      }
      c.log(`${busquedas.length} búsquedas · ${videos.length} videos · ${top.length} en el resumen`)
      return { json: { ...it.json, tendencias: resumen, tendenciasVideos: top, competidores } }
    } catch (e: any) {
      if (c.senal.aborted) throw e
      if (c.param('continuarSiFalla', i) === false) throw e
      c.log(`Sin tendencias: ${e.message}`)
      return { json: { ...it.json, tendencias: '(no disponible hoy)', tendenciasVideos: [], competidores: [] } }
    }
  })

// ───────── Siguiente del stock ─────────
// Toma de la biblioteca el video más viejo (o más nuevo) de un canal que todavía no está publicado en una
// plataforma. Lo usa el "Publicador": la fábrica llena el stock y esto lo va soltando a su ritmo.
const siguienteStock: Ejecutor = async (c) => {
  const canal = String(c.param('canal', 0) || '').trim()
  const plataforma = String(c.param('plataforma', 0) || 'youtube') as 'youtube' | 'tiktok' | 'facebook'
  const cuantos = Math.max(1, Number(c.param('cuantos', 0)) || 1)
  const lista = listarBiblioteca()
    .filter((v) => (!canal || v.canal === canal) && !['publicado', 'privado', 'borrador'].includes(v.plataformas[plataforma]?.estado || ''))
    .sort((a, b) => (c.param('orden', 0) === 'nuevo' ? b.fecha.localeCompare(a.fecha) : a.fecha.localeCompare(b.fecha)))
  c.log(`${lista.length} video(s) en el stock de ${canal || 'todos los canales'} sin publicar en ${plataforma}.`)
  if (!lista.length) return [[]] // sin stock: el flujo termina sin hacer nada
  return [
    lista.slice(0, cuantos).map((v) => ({
      json: { titulo: v.titulo, descripcion: v.descripcion, hashtags: v.hashtags || [], canal: v.canal, fecha: v.fecha, carpeta: v.carpeta, ruta: v.video, quedan: lista.length - 1 },
      archivo: v.video,
    })),
  ]
}

export const integraciones: Record<string, Ejecutor> = { telegram, youtube, tiktok, tendencias, siguienteStock }
