// Curvas de aceleración (easing). Fórmulas estándar, implementadas para Fotograma.
export type Curva = (t: number) => number

const bezierEje = (a: number, b: number) => (t: number) => 3 * a * (1 - t) ** 2 * t + 3 * b * (1 - t) * t ** 2 + t ** 3

// Bézier cúbica como en CSS: cubic-bezier(x1, y1, x2, y2).
const bezier = (x1: number, y1: number, x2: number, y2: number): Curva => {
  const x = bezierEje(x1, x2)
  const y = bezierEje(y1, y2)
  return (t) => {
    if (t <= 0 || t >= 1) return t
    // Newton + bisección para despejar el parámetro que da este x.
    let lo = 0
    let hi = 1
    let u = t
    for (let i = 0; i < 20; i++) {
      const dx = x(u) - t
      if (Math.abs(dx) < 1e-6) break
      if (dx > 0) hi = u
      else lo = u
      u = (lo + hi) / 2
    }
    return y(u)
  }
}

export const Curvas = {
  lineal: ((t) => t) as Curva,
  cuadratica: ((t) => t * t) as Curva,
  cubica: ((t) => t * t * t) as Curva,
  seno: ((t) => 1 - Math.cos((t * Math.PI) / 2)) as Curva,
  circular: ((t) => 1 - Math.sqrt(1 - t * t)) as Curva,
  exponencial: ((t) => (t === 0 ? 0 : 2 ** (10 * (t - 1)))) as Curva,
  potencia: (n: number): Curva => (t) => t ** n,
  retroceso: (s = 1.70158): Curva => (t) => t * t * ((s + 1) * t - s),
  elastica: (rebote = 1): Curva => (t) => 1 - Math.cos((t * Math.PI) / 2) ** 3 * Math.cos(t * rebote * Math.PI),
  rebote: ((t) => {
    const u = 1 - t
    let r: number
    if (u < 1 / 2.75) r = 7.5625 * u * u
    else if (u < 2 / 2.75) r = 7.5625 * (u - 1.5 / 2.75) ** 2 + 0.75
    else if (u < 2.5 / 2.75) r = 7.5625 * (u - 2.25 / 2.75) ** 2 + 0.9375
    else r = 7.5625 * (u - 2.625 / 2.75) ** 2 + 0.984375
    return 1 - r
  }) as Curva,
  bezier,
  // Modificadores: convierten una curva "de entrada" en salida o entrada-salida.
  entrada: (c: Curva): Curva => c,
  salida: (c: Curva): Curva => (t) => 1 - c(1 - t),
  entradaSalida: (c: Curva): Curva => (t) => (t < 0.5 ? c(t * 2) / 2 : 1 - c((1 - t) * 2) / 2),
  // Atajos comunes
  suave: bezier(0.25, 0.1, 0.25, 1),
  suaveEntrada: bezier(0.42, 0, 1, 1),
  suaveSalida: bezier(0, 0, 0.58, 1),
  suaveEntradaSalida: bezier(0.42, 0, 0.58, 1),
}
