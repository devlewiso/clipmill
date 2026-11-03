import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

// Rutas del proyecto abierto. Se fijan al arrancar el estudio con iniciarRutas().
export const R = {
  proyecto: '',
  DIR_FLUJOS: '', // <proyecto>/flujos: los workflows (van a git)
  DIR_TABLAS: '', // <proyecto>/datos/tablas: tablas de datos (historial, etc.)
  DIR_EJECUCIONES: '', // <proyecto>/.fotograma/ejecuciones
  DIR_ARCHIVOS: '', // <proyecto>/.fotograma/archivos: lo que generan las ejecuciones
}

export const iniciarRutas = (proyecto: string) => {
  R.proyecto = proyecto
  R.DIR_FLUJOS = join(proyecto, 'flujos')
  R.DIR_TABLAS = join(proyecto, 'datos', 'tablas')
  R.DIR_EJECUCIONES = join(proyecto, '.fotograma', 'ejecuciones')
  R.DIR_ARCHIVOS = join(proyecto, '.fotograma', 'archivos')
  for (const d of [R.DIR_FLUJOS, R.DIR_TABLAS, R.DIR_EJECUCIONES, R.DIR_ARCHIVOS]) mkdirSync(d, { recursive: true })
}

// Los secretos viven fuera de los proyectos.
export const DIR_SECRETOS = join(homedir(), '.config', 'fotograma')

// Carpetas que ven los workflows de n8n dentro del contenedor, y dónde están en esta máquina.
// El importador traduce las rutas con esto. Configurable con FOTOGRAMA_HERRAMIENTAS y FOTOGRAMA_ARCHIVOS_N8N.
export const HERRAMIENTAS_N8N = process.env.FOTOGRAMA_HERRAMIENTAS || join(homedir(), '.config', 'fotograma', 'herramientas')
const ARCHIVOS_N8N = process.env.FOTOGRAMA_ARCHIVOS_N8N || join(homedir(), 'fotograma-archivos')
export const RUTAS_N8N: [string, string][] = [
  ['/opt/tools', HERRAMIENTAS_N8N],
  ['/files', ARCHIVOS_N8N],
]

// Variables de entorno para que los scripts de las herramientas funcionen fuera del contenedor.
export const ENTORNO_HERRAMIENTAS: Record<string, string> = {
  WWR_DIR: ARCHIVOS_N8N,
  WWR_FFMPEG: join(HERRAMIENTAS_N8N, 'ffmpeg'),
  WWR_FFPROBE: join(HERRAMIENTAS_N8N, 'ffprobe'),
  WWR_FONTS: join(HERRAMIENTAS_N8N, 'fonts'),
  TOOLS_DIR: HERRAMIENTAS_N8N,
}
