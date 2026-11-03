// Barras laterales que se pueden ensanchar arrastrando su borde y ocultar con un botón.
// El ancho y si está oculta se recuerdan por barra (localStorage).
import { useEffect, useRef, useState } from 'react'

const leer = (k: string) => {
  try {
    return localStorage.getItem('fotograma:panel:' + k)
  } catch {
    return null
  }
}
const guardar = (k: string, v: string) => {
  try {
    localStorage.setItem('fotograma:panel:' + k, v)
  } catch {}
}

export type Panel = {
  ancho: number
  oculto: boolean
  columna: string // para grid-template-columns
  setAncho: (n: number) => void
  alternar: () => void
  min: number
  max: number
}

export const usePanel = (clave: string, porDefecto: number, min = 200, max = 560): Panel => {
  const [ancho, setAncho] = useState(() => Math.min(max, Math.max(min, Number(leer(clave + ':ancho')) || porDefecto)))
  const [oculto, setOculto] = useState(() => leer(clave + ':oculto') === '1')
  useEffect(() => guardar(clave + ':ancho', String(ancho)), [clave, ancho])
  useEffect(() => guardar(clave + ':oculto', oculto ? '1' : '0'), [clave, oculto])
  return { ancho, oculto, columna: oculto ? '0px' : ancho + 'px', setAncho, alternar: () => setOculto((o) => !o), min, max }
}

// Manija sobre el borde de la barra: arrastrar cambia el ancho, doble clic o el botón la ocultan/muestran.
// lado "izq": la barra está a la izquierda del contenedor (la manija va en su borde derecho); "der", al revés.
export const Manija = ({ panel, lado, nombre }: { panel: Panel; lado: 'izq' | 'der'; nombre: string }) => {
  const ref = useRef<HTMLDivElement>(null)
  const [arrastrando, setArrastrando] = useState(false)
  const pos = panel.oculto ? 0 : panel.ancho
  const empezar = (e: React.PointerEvent) => {
    if (panel.oculto || (e.target as HTMLElement).closest('button')) return
    e.preventDefault()
    const caja = ref.current?.parentElement?.getBoundingClientRect()
    if (!caja) return
    setArrastrando(true)
    const mover = (ev: PointerEvent) => {
      const n = lado === 'izq' ? ev.clientX - caja.left : caja.right - ev.clientX
      panel.setAncho(Math.round(Math.min(panel.max, Math.max(panel.min, n))))
    }
    const soltar = () => {
      setArrastrando(false)
      window.removeEventListener('pointermove', mover)
      window.removeEventListener('pointerup', soltar)
      document.body.classList.remove('redimensionando')
    }
    document.body.classList.add('redimensionando')
    window.addEventListener('pointermove', mover)
    window.addEventListener('pointerup', soltar)
  }
  const flecha = (lado === 'izq') !== panel.oculto ? 'M15 6l-6 6 6 6' : 'M9 6l6 6-6 6'
  return (
    <div
      ref={ref}
      className={'manija ' + lado + (panel.oculto ? ' cerrada' : '') + (arrastrando ? ' activa' : '')}
      style={lado === 'izq' ? { left: pos } : { right: pos }}
      onPointerDown={empezar}
      onDoubleClick={(e) => !(e.target as HTMLElement).closest('button') && panel.alternar()}
      title={panel.oculto ? `Mostrar ${nombre}` : `Arrastra para cambiar el ancho · doble clic para ocultar ${nombre}`}
    >
      <button className="boton-manija" aria-label={(panel.oculto ? 'Mostrar ' : 'Ocultar ') + nombre} onClick={panel.alternar}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d={flecha} />
        </svg>
      </button>
    </div>
  )
}
