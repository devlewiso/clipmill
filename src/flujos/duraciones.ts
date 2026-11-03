// Duraciones de video y lo que rinde cada una en YouTube. Lo usan las plantillas (cuántas frases,
// capítulos e imágenes) y el estudio (qué potencial tiene y para qué sirve cada duración).
//
// Clave para monetizar: YouTube permite anuncios a mitad de video (mid-roll) desde los 8 minutos,
// así que un video de 8–12 min puede llevar anuncios antes, durante y después. Pero más largo no
// gana solo: si la gente se va al minuto 2, la duración extra sirve de poco, y un espacio mid-roll
// no garantiza que se muestre un anuncio (depende de la demanda y de la experiencia del espectador).
//
// Estrategia: Shorts de 20–60 s para atraer gente → videos de 8–12 min como monetización
// principal → 15–25 min solo cuando el tema realmente aguanta.

export type DuracionId = '30s' | '1min' | '5min' | '10min' | '20min'

export type Duracion = {
  id: DuracionId
  etiqueta: string
  segundos: number
  tipo: 'short' | 'largo' // short = vertical 9:16 (Shorts/TikTok); largo = horizontal 16:9 en capítulos
  potencial: string // potencial de monetización por video
  estrellas: 1 | 2 | 3 | 4 | 5
  sirve: string
  nota: string
  // short: frases (= imágenes) y palabras en total
  frases?: [number, number]
  palabras?: [number, number]
  // largo: capítulos, frases y palabras por capítulo (cada frase = una imagen)
  capitulos?: number
  frasesPorCapitulo?: [number, number]
  palabrasPorCapitulo?: [number, number]
}

export const DURACIONES: Duracion[] = [
  {
    id: '30s',
    etiqueta: '30 s',
    segundos: 30,
    tipo: 'short',
    potencial: 'Bajo por vista',
    estrellas: 1,
    sirve: 'Alcance / Shorts',
    nota: 'Atrae gente nueva al canal; casi no paga por vista.',
    frases: [5, 7],
    palabras: [55, 75],
  },
  {
    id: '1min',
    etiqueta: '1 min',
    segundos: 60,
    tipo: 'short',
    potencial: 'Bajo–medio',
    estrellas: 2,
    sirve: 'Videos rápidos, alcance',
    nota: 'Short más completo: alcance con un poco más de historia.',
    frases: [10, 13],
    palabras: [130, 160],
  },
  {
    id: '5min',
    etiqueta: '5 min',
    segundos: 300,
    tipo: 'largo',
    potencial: 'Medio',
    estrellas: 3,
    sirve: 'Buen equilibrio retención/ingresos',
    nota: 'Sin anuncios a mitad de video: YouTube los permite desde los 8 min.',
    capitulos: 6,
    frasesPorCapitulo: [9, 11],
    palabrasPorCapitulo: [110, 140],
  },
  {
    id: '10min',
    etiqueta: '10 min',
    segundos: 600,
    tipo: 'largo',
    potencial: 'Alto',
    estrellas: 4,
    sirve: 'Excelente para ingresos por video',
    nota: 'Pasa los 8 min: permite anuncios antes, durante y después. La monetización principal, si la gente se queda.',
    capitulos: 8,
    frasesPorCapitulo: [10, 12],
    palabrasPorCapitulo: [170, 200],
  },
  {
    id: '20min',
    etiqueta: '20 min',
    segundos: 1200,
    tipo: 'largo',
    potencial: 'Muy alto si retiene audiencia',
    estrellas: 5,
    sirve: 'Contenido profundo',
    nota: 'Solo cuando el tema realmente aguanta 20 min; si la gente se va temprano, rinde menos que uno de 10.',
    capitulos: 12,
    frasesPorCapitulo: [7, 8],
    palabrasPorCapitulo: [230, 260],
  },
]

export const ESTRATEGIA = 'Shorts de 20–60 s para atraer gente → videos de 8–12 min como monetización principal → 15–25 min cuando el tema aguante.'

export const duracionPorId = (id?: string) => DURACIONES.find((d) => d.id === id) ?? DURACIONES[0]

// Cuántas imágenes lleva el video (una por frase), tomando el punto medio de los rangos.
export const imagenesDe = (d: Duracion) =>
  d.tipo === 'short' ? Math.round((d.frases![0] + d.frases![1]) / 2) : d.capitulos! * Math.round((d.frasesPorCapitulo![0] + d.frasesPorCapitulo![1]) / 2)

export type Visual = 'imagenes' | 'video' | 'mixto' | 'kie' | 'quiz' // quiz: sin imágenes, solo voz

// Costo estimado en USD: voz Kie Gemini (~$0.12 cada 5 min de narración), 3 tomas animadas con
// Kie (~$0.30) en "video", y tomas clave con Nano Banana Pro ($0.09 c/u) en "mixto". Las imágenes
// de Cloudflare entran en la cuota gratis diaria (10,000 neuronas, ~105 por imagen con FLUX.2 klein).
// "kie": todo con Kie, sin depender de la cuota de Cloudflare (tomas clave Pro + el resto Nano Banana 2 a $0.04).
const tomasClave = (visual: Visual, d: Duracion) => (visual === 'mixto' || visual === 'kie' ? (d.tipo === 'short' ? 1 : d.capitulos!) : 0)
export const costoEstimado = (visual: Visual, d: Duracion) => {
  const voz = Math.max(0.015, (0.12 * d.segundos) / 300)
  const claves = tomasClave(visual, d)
  const resto = visual === 'kie' ? (imagenesDe(d) - claves) * 0.04 : 0
  const extra = visual === 'video' ? 0.3 : claves * 0.09 + resto
  return voz + extra
}
// $0.015 → "$0.015"; $0.96 → "$0.96"
export const dolares = (n: number) => '$' + (n < 0.1 ? n.toFixed(3) : n.toFixed(2))
export const neuronasEstimadas = (visual: Visual, d: Duracion) => (visual === 'kie' || visual === 'quiz' ? 0 : (imagenesDe(d) - tomasClave(visual, d)) * 105)
export const tiempoEstimado = (visual: Visual, d: Duracion) =>
  ({ '30s': visual === 'video' ? '≈ 6–9 min' : '≈ 3–5 min', '1min': visual === 'video' ? '≈ 8–12 min' : '≈ 5–8 min', '5min': '≈ 30–45 min', '10min': '≈ 45–70 min', '20min': '≈ 1.5–2 h' })[d.id]
