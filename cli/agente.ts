// Asistente del estudio: un chat con herramientas que edita guiones y clips, crea y edita flujos,
// genera recursos y consulta la biblioteca. Usa Claude Code (`claude -p`) u Ollama (FOTOGRAMA_AGENTE_PROVEEDOR=ollama).
// Lo que gasta dinero (Kie), ejecuta/activa flujos o borra, NO se hace sin el OK del usuario:
// la herramienta queda "pendiente" y el estudio muestra Confirmar / Cancelar.
import { spawn } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CATALOGO } from '../src/flujos/catalogo'
import { DURACIONES } from '../src/flujos/duraciones'
import { pendientesDeAudio } from '../src/guion/parsear'
import type { Clip, Guion } from '../src/guion/tipos'
import { listarBiblioteca } from './biblioteca'
import { estudio } from './flujos/contexto'
import { video } from './flujos/nodos/video'
import { PLANTILLAS } from './flujos/plantillas'
import type { crearApiGuiones } from './guiones'
import type { Trabajo } from './cola'
import type { InfoComposicion } from './render'

const OLLAMA = process.env.OLLAMA_HOST || 'http://127.0.0.1:11434'
// Proveedor del modelo: 'claude' (Claude Code headless, `claude -p`, con la suscripción del usuario) u 'ollama'.
const PROVEEDOR = process.env.FOTOGRAMA_AGENTE_PROVEEDOR || 'claude'
const MODELO = process.env.FOTOGRAMA_AGENTE_MODELO || (PROVEEDOR === 'claude' ? 'sonnet' : 'deepseek-v4.1-flash:cloud')
const MAX_VUELTAS = 10
const SOLO_EN_LA_PC = ['ejecutar_flujo', 'activar_flujo']

export type Mensaje = { role: 'system' | 'user' | 'assistant' | 'tool'; content: string; tool_calls?: Llamada[]; tool_name?: string }
type Llamada = { id?: string; function: { name: string; arguments: Record<string, any> } }
export type Contexto = { pestana?: string; composicion?: string; guion?: string; flujo?: string }
type Cambio = { tipo: 'guion' | 'flujo' | 'recurso'; id?: string }
type Paso = { herramienta: string; args: Record<string, any>; ok: boolean; resumen: string }
export type Pendiente = { llamada: Llamada; descripcion: string }
export type RespuestaAgente = { mensajes: Mensaje[]; pasos: Paso[]; cambios: Cambio[]; pendiente?: Pendiente; texto: string }

type Herramienta = {
  nombre: string
  descripcion: string
  parametros: Record<string, any>
  requeridos?: string[]
  // Si devuelve un texto, la herramienta necesita confirmación (el texto explica qué hará y cuánto cuesta).
  confirmar?: (a: Record<string, any>) => string | null
  ejecutar: (a: Record<string, any>) => Promise<{ resultado: any; cambios?: Cambio[]; resumen?: string }>
}

const s = (descripcion: string, extra: Record<string, any> = {}) => ({ type: 'string', description: descripcion, ...extra })
const n = (descripcion: string) => ({ type: 'number', description: descripcion })
const b = (descripcion: string) => ({ type: 'boolean', description: descripcion })

export const crearAgente = (proyecto: string, g: () => ReturnType<typeof crearApiGuiones>) => {
  const publico = (ruta: string) => join(proyecto, 'public', ruta.replace(/^\/+/, ''))
  const flujosApi = async (ruta: string, metodo = 'GET', cuerpo?: unknown) => {
    if (!estudio.servidor) throw new Error('El estudio no está listo.')
    const r = await fetch(`${estudio.servidor.url}/__fotograma/flujos/${ruta}`, {
      method: metodo,
      headers: cuerpo ? { 'Content-Type': 'application/json' } : undefined,
      body: cuerpo ? JSON.stringify(cuerpo) : undefined,
    })
    const d: any = await r.json().catch(() => ({}))
    if (!r.ok || d?.error) throw new Error(d?.error || `Error ${r.status}`)
    return d
  }

  // Genera una imagen con el mismo nodo "Imagen IA" de los flujos y la copia a `destino` (ruta del disco).
  const generarImagen = async (a: { prompt: string; formato?: string; proveedor?: string; modelo?: string; referencias?: string[] }, destino: string) => {
    const proveedor = a.proveedor === 'kie' ? 'kie' : 'cloudflare'
    const params: Record<string, any> = {
      prompt: a.prompt,
      estilo: '',
      proveedor,
      formato: a.formato || 'vertical',
      modeloCloudflare: proveedor === 'cloudflare' ? a.modelo || '@cf/black-forest-labs/flux-2-klein-4b' : undefined,
      modeloKie: proveedor === 'kie' ? a.modelo || 'nano-banana-pro' : undefined,
      resolucion: '1K',
      referencias: (a.referencias || []).map(publico).filter((r) => existsSync(r)),
    }
    const carpeta = join(proyecto, '.fotograma', 'agente')
    mkdirSync(carpeta, { recursive: true })
    const c: any = {
      items: [{ json: {} }],
      carpeta,
      runIndex: Date.now(),
      senal: AbortSignal.timeout(10 * 60_000),
      param: (k: string) => params[k],
      json: (k: string) => params[k],
      log: () => {},
    }
    const salida = await video.imagen(c)
    const ruta = salida?.[0]?.[0]?.json?.ruta as string | undefined
    if (!ruta) throw new Error('No se generó la imagen.')
    mkdirSync(join(destino, '..'), { recursive: true })
    copyFileSync(ruta, destino)
    return destino
  }

  const resumenGuion = (x: Guion) => ({
    id: x.id,
    titulo: x.titulo,
    formato: x.formato,
    modo: x.modo || 'personajes',
    idioma: x.idioma,
    transicion: x.transicion,
    grano: x.grano,
    vineta: x.vineta,
    subtitulos: x.subtitulos,
    portada: x.portada,
    musica: x.musica,
    proveedorVoz: x.proveedorVoz,
    estiloVoz: x.estiloVoz,
    publicacion: x.publicacion,
    personajes: x.personajes.map((p) => ({ id: p.id, nombre: p.nombre, voz: p.voz })),
    lineas: x.lineas.map((l, i) => ({ numero: i + 1, personaje: l.personaje, texto: l.texto, conAudio: !!l.audio })),
    clips: (x.clips || []).map((c, i) => ({ numero: i + 1, src: c.src, segundos: c.segundos })),
  })

  const leerGuion = (id: string) => {
    const limpio = String(id || '').replace(/^Guion-/, '')
    return g().leer(limpio)
  }

  const cola = () => {
    if (!estudio.cola) throw new Error('La cola del estudio no está lista.')
    return estudio.cola
  }
  // Segundos → frames [desde, hasta] (inclusivo) dentro de la composición; sin límites = completa.
  const tramo = (c: InfoComposicion, desde?: number, hasta?: number): [number, number] | undefined => {
    if (desde == null && hasta == null) return undefined
    const a = Math.max(0, Math.round((desde ?? 0) * c.fps))
    const b = Math.min(c.duracion - 1, Math.round((hasta ?? c.duracion / c.fps) * c.fps) - 1)
    if (b < a) throw new Error('El tramo está vacío o fuera del video.')
    return [a, b]
  }
  const resumenTrabajo = (t: Trabajo) => ({ id: t.id, tipo: t.tipo, composicion: t.composicion, estado: t.estado, enFila: t.posicion, progreso: t.progreso.total ? `${t.progreso.hechos}/${t.progreso.total}` : t.progreso.etapa, error: t.error, archivo: t.estado === 'listo' ? t.salida : undefined })

  const H: Herramienta[] = [
    // ───── Guiones y composiciones ─────
    {
      nombre: 'listar_guiones',
      descripcion: 'Lista los guiones (videos del usuario). Cada guion es también la composición "Guion-<id>".',
      parametros: {},
      ejecutar: async () => ({ resultado: g().todos().map((x) => ({ id: x.id, titulo: x.titulo, formato: x.formato, lineas: x.lineas.length, clips: x.clips?.length || 0, actualizado: x.actualizado })) }),
    },
    {
      nombre: 'leer_guion',
      descripcion: 'Lee un guion completo: líneas de narración, clips (imágenes/videos de fondo, numerados desde 1), estilo y datos para publicar.',
      parametros: { id: s('Id del guion (o "Guion-<id>")') },
      requeridos: ['id'],
      ejecutar: async (a) => ({ resultado: resumenGuion(leerGuion(a.id)) }),
    },
    {
      nombre: 'editar_guion',
      descripcion: 'Cambia el estilo o datos de un guion: título, transición, grano, viñeta, subtítulos, portada, formato, música, pausa entre frases, estilo de voz o datos de publicación.',
      parametros: {
        id: s('Id del guion'),
        titulo: s('Nuevo título'),
        transicion: s('Transición entre clips', { enum: ['variada', 'fundido', 'zoom', 'deslizar', 'empujar', 'barrido', 'desenfoque', 'iris', 'destello', 'ninguna'] }),
        grano: b('Grano de película'),
        vineta: b('Viñeta'),
        subtitulos: b('Mostrar subtítulos'),
        portada: b('Portada con el título al inicio'),
        formato: s('Formato', { enum: ['vertical', 'horizontal', 'cuadrado'] }),
        musica: s('Ruta pública de música de fondo, p. ej. /musica/fondo.mp3 ("" para quitarla)'),
        volumenMusica: n('Volumen de la música de 0 a 1'),
        pausaMs: n('Silencio entre frases en ms'),
        estiloVoz: s('Cómo debe sonar la voz (Gemini)'),
        publicacion_titulo: s('Título para publicar'),
        publicacion_descripcion: s('Descripción para publicar'),
        publicacion_hashtags: { type: 'array', items: { type: 'string' }, description: 'Hashtags para publicar' },
      },
      requeridos: ['id'],
      ejecutar: async (a) => {
        const x = leerGuion(a.id)
        const cambios: Partial<Guion> = {}
        for (const k of ['titulo', 'transicion', 'grano', 'vineta', 'subtitulos', 'portada', 'formato', 'musica', 'volumenMusica', 'pausaMs', 'estiloVoz'] as const)
          if (a[k] !== undefined) (cambios as any)[k] = a[k]
        if (a.publicacion_titulo !== undefined || a.publicacion_descripcion !== undefined || a.publicacion_hashtags !== undefined)
          cambios.publicacion = {
            ...x.publicacion,
            ...(a.publicacion_titulo !== undefined ? { titulo: a.publicacion_titulo } : {}),
            ...(a.publicacion_descripcion !== undefined ? { descripcion: a.publicacion_descripcion } : {}),
            ...(a.publicacion_hashtags !== undefined ? { hashtags: a.publicacion_hashtags } : {}),
          }
        g().guardar(x.id, cambios)
        return { resultado: { ok: true, cambiado: Object.keys(cambios) }, cambios: [{ tipo: 'guion', id: x.id }], resumen: Object.keys(cambios).join(', ') }
      },
    },
    {
      nombre: 'editar_linea',
      descripcion: 'Cambia el texto de una frase de la narración (numerada desde 1). Su audio queda viejo: después hay que regenerar la voz.',
      parametros: { id: s('Id del guion'), numero: n('Número de la frase (desde 1)'), texto: s('Texto nuevo') },
      requeridos: ['id', 'numero', 'texto'],
      ejecutar: async (a) => {
        const x = leerGuion(a.id)
        const i = Number(a.numero) - 1
        if (!x.lineas[i]) throw new Error(`El guion tiene ${x.lineas.length} frases.`)
        // Guardar vuelve a partir el texto en líneas (y conserva los audios de las que no cambiaron).
        const nombre = (id: string) => x.personajes.find((p) => p.id === id)?.nombre || x.personajes[0]?.nombre || 'Narrador'
        const texto = x.lineas.map((l, k) => `${nombre(l.personaje)}: ${(k === i ? String(a.texto) : l.texto).replace(/\n/g, ' ')}`).join('\n')
        g().guardar(x.id, { texto })
        return { resultado: { ok: true, aviso: 'Falta regenerar la voz de esta frase (regenerar_voz).' }, cambios: [{ tipo: 'guion', id: x.id }], resumen: `frase ${a.numero}` }
      },
    },
    {
      nombre: 'cambiar_clip',
      descripcion:
        'Genera una imagen nueva desde un prompt y reemplaza el clip indicado (numerado desde 1) de un guion. Cloudflare FLUX.2 klein es gratis; Kie (Nano Banana Pro, ~$0.09) da la mejor calidad y pide confirmación. Usa "referencia" (número de otro clip) para mantener el mismo sujeto.',
      parametros: {
        id: s('Id del guion'),
        numero: n('Número del clip a reemplazar (desde 1); usa un número mayor que el total para agregar uno nuevo al final'),
        prompt: s('Descripción de la imagen, en inglés: sujeto, encuadre, acción, lugar, luz. Sin texto en la imagen.'),
        proveedor: s('cloudflare (gratis) o kie (pago)', { enum: ['cloudflare', 'kie'] }),
        referencia: n('Número de otro clip del mismo guion para usar como referencia (opcional)'),
      },
      requeridos: ['id', 'numero', 'prompt'],
      confirmar: (a) => (a.proveedor === 'kie' ? `Generar el clip ${a.numero} con Kie Nano Banana Pro (≈ $0.09, 18 créditos).` : null),
      ejecutar: async (a) => {
        const x = leerGuion(a.id)
        const clips: Clip[] = [...(x.clips || [])]
        const i = Math.min(Math.max(0, Number(a.numero) - 1), clips.length)
        const ref = a.referencia ? clips[Number(a.referencia) - 1]?.src : undefined
        const nombre = `agente_${Date.now().toString(36)}.jpg`
        await generarImagen({ prompt: a.prompt, formato: x.formato, proveedor: a.proveedor, referencias: ref && /\.(png|jpe?g|webp)$/i.test(ref) ? [ref] : [] }, publico(`/guiones/${x.id}/clips/${nombre}`))
        clips[i] = { ...(clips[i] || {}), src: `/guiones/${x.id}/clips/${nombre}` }
        g().guardar(x.id, { clips })
        return { resultado: { ok: true, clip: i + 1, src: clips[i].src, total: clips.length }, cambios: [{ tipo: 'guion', id: x.id }], resumen: `clip ${i + 1}` }
      },
    },
    {
      nombre: 'editar_clip',
      descripcion: 'Ajusta un clip sin generar imagen: usar un recurso existente (ruta pública), cambiar cuántos segundos dura, moverlo de posición o quitarlo.',
      parametros: {
        id: s('Id del guion'),
        numero: n('Número del clip (desde 1)'),
        src: s('Ruta pública de una imagen o video ya existente (p. ej. de Recursos)'),
        segundos: n('Duración fija del clip en segundos'),
        mover_a: n('Nueva posición (desde 1)'),
        quitar: b('Quitar el clip del video (el archivo no se borra)'),
      },
      requeridos: ['id', 'numero'],
      ejecutar: async (a) => {
        const x = leerGuion(a.id)
        const clips: Clip[] = [...(x.clips || [])]
        const i = Number(a.numero) - 1
        if (!clips[i]) throw new Error(`El guion tiene ${clips.length} clips.`)
        if (a.src) {
          if (!existsSync(publico(a.src))) throw new Error(`No existe ${a.src} en public/.`)
          clips[i] = { ...clips[i], src: a.src }
        }
        if (a.segundos !== undefined) clips[i] = { ...clips[i], segundos: Number(a.segundos) || undefined }
        if (a.quitar) clips.splice(i, 1)
        else if (a.mover_a) clips.splice(Math.max(0, Number(a.mover_a) - 1), 0, clips.splice(i, 1)[0])
        g().guardar(x.id, { clips })
        return { resultado: { ok: true, clips: clips.map((c, k) => ({ numero: k + 1, src: c.src })) }, cambios: [{ tipo: 'guion', id: x.id }], resumen: `clip ${a.numero}` }
      },
    },
    {
      nombre: 'crear_guion',
      descripcion: 'Crea un guion nuevo narrado (una voz sobre clips) o de diálogo. Después se le pueden generar clips con cambiar_clip y la voz con regenerar_voz.',
      parametros: {
        titulo: s('Título'),
        lineas: { type: 'array', items: { type: 'string' }, description: 'Frases de la narración, en orden (modo narrador)' },
        formato: s('Formato', { enum: ['vertical', 'horizontal', 'cuadrado'] }),
        idioma: s('es o en'),
        voz: s('Voz Gemini del narrador: Charon, Iapetus, Kore, Puck, Orus…'),
      },
      requeridos: ['titulo', 'lineas'],
      ejecutar: async (a) => {
        const voz = a.voz || 'Charon'
        const x = g().crearDesde({
          titulo: a.titulo,
          modo: 'narrador',
          formato: a.formato || 'vertical',
          idioma: a.idioma || 'es',
          proveedorVoz: 'kie-gemini',
          personajes: [{ id: 'narrador', nombre: 'Narrador', color: '#f5b83d', voz, vozNombre: voz }],
          texto: (a.lineas || []).map((l: string) => 'Narrador: ' + l).join('\n'),
          transicion: 'variada',
          grano: true,
          vineta: true,
        } as any)
        return { resultado: { ok: true, id: x.id, composicion: 'Guion-' + x.id }, cambios: [{ tipo: 'guion', id: x.id }], resumen: x.titulo }
      },
    },
    {
      nombre: 'regenerar_voz',
      descripcion: 'Genera la voz de las frases que no tienen audio o cambiaron (Kie Gemini, ≈ $0.015 por cada 30 s). Pide confirmación.',
      parametros: { id: s('Id del guion') },
      requeridos: ['id'],
      confirmar: (a) => {
        const x = leerGuion(a.id)
        const faltan = pendientesDeAudio(x).length
        if (!faltan) return null // no hay nada que generar: no cuesta
        return `Generar la voz de "${x.titulo}" con Kie Gemini (${faltan} frase(s), ≈ $${Math.max(0.005, faltan * 0.002).toFixed(3)}).`
      },
      ejecutar: async (a) => {
        const x = leerGuion(a.id)
        g().generarAudio(x.id)
        return { resultado: { ok: true, aviso: 'La voz se está generando; el estudio muestra el progreso en Guiones.' }, cambios: [{ tipo: 'guion', id: x.id }], resumen: x.titulo }
      },
    },
    {
      nombre: 'borrar_guion',
      descripcion: 'Manda un guion a la papelera del proyecto (se puede recuperar). El video ya renderizado de la biblioteca no se toca. Pide confirmación.',
      parametros: { id: s('Id del guion') },
      requeridos: ['id'],
      confirmar: (a) => `Mandar "${leerGuion(a.id).titulo}" a la papelera.`,
      ejecutar: async (a) => {
        const x = leerGuion(a.id)
        g().borrar(x.id)
        return { resultado: { ok: true }, cambios: [{ tipo: 'guion', id: x.id }], resumen: x.titulo }
      },
    },

    // ───── Flujos ─────
    {
      nombre: 'listar_flujos',
      descripcion: 'Lista los flujos (automatizaciones tipo n8n).',
      parametros: {},
      ejecutar: async () => ({ resultado: await flujosApi('flujos') }),
    },
    {
      nombre: 'leer_flujo',
      descripcion: 'Lee un flujo: nodos (nombre, tipo, parámetros, desactivado) y conexiones.',
      parametros: { id: s('Id del flujo') },
      requeridos: ['id'],
      ejecutar: async (a) => {
        const f = await flujosApi('flujos/' + a.id)
        const nombre = Object.fromEntries(f.nodos.map((x: any) => [x.id, x.nombre]))
        const corto = (v: any) => (typeof v === 'string' && v.length > 400 ? v.slice(0, 400) + '…' : v)
        return {
          resultado: {
            id: f.id,
            nombre: f.nombre,
            activo: f.activo,
            nodos: f.nodos.map((x: any) => ({ nombre: x.nombre, tipo: x.tipo, desactivado: !!x.desactivado, params: Object.fromEntries(Object.entries(x.params || {}).map(([k, v]) => [k, corto(v)])) })),
            conexiones: f.conexiones.map((c: any) => `${nombre[c.origen]} →${c.salida ? ` (salida ${c.salida})` : ''} ${nombre[c.destino]}`),
          },
        }
      },
    },
    {
      nombre: 'plantillas_de_flujo',
      descripcion: 'Lista las plantillas para crear flujos (canal, estilo visual) y las duraciones posibles con su potencial de ingresos.',
      parametros: {},
      ejecutar: async () => ({
        resultado: {
          plantillas: PLANTILLAS.map((p) => ({ id: p.id, nombre: p.nombre, descripcion: p.descripcion, aceptaDuracion: !!p.duraciones })),
          duraciones: DURACIONES.map((d) => ({ id: d.id, potencial: d.potencial, sirve: d.sirve, nota: d.nota })),
        },
      }),
    },
    {
      nombre: 'crear_flujo',
      descripcion: 'Crea un flujo desde una plantilla (queda APAGADO; no se ejecuta). Usa plantillas_de_flujo para ver los ids.',
      parametros: {
        plantilla: s('Id de la plantilla, p. ej. dialogo, blanco'),
        duracion: s('Duración', { enum: DURACIONES.map((d) => d.id) }),
        nombre: s('Nombre del flujo (opcional)'),
        revisar: b('Vista previa antes de publicar (por defecto sí)'),
        youtube: b('Publicar en YouTube (por defecto sí)'),
        tiktok: b('Publicar en TikTok (por defecto sí en Shorts)'),
      },
      requeridos: ['plantilla'],
      ejecutar: async (a) => {
        const f = await flujosApi('plantillas/' + a.plantilla, 'POST', {
          opciones: { revisar: a.revisar !== false, youtube: a.youtube !== false, tiktok: a.tiktok !== false, duracion: a.duracion },
          nombre: a.nombre,
        })
        return { resultado: { ok: true, id: f.id, nombre: f.nombre, nodos: f.nodos.length }, cambios: [{ tipo: 'flujo', id: f.id }], resumen: f.nombre }
      },
    },
    {
      nombre: 'editar_nodo',
      descripcion: 'Cambia parámetros de un nodo de un flujo (por nombre del nodo), lo activa/desactiva o lo renombra. Los parámetros aceptan expresiones {{ }} como en n8n.',
      parametros: {
        flujo: s('Id del flujo'),
        nodo: s('Nombre actual del nodo'),
        params: { type: 'object', description: 'Parámetros a cambiar (solo los que cambian), p. ej. {"cron": "0 18 * * *"}' },
        desactivado: b('true = el nodo se salta'),
        nuevo_nombre: s('Nuevo nombre del nodo'),
      },
      requeridos: ['flujo', 'nodo'],
      ejecutar: async (a) => {
        const f = await flujosApi('flujos/' + a.flujo)
        const x = f.nodos.find((k: any) => k.nombre === a.nodo)
        if (!x) throw new Error(`No hay un nodo "${a.nodo}". Nodos: ${f.nodos.map((k: any) => k.nombre).join(', ')}`)
        if (a.params && typeof a.params === 'object') x.params = { ...x.params, ...a.params }
        if (a.desactivado !== undefined) x.desactivado = a.desactivado || undefined
        if (a.nuevo_nombre) {
          const viejo = x.nombre
          x.nombre = a.nuevo_nombre
          // Las expresiones que lo nombran siguen funcionando.
          for (const k of f.nodos) k.params = JSON.parse(JSON.stringify(k.params).split(`$('${viejo}')`).join(`$('${a.nuevo_nombre}')`))
        }
        await flujosApi('flujos/' + f.id, 'PUT', f)
        return { resultado: { ok: true }, cambios: [{ tipo: 'flujo', id: f.id }], resumen: `${a.nodo} en ${f.nombre}` }
      },
    },
    {
      nombre: 'tipos_de_nodo',
      descripcion: 'Lista los tipos de nodo disponibles (id, para qué sirve y sus parámetros), para agregar nodos a un flujo.',
      parametros: {},
      ejecutar: async () => ({ resultado: CATALOGO.map((t) => ({ tipo: t.id, nombre: t.nombre, descripcion: t.descripcion, parametros: t.campos.map((c) => c.clave) })) }),
    },
    {
      nombre: 'agregar_nodo',
      descripcion: 'Agrega un nodo a un flujo justo después de otro (queda conectado en medio de la cadena).',
      parametros: {
        flujo: s('Id del flujo'),
        tipo: s('Tipo de nodo (ver tipos_de_nodo)'),
        nombre: s('Nombre del nodo nuevo'),
        despues_de: s('Nombre del nodo tras el que va'),
        params: { type: 'object', description: 'Parámetros del nodo' },
      },
      requeridos: ['flujo', 'tipo', 'nombre', 'despues_de'],
      ejecutar: async (a) => {
        const tipo = CATALOGO.find((t) => t.id === a.tipo)
        if (!tipo) throw new Error(`No existe el tipo "${a.tipo}".`)
        const f = await flujosApi('flujos/' + a.flujo)
        const antes = f.nodos.find((k: any) => k.nombre === a.despues_de)
        if (!antes) throw new Error(`No hay un nodo "${a.despues_de}".`)
        const id = Math.random().toString(16).slice(2, 10)
        const porDefecto = Object.fromEntries(tipo.campos.map((c) => [c.clave, c.porDefecto]))
        f.nodos.push({ id, nombre: a.nombre, tipo: a.tipo, posicion: { x: antes.posicion.x + 120, y: antes.posicion.y + 160 }, params: { ...porDefecto, ...(a.params || {}) } })
        for (const c of f.conexiones) if (c.origen === antes.id) c.origen = id
        f.conexiones.push({ id: id + 'c', origen: antes.id, salida: 0, destino: id, entrada: 0 })
        await flujosApi('flujos/' + f.id, 'PUT', f)
        return { resultado: { ok: true }, cambios: [{ tipo: 'flujo', id: f.id }], resumen: `${a.nombre} en ${f.nombre}` }
      },
    },
    {
      nombre: 'ejecutar_flujo',
      descripcion: 'Ejecuta un flujo ahora. Puede gastar créditos y publicar (si tiene vista previa, espera tu aprobación antes de publicar). Pide confirmación.',
      parametros: { id: s('Id del flujo') },
      requeridos: ['id'],
      confirmar: (a) => `Ejecutar el flujo ${a.id} ahora (puede gastar créditos de Kie y publicar según sus nodos).`,
      ejecutar: async (a) => {
        const r = await flujosApi(`flujos/${a.id}/ejecutar`, 'POST', {})
        return { resultado: { ok: true, ejecucion: r.ejecucion }, cambios: [{ tipo: 'flujo', id: a.id }], resumen: a.id }
      },
    },
    {
      nombre: 'activar_flujo',
      descripcion: 'Activa o apaga un flujo (activo = sus triggers programados corren solos). Pide confirmación.',
      parametros: { id: s('Id del flujo'), activo: b('true para activar, false para apagar') },
      requeridos: ['id', 'activo'],
      confirmar: (a) => (a.activo ? `Activar el flujo ${a.id}: correrá solo según su horario (gasta y publica).` : `Apagar el flujo ${a.id}.`),
      ejecutar: async (a) => {
        const f = await flujosApi('flujos/' + a.id)
        f.activo = !!a.activo
        await flujosApi('flujos/' + f.id, 'PUT', f)
        return { resultado: { ok: true, activo: f.activo }, cambios: [{ tipo: 'flujo', id: f.id }], resumen: `${f.nombre}: ${f.activo ? 'activo' : 'apagado'}` }
      },
    },

    // ───── Recursos y biblioteca ─────
    {
      nombre: 'generar_recurso',
      descripcion: 'Genera una imagen y la guarda en Recursos (public/recursos/). Cloudflare FLUX.2 klein es gratis; Kie Nano Banana Pro (~$0.09) pide confirmación.',
      parametros: {
        prompt: s('Descripción de la imagen, en inglés. Sin texto en la imagen.'),
        nombre: s('Nombre del archivo sin extensión, p. ej. fondo-garage'),
        formato: s('Formato', { enum: ['vertical', 'horizontal', 'cuadrado'] }),
        proveedor: s('cloudflare (gratis) o kie (pago)', { enum: ['cloudflare', 'kie'] }),
      },
      requeridos: ['prompt'],
      confirmar: (a) => (a.proveedor === 'kie' ? `Generar "${a.nombre || 'imagen'}" con Kie Nano Banana Pro (≈ $0.09).` : null),
      ejecutar: async (a) => {
        const nombre = (String(a.nombre || 'imagen').replace(/[^\w-]+/g, '-').slice(0, 60) || 'imagen') + '-' + Date.now().toString(36).slice(-4) + '.jpg'
        await generarImagen({ prompt: a.prompt, formato: a.formato || 'vertical', proveedor: a.proveedor }, publico('/recursos/' + nombre))
        return { resultado: { ok: true, ruta: '/recursos/' + nombre }, cambios: [{ tipo: 'recurso' }], resumen: '/recursos/' + nombre }
      },
    },
    {
      nombre: 'listar_recursos',
      descripcion: 'Lista los archivos de Recursos (carpeta public/ del proyecto) que se pueden usar como clips o música.',
      parametros: { filtro: s('Texto que debe contener la ruta (opcional)') },
      ejecutar: async (a) => {
        const r = await fetch(`${estudio.servidor!.url}/__fotograma/api/recursos`).then((x) => x.json())
        const l = (r as any[]).filter((x) => !String(x.ruta).startsWith('/guiones/') && (!a.filtro || String(x.ruta).includes(a.filtro)))
        return { resultado: l.slice(0, 80).map((x) => x.ruta) }
      },
    },
    {
      nombre: 'listar_videos',
      descripcion: 'Lista los videos terminados de la biblioteca (por canal) y dónde están publicados. Solo lectura.',
      parametros: { canal: s('Carpeta del canal (opcional)') },
      ejecutar: async (a) => ({
        resultado: listarBiblioteca()
          .filter((v) => !a.canal || v.canal === a.canal)
          .slice(0, 40)
          .map((v) => ({ titulo: v.titulo, canal: v.canal, fecha: v.fecha, publicado: Object.keys(v.plataformas || {}) })),
      }),
    },

    // ───── Cola de renders (local y gratis: no pide confirmación) ─────
    {
      nombre: 'listar_composiciones',
      descripcion: 'Lista las composiciones que se pueden renderizar (las de código y una "Guion-<id>" por guion), con su duración y carpeta.',
      parametros: { buscar: s('Texto que debe contener el id o la carpeta (opcional)') },
      ejecutar: async (a) => {
        const q = String(a.buscar || '').toLowerCase()
        const l = (await cola().composiciones()).filter((c) => !q || (c.id + ' ' + (c.carpeta || '')).toLowerCase().includes(q))
        return { resultado: { total: l.length, composiciones: l.slice(0, 80).map((c) => ({ id: c.id, carpeta: c.carpeta, segundos: +(c.duracion / c.fps).toFixed(1), formato: `${c.ancho}x${c.alto}` })) } }
      },
    },
    {
      nombre: 'encolar_render',
      descripcion: 'Pone en la cola el render (MP4) de una o varias composiciones. Corren de a una, en orden. Con desde/hasta en segundos renderiza solo ese tramo.',
      parametros: {
        composiciones: { type: 'array', items: { type: 'string' }, description: 'Ids de las composiciones (o "Guion-<id>")' },
        desde_seg: n('Inicio del tramo en segundos (opcional)'),
        hasta_seg: n('Fin del tramo en segundos (opcional)'),
      },
      requeridos: ['composiciones'],
      ejecutar: async (a) => {
        const todas = await cola().composiciones()
        const hechos = (a.composiciones as string[]).map((id) => {
          const c = todas.find((x) => x.id === id) ?? todas.find((x) => x.id === 'Guion-' + id)
          if (!c) throw new Error(`No existe la composición "${id}". Usa listar_composiciones.`)
          return cola().encolar({ id: c.id, frames: tramo(c, a.desde_seg, a.hasta_seg) }, 'asistente')
        })
        return { resultado: hechos.map(resumenTrabajo), resumen: hechos.map((t) => t.composicion).join(', ') }
      },
    },
    {
      nombre: 'retake_tramo',
      descripcion: 'Retake: vuelve a renderizar solo un tramo (en segundos) de una composición y lo pega sobre su último video renderizado, sin rehacer todo. El audio queda igual. Sirve tras corregir algo visual de esa parte.',
      parametros: { composicion: s('Id de la composición'), desde_seg: n('Inicio del tramo en segundos'), hasta_seg: n('Fin del tramo en segundos') },
      requeridos: ['composicion', 'desde_seg', 'hasta_seg'],
      ejecutar: async (a) => {
        const c = (await cola().composiciones()).find((x) => x.id === a.composicion)
        if (!c) throw new Error(`No existe la composición "${a.composicion}".`)
        const base = cola().bases(c.id)[0]
        if (!base) throw new Error('Esa composición no tiene un video renderizado completo para hacerle retake: encola el render completo.')
        const t = cola().encolarRetake({ id: c.id, base: base.ruta, frames: tramo(c, a.desde_seg, a.hasta_seg)! }, 'asistente')
        return { resultado: { ...resumenTrabajo(t), base: base.ruta }, resumen: `${c.id} ${a.desde_seg}–${a.hasta_seg} s` }
      },
    },
    {
      nombre: 'ver_cola',
      descripcion: 'Muestra la cola de trabajos: lo que corre, lo que espera (en orden) y los últimos terminados.',
      parametros: {},
      ejecutar: async () => {
        const l = cola().lista()
        return {
          resultado: {
            activos: l.filter((t) => t.estado === 'corriendo' || t.estado === 'pendiente').map(resumenTrabajo),
            terminados: l.filter((t) => t.estado !== 'corriendo' && t.estado !== 'pendiente').slice(0, 8).map(resumenTrabajo),
          },
        }
      },
    },
    {
      nombre: 'cancelar_trabajo',
      descripcion: 'Cancela un trabajo de la cola (si espera, se saca; si corre, se detiene).',
      parametros: { id: n('Número del trabajo') },
      requeridos: ['id'],
      ejecutar: async (a) => ({ resultado: resumenTrabajo(cola().cancelar(a.id)), resumen: `#${a.id}` }),
    },
    {
      nombre: 'mover_trabajo',
      descripcion: 'Cambia el orden de un trabajo que espera en la cola.',
      parametros: { id: n('Número del trabajo'), a: s('Hacia dónde', { enum: ['primero', 'arriba', 'abajo'] }) },
      requeridos: ['id', 'a'],
      ejecutar: async (a) => ({ resultado: resumenTrabajo(cola().mover(a.id, a.a)), resumen: `#${a.id} ${a.a}` }),
    },
  ]

  const herramientasOllama = H.map((h) => ({
    type: 'function',
    function: { name: h.nombre, description: h.descripcion, parameters: { type: 'object', properties: h.parametros, required: h.requeridos || [] } },
  }))

  const sistema = (ctx: Contexto) => {
    let abierto = ''
    try {
      const idGuion = ctx.guion || (ctx.composicion?.startsWith('Guion-') ? ctx.composicion.slice(6) : '')
      if (idGuion) {
        const x = leerGuion(idGuion)
        abierto += `\nGuion abierto: "${x.titulo}" (id ${x.id}, ${x.formato}, ${x.lineas.length} frases, ${x.clips?.length || 0} clips).`
      } else if (ctx.composicion) abierto += `\nComposición abierta: ${ctx.composicion} (es un ejemplo hecho en código: no se edita desde el chat).`
    } catch {}
    if (ctx.flujo) abierto += `\nFlujo abierto: id ${ctx.flujo}.`
    return `Eres el asistente de Clipmill Estudio (internamente el paquete y la CLI se llaman fotograma), una plataforma de video (framework React + estudio + flujos tipo n8n).
Hablas en español latino, claro y breve (1-4 líneas, conclusión primero). HACES las cosas con tus herramientas; no le explicas al usuario cómo hacerlas.
Reglas:
- Si el usuario dice "este video", "este clip" o "este flujo", se refiere a lo que tiene abierto (abajo). Si no está claro, lee primero (leer_guion / leer_flujo).
- Clips y frases se numeran desde 1, como en la línea de tiempo del estudio.
- Los prompts de imagen van en inglés, detallados, sin texto en la imagen, con el mismo estilo y sujeto que el resto del video (lee los otros clips para mantener coherencia y usa "referencia").
- Por defecto usa Cloudflare (gratis). Kie cuesta dinero: úsalo solo si el usuario lo pide o pide la mejor calidad.
- Nunca publicas en redes. Los flujos se crean apagados.
- Renders: van a una cola que corre de a uno (encolar_render, ver_cola). Para corregir solo una parte de un video ya renderizado usa retake_tramo (no cambia el audio ni la duración). Si piden varios videos, crea los guiones y encola todos sus renders.
- Si cambias el texto de una frase, avisa que falta regenerar la voz (y ofrécelo).
- Al terminar, di en una línea qué cambiaste.
Pestaña actual: ${ctx.pestana || '?'}.${abierto}`
  }

  // Claude Code no recibe herramientas propias por la CLI: se le describen en el sistema y responde con un JSON
  // validado ({ texto, herramientas }) que se convierte en tool_calls, así el resto del ciclo es igual que con Ollama.
  // Sin herramientas internas (--tools ""), sin MCP y desde /tmp para que no cargue CLAUDE.md ni el proyecto.
  const esquemaClaude = JSON.stringify({
    type: 'object',
    properties: {
      texto: { type: 'string' },
      herramientas: { type: 'array', items: { type: 'object', properties: { nombre: { type: 'string', enum: H.map((h) => h.nombre) }, argumentos: { type: 'object' } }, required: ['nombre', 'argumentos'] } },
    },
    required: ['texto', 'herramientas'],
  })
  const transcribir = (m: Mensaje) =>
    m.role === 'user'
      ? `USUARIO: ${m.content}`
      : m.role === 'tool'
        ? `RESULTADO de ${m.tool_name}: ${m.content}`
        : [m.content && `ASISTENTE: ${m.content}`, ...(m.tool_calls || []).map((t) => `ASISTENTE usó ${t.function.name}(${JSON.stringify(t.function.arguments)})`)].filter(Boolean).join('\n')
  const llamarClaude = async (mensajes: Mensaje[]): Promise<Mensaje> => {
    const [sis, ...resto] = mensajes
    const catalogo = H.map((h) => `- ${h.nombre}: ${h.descripcion}\n  argumentos: ${JSON.stringify({ properties: h.parametros, required: h.requeridos || [] })}`).join('\n')
    const sistemaClaude = `${sis.content}

Herramientas disponibles (las ejecuta Clipmill, no tú):
${catalogo}

Formato: respondes SIEMPRE con el JSON { texto, herramientas }. Para usar herramientas, ponlas en "herramientas" (se ejecutan en orden y en el siguiente turno ves sus RESULTADOS). Cuando ya terminaste, "herramientas" va vacío y "texto" es tu respuesta final al usuario.`
    const salida = await new Promise<string>((ok, mal) => {
      const p = spawn('claude', ['-p', '--output-format', 'json', '--tools', '', '--strict-mcp-config', '--no-session-persistence', '--model', MODELO, '--system-prompt', sistemaClaude, '--json-schema', esquemaClaude], {
        cwd: tmpdir(),
        signal: AbortSignal.timeout(300_000),
      })
      let out = ''
      let err = ''
      p.stdout.on('data', (d) => (out += d))
      p.stderr.on('data', (d) => (err = (err + d).slice(-2000)))
      p.on('error', (e) => mal(new Error(`No pude abrir Claude Code (claude): ${e.message}`)))
      p.on('close', (c) => (c === 0 ? ok(out) : mal(new Error(`Claude Code falló (${c}): ${(err || out).slice(0, 400)}`))))
      p.stdin.end(resto.map(transcribir).join('\n\n'))
    })
    const d = JSON.parse(salida)
    if (d.is_error) throw new Error(`Claude Code: ${String(d.result).slice(0, 300)}`)
    const r = d.structured_output ?? JSON.parse(d.result)
    const llamadas: Llamada[] = (r.herramientas || []).map((h: any) => ({ function: { name: h.nombre, arguments: h.argumentos || {} } }))
    return { role: 'assistant', content: r.texto || '', ...(llamadas.length ? { tool_calls: llamadas } : {}) }
  }

  const llamarModelo = async (mensajes: Mensaje[]) => {
    if (PROVEEDOR === 'claude') return llamarClaude(mensajes)
    const cuerpo = (pensar: boolean) => ({ model: MODELO, messages: mensajes, tools: herramientasOllama, stream: false, ...(pensar ? {} : { think: false }), options: { temperature: 0.3, num_ctx: 32768 } })
    let r = await fetch(OLLAMA + '/api/chat', { method: 'POST', body: JSON.stringify(cuerpo(false)), signal: AbortSignal.timeout(300_000) })
    if (!r.ok && /think/i.test(await r.clone().text())) r = await fetch(OLLAMA + '/api/chat', { method: 'POST', body: JSON.stringify(cuerpo(true)), signal: AbortSignal.timeout(300_000) })
    if (!r.ok) throw new Error(`Ollama ${r.status}: ${(await r.text()).slice(0, 300)}`)
    const d: any = await r.json()
    return d.message as Mensaje
  }

  const correrHerramienta = async (ll: Llamada, pasos: Paso[], cambios: Cambio[], remoto = false): Promise<Mensaje> => {
    const h = H.find((x) => x.nombre === ll.function.name)
    const args = typeof ll.function.arguments === 'string' ? JSON.parse(ll.function.arguments || '{}') : ll.function.arguments || {}
    try {
      if (!h) throw new Error(`No existe la herramienta ${ll.function.name}.`)
      if (remoto && SOLO_EN_LA_PC.includes(h.nombre)) throw new Error('Desde el teléfono no se ejecutan ni activan flujos (pueden gastar y publicar): hacelo en la PC.')
      const r = await h.ejecutar(args)
      cambios.push(...(r.cambios || []))
      pasos.push({ herramienta: h.nombre, args, ok: true, resumen: r.resumen || '' })
      return { role: 'tool', tool_name: h.nombre, content: JSON.stringify(r.resultado).slice(0, 12_000) }
    } catch (e: any) {
      pasos.push({ herramienta: ll.function.name, args, ok: false, resumen: e.message })
      return { role: 'tool', tool_name: ll.function.name, content: JSON.stringify({ error: e.message }) }
    }
  }

  // historial: la conversación sin el mensaje de sistema. decision: respuesta a una herramienta pendiente.
  // remoto: la conversación viene del teléfono (Remoto); ahí no se ejecutan ni activan flujos.
  const conversar = async (historial: Mensaje[], ctx: Contexto, decision?: { llamada: Llamada; confirmar: boolean }, remoto = false): Promise<RespuestaAgente> => {
    const nuevos: Mensaje[] = []
    const pasos: Paso[] = []
    const cambios: Cambio[] = []
    if (decision) {
      nuevos.push(
        decision.confirmar
          ? await correrHerramienta(decision.llamada, pasos, cambios, remoto)
          : { role: 'tool', tool_name: decision.llamada.function.name, content: JSON.stringify({ cancelado: 'El usuario no lo autorizó.' }) },
      )
    }
    for (let vuelta = 0; vuelta < MAX_VUELTAS; vuelta++) {
      const m = await llamarModelo([{ role: 'system', content: sistema(ctx) }, ...historial, ...nuevos])
      const asistente: Mensaje = { role: 'assistant', content: m.content || '', ...(m.tool_calls?.length ? { tool_calls: m.tool_calls } : {}) }
      nuevos.push(asistente)
      if (!m.tool_calls?.length) return { mensajes: nuevos, pasos, cambios, texto: m.content || '' }
      for (let k = 0; k < m.tool_calls.length; k++) {
        const ll = m.tool_calls[k]
        const h = H.find((x) => x.nombre === ll.function.name)
        let aviso: string | null = null
        try {
          aviso = h?.confirmar?.(ll.function.arguments || {}) ?? null
        } catch {
          aviso = null
        }
        if (aviso && !(remoto && SOLO_EN_LA_PC.includes(ll.function.name))) {
          // La llamada queda pendiente y las que venían después se descartan (el modelo las repite si
          // hacen falta): así cada llamada del historial tiene exactamente una respuesta.
          asistente.tool_calls = m.tool_calls.slice(0, k + 1)
          return { mensajes: nuevos, pasos, cambios, pendiente: { llamada: ll, descripcion: aviso }, texto: m.content || '' }
        }
        nuevos.push(await correrHerramienta(ll, pasos, cambios, remoto))
      }
    }
    return { mensajes: nuevos, pasos, cambios, texto: 'Me detuve: demasiados pasos seguidos. Dime cómo seguir.' }
  }

  return { conversar, herramientas: H.map((h) => ({ nombre: h.nombre, descripcion: h.descripcion, confirma: !!h.confirmar })) }
}
