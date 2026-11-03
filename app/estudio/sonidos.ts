// Sonidos de la interfaz, sintetizados con Web Audio (sin archivos). Se silencian con el botón de la cabecera.
type Sonido = 'tic' | 'pestana' | 'abrir' | 'exito' | 'error' | 'aviso' | 'inicio'

let ctx: AudioContext | undefined
let silencio = (() => {
  try {
    return localStorage.getItem('fotograma:silencio') === '1'
  } catch {
    return false
  }
})()
const oyentes = new Set<(s: boolean) => void>()

export const silenciado = () => silencio
export const setSilenciado = (s: boolean) => {
  silencio = s
  try {
    localStorage.setItem('fotograma:silencio', s ? '1' : '0')
  } catch {}
  oyentes.forEach((f) => f(s))
}
export const alCambiarSilencio = (f: (s: boolean) => void) => (oyentes.add(f), () => void oyentes.delete(f))

// Una nota corta con envolvente: ataque rápido y caída exponencial.
const nota = (frec: number, cuando: number, dur: number, vol: number, tipo: OscillatorType = 'sine', hasta?: number) => {
  const c = ctx!
  const o = c.createOscillator()
  const g = c.createGain()
  o.type = tipo
  o.frequency.setValueAtTime(frec, cuando)
  if (hasta) o.frequency.exponentialRampToValueAtTime(hasta, cuando + dur)
  g.gain.setValueAtTime(0.0001, cuando)
  g.gain.exponentialRampToValueAtTime(vol, cuando + 0.008)
  g.gain.exponentialRampToValueAtTime(0.0001, cuando + dur)
  o.connect(g).connect(c.destination)
  o.start(cuando)
  o.stop(cuando + dur + 0.02)
}

let ultimoTic = 0
export const sonar = (s: Sonido) => {
  if (silencio || document.documentElement.dataset.modo !== 'dinamico') return
  try {
    ctx ??= new AudioContext()
    if (ctx.state === 'suspended') ctx.resume()
    const t = ctx.currentTime
    switch (s) {
      case 'tic':
        if (t - ultimoTic < 0.04) return
        ultimoTic = t
        nota(1500, t, 0.05, 0.09, 'triangle', 900)
        break
      case 'pestana':
        nota(520, t, 0.1, 0.12, 'triangle', 1040)
        break
      case 'abrir':
        nota(300, t, 0.2, 0.1, 'sine', 900)
        break
      case 'inicio':
        nota(440, t, 0.1, 0.1, 'triangle')
        nota(660, t + 0.07, 0.14, 0.1, 'triangle')
        break
      case 'exito':
        ;[523.25, 659.25, 783.99, 1046.5].forEach((f, i) => nota(f, t + i * 0.075, 0.32, 0.11, 'triangle'))
        break
      case 'aviso':
        nota(880, t, 0.16, 0.12, 'sine')
        nota(1174.66, t + 0.12, 0.26, 0.12, 'sine')
        break
      case 'error':
        nota(220, t, 0.18, 0.08, 'sawtooth', 160)
        nota(165, t + 0.14, 0.26, 0.07, 'sawtooth', 110)
        break
    }
  } catch {}
}

// Un "tic" suave en cada botón, para toda la app.
export const activarTicGlobal = () => {
  const f = (e: PointerEvent) => {
    const b = (e.target as HTMLElement | null)?.closest('button, .comp, .recurso, .tarjeta-flujo, .opcion-nodo')
    if (b && !(b as HTMLButtonElement).disabled) sonar('tic')
  }
  document.addEventListener('pointerdown', f, true)
  return () => document.removeEventListener('pointerdown', f, true)
}
