// Looks de color (como los filtros/ajustes de CapCut) para clips, imágenes o escenas enteras:
//   <Color look="cine" intensidad={0.8}><Video src="toma.mp4" /></Color>
// Son filtros CSS + un tinte con mezcla «soft-light», así que se ven igual en el estudio y en el render.
// Para LUTs .cube reales sobre la toma de cámara, ver docs/color.md (lut3d de ffmpeg en tutorial.py / Limpiar).
import type { CSSProperties, ReactNode } from 'react'

type Ajustes = { brillo?: number; contraste?: number; saturacion?: number; sepia?: number; tono?: number; grises?: number }
export type Look = { nombre: string; ajustes: Ajustes; tinte?: { color: string; opacidad: number } }

export const LOOKS: Record<string, Look> = {
  natural: { nombre: 'Natural', ajustes: { contraste: 1.06, saturacion: 1.12 } },
  cine: { nombre: 'Cine', ajustes: { contraste: 1.14, saturacion: 0.92, brillo: 0.97 }, tinte: { color: '#0a5a6e', opacidad: 0.22 } },
  calido: { nombre: 'Cálido', ajustes: { sepia: 0.22, saturacion: 1.18, tono: -8, brillo: 1.03 }, tinte: { color: '#ff8a3d', opacidad: 0.12 } },
  frio: { nombre: 'Frío', ajustes: { saturacion: 0.92, tono: 8, brillo: 1.02 }, tinte: { color: '#2a6cff', opacidad: 0.16 } },
  bn: { nombre: 'Blanco y negro', ajustes: { grises: 1, contraste: 1.18 } },
  vintage: { nombre: 'Vintage', ajustes: { sepia: 0.45, contraste: 0.9, saturacion: 0.8, brillo: 1.05 }, tinte: { color: '#ffd8a0', opacidad: 0.14 } },
  noche: { nombre: 'Noche', ajustes: { brillo: 0.86, contraste: 1.16, saturacion: 0.75, tono: 10 }, tinte: { color: '#1b2a6b', opacidad: 0.2 } },
  vibrante: { nombre: 'Vibrante', ajustes: { saturacion: 1.5, contraste: 1.1 } },
  dramatico: { nombre: 'Dramático', ajustes: { contraste: 1.35, saturacion: 0.72, brillo: 0.9 } },
}

const NEUTRO: Required<Ajustes> = { brillo: 1, contraste: 1, saturacion: 1, sepia: 0, tono: 0, grises: 0 }

// El filtro CSS de un look a cierta intensidad (0 = sin cambios, 1 = el look completo).
export const filtroColor = (look?: string, intensidad = 1) => {
  const l = look ? LOOKS[look] : undefined
  if (!l || intensidad <= 0) return undefined
  const v = (k: keyof Ajustes) => NEUTRO[k] + ((l.ajustes[k] ?? NEUTRO[k]) - NEUTRO[k]) * intensidad
  return [
    `brightness(${v('brillo').toFixed(3)})`,
    `contrast(${v('contraste').toFixed(3)})`,
    `saturate(${v('saturacion').toFixed(3)})`,
    `sepia(${v('sepia').toFixed(3)})`,
    `hue-rotate(${v('tono').toFixed(1)}deg)`,
    `grayscale(${v('grises').toFixed(3)})`,
  ].join(' ')
}

export const Color = ({ look, intensidad = 1, children, style }: { look?: string; intensidad?: number; children?: ReactNode; style?: CSSProperties }) => {
  const filtro = filtroColor(look, intensidad)
  const tinte = look ? LOOKS[look]?.tinte : undefined
  if (!filtro) return <>{children}</>
  return (
    <div style={{ position: 'absolute', inset: 0, ...style }}>
      <div style={{ position: 'absolute', inset: 0, filter: filtro }}>{children}</div>
      {tinte && <div style={{ position: 'absolute', inset: 0, background: tinte.color, opacity: tinte.opacidad * intensidad, mixBlendMode: 'soft-light', pointerEvents: 'none' }} />}
    </div>
  )
}
