import type { CSSProperties } from 'react'
import { CtxElementos, CtxFrame, CtxLineaTiempo, CtxModo, CtxTramo, CtxVideo, resolverComposicion, type Composicion, type ElementoVisible, type Modo, type Pista } from './contexto'

// Monta una composición en un frame concreto. Lo usan el estudio y el renderer.
export const Lienzo = ({
  composicion,
  frame,
  props,
  modo = 'estudio',
  reproduciendo = false,
  volumen = 1,
  style,
  lineaTiempo = null,
  elementos = null,
}: {
  composicion: Composicion
  frame: number
  props?: Record<string, any>
  modo?: Modo
  reproduciendo?: boolean
  volumen?: number
  style?: CSSProperties
  lineaTiempo?: { registrar: (p: Pista) => void; quitar: (clave: string) => void } | null
  elementos?: { registrar: (e: ElementoVisible) => void; quitar: (clave: string) => void } | null
}) => {
  const c = resolverComposicion(composicion, props)
  const { componente: Componente, id, ancho, alto, fps, duracion } = c
  return (
    <CtxLineaTiempo.Provider value={lineaTiempo}>
    <CtxElementos.Provider value={elementos}>
    <CtxVideo.Provider value={{ id, ancho, alto, fps, duracion }}>
      <CtxModo.Provider value={{ modo, reproduciendo, volumen }}>
        <CtxTramo.Provider value={{ inicio: 0, duracion }}>
          <CtxFrame.Provider value={frame}>
            <div style={{ position: 'relative', width: ancho, height: alto, overflow: 'hidden', ...style }}>
              <Componente {...c.props} />
            </div>
          </CtxFrame.Provider>
        </CtxTramo.Provider>
      </CtxModo.Provider>
    </CtxVideo.Provider>
    </CtxElementos.Provider>
    </CtxLineaTiempo.Provider>
  )
}
