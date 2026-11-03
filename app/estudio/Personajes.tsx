// Personajes del proyecto: una carpeta por personaje en public/personajes/<id>/ con su personaje.json
// (ficha, paleta, expresiones y poses como PNG sueltos, y el código si está dibujado en SVG).
// Clic en una imagen copia su ruta para usarla en una composición; doble clic la abre en grande.
import { useEffect, useState } from 'react'

type Personaje = {
  id: string
  nombre: string
  rol?: string
  tipo?: string
  hoja: string
  hojas?: Record<string, string> // otros estilos de la hoja (p. ej. caricatura)
  avatar?: string
  estilo?: string // nombre del estilo de la hoja principal
  grupos?: Record<string, string[]> // más tiras de imágenes sueltas
  referencia?: string
  ficha?: Record<string, string>
  paleta?: string[]
  expresiones?: string[]
  poses?: string[]
  codigo?: { importar?: string; uso?: string; acciones?: string[]; accesorios?: string[] }
  composicion?: string
}

const imagen = (p: Personaje, n: string) => `/personajes/${p.id}/${n}.png`

export const Personajes = ({ recursos }: { recursos: { ruta: string }[] }) => {
  const [personajes, setPersonajes] = useState<Personaje[]>([])
  const [sel, setSel] = useState(() => localStorage.getItem('fotograma:personaje') || '')
  const [aviso, setAviso] = useState('')
  const [grande, setGrande] = useState<string | null>(null)
  const [estilo, setEstilo] = useState('')

  const fichas = recursos.map((r) => r.ruta).filter((r) => /^\/?personajes\/[^/]+\/personaje\.json$/.test(r))
  useEffect(() => {
    Promise.all(fichas.map((r) => fetch((r.startsWith('/') ? '' : '/') + r).then((x) => x.json()).catch(() => null)))
      .then((l) => setPersonajes(l.filter(Boolean)))
  }, [fichas.join('|')])
  useEffect(() => {
    try {
      localStorage.setItem('fotograma:personaje', sel)
    } catch {}
  }, [sel])
  useEffect(() => {
    if (!aviso) return
    const t = setTimeout(() => setAviso(''), 2500)
    return () => clearTimeout(t)
  }, [aviso])
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => e.key === 'Escape' && setGrande(null)
    window.addEventListener('keydown', tecla)
    return () => window.removeEventListener('keydown', tecla)
  }, [])

  const p = personajes.find((x) => x.id === sel) || personajes[0]
  const hojas: Record<string, string> = p ? { [p.estilo || 'principal']: p.hoja, ...p.hojas } : {}
  const hoja = hojas[estilo] || p?.hoja
  const copiar = (t: string) => (navigator.clipboard?.writeText(t), setAviso(t))

  const Tira = ({ titulo, nombres }: { titulo: string; nombres?: string[] }) =>
    p && nombres?.length ? (
      <section className="grupo-recursos">
        <div className="cab-grupo">
          <span className="mono">{titulo}</span>
          <span className="cuenta">{nombres.length}</span>
          <i />
        </div>
        <div className="rejilla tira-personaje">
          {nombres.map((n) => (
            <button key={n} className="recurso" onClick={() => copiar(imagen(p, n))} onDoubleClick={() => setGrande(imagen(p, n))} title={`${imagen(p, n)}\nClic: copiar la ruta · Doble clic: ver en grande`}>
              <div className="miniatura">
                <img src={imagen(p, n)} alt={n} loading="lazy" />
              </div>
              <span className="nombre">{n}</span>
            </button>
          ))}
        </div>
      </section>
    ) : null

  return (
    <div className="vista-recursos vista-personajes">
      <div className="cabecera">
        <div className="titulo-recursos">
          <h1>Personajes</h1>
          <span className="tenue">
            Fichas de <code>public/personajes/&lt;id&gt;/personaje.json</code> · clic copia la ruta, doble clic la abre
          </span>
        </div>
      </div>

      {!personajes.length && (
        <div className="recursos-vacio">
          <b>Todavía no hay personajes</b>
          <span className="tenue">
            Crea <code>public/personajes/&lt;id&gt;/personaje.json</code> con su hoja y sus expresiones.
          </span>
        </div>
      )}

      {!!personajes.length && (
        <div className="lista-personajes">
          {personajes.map((x) => (
            <button key={x.id} className={'tarjeta-personaje' + (p?.id === x.id ? ' on' : '')} onClick={() => (setSel(x.id), setEstilo(''))}>
              <img src={x.avatar ? imagen(x, x.avatar) : x.expresiones?.length ? imagen(x, x.expresiones[0]) : x.hoja} alt="" />
              <span>
                <b>{x.nombre}</b>
                <small className="tenue">{x.tipo}</small>
              </span>
            </button>
          ))}
        </div>
      )}

      {p && (
        <div className="detalle-personaje">
          <div className="columna-hoja">
            {Object.keys(hojas).length > 1 && (
              <div className="estilos-hoja">
                {Object.keys(hojas).map((k) => (
                  <button key={k} className={(hojas[estilo] ? estilo : p.estilo || 'principal') === k ? 'on' : ''} onClick={() => setEstilo(k)}>
                    {k}
                  </button>
                ))}
              </div>
            )}
            <button className="hoja-personaje" onClick={() => setGrande(hoja!)} title="Ver la hoja completa">
              <img src={hoja} alt={'Hoja de ' + p.nombre} />
            </button>
          </div>
          <div className="datos-personaje">
            <h2>{p.nombre}</h2>
            {p.rol && <p className="tenue">{p.rol}</p>}
            {p.ficha && (
              <dl>
                {Object.entries(p.ficha).map(([k, v]) => (
                  <div key={k}>
                    <dt>{k}</dt>
                    <dd>{v}</dd>
                  </div>
                ))}
              </dl>
            )}
            {!!p.paleta?.length && (
              <div className="paleta-personaje">
                {p.paleta.map((c) => (
                  <button key={c} style={{ background: c }} title={c + ' · clic para copiar'} onClick={() => copiar(c)} />
                ))}
              </div>
            )}
            {p.codigo && (
              <div className="ruta-recurso">
                <small>En código</small>
                {p.codigo.importar && <code onClick={() => copiar(p.codigo!.importar!)}>{p.codigo.importar}</code>}
                {p.codigo.uso && <code onClick={() => copiar(p.codigo!.uso!)}>{p.codigo.uso}</code>}
                {p.codigo.acciones && <small className="tenue">Acciones: {p.codigo.acciones.join(', ')}</small>}
                {p.codigo.accesorios && <small className="tenue">Accesorios: {p.codigo.accesorios.join(', ')}</small>}
              </div>
            )}
            <div className="acciones-personaje">
              {p.composicion && (
                <a className="secundario" href={'#' + p.composicion}>
                  Abrir {p.composicion}
                </a>
              )}
              {p.referencia && (
                <button className="secundario" onClick={() => setGrande(p.referencia!)}>
                  Foto de referencia
                </button>
              )}
              <button className="secundario" onClick={() => copiar(hoja!)}>
                Copiar ruta de la hoja
              </button>
            </div>
          </div>
        </div>
      )}

      <Tira titulo="expresiones" nombres={p?.expresiones} />
      <Tira titulo="poses" nombres={p?.poses} />
      {Object.entries(p?.grupos || {}).map(([t, l]) => (
        <Tira key={t} titulo={t} nombres={l} />
      ))}

      {grande && (
        <div className="visor-recurso" onClick={() => setGrande(null)}>
          <img className="imagen-grande-personaje" src={grande} alt="" />
        </div>
      )}
      {aviso && (
        <div className="aviso-copiado">
          Copiado <code>{aviso}</code>
        </div>
      )}
    </div>
  )
}
