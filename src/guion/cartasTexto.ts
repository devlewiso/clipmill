// Texto y tiempos del modo cartas (sin JSX: lo usan también el servidor y los flujos).
import type { Cartas, Guion } from './tipos'

// Las cartas vienen ordenadas de menor a mayor impacto: la última es el #1.
export const puestoCarta = (c: Cartas, k: number) => c.cartas.length - k

// Texto que lee la voz en cada línea: intro, "Number 3: …" por carta y cierre.
export const lineasCartas = (c: Cartas, idioma = 'en') => {
  const es = idioma.startsWith('es')
  const n = c.cartas.length
  return [
    c.intro,
    ...c.cartas.map((x, k) => {
      const puesto = n - k
      const prefijo = puesto === 1 ? (es ? 'Y el número uno:' : 'And number one:') : es ? `Número ${puesto}:` : `Number ${puesto}:`
      return `${prefijo} ${x.dato}`
    }),
    c.cierre,
  ]
}

export type RolCartas = { tipo: 'intro' | 'carta' | 'cierre'; k: number }
export const rolCartas = (g: Guion, i: number): RolCartas => {
  if (i === 0) return { tipo: 'intro', k: 0 }
  if (i === g.lineas.length - 1) return { tipo: 'cierre', k: 0 }
  return { tipo: 'carta', k: i - 1 }
}

// Un respiro después de cada carta para que se vea completa antes de la siguiente (más en el #1).
export const extraCartasMs = (g: Guion, i: number) => {
  if (g.modo !== 'cartas' || !g.cartas) return 0
  const r = rolCartas(g, i)
  if (r.tipo !== 'carta') return 0
  return puestoCarta(g.cartas, r.k) === 1 ? 1200 : 600
}
