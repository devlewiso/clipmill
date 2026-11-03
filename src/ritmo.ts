// Cortar y animar al ritmo de la música. Los tiempos salen de `npx fotograma ritmo musica.mp3` (o la API del estudio),
// que escribe musica.ritmo.json: { bpm, duracion, beats, compases, acentos } en segundos.
//
//   import ritmo from './musica.ritmo.json'
//   const z = 1 + 0.08 * usePulso(ritmo.beats)                // zoom que late con cada beat
//   const flash = usePulso(ritmo.compases, { caida: 0.12 })   // destello en el 1 de cada compás
//   const n = useGolpe(ritmo.beats)                          // cuántos beats van (cambiar de clip en cada uno)
//   cortesAlRitmo(ritmo.beats, fps, { cada: 2 })             // tramos para una <Serie> que corta cada 2 beats
import { useFrame, useVideo } from './nucleo/contexto'

export type Ritmo = { bpm: number; duracion: number; beats: number[]; compases: number[]; acentos: number[] }
export type OpcionesPulso = { caida?: number; anticipo?: number; forma?: 'exp' | 'lineal' }

// Índice del último tiempo ≤ t (búsqueda binaria; -1 si todavía no llegó ninguno).
export const ultimoGolpe = (tiempos: readonly number[], t: number) => {
  let a = 0
  let b = tiempos.length - 1
  let r = -1
  while (a <= b) {
    const m = (a + b) >> 1
    if (tiempos[m] <= t) ((r = m), (a = m + 1))
    else b = m - 1
  }
  return r
}

// 1 justo en el golpe y cae a 0 en `caida` segundos. `anticipo` adelanta el golpe (para que un zoom ya esté
// arriba cuando suena el bombo).
export const pulso = (tiempos: readonly number[], t: number, { caida = 0.25, anticipo = 0, forma = 'exp' }: OpcionesPulso = {}) => {
  const i = ultimoGolpe(tiempos, t + anticipo)
  if (i < 0) return 0
  const dt = t + anticipo - tiempos[i]
  return forma === 'lineal' ? Math.max(0, 1 - dt / caida) : Math.exp((-dt / caida) * 3)
}

// Fracción (0–1) del camino entre el golpe anterior y el siguiente: para animaciones que van «de beat a beat».
export const faseEntreGolpes = (tiempos: readonly number[], t: number) => {
  const i = ultimoGolpe(tiempos, t)
  if (i < 0 || i + 1 >= tiempos.length) return 0
  return (t - tiempos[i]) / (tiempos[i + 1] - tiempos[i])
}

export const usePulso = (tiempos: readonly number[], opciones?: OpcionesPulso) => {
  const frame = useFrame()
  const { fps } = useVideo()
  return pulso(tiempos, frame / fps, opciones)
}

// Cuántos golpes van sonando (0 antes del primero). Útil para elegir el clip, el color o el texto de cada beat.
export const useGolpe = (tiempos: readonly number[]) => {
  const frame = useFrame()
  const { fps } = useVideo()
  return ultimoGolpe(tiempos, frame / fps) + 1
}

// Tramos en frames que cortan cada `cada` golpes entre `desde` y `hasta` (segundos): [{ desde, duracion }].
// El primero empieza en `desde` aunque no caiga en un golpe. Para <Serie>, usar las `duracion`.
export const cortesAlRitmo = (tiempos: readonly number[], fps: number, { cada = 1, desde = 0, hasta = Infinity }: { cada?: number; desde?: number; hasta?: number } = {}) => {
  const marcas = [desde, ...tiempos.filter((t) => t > desde + 0.05 && t < hasta).filter((_, i) => (i + 1) % cada === 0)]
  if (Number.isFinite(hasta)) marcas.push(hasta)
  const frames = [...new Set(marcas.map((t) => Math.round(t * fps)))]
  return frames.slice(0, -1).map((f, i) => ({ desde: f, duracion: frames[i + 1] - f }))
}
