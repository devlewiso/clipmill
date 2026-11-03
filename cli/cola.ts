// Cola única de trabajos del estudio (renders y retakes): corre de a uno, se puede reordenar y cancelar,
// y sobrevive a los reinicios (se guarda en <proyecto>/.fotograma/cola.json). Lo que estaba corriendo
// cuando se apagó el estudio vuelve a «pendiente» y arranca de nuevo.
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { archivarGuion, rutaBiblioteca } from './biblioteca'
import type { crearApiGuiones } from './guiones'
import { avisarPixi, duracionHablada } from './pixi'
import { listarComposiciones, renderizar, type Codec, type InfoComposicion, type Progreso } from './render'
import { RAIZ_FOTOGRAMA, type abrirServidor } from './servidor'

export type Origen = 'estudio' | 'asistente' | 'remoto'
export type Estado = 'pendiente' | 'corriendo' | 'listo' | 'error' | 'cancelado'

export type Trabajo = {
  id: number
  tipo: 'render' | 'retake' | 'limpieza' | 'reencuadre' | 'lento'
  composicion: string
  codec: Codec
  salida: string
  estado: Estado
  progreso: Progreso
  origen: Origen
  opciones: {
    props?: Record<string, any>
    frame?: number
    frames?: [number, number]
    calidad?: number
    escala?: number
    base?: string // retake: el video al que se le reemplaza el tramo
    limpieza?: PedidoLimpieza // limpieza: analizar la toma (limpiar.py) o aplicar los cortes (tutorial.py)
    reencuadre?: PedidoReencuadre // reencuadre: otro formato siguiendo la cara (reencuadrar.py)
    lento?: PedidoLento & { publico?: string } // cámara lenta suave: cuadros interpolados con minterpolate
  }
  error?: string
  creado: number
  inicio: number // cuándo empezó a correr (o se creó, mientras espera)
  fin?: number
  posicion?: number // solo en la respuesta: lugar en la fila de pendientes (1 = el siguiente)
}

export type PedidoRender = { id: string; props?: Record<string, any>; codec?: Codec; frame?: number; frames?: [number, number]; calidad?: number; escala?: number }
export type PedidoLimpieza = { accion: 'analizar' | 'aplicar'; slug: string; video: string; retranscribir?: boolean; look?: string; pausa?: number; audio?: 'pro' | 'original'; destino?: 'tutorial' | 'noticiero'; ruido?: 'no' | 'suave' | 'normal' | 'fuerte'; lut?: string }
export type PedidoReencuadre = { video: string; formato: '9:16' | '4:5' | '1:1' | '16:9'; zoom?: number }
export type PedidoLento = { src: string; desde: number; segundos: number; velocidad: number; fps?: number; guion?: string } // src: ruta pública; fps: los de la composición; guion: id a actualizar al terminar
export type PedidoRetake = { id: string; base: string; frames: [number, number]; props?: Record<string, any>; calidad?: number }

const EXT: Record<Codec, string> = { h264: 'mp4', vp9: 'webm', prores: 'mov', gif: 'gif', png: 'png' }
const MAX_TERMINADOS = 200
const FFMPEG = process.env.FOTOGRAMA_FFMPEG || 'ffmpeg'
// Python con faster-whisper instalado (pip install faster-whisper). Configurable con FOTOGRAMA_PY.
const PY = process.env.FOTOGRAMA_PY || 'python3'
const SCRIPTS = join(RAIZ_FOTOGRAMA, 'skills', 'editor-videos', 'scripts')
const marca = () => new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-')

const correr = (bin: string, args: string[], senal?: AbortSignal) =>
  new Promise<string>((ok, mal) => {
    const p = spawn(bin, args, { signal: senal })
    let out = ''
    let err = ''
    p.stdout.on('data', (d) => (out += d))
    p.stderr.on('data', (d) => (err = (err + d).slice(-4000)))
    p.on('error', (e: Error) => mal(new Error(`No se pudo ejecutar ${bin}: ${e.message}`)))
    p.on('close', (c) => (c === 0 ? ok(out) : mal(new Error(`${bin} falló:\n${err}`))))
  })

const medidas = async (archivo: string) => {
  const s = JSON.parse(await correr('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height:format=duration', '-of', 'json', archivo]))
  return { ancho: Number(s.streams?.[0]?.width), alto: Number(s.streams?.[0]?.height), duracion: Number(s.format?.duration) }
}

export const crearCola = (o: { proyecto: string; servidor: Awaited<ReturnType<typeof abrirServidor>>; guiones: () => ReturnType<typeof crearApiGuiones> }) => {
  const archivo = join(o.proyecto, '.fotograma', 'cola.json')
  const out = resolve(o.proyecto, 'out')
  let trabajos: Trabajo[] = []
  try {
    trabajos = JSON.parse(readFileSync(archivo, 'utf8'))
  } catch {}
  for (const t of trabajos)
    if (t.estado === 'corriendo') Object.assign(t, { estado: 'pendiente', progreso: { etapa: 'preparando', hechos: 0, total: 0, mensaje: 'Se reinició el estudio: vuelve a empezar.' } })

  const controles = new Map<number, AbortController>()
  const oyentes = new Set<(t: Trabajo) => void>()

  const guardar = () => {
    mkdirSync(join(o.proyecto, '.fotograma'), { recursive: true })
    // Se recortan los terminados más viejos; los pendientes nunca se pierden.
    const terminados = trabajos.filter((t) => t.estado !== 'pendiente' && t.estado !== 'corriendo')
    if (terminados.length > MAX_TERMINADOS) {
      const fuera = new Set(terminados.slice(0, terminados.length - MAX_TERMINADOS).map((t) => t.id))
      trabajos = trabajos.filter((t) => !fuera.has(t.id))
    }
    writeFileSync(archivo + '.tmp', JSON.stringify(trabajos, null, 1))
    renameSync(archivo + '.tmp', archivo)
  }

  const pendientes = () => trabajos.filter((t) => t.estado === 'pendiente')
  const buscar = (id: number) => {
    const t = trabajos.find((x) => x.id === Number(id))
    if (!t) throw new Error(`No existe el trabajo ${id}.`)
    return t
  }
  const cambiar = (t: Trabajo, cambios: Partial<Trabajo>) => {
    Object.assign(t, cambios)
    guardar()
    oyentes.forEach((f) => f(t))
  }

  // Lista de composiciones (abre Chrome, así que se guarda unos minutos).
  let cache: { cuando: number; lista: InfoComposicion[] } | null = null
  const composiciones = async (fresca = false) => {
    if (!fresca && cache && Date.now() - cache.cuando < 10 * 60_000) return cache.lista
    cache = { cuando: Date.now(), lista: await listarComposiciones({ servidor: o.servidor }) }
    return cache.lista
  }

  const nuevo = (t: Omit<Trabajo, 'id' | 'estado' | 'progreso' | 'creado' | 'inicio'>): Trabajo => {
    const ahora = Date.now()
    const x: Trabajo = { ...t, id: Math.max(0, ...trabajos.map((y) => y.id)) + 1, estado: 'pendiente', progreso: { etapa: 'preparando', hechos: 0, total: 0 }, creado: ahora, inicio: ahora }
    trabajos.push(x)
    guardar()
    oyentes.forEach((f) => f(x))
    setTimeout(siguiente, 0)
    return x
  }

  const encolar = (p: PedidoRender, origen: Origen = 'estudio') => {
    if (!p.id) throw new Error('Falta la composición.')
    const codec: Codec = p.codec || 'h264'
    return nuevo({
      tipo: 'render',
      composicion: p.id,
      codec,
      origen,
      salida: join(out, `${p.id}-${marca()}.${EXT[codec]}`),
      opciones: { props: p.props, frame: p.frame, frames: p.frames, calidad: p.calidad, escala: p.escala },
    })
  }

  // Retake: vuelve a renderizar solo el tramo [desde, hasta] y lo pega sobre un video ya renderizado.
  // El resultado es un archivo nuevo en out/ (el video base, aunque esté en la biblioteca, no se toca).
  const encolarRetake = (p: PedidoRetake, origen: Origen = 'estudio') => {
    if (!p.id) throw new Error('Falta la composición.')
    const bib = rutaBiblioteca()
    const base = resolve(String(p.base || ''))
    if (!existsSync(base) || !/\.mp4$/i.test(base) || ![out, ...(bib ? [bib] : [])].some((d) => base.startsWith(d + '/')))
      throw new Error('El video base del retake tiene que ser un MP4 de out/ o de la biblioteca.')
    const [a, b] = p.frames || []
    if (!(Number.isInteger(a) && Number.isInteger(b) && b >= a && a >= 0)) throw new Error('El tramo del retake no es válido.')
    const nombre = base.split('/').pop()!.replace(/(-retake-[\d-]+)?\.\w+$/, '')
    return nuevo({
      tipo: 'retake',
      composicion: p.id,
      codec: 'h264',
      origen,
      salida: join(out, `${nombre === 'video' ? p.id : nombre}-retake-${marca()}.mp4`),
      opciones: { props: p.props, frames: [a, b], calidad: p.calidad, base },
    })
  }

  // Limpieza de una toma a cámara: 'analizar' propone cortes (muletillas, tomas repetidas…), 'aplicar' arma el clip limpio.
  const encolarLimpieza = (p: PedidoLimpieza, origen: Origen = 'estudio') => {
    if (!/^[\w-]+$/.test(p.slug || '')) throw new Error('El nombre (slug) solo puede tener letras, números y guiones.')
    if (!p.video || !existsSync(p.video)) throw new Error('No encuentro el video de la toma.')
    return nuevo({
      tipo: 'limpieza',
      composicion: `${p.accion === 'analizar' ? 'Analizar' : 'Limpiar'} · ${p.slug}`,
      codec: 'h264',
      origen,
      // Noticiero: la toma limpia (sin color, audio original) va a uploads/ con nombre nuevo, para preparar.py.
      salida:
        p.accion === 'analizar'
          ? join(o.proyecto, 'tutoriales', p.slug, 'propuesta.json')
          : p.destino === 'noticiero'
            ? join(o.proyecto, 'public', 'uploads', `${p.slug}-limpio-${marca()}.mp4`)
            : join(o.proyecto, 'public', 'tutoriales', p.slug, 'clip.mp4'),
      opciones: { limpieza: p },
    })
  }

  // Reencuadre: el video a otro formato siguiendo la cara → out/<nombre>-<formato>-<fecha>.mp4 (el original no se toca).
  const encolarReencuadre = (p: PedidoReencuadre, origen: Origen = 'estudio') => {
    if (!p.video || !existsSync(p.video)) throw new Error('No encuentro el video.')
    if (!['9:16', '4:5', '1:1', '16:9'].includes(p.formato)) throw new Error('Formato inválido.')
    const nombre = p.video.split('/').pop()!.replace(/\.\w+$/, '')
    return nuevo({
      tipo: 'reencuadre',
      composicion: `Reencuadrar ${p.formato} · ${nombre}`,
      codec: 'h264',
      origen,
      salida: join(out, `${nombre}-${p.formato.replace(':', 'x')}-${marca()}.mp4`),
      opciones: { reencuadre: { video: p.video, formato: p.formato, zoom: Math.min(2, Math.max(1, Number(p.zoom) || 1)) } },
    })
  }

  // Cámara lenta suave: el tramo [desde, desde + segundos] del video, a fps / velocidad con cuadros interpolados, en
  // public/lento/ (enlace al disco externo). Reproducido a `velocidad`, da cuadros nuevos en vez de repetidos.
  const encolarLento = (p: PedidoLento, origen: Origen = 'estudio') => {
    const publico = join(o.proyecto, 'public')
    const archivo = resolve(publico, String(p.src || '').replace(/^\/+/, ''))
    if (!archivo.startsWith(publico + '/') || !existsSync(archivo) || !/\.(mp4|mov|webm|m4v)$/i.test(archivo)) throw new Error('El video tiene que estar en public/.')
    const v = Number(p.velocidad)
    if (!(v >= 0.2 && v < 1)) throw new Error('La cámara lenta suave es para velocidades menores a 1.')
    const nombre = `${archivo.split('/').pop()!.replace(/\.\w+$/, '')}-${Number(p.desde).toFixed(2)}-${v}.mp4`.replace(/[^\w.-]+/g, '_')
    return nuevo({
      tipo: 'lento',
      composicion: `Cámara lenta ${v}× · ${archivo.split('/').pop()}`,
      codec: 'h264',
      origen,
      salida: join(publico, 'lento', nombre),
      opciones: { lento: { src: archivo, desde: Math.max(0, Number(p.desde) || 0), segundos: Math.max(0.2, Number(p.segundos) || 1), velocidad: v, fps: Number(p.fps) || 30, guion: p.guion ? String(p.guion) : undefined, publico: String(p.src) } },
    })
  }

  // Videos que sirven de base para un retake: los renders MP4 completos de esa composición que todavía existen
  // (los de la cola y los que haya en out/ hechos con la CLI, p. ej. MotoEvolucion-ES.mp4).
  const bases = (composicion: string) => {
    const deCola = trabajos
      .filter((t) => t.composicion === composicion && t.estado === 'listo' && t.codec === 'h264' && (t.tipo === 'retake' || !t.opciones.frames) && existsSync(t.salida))
      .map((t) => ({ ruta: t.salida, fecha: t.fin ?? t.inicio, retake: t.tipo === 'retake' }))
    const enOut = existsSync(out)
      ? readdirSync(out)
          .filter((f) => (f === composicion + '.mp4' || (f.startsWith(composicion + '-') && /^[\d-]+(-retake-[\d-]+)?\.mp4$|^retake-[\d-]+\.mp4$/.test(f.slice(composicion.length + 1)))) && !f.includes('.tramo.'))
          .map((f) => ({ ruta: join(out, f), fecha: statSync(join(out, f)).mtimeMs, retake: f.includes('-retake-') }))
      : []
    const vistos = new Set<string>()
    return [...deCola, ...enOut].filter((x) => !vistos.has(x.ruta) && vistos.add(x.ruta)).sort((a, b) => b.fecha - a.fecha)
  }

  const ejecutarRender = async (t: Trabajo, senal: AbortSignal) => {
    await renderizar({
      composicion: t.composicion,
      props: t.opciones.props,
      codec: t.codec,
      frame: t.opciones.frame,
      frames: t.opciones.frames,
      calidad: t.opciones.calidad,
      escala: t.opciones.escala,
      salida: t.salida,
      servidor: o.servidor,
      senal,
      alProgresar: (p) => (t.progreso = p),
    })
    // Los guiones renderizados completos también van a la biblioteca.
    const idGuion = t.composicion.match(/^Guion-(.+)$/)?.[1]
    if (idGuion && t.codec !== 'png' && !t.opciones.frames) {
      const a = await archivarGuion(t.salida, o.guiones().leer(idGuion)).catch(() => null)
      if (a) t.salida = a.video
    }
  }

  const ejecutarRetake = async (t: Trabajo, senal: AbortSignal) => {
    const base = t.opciones.base!
    const [a, b] = t.opciones.frames!
    const tramo = t.salida.replace(/\.mp4$/, '.tramo.mp4')
    const { info } = (await renderizar({
      composicion: t.composicion,
      props: t.opciones.props,
      codec: 'h264',
      frames: [a, b],
      calidad: t.opciones.calidad,
      salida: tramo,
      servidor: o.servidor,
      senal,
      alProgresar: (p) => (t.progreso = p),
    })) as { info: InfoComposicion }
    t.progreso = { etapa: 'codificando', hechos: 0, total: 0, mensaje: 'Pegando el tramo en el video' }
    const m = await medidas(base)
    const esperado = info.duracion / info.fps
    if (Math.abs(m.duracion - esperado) > 0.25)
      throw new Error(`El video base dura ${m.duracion.toFixed(2)} s y la composición ${esperado.toFixed(2)} s: cambió la duración, renderizá completo.`)
    const t0 = a / info.fps
    const t1 = (b + 1) / info.fps
    const partes: string[] = []
    const filtros: string[] = []
    if (a > 0) (filtros.push(`[0:v]trim=end=${t0.toFixed(4)},setpts=PTS-STARTPTS[v0]`), partes.push('[v0]'))
    filtros.push(`[1:v]scale=${m.ancho}:${m.alto},setsar=1,fps=${info.fps},setpts=PTS-STARTPTS[v1]`)
    partes.push('[v1]')
    if (t1 < m.duracion - 0.5 / info.fps) (filtros.push(`[0:v]trim=start=${t1.toFixed(4)},setpts=PTS-STARTPTS[v2]`), partes.push('[v2]'))
    filtros.push(`${partes.join('')}concat=n=${partes.length}:v=1:a=0[v]`)
    // El audio se conserva tal cual del video base: el retake cambia la imagen, no el tiempo.
    await correr(
      FFMPEG,
      ['-y', '-hide_banner', '-loglevel', 'error', '-i', base, '-i', tramo, '-filter_complex', filtros.join(';'), '-map', '[v]', '-map', '0:a?',
        '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', String(t.opciones.calidad ?? 20), '-maxrate', '12M', '-bufsize', '24M', '-preset', 'fast',
        '-c:a', 'copy', '-movflags', '+faststart', t.salida],
      senal,
    )
    rmSync(tramo, { force: true }) // el tramo intermedio es nuestro y vive en out/
  }

  // Scripts de Python de la skill editor-videos (limpiar / tutorial / reencuadrar): la última línea de su salida es el progreso.
  const ejecutarPython = (t: Trabajo, senal: AbortSignal) =>
    new Promise<void>((ok, mal) => {
      const r = t.opciones.reencuadre
      const l = t.opciones.limpieza
      const args = r
        ? [join(SCRIPTS, 'reencuadrar.py'), r.video, t.salida, '--formato', r.formato, '--zoom', String(r.zoom ?? 1)]
        : l!.accion === 'analizar'
          ? [join(SCRIPTS, 'limpiar.py'), l!.video, '--slug', l!.slug, ...(l!.retranscribir ? ['--retranscribir'] : [])]
          : l!.destino === 'noticiero'
            ? [join(SCRIPTS, 'tutorial.py'), l!.video, '--slug', l!.slug, '--propuesta', '--look', 'ninguno', '--pausa', String(l!.pausa ?? 0.3), '--audio', 'original', '--ruido', l!.ruido || 'suave', '--salida', t.salida]
            : [join(SCRIPTS, 'tutorial.py'), l!.video, '--slug', l!.slug, '--propuesta', '--look', l!.look || 'natural', '--pausa', String(l!.pausa ?? 0.3), '--audio', l!.audio || 'pro', '--ruido', l!.ruido || 'suave', ...(l!.lut ? ['--lut', l!.lut] : [])]
      const p = spawn(PY, args, { cwd: o.proyecto, signal: senal, env: { ...process.env, PYTHONUNBUFFERED: '1' } })
      let err = ''
      const linea = (d: Buffer) => {
        const ultima = String(d).trim().split('\n').pop()
        if (ultima) t.progreso = { etapa: 'preparando', hechos: 0, total: 0, mensaje: ultima.slice(0, 160) }
      }
      p.stdout.on('data', linea)
      p.stderr.on('data', (d) => (err = (err + d).slice(-3000)))
      p.on('error', (e) => mal(new Error(`No pude ejecutar Python (${PY}): ${e.message}`)))
      p.on('close', (c) => (c === 0 ? ok() : mal(new Error(err.trim().split('\n').slice(-3).join(' ') || `Python terminó con código ${c}`))))
    })

  const ejecutarLento = async (t: Trabajo, senal: AbortSignal) => {
    const l = t.opciones.lento!
    const [num, den] = (await correr('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=r_frame_rate', '-of', 'csv=p=0', l.src])).trim().split('/').map(Number)
    const fps = num / (den || 1) || 30
    // Un cuadro nuevo por cada cuadro de la composición: ni menos (se repetirían) ni de más.
    const destino = Math.min(240, Math.round(Math.max(fps, l.fps ?? 30) / l.velocidad))
    mkdirSync(join(o.proyecto, 'public', 'lento'), { recursive: true })
    t.progreso = { etapa: 'codificando', hechos: 0, total: 0, mensaje: `Interpolando a ${destino} fps (puede tardar)` }
    await correr(FFMPEG, ['-y', '-hide_banner', '-loglevel', 'error', '-ss', String(l.desde), '-t', String(l.segundos + 0.3), '-i', l.src, '-an',
      '-vf', `minterpolate=fps=${destino}:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1`, '-c:v', 'libx264', '-preset', 'fast', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', t.salida], senal)
    // El guion que lo pidió pasa a usarlo (aunque el estudio esté cerrado): los clips con ese mismo video, tramo y velocidad.
    if (l.guion && l.publico) {
      const g = o.guiones().leer(l.guion)
      const lento = { src: '/lento/' + t.salida.split('/').pop(), desde: l.desde, velocidad: l.velocidad }
      const clips = (g.clips || []).map((c) => (c.src === l.publico && (c.recorte ?? 0) === l.desde && c.velocidad === l.velocidad ? { ...c, lento } : c))
      o.guiones().guardar(l.guion, { clips })
    }
  }

  let ocupado = false
  const siguiente = async () => {
    if (ocupado) return
    const t = pendientes()[0]
    if (!t) return
    ocupado = true
    const control = new AbortController()
    controles.set(t.id, control)
    cambiar(t, { estado: 'corriendo', inicio: Date.now(), progreso: { etapa: 'preparando', hechos: 0, total: 0 } })
    try {
      await (t.tipo === 'retake' ? ejecutarRetake(t, control.signal) : t.tipo === 'lento' ? ejecutarLento(t, control.signal) : t.tipo === 'limpieza' || t.tipo === 'reencuadre' ? ejecutarPython(t, control.signal) : ejecutarRender(t, control.signal))
      cambiar(t, { estado: 'listo', fin: Date.now(), progreso: { ...t.progreso, etapa: 'listo' } })
      if (t.codec !== 'png') avisarPixi(`Terminó ${t.tipo === 'retake' ? 'el retake' : t.tipo === 'limpieza' ? 'la limpieza' : t.tipo === 'reencuadre' ? 'el reencuadre' : t.tipo === 'lento' ? 'la cámara lenta' : 'el render'} de ${t.composicion}, tardó ${duracionHablada(Date.now() - t.inicio)}.`)
    } catch (e: any) {
      cambiar(t, { estado: control.signal.aborted ? 'cancelado' : 'error', error: control.signal.aborted ? 'Cancelado.' : e.message, fin: Date.now() })
      if (t.estado === 'error') avisarPixi(`Falló el render de ${t.composicion}.`)
    } finally {
      controles.delete(t.id)
      ocupado = false
      setTimeout(siguiente, 0)
    }
  }

  const cancelar = (id: number) => {
    const t = buscar(id)
    if (t.estado === 'pendiente') cambiar(t, { estado: 'cancelado', error: 'Cancelado antes de empezar.', fin: Date.now() })
    else controles.get(t.id)?.abort()
    return t
  }

  // Mueve un pendiente dentro de la fila: 'arriba', 'abajo' o 'primero'.
  const mover = (id: number, a: 'arriba' | 'abajo' | 'primero') => {
    const t = buscar(id)
    if (t.estado !== 'pendiente') throw new Error('Solo se pueden mover los trabajos que esperan.')
    const fila = pendientes()
    const i = fila.indexOf(t)
    const j = a === 'primero' ? 0 : a === 'arriba' ? Math.max(0, i - 1) : Math.min(fila.length - 1, i + 1)
    if (i === j) return t
    fila.splice(i, 1)
    fila.splice(j, 0, t)
    // Los pendientes se reacomodan en los lugares que ya ocupaban dentro de la lista completa.
    const lugares = trabajos.map((x, k) => (x.estado === 'pendiente' ? k : -1)).filter((k) => k >= 0)
    lugares.forEach((k, n) => (trabajos[k] = fila[n]))
    guardar()
    return t
  }

  const reintentar = (id: number, origen: Origen = 'estudio') => {
    const t = buscar(id)
    if (t.estado === 'pendiente' || t.estado === 'corriendo') throw new Error('Ese trabajo todavía no terminó.')
    const { opciones: op } = t
    if (t.tipo === 'limpieza') return encolarLimpieza(op.limpieza!, origen)
    if (t.tipo === 'reencuadre') return encolarReencuadre(op.reencuadre!, origen)
    if (t.tipo === 'lento') return nuevo({ ...t, opciones: { lento: op.lento }, origen })
    return t.tipo === 'retake'
      ? encolarRetake({ id: t.composicion, base: op.base!, frames: op.frames!, props: op.props, calidad: op.calidad }, origen)
      : encolar({ id: t.composicion, codec: t.codec, props: op.props, frame: op.frame, frames: op.frames, calidad: op.calidad, escala: op.escala }, origen)
  }

  // Saca de la lista los terminados (los archivos renderizados quedan donde están).
  const limpiar = () => {
    trabajos = trabajos.filter((t) => t.estado === 'pendiente' || t.estado === 'corriendo')
    guardar()
  }

  // Más nuevo primero, como antes; los pendientes llevan su lugar en la fila.
  const lista = () => {
    const fila = pendientes()
    return trabajos
      .slice()
      .reverse()
      .map((t) => (t.estado === 'pendiente' ? { ...t, posicion: fila.indexOf(t) + 1 } : t))
  }

  if (pendientes().length) setTimeout(siguiente, 3000) // al arrancar, retoma lo que quedó
  return { lista, encolar, encolarRetake, encolarLimpieza, encolarReencuadre, encolarLento, cancelar, mover, reintentar, limpiar, bases, composiciones, buscar, alCambiar: (f: (t: Trabajo) => void) => (oyentes.add(f), () => void oyentes.delete(f)) }
}

export type Cola = ReturnType<typeof crearCola>
