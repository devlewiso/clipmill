// Línea de tiempo: regla, cabezal, rango de reproducción (entrada/salida) y una pista por
// cada Secuencia, Audio y Video que registra la composición.
import { useRef } from 'react'
import type { Pista } from '../../src/nucleo/contexto'
import { tiempo } from './api'

const COLORES: Record<Pista['tipo'], string> = { secuencia: '#4c6ef5', audio: '#2f9e44', video: '#e8590c' }

export const LineaTiempo = ({
  pistas,
  duracion,
  fps,
  frame,
  entrada,
  salida,
  irA,
}: {
  pistas: Pista[]
  duracion: number
  fps: number
  frame: number
  entrada: number | null
  salida: number | null
  irA: (f: number) => void
}) => {
  const regla = useRef<HTMLDivElement>(null)
  const pct = (f: number) => `${(Math.min(f, duracion) / duracion) * 100}%`

  // Click o arrastre sobre la regla mueve el cabezal.
  const mover = (x: number) => {
    const r = regla.current!.getBoundingClientRect()
    irA(Math.round(Math.max(0, Math.min(1, (x - r.left) / r.width)) * (duracion - 1)))
  }
  const arrastrar = (e: React.PointerEvent) => {
    mover(e.clientX)
    const mov = (ev: PointerEvent) => mover(ev.clientX)
    const fin = () => (window.removeEventListener('pointermove', mov), window.removeEventListener('pointerup', fin))
    window.addEventListener('pointermove', mov)
    window.addEventListener('pointerup', fin)
  }

  // Marcas de segundo en la regla (cada 1, 5 o 10 s según el largo).
  const segundos = duracion / fps
  const paso = segundos > 120 ? 10 : segundos > 30 ? 5 : 1
  const marcas = Array.from({ length: Math.floor(segundos / paso) + 1 }, (_, i) => i * paso)

  const ordenadas = [...pistas].sort((a, b) => a.nivel - b.nivel || a.inicio - b.inicio)

  return (
    <div className="lineatiempo">
      <div className="lt-nombres">
        <div className="lt-hueco" />
        {ordenadas.map((p) => (
          <div key={p.clave} className="lt-nombre" style={{ paddingLeft: 8 + p.nivel * 10 }} title={p.nombre}>
            <i style={{ background: COLORES[p.tipo] }} />
            {p.nombre}
          </div>
        ))}
      </div>
      <div className="lt-pistas" ref={regla} onPointerDown={arrastrar}>
        <div className="lt-regla">
          {marcas.map((s) => (
            <span key={s} style={{ left: pct(s * fps) }}>
              {tiempo(s * fps, fps).replace(/\.\d+$/, '')}
            </span>
          ))}
        </div>
        {entrada !== null && <div className="lt-fuera" style={{ left: 0, width: pct(entrada) }} />}
        {salida !== null && <div className="lt-fuera" style={{ left: pct(salida + 1), right: 0 }} />}
        {ordenadas.map((p) => (
          <div key={p.clave} className="lt-fila">
            <div
              className="lt-barra"
              style={{ left: pct(p.inicio), width: `calc(${pct(Math.min(p.duracion, duracion - p.inicio))} - 1px)`, background: COLORES[p.tipo] }}
              title={`${p.nombre} · ${tiempo(p.inicio, fps)} → ${tiempo(p.inicio + p.duracion, fps)}`}
            >
              {p.nombre}
            </div>
          </div>
        ))}
        <div className="lt-cabezal" style={{ left: pct(frame) }} />
      </div>
    </div>
  )
}
