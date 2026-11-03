// Remoto: usar Clipmill desde el teléfono (misma red). Aquí se prende, se empareja con un QR y se revocan teléfonos.
import { useEffect, useState } from 'react'
import { api } from './api'

type Dispositivo = { id: string; nombre: string; creado: number; ultimo: number }
type Estado = { activo: boolean; escuchando: boolean; url: string; dispositivos: Dispositivo[] }
type Codigo = { codigo: string; vence: number; enlace: string; qr: string }

const hace = (ms: number) => {
  const m = Math.round((Date.now() - ms) / 60_000)
  return m < 1 ? 'ahora' : m < 60 ? `hace ${m} min` : m < 1440 ? `hace ${Math.round(m / 60)} h` : `hace ${Math.round(m / 1440)} d`
}

export const Remoto = ({ cerrar }: { cerrar: () => void }) => {
  const [estado, setEstado] = useState<Estado | null>(null)
  const [codigo, setCodigo] = useState<Codigo | null>(null)
  const [error, setError] = useState('')
  const [, setReloj] = useState(0)

  const leer = () => api<Estado>('remoto').then(setEstado).catch((e) => setError(e.message))
  useEffect(() => {
    leer()
    const t = setInterval(() => (leer(), setReloj((r) => r + 1)), 3000) // ver aparecer el teléfono recién emparejado
    return () => clearInterval(t)
  }, [])

  const intentar = async (f: () => Promise<unknown>) => {
    setError('')
    try {
      await f()
    } catch (e: any) {
      setError(e.message)
    }
  }
  const activar = (activo: boolean) =>
    intentar(async () => {
      setEstado(await api<Estado>('remoto/activar', { cuerpo: { activo } }))
      setCodigo(activo ? await api<Codigo>('remoto/codigo', { cuerpo: {} }) : null)
    })
  const nuevoCodigo = () => intentar(async () => setCodigo(await api<Codigo>('remoto/codigo', { cuerpo: {} })))
  const revocar = (id: string) => intentar(async () => setEstado(await api<Estado>('remoto/revocar', { cuerpo: { id } })))

  const vigente = codigo && codigo.vence > Date.now()
  const quedan = vigente ? Math.ceil((codigo!.vence - Date.now()) / 60_000) : 0

  return (
    <div className="modal" onClick={cerrar}>
      <div className="caja remoto" onClick={(e) => e.stopPropagation()}>
        <h3>📱 Remoto</h3>
        <p className="tenue pequeno">
          Usá Clipmill desde el teléfono (misma red Wi-Fi): ver y ordenar la cola, encolar renders, ver los videos terminados y hablar con el asistente. Desde ahí no se
          publica ni se ejecutan flujos.
        </p>
        {!estado ? (
          <p className="tenue">Cargando…</p>
        ) : (
          <>
            <label className="campo campo-check">
              <span>{estado.activo ? (estado.escuchando ? `Encendido en ${estado.url}` : 'Encendido (no pudo abrir el puerto)') : 'Apagado'}</span>
              <input type="checkbox" checked={estado.activo} onChange={(e) => activar(e.target.checked)} />
            </label>

            {estado.activo && estado.escuchando && (
              <div className="remoto-qr">
                {vigente ? (
                  <>
                    <img src={codigo!.qr} alt="QR para emparejar el teléfono" width={220} height={220} />
                    <div>
                      <p>Escaneá el QR con la cámara del teléfono.</p>
                      <p className="tenue pequeno">
                        O abrí <b>{estado.url}</b> y escribí el código:
                      </p>
                      <div className="remoto-codigo">{codigo!.codigo}</div>
                      <p className="tenue pequeno">Vale {quedan} min y sirve para un solo teléfono.</p>
                    </div>
                  </>
                ) : (
                  <button className="primario" onClick={nuevoCodigo}>
                    + Emparejar un teléfono
                  </button>
                )}
              </div>
            )}

            <h3>Teléfonos emparejados</h3>
            {estado.dispositivos.length ? (
              estado.dispositivos.map((d) => (
                <div key={d.id} className="remoto-dispositivo">
                  <div>
                    <b>{d.nombre}</b>
                    <small className="tenue">
                      {' '}
                      · emparejado {new Date(d.creado).toLocaleDateString()} · usado {hace(d.ultimo)}
                    </small>
                  </div>
                  <button className="mini" onClick={() => revocar(d.id)}>
                    revocar
                  </button>
                </div>
              ))
            ) : (
              <p className="tenue pequeno">Ninguno todavía.</p>
            )}
          </>
        )}
        {error && <div className="aviso">{error}</div>}
        <button onClick={cerrar}>Cerrar</button>
      </div>
    </div>
  )
}
