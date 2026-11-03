import { interpolar, type OpcionesInterpolar } from './interpolar'

type RGBA = [number, number, number, number]

let lienzo: CanvasRenderingContext2D | null = null

// Convierte cualquier color CSS (#hex, rgb(), hsl(), nombres) a [r, g, b, a].
export const aRgba = (color: string): RGBA => {
  const hex = color.trim().match(/^#([\da-f]{3,8})$/i)?.[1]
  if (hex) {
    const h = hex.length <= 4 ? [...hex].map((c) => c + c).join('') : hex
    const n = (i: number) => parseInt(h.slice(i, i + 2), 16)
    return [n(0), n(2), n(4), h.length === 8 ? n(6) / 255 : 1]
  }
  const rgb = color.match(/rgba?\(([^)]+)\)/i)?.[1]
  if (rgb) {
    const [r, g, b, a = '1'] = rgb.split(/[\s,/]+/).filter(Boolean)
    return [parseFloat(r), parseFloat(g), parseFloat(b), parseFloat(a)]
  }
  // Otros formatos: el navegador los normaliza.
  lienzo ??= document.createElement('canvas').getContext('2d')
  if (!lienzo) return [0, 0, 0, 1]
  lienzo.fillStyle = color
  return aRgba(lienzo.fillStyle as string)
}

export const interpolarColor = (valor: number, entrada: readonly number[], colores: readonly string[], opciones?: OpcionesInterpolar) => {
  const rgba = colores.map(aRgba)
  const canal = (k: number) =>
    interpolar(
      valor,
      entrada,
      rgba.map((c) => c[k]),
      { extrapolarIzquierda: 'limitar', extrapolarDerecha: 'limitar', ...opciones },
    )
  return `rgba(${Math.round(canal(0))}, ${Math.round(canal(1))}, ${Math.round(canal(2))}, ${+canal(3).toFixed(3)})`
}
