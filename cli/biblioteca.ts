// Biblioteca de videos terminados en el disco externo, organizada para publicar en cualquier red:
//   <biblioteca>/<canal>/<AAAA-MM>/<AAAA-MM-DD_HHMM>_<tema>/
//       video.mp4      el video final
//       miniatura.jpg  un frame para reconocerlo
//       info.json      título, descripción, hashtags y dónde está publicado (YouTube, TikTok, Facebook…)
//   <biblioteca>/indice.json y LEEME.md  resumen de todo (qué falta publicar en cada red)
import { execFile } from 'node:child_process'
import { copyFileSync, existsSync, linkSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { promisify } from 'node:util'

const sh = promisify(execFile)

export type Plataforma = 'youtube' | 'tiktok' | 'facebook' | 'instagram'

export type InfoVideo = {
  canal: string // carpeta del canal: mi-canal…
  titulo: string
  descripcion: string
  hashtags: string[]
  idioma: string
  fecha: string // ISO de cuando se hizo el video
  segundos?: number
  origen: 'n8n' | 'fotograma'
  guion?: string
  archivoOriginal?: string
  plataformas: Partial<Record<Plataforma, { estado: 'publicado' | 'programado' | 'borrador' | 'privado' | 'pendiente' | 'error'; url?: string; id?: string; cuenta?: string; pagina?: string; por?: string; fecha?: string; nota?: string }>>
}

const CONFIG = join(homedir(), '.config', 'fotograma', 'config.json')

// Canales de publicación: { "canales": { "mi-canal": { "cuenta": "YouTube - Mi canal", "categoria": "22" } } } en config.json.
export const leerCanales = (): Record<string, { cuenta: string; categoria?: string }> => {
  try {
    return JSON.parse(readFileSync(CONFIG, 'utf8')).canales || {}
  } catch {
    return {}
  }
}

export const rutaBiblioteca = (): string | null => {
  try {
    const c = JSON.parse(readFileSync(CONFIG, 'utf8'))
    if (c.biblioteca) return c.biblioteca
  } catch {}
  // O con la variable FOTOGRAMA_BIBLIOTECA; si no, no hay biblioteca.
  return process.env.FOTOGRAMA_BIBLIOTECA || null
}

export const slugTema = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/#\w+/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60) || 'video'

// Canal a partir del id del guion («mi-canal-…» → «mi-canal»); con cuenta de YouTube, su nombre en minúsculas.
export const canalDe = (cuentaYoutube?: string, id?: string) => {
  if (cuentaYoutube) return slugTema(cuentaYoutube.replace(/^YouTube\s*-\s*/i, '')) || 'otros'
  return (id || 'otros').split('-')[0] || 'otros'
}

const duracion = async (archivo: string) => {
  try {
    const { stdout } = await sh('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', archivo])
    return Math.round(parseFloat(stdout) * 10) / 10
  } catch {
    return undefined
  }
}

const miniatura = async (video: string, destino: string, seg: number) => {
  await sh('ffmpeg', ['-v', 'error', '-y', '-ss', String(Math.max(0.5, Math.min(seg, 3))), '-i', video, '-frames:v', '1', '-vf', 'scale=360:-2', '-q:v', '4', destino]).catch(() => {})
}

const escribirJson = (ruta: string, datos: unknown) => {
  writeFileSync(ruta + '.tmp', JSON.stringify(datos, null, 2))
  renameSync(ruta + '.tmp', ruta)
}

// Guarda un video en la biblioteca. Si está en el mismo disco usa un hardlink (no ocupa espacio extra).
export const archivarVideo = async (archivo: string, info: Omit<InfoVideo, 'segundos'>, opciones: { mover?: boolean } = {}) => {
  const bib = rutaBiblioteca()
  if (!bib) throw new Error('No hay biblioteca configurada (~/.config/fotograma/config.json → "biblioteca").')
  const f = new Date(info.fecha)
  const pad = (n: number) => String(n).padStart(2, '0')
  const carpeta = join(
    bib,
    info.canal,
    `${f.getFullYear()}-${pad(f.getMonth() + 1)}`,
    `${f.getFullYear()}-${pad(f.getMonth() + 1)}-${pad(f.getDate())}_${pad(f.getHours())}${pad(f.getMinutes())}_${slugTema(info.titulo)}`,
  )
  mkdirSync(carpeta, { recursive: true })
  const video = join(carpeta, 'video.mp4')
  if (!existsSync(video)) {
    try {
      linkSync(archivo, video)
    } catch {
      if (opciones.mover) {
        try {
          renameSync(archivo, video)
        } catch {
          copyFileSync(archivo, video)
        }
      } else copyFileSync(archivo, video)
    }
  }
  const segundos = await duracion(video)
  if (!existsSync(join(carpeta, 'miniatura.jpg'))) await miniatura(video, join(carpeta, 'miniatura.jpg'), 1.5)
  const previo: InfoVideo | null = existsSync(join(carpeta, 'info.json')) ? JSON.parse(readFileSync(join(carpeta, 'info.json'), 'utf8')) : null
  const completo: InfoVideo = { ...info, segundos, plataformas: { ...(previo?.plataformas || {}), ...info.plataformas } }
  escribirJson(join(carpeta, 'info.json'), completo)
  regenerarIndice()
  return { carpeta, video, info: completo }
}

// Anota dónde quedó publicado un video de la biblioteca (busca la carpeta por la ruta del video).
export const anotarPublicacion = (video: string, plataforma: Plataforma, datos: NonNullable<InfoVideo['plataformas'][Plataforma]>) => {
  const p = join(dirname(video), 'info.json')
  if (!existsSync(p)) return false
  const info: InfoVideo = JSON.parse(readFileSync(p, 'utf8'))
  info.plataformas[plataforma] = { ...datos, fecha: datos.fecha || new Date().toISOString() }
  escribirJson(p, info)
  regenerarIndice()
  return true
}

// Cambia los textos (título, descripción, hashtags) de un video que ya está en la biblioteca.
export const actualizarTextos = (video: string, textos: Partial<Pick<InfoVideo, 'titulo' | 'descripcion' | 'hashtags'>>) => {
  const p = join(dirname(video), 'info.json')
  if (!existsSync(p)) return false
  escribirJson(p, { ...JSON.parse(readFileSync(p, 'utf8')), ...textos })
  regenerarIndice()
  return true
}

export type EntradaIndice = InfoVideo & { carpeta: string; video: string }

export const listarBiblioteca = (): EntradaIndice[] => {
  const bib = rutaBiblioteca()
  if (!bib || !existsSync(bib)) return []
  const r: EntradaIndice[] = []
  for (const canal of readdirSync(bib)) {
    const dc = join(bib, canal)
    if (!statSync(dc).isDirectory()) continue
    for (const mes of readdirSync(dc)) {
      const dm = join(dc, mes)
      if (!statSync(dm).isDirectory()) continue
      for (const v of readdirSync(dm)) {
        const p = join(dm, v, 'info.json')
        if (existsSync(p)) r.push({ ...JSON.parse(readFileSync(p, 'utf8')), carpeta: join(dm, v), video: join(dm, v, 'video.mp4') })
      }
    }
  }
  return r.sort((a, b) => b.fecha.localeCompare(a.fecha))
}

const ESTADO: Record<string, string> = { publicado: '✅', programado: '🗓️', borrador: '📝', privado: '🔒', pendiente: '—', error: '⚠️' }

const NOMBRE = { youtube: 'YouTube', tiktok: 'TikTok', facebook: 'Facebook' } as const

// indice.json (para mí y para los flujos) y LEEME.md (para leerlo a mano).
export const regenerarIndice = () => {
  const bib = rutaBiblioteca()
  if (!bib) return
  const todos = listarBiblioteca()
  escribirJson(join(bib, 'indice.json'), {
    actualizado: new Date().toISOString(),
    videos: todos.map((v) => ({ canal: v.canal, fecha: v.fecha, titulo: v.titulo, carpeta: v.carpeta, plataformas: v.plataformas })),
  })
  const porCanal = new Map<string, EntradaIndice[]>()
  for (const v of todos) porCanal.set(v.canal, [...(porCanal.get(v.canal) || []), v])
  const filas = (l: EntradaIndice[]) =>
    l
      .map((v) => {
        const p = v.plataformas
        const yt = p.youtube?.url ? `[${ESTADO[p.youtube.estado]}](${p.youtube.url})` : ESTADO[p.youtube?.estado || 'pendiente']
        return `| ${v.fecha.slice(0, 10)} | ${v.titulo.replace(/\|/g, '/')} | ${yt} | ${ESTADO[p.tiktok?.estado || 'pendiente']} | ${ESTADO[p.facebook?.estado || 'pendiente']} | \`${v.carpeta.replace(bib + '/', '')}\` |`
      })
      .join('\n')
  const md = [
    '# Biblioteca de videos',
    '',
    `Actualizado: ${new Date().toLocaleString()}. Total: ${todos.length} videos.`,
    '',
    'Leyenda: ✅ publicado · 🗓️ programado · 📝 borrador · 🔒 privado · — pendiente · ⚠️ error',
    '',
    ...[...porCanal.entries()].flatMap(([canal, l]) => [
      `## ${canal} (${l.length})`,
      '',
      `Pendientes: ${(['youtube', 'tiktok', 'facebook'] as const).map((r) => `${NOMBRE[r]} ${l.filter((v) => (v.plataformas[r]?.estado || 'pendiente') === 'pendiente').length}`).join(' · ')}`,
      '',
      '| Fecha | Título | YouTube | TikTok | Facebook | Carpeta |',
      '|---|---|---|---|---|---|',
      filas(l),
      '',
    ]),
  ].join('\n')
  writeFileSync(join(bib, 'LEEME.md'), md)
}

// Archiva el render de un guion con sus datos de publicación. El archivo original se borra si se pudo copiar
// (así no queda duplicado en el proyecto).
export const archivarGuion = async (archivo: string, g: import('../src/guion/tipos').Guion) => {
  if (!rutaBiblioteca()) return null
  const pub = g.publicacion || {}
  const r = await archivarVideo(
    archivo,
    {
      canal: canalDe(pub.canal, g.id),
      titulo: pub.titulo || g.titulo,
      descripcion: pub.descripcion || '',
      hashtags: pub.hashtags || [],
      idioma: g.idioma,
      fecha: new Date().toISOString(),
      origen: 'fotograma',
      guion: g.id,
      plataformas: {},
    },
    { mover: true },
  )
  // Solo se borra el render temporal del proyecto (nunca algo fuera de out/ o .fotograma/archivos).
  if (existsSync(archivo) && archivo !== r.video && /\/(out|\.fotograma\/archivos)\//.test(archivo) && existsSync(r.video)) {
    try {
      const { unlinkSync } = await import('node:fs')
      unlinkSync(archivo)
    } catch {}
  }
  return r
}

// ───── Facebook Reels (los publica otra IA con la extensión de Chrome: no hay app de Facebook) ─────
// Lista de lo que falta subir, con el texto listo para pegar, y la marca de "ya se publicó".
export const pendientesFacebook = (canal?: string) =>
  listarBiblioteca()
    .filter((v) => (!canal || v.canal === canal) && !['publicado', 'programado'].includes(v.plataformas.facebook?.estado || '') && existsSync(v.video))
    .map((v) => ({
      video: v.video,
      miniatura: join(v.carpeta, 'miniatura.jpg'),
      canal: v.canal,
      titulo: v.titulo,
      texto: [v.titulo, v.descripcion, (v.hashtags || []).join(' ')].filter(Boolean).join('\n\n'),
      idioma: v.idioma,
      fecha: v.fecha,
      segundos: v.segundos,
      youtube: v.plataformas.youtube?.url,
      estadoFacebook: v.plataformas.facebook?.estado || 'pendiente',
    }))

export const marcarFacebook = (video: string, datos: { estado?: string; url?: string; pagina?: string; por?: string; nota?: string }) => {
  const bib = rutaBiblioteca()
  const ruta = resolve(video)
  if (!bib || !ruta.startsWith(resolve(bib) + '/')) throw new Error('Ese video no está en la biblioteca.')
  const estado = (['publicado', 'programado', 'pendiente', 'error'].includes(String(datos.estado)) ? datos.estado : 'publicado') as 'publicado' | 'programado' | 'pendiente' | 'error'
  if (!anotarPublicacion(ruta, 'facebook', { estado, url: datos.url || undefined, pagina: datos.pagina || undefined, por: datos.por || undefined, nota: datos.nota || undefined }))
    throw new Error('No encontré el info.json de ese video.')
  return { ok: true, video: ruta, estado }
}
