// Producción desde guion: los personajes son los "ingredientes" y cada línea del guion se convierte
// en una toma con su audio, el personaje que habla y subtítulos palabra por palabra.

export type Personaje = {
  id: string
  nombre: string
  color: string
  imagen?: string // ruta pública (/guiones/<id>/personajes/x.png)
  voz: string // id de voz de ElevenLabs
  vozNombre?: string
}

export type Palabra = { texto: string; inicioMs: number; finMs: number }

export type LineaGuion = {
  id: string
  personaje: string // id del personaje
  texto: string
  audio?: string // ruta pública del mp3
  duracionMs?: number
  palabras?: Palabra[]
  firma?: string // texto + voz con que se generó el audio (si cambia, hay que regenerarlo)
  pausaDespuesMs?: number // silencio extra después de esta línea (se edita arrastrando su borde en la línea de tiempo)
}

export type Formato = 'vertical' | 'horizontal' | 'cuadrado'

// personajes: se ve quién habla (avatar, nombre). narrador: una voz sobre los clips de fondo, como los Shorts.
export type Modo = 'personajes' | 'narrador' | 'quiz' | 'cartas'

// Quiz / acertijos: cada pregunta se muestra con sus opciones, corre una cuenta regresiva y se revela
// la respuesta. Las líneas del guion son: intro, (pregunta, respuesta) × N y cierre.
export type PreguntaQuiz = { pregunta: string; opciones: string[]; correcta: number; explicacion?: string }
export type Quiz = { preguntas: PreguntaQuiz[]; cuentaS: number; intro: string; cierre: string; marca?: string; tema?: string }

// Cartas: cuenta regresiva (#N → #1) de animales con un superpoder real, cada uno como una carta
// coleccionable que dibuja Fotograma (emoji, superpoder, una cifra y barras). Líneas: intro, una por carta, cierre.
export type Stat = { etiqueta: string; valor: number } // valor de 0 a 100
export type Carta = { nombre: string; cientifico?: string; emoji: string; poder: string; dato: string; cifra?: string; stats: Stat[] }
export type Cartas = { cartas: Carta[]; intro: string; cierre: string; marca?: string; tema?: string }

// Video o imagen de fondo. Los clips se reparten a lo largo de todo el video, uno detrás de otro.
export type Clip = {
  src: string
  segundos?: number
  recorte?: number
  color?: string // look de fotograma/color
  intensidadColor?: number
  velocidad?: number // videos: 0.25–3 (cámara lenta / rápida)
  congelar?: boolean // videos: cuadro congelado en `recorte`
  // Cámara lenta suave: versión con cuadros interpolados (minterpolate) del tramo [desde, desde + segundos·velocidad].
  lento?: { src: string; desde: number; velocidad: number }
}

// Texto o sticker (emoji) en pantalla entre `desde` y `hasta` (segundos), agregado desde la línea de tiempo.
export type TextoEnPantalla = { id: string; texto: string; desde: number; hasta: number; posicion?: 'arriba' | 'centro' | 'abajo'; tamano?: number; color?: string }

export type Guion = {
  id: string
  titulo: string
  formato: Formato
  fps: number
  texto: string // guion tal como se escribió ("Nombre: lo que dice")
  personajes: Personaje[]
  lineas: LineaGuion[]
  modo?: Modo
  fondo: string // color o gradiente CSS
  fondoImagen?: string
  clips?: Clip[]
  colorClips?: string // look de color para los clips que no tienen uno propio
  textos?: TextoEnPantalla[]
  quiz?: Quiz
  cartas?: Cartas
  transicion?: string // entre clips: variada, fundido, zoom, deslizar, empujar, barrido, desenfoque, iris, destello, ninguna
  grano?: boolean
  vineta?: boolean
  musica?: string // ruta pública de una pista de música de fondo
  volumenMusica?: number
  pausaMs: number // silencio entre líneas
  portada: boolean // mostrar el título al inicio
  subtitulos: boolean
  // Lo que se usa al publicar (lo escribe la IA en los flujos; se puede editar antes de publicar).
  publicacion?: { titulo?: string; descripcion?: string; hashtags?: string[]; canal?: string; categoria?: string }
  // Voz: Kie Gemini (barato, por defecto) o ElevenLabs. estiloVoz describe cómo debe sonar (Gemini).
  proveedorVoz?: 'kie-gemini' | 'elevenlabs'
  estiloVoz?: string
  modelo: string // modelo de ElevenLabs (solo si proveedorVoz = elevenlabs)
  idioma: string
  actualizado?: string
}

export const MEDIDAS: Record<Formato, { ancho: number; alto: number }> = {
  vertical: { ancho: 1080, alto: 1920 },
  horizontal: { ancho: 1920, alto: 1080 },
  cuadrado: { ancho: 1080, alto: 1080 },
}

export const guionNuevo = (id: string, titulo: string): Guion => ({
  id,
  titulo,
  formato: 'vertical',
  fps: 30,
  texto: 'Ana: ¡Hola! Bienvenidos a un nuevo video.\nLuis: Hoy vamos a ver algo increíble.',
  personajes: [
    { id: 'ana', nombre: 'Ana', color: '#ff6b9a', voz: 'Kore', vozNombre: 'Kore' },
    { id: 'luis', nombre: 'Luis', color: '#4cc9f0', voz: 'Charon', vozNombre: 'Charon' },
  ],
  lineas: [],
  fondo: 'linear-gradient(160deg, #1b1035 0%, #0d1b2a 100%)',
  pausaMs: 250,
  portada: true,
  subtitulos: true,
  proveedorVoz: 'kie-gemini',
  modelo: 'eleven_multilingual_v2',
  idioma: 'es',
})
