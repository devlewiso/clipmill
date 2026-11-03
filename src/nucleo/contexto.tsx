import { createContext, useContext } from 'react'
import type { ComponentType } from 'react'

export type ConfigVideo = {
  id: string
  ancho: number
  alto: number
  fps: number
  duracion: number // en frames
}

// Campos para el formulario de props del estudio.
export type CampoEsquema =
  | { tipo: 'texto' | 'textoLargo' | 'color' | 'imagen' | 'audio' | 'video'; etiqueta?: string }
  | { tipo: 'numero'; etiqueta?: string; min?: number; max?: number; paso?: number }
  | { tipo: 'booleano'; etiqueta?: string }
  | { tipo: 'opciones'; etiqueta?: string; opciones: string[] }

export type Composicion<P extends Record<string, any> = any> = ConfigVideo & {
  componente: ComponentType<P>
  props?: P
  descripcion?: string
  carpeta?: string
  ejemplo?: boolean // demo de lo que hace Fotograma; en el estudio va en «Ejemplos» y no entre los videos del proyecto
  lufs?: number // al renderizar, normaliza el audio a este volumen (p. ej. -14 para redes)
  archivo?: string // JSON del proyecto del que salen las props (p. ej. reels/<id>.json): el inspector guarda ahí
  esquema?: { [K in keyof P]?: CampoEsquema }
  // Ajusta duración, tamaño o props según las props (p. ej. la duración de un audio).
  calcularMetadatos?: (props: P) => Partial<Omit<ConfigVideo, 'id'>> & { props?: P }
}

// Define una composición con tipos (las props por defecto se validan contra el componente).
export const definirComposicion = <P extends Record<string, any>>(c: Composicion<P>) => c

// Aplica calcularMetadatos con las props finales (las de la composición + las que se pasen).
export const resolverComposicion = (c: Composicion, props?: Record<string, any>): Composicion & { props: Record<string, any> } => {
  const p = { ...(c.props || {}), ...(props || {}) }
  const m = c.calcularMetadatos?.(p) || {}
  return { ...c, ...m, id: c.id, props: m.props ?? p }
}

export type Modo = 'estudio' | 'render'

export const CtxVideo = createContext<ConfigVideo | null>(null)
export const CtxFrame = createContext(0) // frame absoluto de la composición
export const CtxModo = createContext<{ modo: Modo; reproduciendo: boolean; volumen: number }>({
  modo: 'estudio',
  reproduciendo: false,
  volumen: 1,
})
// Pistas de la línea de tiempo del estudio (secuencias, audio, video).
export type Pista = { clave: string; nombre: string; tipo: 'secuencia' | 'audio' | 'video'; inicio: number; duracion: number; nivel: number }
export const CtxLineaTiempo = createContext<{ registrar: (p: Pista) => void; quitar: (clave: string) => void } | null>(null)
export const CtxNivel = createContext(0)
// Elementos ajustables (fotograma/escena) que se están viendo: el inspector del estudio los lista.
export type ElementoVisible = { clave: string; escena: number; nombre: string }
export const CtxElementos = createContext<{ registrar: (e: ElementoVisible) => void; quitar: (clave: string) => void } | null>(null)

// Desplazamiento acumulado de las Secuencias anidadas.
export const CtxTramo = createContext<{ inicio: number; duracion: number }>({ inicio: 0, duracion: Infinity })

export const useVideo = () => {
  const v = useContext(CtxVideo)
  if (!v) throw new Error('useVideo() solo funciona dentro de una composición de Fotograma.')
  return v
}

// Frame actual relativo a la Secuencia en la que está el componente (0 = su primer frame).
export const useFrame = () => useContext(CtxFrame) - useContext(CtxTramo).inicio

// Frame actual contado desde el inicio de la composición.
export const useFrameAbsoluto = () => useContext(CtxFrame)

// Inicio y duración de la Secuencia actual (en frames absolutos).
export const useTramo = () => useContext(CtxTramo)

export const useModo = () => useContext(CtxModo)
