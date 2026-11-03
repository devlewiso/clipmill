// Visor de la composición: escala, fondo de tablero, pantalla completa y errores.
import { Component, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { Lienzo } from '../../src/nucleo/lienzo'
import type { Composicion, ElementoVisible, Pista } from '../../src/nucleo/contexto'

class Atrapar extends Component<{ children: ReactNode; clave: string }, { error: Error | null; clave: string }> {
  state = { error: null as Error | null, clave: this.props.clave }
  static getDerivedStateFromError(error: Error) {
    return { error }
  }
  static getDerivedStateFromProps(p: { clave: string }, s: { clave: string }) {
    return p.clave !== s.clave ? { error: null, clave: p.clave } : null
  }
  render() {
    return this.state.error ? <pre className="error">{this.state.error.stack || this.state.error.message}</pre> : this.props.children
  }
}

export type Zoom = 'ajustar' | number

export const Reproductor = ({
  comp,
  ancho,
  alto,
  frame,
  props,
  reproduciendo,
  volumen,
  zoom = 'ajustar',
  tablero = true,
  lineaTiempo,
  elementos,
}: {
  comp: Composicion
  ancho: number
  alto: number
  frame: number
  props: any
  reproduciendo: boolean
  volumen: number
  zoom?: Zoom
  tablero?: boolean
  lineaTiempo?: { registrar: (p: Pista) => void; quitar: (clave: string) => void }
  elementos?: { registrar: (e: ElementoVisible) => void; quitar: (clave: string) => void }
}) => {
  const caja = useRef<HTMLDivElement>(null)
  const [tam, setTam] = useState({ w: 800, h: 450 })
  useLayoutEffect(() => {
    const el = caja.current!
    const ro = new ResizeObserver(() => setTam({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const escala = zoom === 'ajustar' ? Math.min((tam.w - 32) / ancho, (tam.h - 32) / alto) : zoom
  return (
    <div className={'escenario' + (tablero ? ' tablero' : '')} ref={caja} onDoubleClick={() => caja.current?.requestFullscreen?.()}>
      <div className="marco" style={{ width: ancho * escala, height: alto * escala }}>
        <div style={{ transform: `scale(${escala})`, transformOrigin: '0 0' }}>
          <Atrapar clave={comp.id + frame}>
            <Lienzo composicion={comp} frame={frame} props={props} reproduciendo={reproduciendo} volumen={volumen} lineaTiempo={lineaTiempo} elementos={elementos} />
          </Atrapar>
        </div>
      </div>
    </div>
  )
}
