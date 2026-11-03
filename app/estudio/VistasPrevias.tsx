// Videos que esperan tu revisión (nodo "Vista previa" de los flujos). Se muestra en cualquier pestaña.
import { useEffect, useRef, useState } from 'react'
import { Icono } from './iconos'
import { sonar } from './sonidos'

type Pendiente = { id: string; flujo: string; nodo: string; video: string; titulo: string; descripcion?: string; destino?: string; creado: string }

const urlVideo = (ruta: string) => '/__fotograma/api/video?ruta=' + encodeURIComponent(ruta)

export const VistasPrevias = () => {
  const [lista, setLista] = useState<Pendiente[]>([])
  const [abierta, setAbierta] = useState<Pendiente | null>(null)
  const [enviando, setEnviando] = useState(false)
  const leerSet = (k: string) => {
    try {
      return new Set<string>(JSON.parse(localStorage.getItem(k) || '[]'))
    } catch {
      return new Set<string>()
    }
  }
  const guardarSet = (k: string, v: Set<string>) => {
    try {
      localStorage.setItem(k, JSON.stringify([...v].slice(-50)))
    } catch {}
  }
  const vistas = useRef(leerSet('fotograma:revisiones-vistas'))
  const [ocultas, setOcultas] = useState(() => leerSet('fotograma:revisiones-ocultas'))

  useEffect(() => {
    const leer = () =>
      fetch('/__fotograma/flujos/aprobaciones')
        .then((r) => r.json())
        .then((l: Pendiente[]) => {
          if (!Array.isArray(l)) return
          setLista(l)
          // Una vista previa nueva se abre sola (una vez).
          const nueva = l.find((p) => !vistas.current.has(p.id))
          if (nueva) {
            l.forEach((p) => vistas.current.add(p.id))
            guardarSet('fotograma:revisiones-vistas', vistas.current)
            setAbierta((a) => a ?? nueva)
            sonar('aviso')
          }
          setAbierta((a) => (a && !l.some((p) => p.id === a.id) ? null : a))
        })
        .catch(() => {})
    leer()
    const t = setInterval(leer, 3000)
    return () => clearInterval(t)
  }, [])

  const decidir = async (decision: 'aprobado' | 'rechazado') => {
    if (!abierta) return
    setEnviando(true)
    sonar(decision === 'aprobado' ? 'exito' : 'error')
    await fetch('/__fotograma/flujos/aprobaciones/' + abierta.id, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision }),
    }).catch(() => {})
    setEnviando(false)
    setLista((l) => l.filter((p) => p.id !== abierta.id))
    setAbierta(null)
  }

  const visibles = lista.filter((p) => !ocultas.has(p.id))
  const ocultar = () => {
    const n = new Set(ocultas)
    visibles.forEach((p) => n.add(p.id))
    guardarSet('fotograma:revisiones-ocultas', n)
    setOcultas(n)
  }

  return (
    <>
      {visibles.length > 0 && !abierta && (
        <div className="aviso-revision">
        <button className="abrir-revision" onClick={() => setAbierta(visibles[0])}>
          <Icono n="claqueta" t={16} /> {visibles.length === 1 ? '1 video espera' : `${visibles.length} videos esperan`} tu revisión
        </button>
        <button className="ocultar-revision" onClick={ocultar} title="Achicar el aviso (el flujo sigue en pausa hasta que decidas)">
          <Icono n="cerrar" t={13} />
        </button>
        </div>
      )}
      {visibles.length === 0 && lista.length > 0 && !abierta && (
        <button className="revision-mini" onClick={() => setAbierta(lista[0])} title={`${lista.length} por revisar`}>
          <Icono n="claqueta" t={15} />
          <b>{lista.length}</b>
        </button>
      )}
      {abierta && (
        <div className="modal">
          <div className="caja revision">
            <video src={urlVideo(abierta.video)} controls autoPlay className="video-revision" />
            <div className="datos-revision">
              <small className="tenue">
                {abierta.flujo} · {abierta.nodo}
              </small>
              <h2>{abierta.titulo}</h2>
              {abierta.descripcion && <p className="pequeno">{abierta.descripcion}</p>}
              {abierta.destino && (
                <p className="pequeno">
                  Si continúas se publica en: <b>{abierta.destino}</b>
                </p>
              )}
              <p className="tenue pequeno">El flujo está en pausa hasta que decidas. Si lo rechazas, el video queda en la biblioteca y no se publica.</p>
              <span className="espacio" />
              <div className="fila">
                <button className="secundario" disabled={enviando} onClick={() => decidir('rechazado')}>
                  <Icono n="cerrar" t={14} /> Rechazar
                </button>
                <button className="primario" disabled={enviando} onClick={() => decidir('aprobado')}>
                  <Icono n="play" t={14} /> Continuar y publicar
                </button>
              </div>
              <button className="mini" onClick={() => setAbierta(null)}>
                decidir después
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
