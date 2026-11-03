// Estándar de escenas: control granular de cada elemento de un video de motion graphics desde sus datos (el JSON).
// Una plantilla envuelve cada pieza que dibuja en <Elemento nombre="titulo">…</Elemento>; el JSON del video puede
// entonces moverla, escalarla, recolorearla, retrasarla, acelerarla, cambiarle la entrada/salida u ocultarla:
//   "ajustes": { "titulo": { "y": -120, "escala": 1.2, "color": "#ffd400", "en": 0.5, "entrada": "subir" } }
// Sin ajustes el elemento no agrega nada al DOM: los videos de antes se ven exactamente igual.
// Ver docs/estandar-video.md.
import { createContext, useContext, useId, useLayoutEffect, type CSSProperties, type ReactNode } from 'react'
import { CtxElementos, CtxFrame, CtxTramo, useFrame, useVideo } from '../nucleo/contexto'
import { interpolar } from '../nucleo/interpolar'
import { resorte } from '../nucleo/resorte'

export type Movimiento = 'ninguno' | 'aparecer' | 'subir' | 'bajar' | 'izquierda' | 'derecha' | 'zoom' | 'pop'
export const MOVIMIENTOS: Movimiento[] = ['ninguno', 'aparecer', 'subir', 'bajar', 'izquierda', 'derecha', 'zoom', 'pop']

// Ajustes de un elemento. Posiciones en px del cuadro (1080×1920), tiempos en segundos desde que empieza la escena.
export type Ajuste = {
  oculto?: boolean
  x?: number // desplazamiento horizontal
  y?: number // desplazamiento vertical
  escala?: number
  rot?: number // grados
  opacidad?: number // 0–1
  color?: string // color principal del texto/figura (si la plantilla lo lee)
  tam?: number // multiplica el tamaño de letra (1 = el de la plantilla)
  fuente?: string // familia tipográfica
  en?: number // arranca a los N s de la escena (retrasa toda su animación)
  dur?: number // queda N s en pantalla desde que arranca y sale
  velocidad?: number // 2 = su animación va al doble
  entrada?: Movimiento // entrada extra, encima de la animación propia
  salida?: Movimiento // salida al terminar `dur` (o al final de la escena)
  transicion?: number // segundos de la entrada/salida (0.35)
}
export type Ajustes = Record<string, Ajuste>

// Campos editables, en orden, para el inspector del estudio.
export const CAMPOS_AJUSTE: { clave: keyof Ajuste; etiqueta: string; tipo: 'numero' | 'color' | 'texto' | 'booleano' | 'movimiento'; min?: number; max?: number; paso?: number; neutro?: unknown }[] = [
  { clave: 'oculto', etiqueta: 'Ocultar', tipo: 'booleano' },
  { clave: 'x', etiqueta: 'X (px)', tipo: 'numero', min: -1080, max: 1080, paso: 2, neutro: 0 },
  { clave: 'y', etiqueta: 'Y (px)', tipo: 'numero', min: -1920, max: 1920, paso: 2, neutro: 0 },
  { clave: 'escala', etiqueta: 'Escala', tipo: 'numero', min: 0.1, max: 3, paso: 0.01, neutro: 1 },
  { clave: 'rot', etiqueta: 'Rotación (°)', tipo: 'numero', min: -180, max: 180, paso: 1, neutro: 0 },
  { clave: 'opacidad', etiqueta: 'Opacidad', tipo: 'numero', min: 0, max: 1, paso: 0.01, neutro: 1 },
  { clave: 'color', etiqueta: 'Color', tipo: 'color' },
  { clave: 'tam', etiqueta: 'Tamaño de letra (×)', tipo: 'numero', min: 0.3, max: 3, paso: 0.01, neutro: 1 },
  { clave: 'fuente', etiqueta: 'Fuente', tipo: 'texto' },
  { clave: 'en', etiqueta: 'Empieza en (s)', tipo: 'numero', min: 0, max: 30, paso: 0.05, neutro: 0 },
  { clave: 'dur', etiqueta: 'Dura (s)', tipo: 'numero', min: 0, max: 30, paso: 0.05 },
  { clave: 'velocidad', etiqueta: 'Velocidad (×)', tipo: 'numero', min: 0.1, max: 4, paso: 0.05, neutro: 1 },
  { clave: 'entrada', etiqueta: 'Entrada', tipo: 'movimiento', neutro: 'ninguno' },
  { clave: 'salida', etiqueta: 'Salida', tipo: 'movimiento', neutro: 'ninguno' },
  { clave: 'transicion', etiqueta: 'Entrada/salida (s)', tipo: 'numero', min: 0.05, max: 3, paso: 0.05, neutro: 0.35 },
]

// Ajustes de la escena actual (los del video completo ya mezclados con los de la escena).
const CtxAjustes = createContext<{ escena: number; ajustes: Ajustes }>({ escena: -1, ajustes: {} })
// Estilo que el elemento más cercano le pasa a quien dibuja el texto (color, tamaño, fuente).
const CtxEstiloElemento = createContext<Pick<Ajuste, 'color' | 'tam' | 'fuente'>>({})

// Mezcla los ajustes del video (aplican a todas las escenas) con los de una escena (ganan los de la escena).
export const mezclarAjustes = (global?: Ajustes, escena?: Ajustes): Ajustes => {
  const r: Ajustes = { ...(global ?? {}) }
  for (const [k, v] of Object.entries(escena ?? {})) r[k] = { ...(r[k] ?? {}), ...v }
  return r
}

// Envuelve una escena: sus elementos leen estos ajustes. `escena` = índice (para el inspector).
export const EscenaAjustable = ({ escena, ajustes, global, children }: { escena: number; ajustes?: Ajustes; global?: Ajustes; children?: ReactNode }) => (
  <CtxAjustes.Provider value={{ escena, ajustes: mezclarAjustes(global, ajustes) }}>{children}</CtxAjustes.Provider>
)

// Lo que el texto de adentro debería usar: color/fuente del ajuste o los de la plantilla, tamaño multiplicado.
export const useEstiloElemento = () => useContext(CtxEstiloElemento)
export const estiloTexto = (a: Pick<Ajuste, 'color' | 'tam' | 'fuente'>, base: { color?: string; tam?: number; fuente?: string }) => ({
  color: a.color ?? base.color,
  tam: base.tam == null ? undefined : base.tam * (a.tam ?? 1),
  fuente: a.fuente ?? base.fuente,
})

const desplazar = (m: Movimiento | undefined, p: number, frame: number | null, fps: number) => {
  // p: 0 = fuera, 1 = en su lugar
  switch (m) {
    case 'aparecer': return { op: p, tr: '' }
    case 'subir': return { op: p, tr: `translateY(${(1 - p) * 140}px)` }
    case 'bajar': return { op: p, tr: `translateY(${(p - 1) * 140}px)` }
    case 'izquierda': return { op: p, tr: `translateX(${(p - 1) * 220}px)` }
    case 'derecha': return { op: p, tr: `translateX(${(1 - p) * 220}px)` }
    case 'zoom': return { op: p, tr: `scale(${0.6 + 0.4 * p})` }
    // pop: al entrar rebota con resorte; al salir (frame = null) se encoge con la curva.
    case 'pop': return { op: Math.min(1, p * 2), tr: `scale(${p >= 1 ? 1 : frame == null ? p : resorte({ frame, fps, config: { rigidez: 300, amortiguacion: 11 } })})` }
    default: return { op: 1, tr: '' }
  }
}
const suave = (x: number) => 1 - (1 - x) ** 3

// Una pieza ajustable de la escena. `capa`: ocupa todo el cuadro (svg, fondos, overlays a pantalla completa).
// `style`: estilo de la envoltura cuando hace falta una (p. ej. width: '100%' si el hijo depende del ancho del padre).
export const Elemento = ({ nombre, capa, style, children }: { nombre: string; capa?: boolean; style?: CSSProperties; children?: ReactNode }) => {
  const { escena, ajustes } = useContext(CtxAjustes)
  const a = ajustes[nombre] ?? {}
  const lt = useContext(CtxElementos)
  const clave = useId()
  useLayoutEffect(() => {
    if (!lt) return
    lt.registrar({ clave, escena, nombre })
    return () => lt.quitar(clave)
  }, [lt, clave, escena, nombre])

  const frame = useFrame()
  const tramo = useContext(CtxTramo)
  const { fps } = useVideo()
  if (a.oculto) return null
  const inicio = Math.round((a.en ?? 0) * fps)
  const fin = a.dur != null ? inicio + Math.round(a.dur * fps) : tramo.duracion
  // Antes de `en` y después de `dur` no se ve, pero guarda su lugar (el resto de la escena no se corre).
  const fuera = frame < inicio || frame >= fin
  const vel = a.velocidad && a.velocidad > 0 ? a.velocidad : 1
  const local = frame < inicio ? 0 : Math.floor((Math.min(frame, fin - 1) - inicio) * vel)

  // Tiempo propio: si arranca más tarde o va a otra velocidad, su useFrame() empieza en 0 y avanza a su ritmo.
  let contenido = <CtxEstiloElemento.Provider value={{ color: a.color, tam: a.tam, fuente: a.fuente }}>{children}</CtxEstiloElemento.Provider>
  if (inicio > 0 || vel !== 1 || fuera) {
    const ini = tramo.inicio + inicio
    contenido = (
      <CtxTramo.Provider value={{ inicio: ini, duracion: Math.max(1, Math.floor((tramo.duracion - inicio) * vel)) }}>
        <CtxFrame.Provider value={ini + local}>{contenido}</CtxFrame.Provider>
      </CtxTramo.Provider>
    )
  }

  const envoltura: CSSProperties = capa ? { position: 'absolute', inset: 0 } : { position: 'relative' }
  if (fuera) return <div data-elemento={nombre} style={{ ...envoltura, ...style, visibility: 'hidden' }}>{contenido}</div>

  const t = Math.max(1, Math.round((a.transicion ?? 0.35) * fps))
  const ent = a.entrada && a.entrada !== 'ninguno' ? desplazar(a.entrada, suave(interpolar(frame - inicio, [0, t], [0, 1], { extrapolarIzquierda: 'limitar', extrapolarDerecha: 'limitar' })), frame - inicio, fps) : null
  const sal = a.salida && a.salida !== 'ninguno' ? desplazar(a.salida, suave(interpolar(frame, [fin - t, fin], [1, 0], { extrapolarIzquierda: 'limitar', extrapolarDerecha: 'limitar' })), null, fps) : null
  const transform = [
    a.x || a.y ? `translate(${a.x ?? 0}px, ${a.y ?? 0}px)` : '',
    a.rot ? `rotate(${a.rot}deg)` : '',
    a.escala != null && a.escala !== 1 ? `scale(${a.escala})` : '',
    ent?.tr ?? '',
    sal?.tr ?? '',
  ].filter(Boolean).join(' ')
  const opacidad = (a.opacidad ?? 1) * (ent?.op ?? 1) * (sal?.op ?? 1)
  // Sin cambios visuales no hay envoltura: el layout queda idéntico al de la plantilla.
  if (!transform && opacidad === 1) return contenido
  return (
    <div data-elemento={nombre} style={{ ...envoltura, ...style, transform: transform || undefined, opacity: opacidad }}>
      {contenido}
    </div>
  )
}

// Estilo fijo o calculado con el frame del elemento (así `en` y `velocidad` también mueven su animación).
export type EstiloAnimado = CSSProperties | ((frame: number) => CSSProperties)

// Texto que toma color, tamaño (× fontSize) y fuente de los ajustes del elemento que lo envuelve.
export const TextoAjustado = ({ style, como = 'div', children }: { style?: EstiloAnimado; como?: 'div' | 'span'; children?: ReactNode }) => {
  const a = useContext(CtxEstiloElemento)
  const frame = useFrame()
  const s: CSSProperties = { ...(typeof style === 'function' ? style(frame) : style) }
  if (a.color) s.color = a.color
  if (a.fuente) s.fontFamily = a.fuente
  if (a.tam && typeof s.fontSize === 'number') s.fontSize = s.fontSize * a.tam
  const Etiqueta = como
  return <Etiqueta style={s}>{children}</Etiqueta>
}

// Atajo: un elemento que es solo un texto. `envoltura`: estilo de la envoltura (si hace falta una).
export const ElementoTexto = ({ nombre, style, como, envoltura, children }: { nombre: string; style?: EstiloAnimado; como?: 'div' | 'span'; envoltura?: CSSProperties; children?: ReactNode }) => (
  <Elemento nombre={nombre} style={envoltura}>
    <TextoAjustado style={style} como={como}>{children}</TextoAjustado>
  </Elemento>
)

// Un elemento cuyo contenido se arma con el frame del elemento: <ElementoAnimado nombre="x">{(f) => …}</ElementoAnimado>.
const Animado = ({ children }: { children: (frame: number) => ReactNode }) => <>{children(useFrame())}</>
export const ElementoAnimado = ({ nombre, capa, style, children }: { nombre: string; capa?: boolean; style?: CSSProperties; children: (frame: number) => ReactNode }) => (
  <Elemento nombre={nombre} capa={capa} style={style}>
    <Animado>{children}</Animado>
  </Elemento>
)
