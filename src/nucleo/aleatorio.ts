// Números "aleatorios" deterministas: la misma semilla da siempre el mismo valor,
// así cada frame se renderiza igual aunque se renderice varias veces o en paralelo.

const hash = (s: string) => {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

// mulberry32: generador pequeño y rápido con buena distribución.
const mulberry32 = (a: number) => {
  let t = (a + 0x6d2b79f5) | 0
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

// Devuelve un número en [0, 1). Con semilla null usa Math.random (no determinista).
export const aleatorio = (semilla: string | number | null): number => {
  if (semilla === null) return Math.random()
  return mulberry32(typeof semilla === 'number' ? hash(String(semilla)) : hash(semilla))
}

export const random = aleatorio
