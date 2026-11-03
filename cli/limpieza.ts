// Pestaña «Limpiar» del estudio: tomas a cámara con su propuesta de cortes (limpiar.py) para revisar.
// Datos en <proyecto>/tutoriales/<slug>/ (transcripcion-original.json, propuesta.json); los videos crudos, en public/uploads.
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { filtroRuido, MODELO_RUIDO } from './render'

export type Corte = { id: number; a: number; b: number; tipo: string; motivo: string; texto: string; activo: boolean }
// Movido: el bloque [a, b] de la toma va después de la palabra que empieza en `despues` (edición por texto).
export type Movido = { a: number; b: number; despues: number }
export type Propuesta = { video: string; slug: string; duracion: number; cortes: Corte[]; movidos?: Movido[] }

const SLUG = /^[\w-]+$/

export const crearApiLimpieza = (proyecto: string) => {
  const datos = join(proyecto, 'tutoriales')
  const uploads = join(proyecto, 'public', 'uploads')
  const leerJson = (f: string) => (existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null)
  const carpeta = (slug: string) => {
    if (!SLUG.test(slug)) throw new Error('Nombre inválido.')
    return join(datos, slug)
  }

  // Las tomas que ya tienen transcripción o propuesta, la más nueva primero.
  const tomas = () =>
    (existsSync(datos) ? readdirSync(datos) : [])
      .filter((s) => SLUG.test(s) && (existsSync(join(datos, s, 'propuesta.json')) || existsSync(join(datos, s, 'transcripcion-original.json'))))
      .map((slug) => {
        const p: Propuesta | null = leerJson(join(datos, slug, 'propuesta.json'))
        const clip = join(proyecto, 'public', 'tutoriales', slug, 'clip.mp4')
        return {
          slug,
          propuesta: !!p,
          cortes: p?.cortes.length ?? 0,
          activos: p?.cortes.filter((c) => c.activo).length ?? 0,
          duracion: p?.duracion ?? 0,
          clip: existsSync(clip) ? statSync(clip).mtimeMs : null,
          fecha: statSync(join(datos, slug)).mtimeMs,
        }
      })
      .sort((a, b) => b.fecha - a.fecha)

  // Videos crudos subidos (public/uploads → disco externo) para empezar una toma nueva.
  const videos = () =>
    (existsSync(uploads) ? readdirSync(uploads) : [])
      .filter((f) => /\.(mp4|mov|m4v|webm)$/i.test(f))
      .map((f) => ({ nombre: f, ruta: join(realpathSync(uploads), f), bytes: statSync(join(uploads, f)).size, fecha: statSync(join(uploads, f)).mtimeMs }))
      .sort((a, b) => b.fecha - a.fecha)
      .slice(0, 60)

  const leer = (slug: string) => {
    const c = carpeta(slug)
    const propuesta: Propuesta | null = leerJson(join(c, 'propuesta.json'))
    const t = leerJson(join(c, 'transcripcion-original.json'))
    if (!propuesta && !t) throw new Error('Esa toma no existe.')
    return { slug, propuesta, palabras: (t?.palabras ?? []) as [string, number, number][], video: propuesta?.video ?? t?.video }
  }

  // Guarda la revisión: cortes (activos, manuales) y bloques movidos, todo dentro de la duración del video.
  const guardar = (slug: string, cortes: Corte[], movidos: Movido[] = []) => {
    const f = join(carpeta(slug), 'propuesta.json')
    const p: Propuesta | null = leerJson(f)
    if (!p) throw new Error('Esa toma todavía no tiene propuesta: analizala primero.')
    p.cortes = (cortes || [])
      .filter((c) => Number.isFinite(c.a) && Number.isFinite(c.b) && c.b > c.a && c.a >= 0 && c.a < p.duracion)
      .map((c, i) => ({ id: i + 1, a: +c.a, b: Math.min(+c.b, p.duracion), tipo: String(c.tipo || 'manual'), motivo: String(c.motivo || ''), texto: String(c.texto || ''), activo: !!c.activo }))
      .sort((x, y) => x.a - y.a)
    p.movidos = (movidos || [])
      .filter((m) => [m.a, m.b, m.despues].every(Number.isFinite) && m.b > m.a && m.a >= 0 && m.b <= p.duracion + 0.5 && !(m.a <= m.despues && m.despues <= m.b))
      .map((m) => ({ a: +m.a, b: +m.b, despues: +m.despues }))
    writeFileSync(f + '.tmp', JSON.stringify(p, null, 1))
    renameSync(f + '.tmp', f)
    return p
  }

  // El video crudo de la toma (para la vista previa): solo si está en uploads o es el que registró la transcripción.
  const videoDe = (slug: string) => {
    const v = leer(slug).video
    if (!v || !existsSync(v)) throw new Error('No encuentro el video de esa toma.')
    return resolve(v)
  }

  const videoPermitido = (ruta: string) => {
    if (!existsSync(ruta)) return false
    const r = realpathSync(ruta)
    return existsSync(uploads) && r.startsWith(realpathSync(uploads) + '/')
  }

  // Antes/después de quitar el ruido: 8 s desde `desde` para compararlos de oído (sin normalizar: loudnorm subiría el piso
  // de ruido, y RNNoise casi no cambia el volumen de la voz).
  const muestraRuido = (slug: string, nivel: string, desde: number) => {
    if (!['suave', 'normal', 'fuerte'].includes(nivel)) throw new Error('Nivel inválido.')
    if (nivel !== 'suave' && !existsSync(MODELO_RUIDO)) throw new Error(`Falta el modelo de ruido ${MODELO_RUIDO}.`)
    const video = videoDe(slug)
    const dir = join(proyecto, '.fotograma', 'ruido')
    mkdirSync(dir, { recursive: true })
    for (const [nombre, f] of [['antes', 'anull'], ['despues', filtroRuido(nivel)]]) {
      const r = spawnSync('ffmpeg', ['-v', 'error', '-y', '-ss', String(Math.max(0, desde)), '-t', '8', '-i', video, '-vn', '-ac', '1', '-af', f, '-ar', '48000', join(dir, `${slug}-${nombre}.wav`)], { encoding: 'utf8' })
      if (r.status !== 0) throw new Error('ffmpeg: ' + (r.stderr || '').slice(-300))
    }
    return { antes: `limpieza/${slug}/ruido/antes`, despues: `limpieza/${slug}/ruido/despues`, nivel, desde }
  }
  const archivoMuestra = (slug: string, cual: string) => {
    const f = join(proyecto, '.fotograma', 'ruido', `${carpeta(slug).split('/').pop()}-${cual === 'antes' ? 'antes' : 'despues'}.wav`)
    if (!existsSync(f)) throw new Error('No hay muestra.')
    return f
  }

  // LUTs .cube de public/luts (las de Clipmill y las que agregue el usuario).
  const dirLuts = join(proyecto, 'public', 'luts')
  const luts = () => (existsSync(dirLuts) ? readdirSync(dirLuts).filter((f) => /\.(cube|3dl)$/i.test(f)).sort() : [])
  const rutaLut = (nombre: string) => {
    if (!luts().includes(nombre)) throw new Error('Esa LUT no está en public/luts/.')
    return join(dirLuts, nombre)
  }

  return { tomas, videos, leer, guardar, videoDe, videoPermitido, muestraRuido, archivoMuestra, luts, rutaLut }
}
