// Nodos propios de Fotograma: guion → voz → render, para producir videos sin salir de la plataforma.
import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import { slug } from '../../../src/guion/parsear'
import type { Cartas, Clip, Guion, Personaje, Quiz } from '../../../src/guion/tipos'
import { lineasQuiz } from '../../../src/guion/quizTexto'
import { lineasCartas } from '../../../src/guion/cartasTexto'
import { renderizar, type Codec } from '../../render'
import { archivarGuion } from '../../biblioteca'
import { estudio } from '../contexto'
import type { Ejecutor } from '../motor'
import { R } from '../rutas'
import { pedirAprobacion } from '../aprobaciones'
import { porItem, rutaSalida } from './util'

const guionesApi = () => {
  if (!estudio.guiones) throw new Error('Los nodos de Fotograma solo funcionan con el estudio abierto (npx fotograma estudio).')
  return estudio.guiones
}

const comoLista = (v: any): any[] => (v === undefined || v === null || v === '' ? [] : Array.isArray(v) ? v : [v])

// Parte un texto narrado en frases (una línea de guion por frase, así los subtítulos y las pausas quedan naturales).
const frases = (t: string) =>
  String(t)
    .replace(/\s+/g, ' ')
    .match(/[^.!?…]+[.!?…]+["»”)]?|[^.!?…]+$/g)
    ?.map((x) => x.trim())
    .filter(Boolean) ?? []

// Se ejecuta UNA vez aunque lleguen varios items (p. ej. una por toma de Kie): el guion junta todo,
// y los clips se toman de todos los items con una expresión como $('Kie · generar').all().
const crearGuion: Ejecutor = async (c) => {
  const i = 0
  {
    const api = guionesApi()
    const modoParam = c.param('modo', i)
    const modo: Guion['modo'] = modoParam === 'personajes' ? 'personajes' : modoParam === 'quiz' ? 'quiz' : modoParam === 'cartas' ? 'cartas' : 'narrador'
    const titulo = String(c.param('titulo', i) || 'Video').trim()
    const id = slug(String(c.param('id', i) || '') || `${titulo}-${new Date().toISOString().slice(0, 10)}`)

    // Personajes: en modo narrador basta una voz.
    // En modo narrador solo hay una voz: se ignora la lista de personajes (aunque tenga su valor por defecto).
    let personajes: Personaje[] = (modo === 'personajes' ? comoLista(c.json('personajes', i)) : []).map((p: any, k: number) => ({
      id: slug(p.id || p.nombre || `p${k}`),
      nombre: String(p.nombre || `Personaje ${k + 1}`),
      color: p.color || ['#ff6b9a', '#4cc9f0', '#ffd166', '#06d6a0'][k % 4],
      voz: String(p.voz || ''),
      imagen: p.imagen,
    }))
    if (modo !== 'personajes' && !personajes.length) personajes = [{ id: 'narrador', nombre: 'Narrador', color: '#ffd400', voz: String(c.param('voz', i) || 'Charon') }]

    // Texto: en narrador se acepta la narración entera (se parte en frases);
    // en personajes, un array [{personaje, texto}] o el texto ya escrito "Nombre: …".
    // En quiz las líneas salen de las preguntas: no se evalúa el campo de líneas.
    const entrada = modo === 'quiz' || modo === 'cartas' ? undefined : c.json('lineas', i)
    let texto: string
    // Quiz: las líneas salen de las preguntas (intro, pregunta/respuesta × N, cierre).
    let quiz: Quiz | undefined
    let cartas: Cartas | undefined
    if (modo === 'quiz') {
      const q: any = c.json('quiz', i) || {}
      const preguntas = comoLista(q.preguntas)
        .map((p: any) => ({ pregunta: String(p.pregunta || '').trim(), opciones: comoLista(p.opciones).map((o: any) => String(o).trim()).slice(0, 4), correcta: Number(p.correcta), explicacion: p.explicacion ? String(p.explicacion).trim() : undefined }))
        .filter((p) => p.pregunta && p.opciones.length >= 2 && Number.isInteger(p.correcta) && p.correcta >= 0 && p.correcta < p.opciones.length)
      if (!preguntas.length) throw new Error('El quiz no trae preguntas válidas.')
      quiz = { preguntas, cuentaS: Math.max(2, Number(q.cuentaS) || 5), intro: String(q.intro || '¿Cuántas puedes responder?'), cierre: String(q.cierre || '¿Cuántas acertaste? Escríbelo en los comentarios.'), marca: q.marca || String(c.param('marca', i) || '') || undefined, tema: q.tema }
      texto = lineasQuiz(quiz, String(c.param('idioma', i) || 'es')).map((l) => `${personajes[0].nombre}: ${l.replace(/\n/g, ' ')}`).join('\n')
    } else if (modo === 'cartas') {
      // Cartas: una línea por carta (de menor a mayor impacto; la última es el #1), más intro y cierre.
      const q: any = c.json('cartas', i) || {}
      const lista = comoLista(q.cartas)
        .map((x: any) => ({
          nombre: String(x.nombre || '').trim(),
          cientifico: x.cientifico ? String(x.cientifico).trim() : undefined,
          emoji: String(x.emoji || '🐾').trim(),
          poder: String(x.poder || '').trim(),
          dato: String(x.dato || '').trim(),
          cifra: x.cifra ? String(x.cifra).trim() : undefined,
          stats: comoLista(x.stats)
            .map((st: any) => ({ etiqueta: String(st.etiqueta || st.label || '').trim(), valor: Math.max(0, Math.min(100, Math.round(Number(st.valor ?? st.value) || 0))) }))
            .filter((st: any) => st.etiqueta)
            .slice(0, 3),
        }))
        .filter((x) => x.nombre && x.poder && x.dato)
      if (!lista.length) throw new Error('Las cartas no traen animales válidos (faltan nombre, poder o dato).')
      cartas = { cartas: lista, intro: String(q.intro || ''), cierre: String(q.cierre || ''), marca: q.marca || String(c.param('marca', i) || '') || undefined, tema: q.tema }
      texto = lineasCartas(cartas, String(c.param('idioma', i) || 'en')).map((l) => `${personajes[0].nombre}: ${l.replace(/\n/g, ' ')}`).join('\n')
    } else if (typeof entrada === 'string' && modo === 'narrador') texto = frases(entrada).map((f) => `${personajes[0].nombre}: ${f}`).join('\n')
    else if (typeof entrada === 'string') texto = entrada
    else
      texto = comoLista(entrada)
        .map((l: any) => {
          if (typeof l === 'string') return `${personajes[0].nombre}: ${l.replace(/\n/g, ' ')}`
          const p = personajes.find((x) => x.id === slug(l.personaje || '') || x.nombre.toLowerCase() === String(l.personaje || '').toLowerCase()) ?? personajes[0]
          return `${p.nombre}: ${String(l.texto || l.text || '').replace(/\n/g, ' ')}`
        })
        .join('\n')

    // Clips: archivos locales (p. ej. lo que descargó Kie) se copian a public/ para que el render los vea.
    const dirClips = join(R.proyecto, 'public', 'guiones', id, 'clips')
    const clips: Clip[] = comoLista(c.json('clips', i)).map((x: any, k: number) => {
      const src = typeof x === 'string' ? x : x.src || x.ruta
      const extra = typeof x === 'object' ? x : {}
      if (src && src.startsWith('/') && existsSync(src) && !src.startsWith(join(R.proyecto, 'public'))) {
        mkdirSync(dirClips, { recursive: true })
        const nombre = `${k}-${basename(src, extname(src)).slice(0, 40)}${extname(src)}`
        copyFileSync(src, join(dirClips, nombre))
        return { ...extra, src: `/guiones/${id}/clips/${nombre}` }
      }
      if (src && src.startsWith(join(R.proyecto, 'public'))) return { ...extra, src: src.slice(join(R.proyecto, 'public').length) }
      return { ...extra, src }
    })

    const datos: Partial<Guion> & { titulo: string } = {
      id,
      titulo,
      modo,
      ...(quiz ? { quiz } : {}),
      ...(cartas ? { cartas } : {}),
      formato: (c.param('formato', i) as Guion['formato']) || 'vertical',
      texto,
      personajes,
      clips,
      portada: c.param('portada', i) !== false,
      subtitulos: modo !== 'quiz' && modo !== 'cartas' && c.param('subtitulos', i) !== false, // quiz y cartas ya muestran el texto
      pausaMs: Number(c.param('pausaMs', i) ?? 150),
      idioma: String(c.param('idioma', i) || 'es'),
    }
    const hashtags = c.json('hashtags', i)
    const descripcion = String(c.param('descripcion', i) || '')
    const canal = String(c.param('canalYoutube', i) || '')
    if (descripcion || hashtags || canal)
      datos.publicacion = {
        titulo: String(c.param('tituloPublicacion', i) || '') || titulo,
        descripcion,
        hashtags: comoLista(hashtags).map(String),
        canal: canal || undefined,
        categoria: String(c.param('categoriaYoutube', i) || '') || undefined,
      }
    datos.proveedorVoz = c.param('proveedorVoz', i) === 'elevenlabs' ? 'elevenlabs' : 'kie-gemini'
    const estiloVoz = String(c.param('estiloVoz', i) || '')
    if (estiloVoz) datos.estiloVoz = estiloVoz
    datos.transicion = String(c.param('transicion', i) || 'variada')
    datos.grano = c.param('grano', i) !== false
    datos.vineta = c.param('vineta', i) !== false
    const fondo = String(c.param('fondo', i) || '')
    if (fondo) datos.fondo = fondo
    const musica = String(c.param('musica', i) || '')
    if (musica) datos.musica = musica
    const g = api.crearDesde(datos)
    c.log(`Guion "${g.titulo}" con ${g.lineas.length} líneas y ${clips.length} clips`)
    return [[{ json: { guion: g.id, composicion: `Guion-${g.id}`, titulo: g.titulo, lineas: g.lineas.length, clips: clips.length } }]]
  }
}

const vozGuion: Ejecutor = async (c) =>
  porItem(c, async (it, i) => {
    const id = String(c.param('guion', i) || it.json.guion || '')
    if (!id) throw new Error('Falta el id del guion.')
    const g = await guionesApi().generarAudioYEsperar(id, c.log, c.senal)
    const ms = g.lineas.reduce((n, l) => n + (l.duracionMs ?? 0), 0)
    return { json: { ...it.json, guion: g.id, composicion: `Guion-${g.id}`, segundosVoz: Math.round(ms / 100) / 10 } }
  })

const render: Ejecutor = async (c) =>
  porItem(c, async (it, i) => {
    if (!estudio.servidor) throw new Error('El render necesita el estudio abierto (npx fotograma estudio).')
    const composicion = String(c.param('composicion', i) || it.json.composicion || '').trim()
    if (!composicion) throw new Error('Falta la composición a renderizar.')
    const codec = (String(c.param('codec', i) || 'h264') as Codec) || 'h264'
    const ext = { h264: '.mp4', vp9: '.webm', prores: '.mov', gif: '.gif', png: '.png' }[codec]
    const salida = rutaSalida(c, c.param('nombreArchivo', i), `${composicion}${ext}`)
    const servidor = estudio.servidor
    let ultimo = -1
    // Si otro flujo agrega un JSON de reel mientras tanto, el estudio recarga la página del render: se reintenta.
    const intentar = async <T,>(fn: () => Promise<T>, veces = 3): Promise<T> => {
      try {
        return await fn()
      } catch (e: any) {
        if (veces <= 1 || c.senal.aborted || !/context was destroyed|navigation|Target closed/i.test(String(e?.message))) throw e
        c.log(`Render ${composicion}: la página se recargó, reintento…`)
        await new Promise((ok) => setTimeout(ok, 3000))
        return intentar(fn, veces - 1)
      }
    }
    const r = await intentar(() => renderizar({
      composicion,
      salida,
      props: c.json('props', i) || undefined,
      codec,
      frame: Number(c.param('frame', i)) || 0,
      servidor: servidor,
      senal: c.senal,
      alProgresar: (p) => {
        const pct = p.total ? Math.floor((p.hechos / p.total) * 10) : -1
        if (p.etapa !== 'capturando') c.log(`Render ${composicion}: ${p.etapa}`)
        else if (pct !== ultimo) c.log(`Render ${composicion}: ${pct * 10}%`)
        ultimo = pct
      },
    }))
    let ruta = r.salida
    // Los videos de guiones van a la biblioteca del disco externo (con su info.json para publicar).
    const idGuion = composicion.match(/^Guion-(.+)$/)?.[1]
    if (idGuion && codec !== 'png') {
      try {
        const a = await archivarGuion(r.salida, guionesApi().leer(idGuion))
        if (a) {
          ruta = a.video
          c.log(`Guardado en la biblioteca: ${a.carpeta}`)
        }
      } catch (e: any) {
        c.log('No se pudo guardar en la biblioteca: ' + e.message)
      }
    }
    return {
      json: { ...it.json, ruta, composicion, segundos: Math.round((r.info.duracion / r.info.fps) * 10) / 10, ancho: r.info.ancho, alto: r.info.alto },
      archivo: ruta,
    }
  })

// Vista previa: detiene el flujo hasta que apruebes el video en el estudio (o pasa solo en modo automático).
const vistaPrevia: Ejecutor = async (c) => {
  if (c.param('modo', 0) === 'automatico') {
    c.log('Vista previa en automático: sigue sin esperar.')
    return [c.items, []]
  }
  const aprobados: typeof c.items = []
  const rechazados: typeof c.items = []
  for (let i = 0; i < c.items.length; i++) {
    const it = c.items[i]
    if (!it.archivo) throw new Error('La vista previa necesita un video (conecta este nodo después de Render).')
    c.log('⏸ Esperando tu revisión en el estudio (aviso arriba a la derecha)…')
    const d = await pedirAprobacion(
      {
        ejecucion: c.ejecucionId,
        flujoId: c.flujo.id,
        flujo: c.flujo.nombre,
        nodo: c.nodo.nombre,
        video: it.archivo,
        titulo: String(c.param('titulo', i) || it.json.titulo || it.json.composicion || 'Video'),
        descripcion: String(c.param('descripcion', i) || ''),
        destino: String(c.param('destino', i) || ''),
      },
      c.senal,
    )
    c.log(d === 'aprobado' ? '▶ Aprobado: continúa.' : '■ Rechazado: no se publica.')
    ;(d === 'aprobado' ? aprobados : rechazados).push(it)
  }
  return [aprobados, rechazados]
}

export const fotograma: Record<string, Ejecutor> = { crearGuion, vozGuion, render, vistaPrevia }
