// Interpolación entre rangos, con curvas y extrapolación. Implementación propia de Fotograma.
// Los nombres en inglés (interpolate, InterpolateOptions…) existen para el código MIT de terceros.

export type Extrapolacion = 'extender' | 'limitar' | 'identidad' | 'extend' | 'clamp' | 'identity' | 'wrap' | 'repetir'
export type ExtrapolateType = Extrapolacion

export type OpcionesInterpolar = {
  curva?: (t: number) => number
  easing?: (t: number) => number
  extrapolarIzquierda?: Extrapolacion
  extrapolarDerecha?: Extrapolacion
  extrapolateLeft?: Extrapolacion
  extrapolateRight?: Extrapolacion
  // Redondea el resultado a múltiplos de este paso (movimiento "a saltos").
  posterizar?: number
  posterize?: number
}
export type InterpolateOptions = OpcionesInterpolar

const normalizar = (e: Extrapolacion | undefined): 'extender' | 'limitar' | 'identidad' | 'repetir' => {
  switch (e) {
    case 'clamp':
    case 'limitar':
      return 'limitar'
    case 'identity':
    case 'identidad':
      return 'identidad'
    case 'wrap':
    case 'repetir':
      return 'repetir'
    default:
      return 'extender'
  }
}

const tramo = (x: number, a: number, b: number, c: number, d: number, curva: (t: number) => number, izq: string, der: string) => {
  let v = x
  if (v < a) {
    if (izq === 'identidad') return v
    if (izq === 'limitar') v = a
    if (izq === 'repetir') v = a + ((((v - a) % (b - a)) + (b - a)) % (b - a))
  }
  if (v > b) {
    if (der === 'identidad') return v
    if (der === 'limitar') v = b
    if (der === 'repetir') v = a + ((v - a) % (b - a))
  }
  if (c === d) return c
  const t = a === b ? 0 : (v - a) / (b - a)
  return c + curva(t) * (d - c)
}

// Con salidas vectoriales (arrays de números) interpola cada componente por separado.
export function interpolar(valor: number, entrada: readonly number[], salida: readonly number[], opciones?: OpcionesInterpolar): number
export function interpolar(valor: number, entrada: readonly number[], salida: readonly (readonly number[])[], opciones?: OpcionesInterpolar): number[]
export function interpolar(valor: number, entrada: readonly number[], salida: readonly (number | readonly number[])[], opciones: OpcionesInterpolar = {}): number | number[] {
  if (Array.isArray(salida[0])) {
    const vectores = salida as readonly (readonly number[])[]
    return vectores[0].map((_, k) => interpolar(valor, entrada, vectores.map((v) => v[k]), opciones))
  }
  return interpolarEscalar(valor, entrada, salida as readonly number[], opciones)
}

const interpolarEscalar = (valor: number, entrada: readonly number[], salida: readonly number[], opciones: OpcionesInterpolar): number => {
  if (entrada.length !== salida.length) throw new Error('interpolar: la entrada y la salida deben tener el mismo largo.')
  if (entrada.length < 2) throw new Error('interpolar: se necesitan al menos 2 puntos.')
  for (let i = 1; i < entrada.length; i++)
    if (!(entrada[i] > entrada[i - 1])) throw new Error(`interpolar: la entrada debe ser estrictamente creciente (${entrada.join(', ')}).`)
  if (!Number.isFinite(valor)) return valor

  const curva = opciones.curva ?? opciones.easing ?? ((t: number) => t)
  const izq = normalizar(opciones.extrapolarIzquierda ?? opciones.extrapolateLeft)
  const der = normalizar(opciones.extrapolarDerecha ?? opciones.extrapolateRight)

  let i = 1
  while (i < entrada.length - 1 && valor > entrada[i]) i++
  let r = tramo(valor, entrada[i - 1], entrada[i], salida[i - 1], salida[i], curva, izq, der)

  const paso = opciones.posterizar ?? opciones.posterize
  if (paso) r = Math.round(r / paso) * paso
  return r
}

export const interpolate = interpolar
