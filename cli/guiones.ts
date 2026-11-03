// API de guiones del estudio. Los guiones se guardan en <proyecto>/guiones/<id>.json
// y sus archivos (imágenes de personajes, audios) en <proyecto>/public/guiones/<id>/.
import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { extname, join } from 'node:path'
import { promisify } from 'node:util'
import { parsearGuion, pendientesDeAudio, slug } from '../src/guion/parsear'
import { guionNuevo, type Guion, type Palabra } from '../src/guion/tipos'
import { generarVoz, generarVozKie, listarVoces, VOCES_GEMINI } from './voz'
import { aPapelera } from './seguridad'

const sh = promisify(execFile)

export type ProgresoAudio = { guion: string; hechas: number; total: number; actual?: string; estado: 'corriendo' | 'listo' | 'error'; error?: string }

export const crearApiGuiones = (proyecto: string) => {
  const dirJson = join(proyecto, 'guiones')
  const dirMedios = (id: string) => join(proyecto, 'public', 'guiones', id)
  const ruta = (id: string) => join(dirJson, slug(id) + '.json')
  const progreso = new Map<string, ProgresoAudio>()

  const leer = (id: string): Guion => {
    const p = ruta(id)
    if (!existsSync(p)) throw new Error(`No existe el guion "${id}".`)
    return JSON.parse(readFileSync(p, 'utf8'))
  }

  // Escritura atómica: el estudio recarga al ver el archivo y no debe leerlo a medias.
  const escribir = (g: Guion) => {
    mkdirSync(dirJson, { recursive: true })
    g.actualizado = new Date().toISOString()
    const tmp = ruta(g.id) + '.tmp'
    writeFileSync(tmp, JSON.stringify(g, null, 2))
    renameSync(tmp, ruta(g.id))
    return g
  }

  const duracionReal = async (archivo: string) => {
    try {
      const { stdout } = await sh('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', archivo])
      return Math.round(parseFloat(stdout) * 1000)
    } catch {
      return undefined
    }
  }

  const generar = async (id: string, estado: ProgresoAudio, avisar?: (m: string) => void, senal?: AbortSignal) => {
    const g = leer(id)
    const pendientes = pendientesDeAudio(g)
    const dir = join(dirMedios(g.id), 'lineas')
    mkdirSync(dir, { recursive: true })
    try {
      for (const l of pendientes) {
        // "Detener" en el flujo corta entre línea y línea (las voces ya hechas quedan guardadas).
        if (senal?.aborted) throw new Error('Ejecución cancelada: la voz quedó a medias (las líneas hechas se conservan).')
        const p = g.personajes.find((x) => x.id === l.personaje)
        if (!p) throw new Error(`La línea "${l.texto.slice(0, 40)}…" no tiene un personaje conocido.`)
        if (!p.voz) throw new Error(`${p.nombre} no tiene voz asignada.`)
        estado.actual = `${p.nombre}: ${l.texto.slice(0, 60)}`
        avisar?.(`Voz ${estado.hechas + 1}/${estado.total} · ${estado.actual}`)
        const archivo = `${l.id}-${Date.now().toString(36)}.mp3`
        let r: { palabras: Palabra[]; duracionMs: number }
        if ((g.proveedorVoz || 'kie-gemini') === 'kie-gemini') {
          r = await generarVozKie({ texto: l.texto, voz: p.voz, idioma: g.idioma, escena: g.estiloVoz, destinoMp3: join(dir, archivo) })
        } else {
          const e = await generarVoz({ texto: l.texto, voz: p.voz, modelo: g.modelo, idioma: g.idioma })
          writeFileSync(join(dir, archivo), e.audio)
          r = e
        }
        // Se relee el guion por si se editó mientras se generaba.
        const actual = leer(id)
        const destino = actual.lineas.find((x) => x.id === l.id)
        if (destino) {
          destino.audio = `/guiones/${g.id}/lineas/${archivo}`
          destino.palabras = r.palabras
          destino.duracionMs = (await duracionReal(join(dir, archivo))) ?? r.duracionMs
          destino.firma = `${p.voz}|${l.texto}`
          escribir(actual)
        }
        estado.hechas++
      }
      estado.estado = 'listo'
      estado.actual = undefined
    } catch (e: any) {
      estado.estado = 'error'
      estado.error = e.message
      throw e
    }
  }

  return {
    listar: () =>
      existsSync(dirJson)
        ? readdirSync(dirJson)
            .filter((f) => f.endsWith('.json'))
            .map((f) => JSON.parse(readFileSync(join(dirJson, f), 'utf8')) as Guion)
            .map((g) => ({ id: g.id, titulo: g.titulo, formato: g.formato, lineas: g.lineas.length, pendientes: pendientesDeAudio(g).length, actualizado: g.actualizado }))
        : [],

    leer,

    todos: () =>
      existsSync(dirJson)
        ? readdirSync(dirJson)
            .filter((f) => f.endsWith('.json'))
            .map((f) => JSON.parse(readFileSync(join(dirJson, f), 'utf8')) as Guion)
        : [],

    crear: (titulo: string) => {
      let id = slug(titulo)
      for (let n = 2; existsSync(ruta(id)); n++) id = `${slug(titulo)}-${n}`
      const g = guionNuevo(id, titulo)
      g.lineas = parsearGuion(g.texto, g.personajes).lineas
      return escribir(g)
    },

    // Crea (o reemplaza) un guion completo desde un flujo. El texto se parte en líneas como en el editor.
    crearDesde: (datos: Partial<Guion> & { titulo: string }) => {
      const id = slug(datos.id || datos.titulo)
      const anterior = existsSync(ruta(id)) ? leer(id) : null
      const g: Guion = { ...guionNuevo(id, datos.titulo), ...(anterior || {}), ...datos, id }
      g.lineas = parsearGuion(g.texto, g.personajes, anterior?.lineas || []).lineas
      return escribir(g)
    },

    // Guarda los cambios y vuelve a partir el texto en líneas (conservando los audios que sirven).
    guardar: (id: string, cambios: Partial<Guion>) => {
      const anterior = leer(id)
      const g: Guion = { ...anterior, ...cambios, id: anterior.id }
      // Los audios se conservan desde lo guardado en disco (el estudio puede tener líneas viejas, sin el audio recién
      // generado); de lo que manda el estudio solo se toman los ajustes de la línea de tiempo (silencio después).
      const ajustes = new Map((cambios.lineas || []).map((l) => [l.id, l]))
      const base = anterior.lineas.map((l) => (ajustes.has(l.id) ? { ...l, pausaDespuesMs: ajustes.get(l.id)!.pausaDespuesMs } : l))
      const { lineas, desconocidos } = parsearGuion(g.texto, g.personajes, base)
      g.lineas = lineas
      return { guion: escribir(g), desconocidos }
    },

    // No se borra: el guion y sus audios/imágenes van a la papelera del proyecto (recuperables).
    borrar: (id: string) => {
      aPapelera(proyecto, 'guiones', ruta(id))
      const medios = dirMedios(slug(id))
      if (aPapelera(proyecto, 'guiones-medios', medios) && existsSync(medios)) rmSync(medios, { recursive: true, force: true })
    },

    subirImagen: (id: string, personaje: string, nombre: string, datos: Buffer) => {
      const g = leer(id)
      const p = g.personajes.find((x) => x.id === personaje)
      if (!p) throw new Error('No existe ese personaje.')
      const ext = (extname(nombre) || '.png').toLowerCase()
      if (!['.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif'].includes(ext)) throw new Error('La imagen debe ser png, jpg, webp, gif o avif.')
      const dir = join(dirMedios(g.id), 'personajes')
      mkdirSync(dir, { recursive: true })
      // Nombre con fecha para que el navegador no muestre la imagen anterior en caché.
      const archivo = `${personaje}-${Date.now().toString(36)}${ext}`
      writeFileSync(join(dir, archivo), datos)
      p.imagen = `/guiones/${g.id}/personajes/${archivo}`
      return escribir(g)
    },

    // Voces según el proveedor: Gemini (Kie) es una lista fija; ElevenLabs se consulta a su API.
    voces: async (proveedor = 'kie-gemini') =>
      proveedor === 'elevenlabs'
        ? listarVoces()
        : VOCES_GEMINI.map((v) => ({ id: v.id, nombre: `${v.id} - ${v.descripcion}`, categoria: 'gemini', genero: v.genero, usable: true })),

    progreso: (id: string) => progreso.get(id),

    // Genera el audio de las líneas nuevas o cambiadas, una por una (en segundo plano).
    generarAudio: (id: string) => {
      const estado: ProgresoAudio = { guion: id, hechas: 0, total: pendientesDeAudio(leer(id)).length, estado: 'corriendo' }
      progreso.set(id, estado)
      generar(id, estado).catch(() => {})
      return estado
    },

    // Igual, pero espera a que termine (lo usan los flujos).
    generarAudioYEsperar: async (id: string, avisar?: (m: string) => void, senal?: AbortSignal) => {
      const estado: ProgresoAudio = { guion: id, hechas: 0, total: pendientesDeAudio(leer(id)).length, estado: 'corriendo' }
      progreso.set(id, estado)
      await generar(id, estado, avisar, senal)
      return leer(id)
    },
  }
}
