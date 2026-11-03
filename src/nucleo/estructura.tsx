import { Children, isValidElement, useContext, useId, useLayoutEffect, type CSSProperties, type ReactElement, type ReactNode } from 'react'
import { CtxFrame, CtxLineaTiempo, CtxNivel, CtxTramo, useFrame, type Pista } from './contexto'

// Registra un elemento en la línea de tiempo del estudio (no hace nada al renderizar).
export const usePista = (p: Omit<Pista, 'clave' | 'nivel'>) => {
  const lt = useContext(CtxLineaTiempo)
  const nivel = useContext(CtxNivel)
  const clave = useId()
  useLayoutEffect(() => {
    if (!lt) return
    lt.registrar({ ...p, clave, nivel })
    return () => lt.quitar(clave)
  }, [lt, clave, nivel, p.nombre, p.tipo, p.inicio, p.duracion])
}

// Capa que ocupa todo el cuadro (el equivalente a position:absolute; inset:0).
export const Capa = ({ children, style, className, nombre }: { children?: ReactNode; style?: CSSProperties; className?: string; nombre?: string }) => (
  <div className={className} data-secuencia={nombre} style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', ...style }}>
    {children}
  </div>
)

// Muestra su contenido solo entre `desde` y `desde + duracion`, y reinicia useFrame() en 0.
export const Secuencia = ({
  desde = 0,
  duracion = Infinity,
  children,
  capa = true,
  style,
  nombre,
}: {
  desde?: number
  duracion?: number
  children?: ReactNode
  capa?: boolean // false = sin envolver en una Capa
  style?: CSSProperties
  nombre?: string
}) => {
  const padre = useContext(CtxTramo)
  const frame = useContext(CtxFrame)
  const nivel = useContext(CtxNivel)
  const inicio = padre.inicio + desde
  // La secuencia no puede durar más que su contenedor.
  const fin = Math.min(inicio + duracion, padre.inicio + padre.duracion)
  usePista({ nombre: nombre || 'Secuencia', tipo: 'secuencia', inicio, duracion: fin - inicio })
  if (frame < inicio || frame >= fin) return null
  return (
    <CtxNivel.Provider value={nivel + 1}>
    <CtxTramo.Provider value={{ inicio, duracion: fin - inicio }}>
      {capa ? (
        <Capa style={style} nombre={nombre}>
          {children}
        </Capa>
      ) : (
        children
      )}
    </CtxTramo.Provider>
    </CtxNivel.Provider>
  )
}

// Pieza de una Serie: se reproduce después de la anterior.
type PropsTramo = { duracion: number; desplazamiento?: number; children?: ReactNode; style?: CSSProperties; nombre?: string }
const Tramo = (_: PropsTramo): null => null

// Pone Secuencias una detrás de otra sin calcular los `desde` a mano.
export const Serie = ({ children }: { children?: ReactNode }) => {
  let cursor = 0
  const hijos = Children.toArray(children).filter(isValidElement) as ReactElement<PropsTramo>[]
  return (
    <>
      {hijos.map((h, i) => {
        if (h.type !== Tramo) throw new Error('Dentro de <Serie> solo van <Serie.Tramo>.')
        const { duracion, desplazamiento = 0, children: contenido, style, nombre } = h.props
        const desde = cursor + desplazamiento
        cursor = desde + duracion
        return (
          <Secuencia key={h.key ?? i} desde={desde} duracion={duracion} style={style} nombre={nombre}>
            {contenido}
          </Secuencia>
        )
      })}
    </>
  )
}
Serie.Tramo = Tramo

// Repite su contenido cada `duracion` frames (veces = cuántas; por defecto infinitas).
export const Bucle = ({ duracion, veces = Infinity, children }: { duracion: number; veces?: number; children?: ReactNode }) => {
  const padre = useContext(CtxTramo)
  const frame = useContext(CtxFrame)
  const rel = frame - padre.inicio
  const vuelta = Math.floor(rel / duracion)
  if (vuelta >= veces) return null
  return (
    <CtxTramo.Provider value={{ inicio: padre.inicio + vuelta * duracion, duracion }}>
      <Capa>{children}</Capa>
    </CtxTramo.Provider>
  )
}

// Congela su contenido en un frame fijo.
export const Congelar = ({ frame, children }: { frame: number; children?: ReactNode }) => {
  const padre = useContext(CtxTramo)
  return <CtxFrame.Provider value={padre.inicio + frame}>{children}</CtxFrame.Provider>
}

// Útil para depurar: muestra el frame actual en una esquina.
export const Contador = ({ style }: { style?: CSSProperties }) => {
  const f = useFrame()
  return <div style={{ position: 'absolute', top: 8, left: 8, font: '600 14px monospace', color: '#fff', background: '#0008', padding: '2px 6px', ...style }}>{f}</div>
}
