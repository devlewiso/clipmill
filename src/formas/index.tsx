// Formas SVG. Los generadores de trazos vienen de @remotion/shapes (MIT, ver src/terceros/LICENCIAS.md);
// los componentes y el trazo animado son de Fotograma.
import type { CSSProperties, SVGProps } from 'react'
import { makeArrow } from '../terceros/formas/make-arrow'
import { makeCallout } from '../terceros/formas/make-callout'
import { makeCircle } from '../terceros/formas/make-circle'
import { makeEllipse } from '../terceros/formas/make-ellipse'
import { makeHeart } from '../terceros/formas/make-heart'
import { makePie } from '../terceros/formas/make-pie'
import { makePolygon } from '../terceros/formas/make-polygon'
import { makeRect } from '../terceros/formas/make-rect'
import { makeSpark } from '../terceros/formas/make-spark'
import { makeStar } from '../terceros/formas/make-star'
import { makeTriangle } from '../terceros/formas/make-triangle'
import type { ShapeInfo } from '../terceros/formas/shape-info'
import { evolvePath } from '../terceros/trazos'

export { makeArrow, makeCallout, makeCircle, makeEllipse, makeHeart, makePie, makePolygon, makeRect, makeSpark, makeStar, makeTriangle }
export type { ShapeInfo }

type PropsPath = Omit<SVGProps<SVGPathElement>, 'd'> & { estiloSvg?: CSSProperties }

// Dibuja lo que devuelve un generador make*.
export const Forma = ({ forma, estiloSvg, ...path }: PropsPath & { forma: ShapeInfo }) => (
  <svg width={forma.width} height={forma.height} viewBox={`0 0 ${forma.width} ${forma.height}`} style={{ overflow: 'visible', ...estiloSvg }}>
    <path d={forma.path} {...path} />
  </svg>
)

const componente =
  <O,>(hacer: (o: O) => ShapeInfo) =>
  ({ estiloSvg, ...resto }: PropsPath & O) => {
    const forma = hacer(resto as O)
    // Los props de la forma no se pasan al <path>.
    const path = Object.fromEntries(Object.entries(resto).filter(([k]) => /^(fill|stroke|opacity|style|className|transform|on[A-Z])/.test(k)))
    return <Forma forma={forma} estiloSvg={estiloSvg} {...path} />
  }

export const Circulo = componente(makeCircle)
export const Elipse = componente(makeEllipse)
export const Rectangulo = componente(makeRect)
export const Triangulo = componente(makeTriangle)
export const Estrella = componente(makeStar)
export const Poligono = componente(makePolygon)
export const Corazon = componente(makeHeart)
export const Pastel = componente(makePie)
export const Flecha = componente(makeArrow)
export const Globo = componente(makeCallout)
export const Chispa = componente(makeSpark)

// Trazo que se va dibujando: progreso 0 = nada, 1 = completo.
export const TrazoAnimado = ({
  d,
  progreso,
  ancho,
  alto,
  ...path
}: Omit<SVGProps<SVGPathElement>, 'd'> & { d: string; progreso: number; ancho: number; alto: number }) => {
  const { strokeDasharray, strokeDashoffset } = evolvePath(Math.max(0, Math.min(1, progreso)), d)
  return (
    <svg width={ancho} height={alto} viewBox={`0 0 ${ancho} ${alto}`} style={{ overflow: 'visible' }}>
      <path d={d} fill="none" stroke="currentColor" strokeWidth={4} strokeLinecap="round" {...path} strokeDasharray={strokeDasharray} strokeDashoffset={strokeDashoffset} />
    </svg>
  )
}
