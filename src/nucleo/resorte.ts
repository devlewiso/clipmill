// Animación con física de resorte (oscilador amortiguado), integrada frame a frame.

export type ConfigResorte = {
  masa?: number
  rigidez?: number
  amortiguacion?: number
  // Si es true, el valor nunca pasa del destino (sin rebote).
  sinRebote?: boolean
}

export type OpcionesResorte = {
  frame: number
  fps: number
  config?: ConfigResorte
  desde?: number
  hasta?: number
  retraso?: number // frames de espera antes de arrancar
  duracion?: number // si se da, se estira el tiempo para que dure estos frames
}

const PREDETERMINADO: Required<ConfigResorte> = { masa: 1, rigidez: 100, amortiguacion: 10, sinRebote: false }

// Avanza la simulación `t` segundos desde el reposo (valor 0 → destino 1) con pasos de 1 ms.
const simular = (t: number, c: Required<ConfigResorte>) => {
  let x = 0
  let v = 0
  const dt = 0.001
  const pasos = Math.max(0, Math.round(t / dt))
  for (let i = 0; i < pasos; i++) {
    const fuerza = -c.rigidez * (x - 1) - c.amortiguacion * v
    v += (fuerza / c.masa) * dt
    x += v * dt
    if (c.sinRebote && x > 1) {
      x = 1
      v = 0
    }
  }
  return { x, v }
}

const cache = new Map<string, number>()

// Frames que tarda el resorte en quedar prácticamente quieto.
export const duracionResorte = (fps: number, config: ConfigResorte = {}) => {
  const c = { ...PREDETERMINADO, ...config }
  const clave = `d|${fps}|${c.masa}|${c.rigidez}|${c.amortiguacion}|${c.sinRebote}`
  const guardado = cache.get(clave)
  if (guardado !== undefined) return guardado
  let f = 0
  for (; f < fps * 60; f++) {
    const { x, v } = simular(f / fps, c)
    if (Math.abs(1 - x) < 0.005 && Math.abs(v) < 0.005) break
  }
  cache.set(clave, f)
  return f
}

export const resorte = ({ frame, fps, config = {}, desde = 0, hasta = 1, retraso = 0, duracion }: OpcionesResorte) => {
  const c = { ...PREDETERMINADO, ...config }
  let f = frame - retraso
  if (f <= 0) return desde
  if (duracion) f = (f / duracion) * duracionResorte(fps, c)
  const clave = `${f}|${fps}|${c.masa}|${c.rigidez}|${c.amortiguacion}|${c.sinRebote}`
  let x = cache.get(clave)
  if (x === undefined) {
    x = simular(f / fps, c).x
    if (cache.size > 5000) cache.clear()
    cache.set(clave, x)
  }
  return desde + (hasta - desde) * x
}
