// Plantillas de flujos: punto de partida para armar flujos en el estudio (pestaña Flujos → Nuevo).
// Agrega aquí tus propias plantillas: cada una es una tarjeta con su info y una función `crear` que arma el flujo.
import type { Flujo } from '../../src/flujos/tipos'
import { armar } from './armar'
import type { DuracionId } from '../../src/flujos/duraciones'

export type Opciones = { revisar?: boolean; youtube?: boolean; tiktok?: boolean; duracion?: DuracionId; idioma?: 'es' | 'en' }

// Idioma base de una plantilla (el de su tarjeta).
export const idiomaBase = (p: { idioma?: string }) => (p.idioma === 'Inglés' ? 'en' : 'es')

// Pasa un flujo de plantilla a otro idioma (español ↔ inglés): la IA escribe en ese idioma todo lo que se
// lee o escucha, el guion y la voz cambian de idioma, y las tendencias y YouTube también.
export const aplicarIdioma = (f: Flujo, idioma: 'es' | 'en') => {
  const en = idioma === 'en'
  const orden = en
    ? '\n\nOUTPUT LANGUAGE (mandatory): write EVERYTHING the viewer reads or hears (titles, narration, questions, options, explanations, card texts, YouTube description and hashtags) in natural, native ENGLISH, even if these instructions or the input data are in Spanish.'
    : '\n\nIDIOMA DE SALIDA (obligatorio): escribe TODO lo que el espectador lee o escucha (títulos, narración, preguntas, opciones, explicaciones, textos de las cartas, descripción de YouTube y hashtags) en ESPAÑOL latino neutro y natural, aunque estas instrucciones o los datos de entrada estén en inglés.'
  for (const n of f.nodos) {
    if (n.tipo === 'llm') n.params.sistema = String(n.params.sistema || '') + orden
    if (n.tipo === 'crearGuion') {
      n.params.idioma = idioma
      n.params.estiloVoz = String(n.params.estiloVoz || '') + (en ? ' Speak in natural, native English.' : ' Habla en español latino neutro.')
    }
    if (n.tipo === 'youtube' || n.tipo === 'tendencias') n.params.idioma = idioma
    if (n.tipo === 'nota') n.params.texto = String(n.params.texto || '') + (en ? '\n\nIdioma: INGLÉS (adaptado de la plantilla en español).' : '\n\nIdioma: ESPAÑOL (adaptado de la plantilla en inglés).')
  }
  f.nombre = f.nombre.replace(/\b(ES|EN)\)/, idioma.toUpperCase() + ')')
  return f
}

// Canal de una plantilla (para su historial de temas ya usados). Libre: usa el nombre que quieras.
export type CanalId = string

const dialogo = () =>
  armar(
    'Diálogo entre personajes',
    [
      { nombre: 'Trigger manual', tipo: 'manual', x: 0, y: 0 },
      { nombre: 'Tema', tipo: 'establecer', x: 240, y: 0, params: { campos: '{\n  "tema": "Por qué el cielo es azul, explicado entre dos amigos"\n}' } },
      {
        nombre: 'Guionista',
        tipo: 'llm',
        x: 480,
        y: 0,
        params: {
          modelo: 'deepseek-v4.1-flash:cloud',
          respaldo: 'kimi-k3:cloud',
          sistema: 'Escribes diálogos breves, naturales y divertidos en español entre Ana (curiosa) y Luis (sabe del tema).',
          prompt: 'Escribe un diálogo de 6 a 8 intervenciones sobre: {{ $json.tema }}',
          esquema: JSON.stringify(
            {
              type: 'object',
              properties: {
                titulo: { type: 'string' },
                lineas: {
                  type: 'array',
                  minItems: 4,
                  maxItems: 10,
                  items: { type: 'object', properties: { personaje: { type: 'string', enum: ['Ana', 'Luis'] }, texto: { type: 'string', maxLength: 160 } }, required: ['personaje', 'texto'] },
                },
              },
              required: ['titulo', 'lineas'],
            },
            null,
            2,
          ),
        },
      },
      {
        nombre: 'Crear guion',
        tipo: 'crearGuion',
        x: 720,
        y: 0,
        params: {
          titulo: '{{ $json.output.titulo }}',
          modo: 'personajes',
          lineas: '{{ $json.output.lineas }}',
          personajes: '[\n  { "nombre": "Ana", "voz": "Kore", "color": "#ff6b9a" },\n  { "nombre": "Luis", "voz": "Charon", "color": "#4cc9f0" }\n]',
          proveedorVoz: 'kie-gemini',
        },
      },
      { nombre: 'Voz del guion', tipo: 'vozGuion', x: 960, y: 0 },
      { nombre: 'Render', tipo: 'render', x: 1200, y: 0 },
      { nombre: 'Vista previa', tipo: 'vistaPrevia', x: 1440, y: 0, params: { modo: 'revisar', destino: 'nada (solo revisión)' } },
    ],
    [
      ['Trigger manual', 'Tema'],
      ['Tema', 'Guionista'],
      ['Guionista', 'Crear guion'],
      ['Crear guion', 'Voz del guion'],
      ['Voz del guion', 'Render'],
      ['Render', 'Vista previa'],
    ],
  )

const blanco = () => armar('Flujo nuevo', [{ nombre: 'Trigger manual', tipo: 'manual', x: 0, y: 0 }], [])

// ───────── Tarjetas ─────────
export type Plantilla = {
  id: string
  nombre: string
  descripcion: string
  canal?: string
  idioma?: string
  visual?: string
  costo?: string
  duracion?: string
  publica?: string
  opciones?: (keyof Opciones)[]
  nombreFlujo?: string // nombre con el que se crea el flujo (más específico que el de la tarjeta)
  historial?: { canal: CanalId; tabla: string; campo?: string } // carpeta de la biblioteca y tabla donde se guardan los temas usados
  duracionPorDefecto?: DuracionId
  duraciones?: { id: DuracionId; costo: string; tiempo: string; imagenes: number; neuronas: number; detalle?: string }[]
  crear: (o: Opciones) => Flujo
}

export const PLANTILLAS: Plantilla[] = [
  {
    id: 'dialogo',
    nombre: 'Diálogo entre personajes',
    descripcion: 'La IA escribe un diálogo entre Ana y Luis sobre un tema; cada uno con su voz y avatar. Sin publicar.',
    idioma: 'Español',
    visual: 'Personajes',
    duracion: '≈ 2 min',
    crear: () => dialogo(),
  },
  { id: 'blanco', nombre: 'Flujo en blanco', descripcion: 'Empieza solo con un trigger manual y arma tus nodos.', crear: () => blanco() },
]
