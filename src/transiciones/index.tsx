// Transiciones entre escenas. Implementación propia de Fotograma.
//
// <SerieTransiciones>
//   <SerieTransiciones.Tramo duracion={60}><EscenaA /></SerieTransiciones.Tramo>
//   <SerieTransiciones.Transicion efecto={deslizar('izquierda')} tiempo={tiempoLineal(20)} />
//   <SerieTransiciones.Tramo duracion={60}><EscenaB /></SerieTransiciones.Tramo>
// </SerieTransiciones>
//
// Durante la transición las dos escenas se superponen, así que la serie dura
// (suma de tramos) − (suma de transiciones).
import { Children, isValidElement, type CSSProperties, type ReactElement, type ReactNode } from 'react'
import { Curvas, type Curva } from '../nucleo/curvas'
import { Capa, Secuencia } from '../nucleo/estructura'
import { useFrame, useVideo } from '../nucleo/contexto'
import { duracionResorte, resorte, type ConfigResorte } from '../nucleo/resorte'

export type Lado = 'entrada' | 'salida'

export type Efecto = {
  // Estilo de cada escena según el progreso p (0 → 1) de la transición.
  estilo: (p: number, lado: Lado, cuadro: { ancho: number; alto: number }) => CSSProperties
  // Algo que se dibuja encima de ambas escenas (p. ej. un destello).
  encima?: (p: number) => ReactNode
  // Qué escena va arriba mientras se superponen (por defecto, la que entra).
  arriba?: Lado
}

export type Tiempo = { duracion: number; progreso: (frame: number) => number }

export const tiempoLineal = (duracion: number, curva: Curva = Curvas.suaveEntradaSalida): Tiempo => ({
  duracion,
  progreso: (f) => curva(Math.min(1, Math.max(0, f / duracion))),
})

export const tiempoResorte = (fps: number, config: ConfigResorte = { amortiguacion: 200 }, duracion?: number): Tiempo => {
  const d = duracion ?? duracionResorte(fps, config)
  return { duracion: d, progreso: (f) => Math.min(1, resorte({ frame: f, fps, config, duracion: d })) }
}

// ───────── Efectos ─────────
export type Direccion = 'izquierda' | 'derecha' | 'arriba' | 'abajo'
const vector = (d: Direccion) => ({ izquierda: [-1, 0], derecha: [1, 0], arriba: [0, -1], abajo: [0, 1] })[d]

export const fundido = (): Efecto => ({ estilo: (p, lado) => ({ opacity: lado === 'entrada' ? p : 1 }) })

// La escena nueva entra deslizándose por encima de la anterior.
export const deslizar = (desde: Direccion = 'derecha'): Efecto => ({
  estilo: (p, lado) => {
    if (lado === 'salida') return {}
    const [x, y] = vector(desde)
    return { transform: `translate(${x * (1 - p) * 100}%, ${y * (1 - p) * 100}%)` }
  },
})

// Las dos escenas se mueven juntas: la nueva empuja a la anterior fuera del cuadro.
export const empujar = (desde: Direccion = 'derecha'): Efecto => ({
  estilo: (p, lado) => {
    const [x, y] = vector(desde)
    const k = lado === 'entrada' ? 1 - p : -p
    return { transform: `translate(${x * k * 100}%, ${y * k * 100}%)` }
  },
})

// Barrido: la escena nueva se revela con un borde recto.
export const barrido = (desde: Direccion = 'izquierda'): Efecto => ({
  estilo: (p, lado) => {
    if (lado === 'salida') return {}
    const r = (1 - p) * 100
    const inset = { izquierda: `0 ${r}% 0 0`, derecha: `0 0 0 ${r}%`, arriba: `0 0 ${r}% 0`, abajo: `${r}% 0 0 0` }[desde]
    return { clipPath: `inset(${inset})` }
  },
})

// Iris: círculo que se abre desde un punto.
export const iris = (centro: [number, number] = [50, 50]): Efecto => ({
  estilo: (p, lado) => (lado === 'salida' ? {} : { clipPath: `circle(${p * 75}% at ${centro[0]}% ${centro[1]}%)` }),
})

export const zoom = (escala = 1.25): Efecto => ({
  estilo: (p, lado) =>
    lado === 'entrada'
      ? { opacity: p, transform: `scale(${1 / escala + (1 - 1 / escala) * p})` }
      : { transform: `scale(${1 + (escala - 1) * p})` },
})

export const desenfoque = (radio = 24): Efecto => ({
  estilo: (p, lado) =>
    lado === 'entrada' ? { opacity: p, filter: `blur(${(1 - p) * radio}px)` } : { filter: `blur(${p * radio}px)` },
})

// Tarjeta que gira en 3D (la escena anterior es el frente y la nueva el dorso).
export const voltear = (eje: 'x' | 'y' = 'y'): Efecto => ({
  arriba: 'salida',
  estilo: (p, lado) => {
    const giro = lado === 'salida' ? p * 180 : p * 180 - 180
    const visible = lado === 'salida' ? p < 0.5 : p >= 0.5
    return {
      transform: `perspective(1600px) rotate${eje.toUpperCase()}(${giro}deg)`,
      backfaceVisibility: 'hidden',
      opacity: visible ? 1 : 0,
    }
  },
})

// Persiana: franjas que se abren a la vez.
export const persiana = (franjas = 8, vertical = true): Efecto => ({
  estilo: (p, lado) => {
    if (lado === 'salida') return {}
    const tam = 100 / franjas
    const abierto = tam * p
    const puntos: string[] = []
    for (let i = 0; i < franjas; i++) {
      const a = i * tam
      const b = a + abierto
      puntos.push(vertical ? `${a}% 0%, ${b}% 0%, ${b}% 100%, ${a}% 100%, ${a}% 0%` : `0% ${a}%, 100% ${a}%, 100% ${b}%, 0% ${b}%, 0% ${a}%`)
    }
    // Un solo polígono que recorre todas las franjas y vuelve por el borde.
    return { clipPath: `polygon(evenodd, ${puntos.join(', ')})` }
  },
})

// Reloj: barrido circular como las agujas.
export const reloj = (): Efecto => ({
  estilo: (p, lado) =>
    lado === 'salida'
      ? {}
      : {
          WebkitMaskImage: `conic-gradient(#000 ${p * 360}deg, transparent ${p * 360}deg)`,
          maskImage: `conic-gradient(#000 ${p * 360}deg, transparent ${p * 360}deg)`,
        },
})

// Puertas: la escena anterior se abre por el centro hacia los lados.
export const puertas = (): Efecto => ({
  arriba: 'salida',
  estilo: (p, lado) => (lado === 'salida' ? { clipPath: `polygon(0 0, ${50 - p * 50}% 0, ${50 - p * 50}% 100%, 0 100%, 0 0, 100% 0, ${50 + p * 50}% 0, ${50 + p * 50}% 100%, 100% 100%, 100% 0)` } : {}),
})

// Destello: corte con un flash de luz en el medio.
export const destello = (color = '#fff'): Efecto => ({
  estilo: (p, lado) => ({ opacity: lado === 'entrada' ? (p >= 0.5 ? 1 : 0) : p < 0.5 ? 1 : 0 }),
  encima: (p) => <Capa style={{ background: color, opacity: 1 - Math.abs(p - 0.5) * 2, pointerEvents: 'none' }} />,
})

export const Efectos = { fundido, deslizar, empujar, barrido, iris, zoom, desenfoque, voltear, persiana, reloj, puertas, destello }

// ───────── Serie con transiciones ─────────
type PropsTramo = { duracion: number; children?: ReactNode; style?: CSSProperties }
type PropsTransicion = { efecto: Efecto; tiempo: Tiempo }
const Tramo = (_: PropsTramo): null => null
const Transicion = (_: PropsTransicion): null => null

// Aplica los estilos de entrada/salida según el frame dentro del tramo.
const Escena = ({
  duracion,
  entrada,
  salida,
  children,
  style,
}: {
  duracion: number
  entrada?: PropsTransicion
  salida?: PropsTransicion
  children?: ReactNode
  style?: CSSProperties
}) => {
  const f = useFrame()
  const { ancho, alto } = useVideo()
  let estilo: CSSProperties = { ...style }
  let encima: ReactNode = null
  let z = 0
  if (entrada && f < entrada.tiempo.duracion) {
    const p = entrada.tiempo.progreso(f)
    estilo = { ...estilo, ...entrada.efecto.estilo(p, 'entrada', { ancho, alto }) }
    z = (entrada.efecto.arriba ?? 'entrada') === 'entrada' ? 1 : 0
    encima = entrada.efecto.encima?.(p)
  }
  if (salida) {
    const inicio = duracion - salida.tiempo.duracion
    if (f >= inicio) {
      const p = salida.tiempo.progreso(f - inicio)
      estilo = { ...estilo, ...salida.efecto.estilo(p, 'salida', { ancho, alto }) }
      z = salida.efecto.arriba === 'salida' ? 1 : 0
    }
  }
  return (
    <>
      <Capa style={{ ...estilo, zIndex: z }}>{children}</Capa>
      {encima && <div style={{ position: 'absolute', inset: 0, zIndex: 2 }}>{encima}</div>}
    </>
  )
}

export const SerieTransiciones = ({ children }: { children?: ReactNode }) => {
  const hijos = Children.toArray(children).filter(isValidElement) as ReactElement<any>[]
  const tramos: { props: PropsTramo; entrada?: PropsTransicion; salida?: PropsTransicion; desde: number }[] = []
  let cursor = 0
  let pendiente: PropsTransicion | undefined
  for (const h of hijos) {
    if (h.type === Transicion) {
      if (!tramos.length) throw new Error('Una <Transicion> tiene que ir entre dos <Tramo>.')
      pendiente = h.props as PropsTransicion
      const anterior = tramos[tramos.length - 1]
      anterior.salida = pendiente
      cursor -= pendiente.tiempo.duracion
    } else if (h.type === Tramo) {
      const props = h.props as PropsTramo
      if (pendiente && pendiente.tiempo.duracion > props.duracion)
        throw new Error('La transición dura más que el tramo que entra.')
      tramos.push({ props, entrada: pendiente, desde: cursor })
      cursor += props.duracion
      pendiente = undefined
    } else throw new Error('Dentro de <SerieTransiciones> solo van <Tramo> y <Transicion>.')
  }
  return (
    <>
      {tramos.map((t, i) => (
        <Secuencia key={i} desde={t.desde} duracion={t.props.duracion}>
          <Escena duracion={t.props.duracion} entrada={t.entrada} salida={t.salida} style={t.props.style}>
            {t.props.children}
          </Escena>
        </Secuencia>
      ))}
    </>
  )
}
SerieTransiciones.Tramo = Tramo
SerieTransiciones.Transicion = Transicion

// Duración total de una serie: útil para la `duracion` de la composición.
export const duracionSerie = (tramos: number[], transiciones: number[]) =>
  tramos.reduce((a, b) => a + b, 0) - transiciones.reduce((a, b) => a + b, 0)
