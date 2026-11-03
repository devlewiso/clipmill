// Videos renderizados (del estudio y de los flujos) y su publicación en YouTube / TikTok.
import { useEffect, useState } from 'react'
import { api } from './api'

type Pub = {
  id: string
  ruta: string
  fecha: string
  youtube?: { estado: string; url?: string; error?: string; credencial: string; privacidad?: string; mensaje?: string }
  tiktok?: { estado: string; error?: string; privado?: boolean; mensaje?: string; modo?: string; postId?: string | null }
}
type EstadoPlataforma = { estado: string; url?: string; nota?: string; fecha?: string; pagina?: string; por?: string }
type Video = {
  ruta: string
  nombre: string
  origen: 'estudio' | 'flujo' | 'biblioteca'
  canal: string
  plataformas: Partial<Record<'youtube' | 'tiktok' | 'facebook' | 'instagram', EstadoPlataforma>>
  bytes: number
  fecha: string
  datos: { guion: string; titulo: string; descripcion: string; hashtags: string[]; canal?: string; categoria?: string; idioma?: string } | null
  publicaciones: Pub[]
  anteriores: { ruta: string; nombre: string; fecha: string }[]
}
type Respuesta = { videos: Video[]; canales: string[]; tiktok: boolean; enCurso: Pub[] }

const CATEGORIAS: [string, string][] = [
  ['2', 'Autos y vehículos'],
  ['15', 'Mascotas y animales'],
  ['22', 'Personas y blogs'],
  ['24', 'Entretenimiento'],
  ['27', 'Educación'],
  ['28', 'Ciencia y tecnología'],
]

// Conecta un canal de YouTube nuevo (abre Google en otra pestaña y espera a que termine).
export const ConectarCanal = ({ conectado }: { conectado: (credencial: string) => void }) => {
  const [estado, setEstado] = useState<'' | 'esperando' | 'error'>('')
  const [error, setError] = useState('')
  const conectar = async () => {
    setError('')
    try {
      const r = await fetch('/__fotograma/flujos/youtube/conectar', { method: 'POST' }).then((x) => x.json())
      if (r.error) throw new Error(r.error)
      window.open(r.url, '_blank')
      setEstado('esperando')
      const t = setInterval(async () => {
        const e = await fetch('/__fotograma/flujos/youtube/estado').then((x) => x.json())
        if (e?.estado === 'listo') {
          clearInterval(t)
          setEstado('')
          conectado(e.credencial)
        } else if (e?.estado === 'error') {
          clearInterval(t)
          setEstado('error')
          setError(e.error)
        }
      }, 2000)
    } catch (e: any) {
      setEstado('error')
      setError(e.message)
    }
  }
  return (
    <span className="conectar-canal">
      <button className="mini" onClick={conectar} disabled={estado === 'esperando'}>
        {estado === 'esperando' ? 'Esperando a Google… (elige el canal en la otra pestaña)' : '+ Conectar otro canal de YouTube'}
      </button>
      {error && <small className="aviso">{error}</small>}
    </span>
  )
}

const urlVideo = (ruta: string) => '/__fotograma/api/video?ruta=' + encodeURIComponent(ruta)

const Estado = ({ p }: { p: Pub }) => (
  <div className="estados-pub">
    {p.youtube && (
      <span className={'pub ' + p.youtube.estado} title={p.youtube.error || p.youtube.mensaje}>
        ▶ YouTube:{' '}
        {p.youtube.estado === 'listo' ? (
          <a href={p.youtube.url} target="_blank" rel="noreferrer">
            {p.youtube.url?.replace('https://', '')}
          </a>
        ) : p.youtube.estado === 'error' ? (
          'error'
        ) : (
          p.youtube.mensaje || 'subiendo…'
        )}
      </span>
    )}
    {p.tiktok && (
      <span className={'pub ' + p.tiktok.estado} title={p.tiktok.error || p.tiktok.mensaje}>
        ♪ TikTok:{' '}
        {p.tiktok.estado === 'listo'
          ? p.tiktok.modo === 'draft' || (!p.tiktok.modo && !p.tiktok.postId)
            ? 'borrador en tu bandeja: ábrelo en la app de TikTok para publicarlo'
            : p.tiktok.privado
              ? 'publicado en privado'
              : 'publicado'
          : p.tiktok.estado === 'error'
            ? 'error'
            : 'subiendo…'}
      </span>
    )}
  </div>
)

const Publicar = ({ v, canales, tiktokDisponible, cerrar, listo, recargar }: { v: Video; canales: string[]; tiktokDisponible: boolean; cerrar: () => void; listo: () => void; recargar: () => void }) => {
  const d = v.datos
  const hashtags = (d?.hashtags || []).map((h) => (h.startsWith('#') ? h : '#' + h))
  const [titulo, setTitulo] = useState(d?.titulo || v.nombre.replace(/\.\w+$/, ''))
  const [descripcion, setDescripcion] = useState([d?.descripcion, hashtags.join(' ')].filter(Boolean).join('\n\n'))
  const [conYoutube, setConYoutube] = useState(canales.length > 0)
  const [canal, setCanal] = useState(d?.canal && canales.includes(d.canal) ? d.canal : canales[0] || '')
  const [privacidad, setPrivacidad] = useState<'public' | 'unlisted' | 'private'>('public')
  const [categoria, setCategoria] = useState(d?.categoria || '2')
  const [shorts, setShorts] = useState(true)
  const [conTiktok, setConTiktok] = useState(tiktokDisponible)
  const [textoTiktok, setTextoTiktok] = useState([d?.titulo, hashtags.join(' ')].filter(Boolean).join('\n\n'))
  const [publicoTiktok, setPublicoTiktok] = useState(true)
  const [error, setError] = useState('')
  const [enviando, setEnviando] = useState(false)

  const enviar = async () => {
    setEnviando(true)
    setError('')
    try {
      const t = shorts && !/#shorts/i.test(titulo) ? `${titulo.slice(0, 88)} #Shorts` : titulo
      await api('publicar', {
        cuerpo: {
          ruta: v.ruta,
          youtube: conYoutube
            ? { credencial: canal, titulo: t, descripcion: shorts && !/#shorts/i.test(descripcion) ? descripcion + ' #Shorts' : descripcion, tags: hashtags, privacidad, categoria, idioma: d?.idioma || 'es' }
            : undefined,
          tiktok: conTiktok ? { texto: textoTiktok, publico: publicoTiktok } : undefined,
        },
      })
      listo()
    } catch (e: any) {
      setError(e.message)
      setEnviando(false)
    }
  }

  return (
    <div className="modal" onClick={cerrar}>
      <div className="caja ancha publicar" onClick={(e) => e.stopPropagation()}>
        <div className="fila">
          <video src={urlVideo(v.ruta)} controls className="mini-video" />
          <div className="formulario" style={{ flex: 1 }}>
            <h3>Publicar · {v.nombre}</h3>
            <label className="campo">
              <span>Título</span>
              <input value={titulo} maxLength={100} onChange={(e) => setTitulo(e.target.value)} />
            </label>
            <label className="campo">
              <span>Descripción (YouTube)</span>
              <textarea rows={5} value={descripcion} onChange={(e) => setDescripcion(e.target.value)} />
            </label>
          </div>
        </div>

        <div className="destinos">
          <div className={'destino' + (conYoutube ? ' on' : '')}>
            <label className="campo-check">
              <input type="checkbox" checked={conYoutube} disabled={!canales.length} onChange={(e) => setConYoutube(e.target.checked)} />
              <b>▶ YouTube</b>
            </label>
            {!canales.length && (
              <>
                <small className="aviso">No hay canales conectados.</small>
                <ConectarCanal conectado={(c) => (setCanal(c), setConYoutube(true), recargar())} />
              </>
            )}
            {conYoutube && (
              <>
                <label className="campo">
                  <span>Canal</span>
                  <select value={canal} onChange={(e) => setCanal(e.target.value)}>
                    {canales.map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                </label>
                <ConectarCanal conectado={(c) => (setCanal(c), recargar())} />
                <div className="fila">
                  <label className="campo">
                    <span>Privacidad</span>
                    <select value={privacidad} onChange={(e) => setPrivacidad(e.target.value as any)}>
                      <option value="public">Público</option>
                      <option value="unlisted">No listado</option>
                      <option value="private">Privado</option>
                    </select>
                  </label>
                  <label className="campo">
                    <span>Categoría</span>
                    <select value={categoria} onChange={(e) => setCategoria(e.target.value)}>
                      {CATEGORIAS.map(([k, n]) => (
                        <option key={k} value={k}>
                          {n}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <label className="campo-check">
                  <input type="checkbox" checked={shorts} onChange={(e) => setShorts(e.target.checked)} /> Agregar #Shorts
                </label>
              </>
            )}
          </div>

          <div className={'destino' + (conTiktok ? ' on' : '')}>
            <label className="campo-check">
              <input type="checkbox" checked={conTiktok} disabled={!tiktokDisponible} onChange={(e) => setConTiktok(e.target.checked)} />
              <b>♪ TikTok</b>
            </label>
            {!tiktokDisponible && <small className="aviso">Falta el token de TikTok (FOTOGRAMA_HERRAMIENTAS/tiktok).</small>}
            {conTiktok && (
              <>
                <label className="campo">
                  <span>Texto</span>
                  <textarea rows={4} maxLength={2200} value={textoTiktok} onChange={(e) => setTextoTiktok(e.target.value)} />
                </label>
                <label className="campo-check">
                  <input type="checkbox" checked={publicoTiktok} onChange={(e) => setPublicoTiktok(e.target.checked)} /> Público
                </label>
                <small className="aviso">
                  Tu app de TikTok aún no está auditada: TikTok no deja publicar directo, así que el video llega como <b>borrador a tu bandeja</b> y lo
                  terminas de publicar desde la app (te llega una notificación).
                </small>
              </>
            )}
          </div>
        </div>

        {error && <div className="aviso">{error}</div>}
        <div className="fila">
          <span className="espacio" />
          <button className="secundario" onClick={cerrar}>
            Cancelar
          </button>
          <button className="primario" disabled={enviando || (!conYoutube && !conTiktok)} onClick={enviar}>
            {enviando ? 'Publicando…' : `Publicar en ${[conYoutube && 'YouTube', conTiktok && 'TikTok'].filter(Boolean).join(' y ') || '…'}`}
          </button>
        </div>
      </div>
    </div>
  )
}

const ICONO: Record<string, string> = { publicado: '✅', borrador: '📝', privado: '🔒', pendiente: '—', error: '⚠️' }

const Plataformas = ({ p }: { p: Video['plataformas'] }) => (
  <div className="plataformas">
    {(['youtube', 'tiktok', 'facebook'] as const).map((k) => {
      const e = p[k]
      const contenido = (
        <>
          {k === 'youtube' ? 'YT' : k === 'tiktok' ? 'TT' : 'FB'} {ICONO[e?.estado || 'pendiente']}
        </>
      )
      return e?.url ? (
        <a key={k} href={e.url} target="_blank" rel="noreferrer" title={e.estado} className={'chip ' + (e?.estado || 'pendiente')}>
          {contenido}
        </a>
      ) : (
        <span key={k} title={e?.nota || e?.estado || 'pendiente'} className={'chip ' + (e?.estado || 'pendiente')}>
          {contenido}
        </span>
      )
    })}
  </div>
)

// Facebook Reels: los sube otra IA con la extensión de Chrome. Aquí se ve si ya se hizo y se puede
// marcar a mano (con el enlace del reel, si lo tienes).
const Facebook = ({ v, recargar }: { v: Video; recargar: () => void }) => {
  const fb = v.plataformas.facebook
  const [abierto, setAbierto] = useState(false)
  const [enlace, setEnlace] = useState('')
  const marcar = async (estado: 'publicado' | 'pendiente') => {
    await api('facebook/marcar', { cuerpo: { video: v.ruta, estado, url: enlace.trim() || undefined, por: 'manual' } })
    setAbierto(false)
    setEnlace('')
    recargar()
  }
  if (fb?.estado === 'publicado')
    return (
      <div className="fb-estado hecho">
        <span>
          ✅ Facebook Reels{fb.fecha ? ' · ' + new Date(fb.fecha).toLocaleDateString() : ''}
          {fb.url && (
            <>
              {' · '}
              <a href={fb.url} target="_blank" rel="noreferrer">
                ver
              </a>
            </>
          )}
        </span>
        <button className="mini" title="Volver a pendiente" onClick={() => marcar('pendiente')}>
          desmarcar
        </button>
      </div>
    )
  return abierto ? (
    <div className="fb-estado">
      <input placeholder="Enlace del reel (opcional)" value={enlace} onChange={(e) => setEnlace(e.target.value)} />
      <button className="mini" onClick={() => marcar('publicado')}>
        ✓ Publicado
      </button>
      <button className="mini" onClick={() => setAbierto(false)}>
        ✕
      </button>
    </div>
  ) : (
    <div className="fb-estado">
      <span className="tenue">⏳ Facebook Reels: pendiente</span>
      <button className="mini" onClick={() => setAbierto(true)}>
        marcar publicado
      </button>
    </div>
  )
}

export const Videos = () => {
  const [r, setR] = useState<Respuesta | null>(null)
  const [filtro, setFiltro] = useState('todos')
  const [sel, setSel] = useState<Video | null>(null)
  const [error, setError] = useState('')
  const cargar = () => api<Respuesta>('videos').then(setR).catch((e) => setError(e.message))
  useEffect(() => {
    cargar()
  }, [])
  // Mientras haya publicaciones en curso se refresca el estado.
  useEffect(() => {
    if (!r?.enCurso.some((p) => p.youtube?.estado === 'subiendo' || p.tiktok?.estado === 'subiendo')) return
    const t = setInterval(cargar, 2000)
    return () => clearInterval(t)
  }, [r])

  return (
    <div className="vista-videos">
      <div className="cabecera">
        <h3>Videos</h3>
        <select value={filtro} onChange={(e) => setFiltro(e.target.value)}>
          <option value="todos">Todos</option>
          {[...new Set(r?.videos.map((v) => v.canal).filter(Boolean))].map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
          <option value="sin-facebook">Pendientes de Facebook</option>
          <option value="otros">Pruebas del estudio</option>
        </select>
        <span className="tenue pequeno">Biblioteca: ruta en ~/.config/fotograma/config.json (biblioteca)</span>
        <span className="espacio" />
        {r && <span className="tenue pequeno">Canales: {r.canales.join(' · ') || 'ninguno'}</span>}
        <ConectarCanal conectado={() => cargar()} />
        <button className="secundario" onClick={cargar}>
          Actualizar
        </button>
      </div>
      {error && <div className="aviso">{error}</div>}
      <div className="rejilla-videos">
        {r?.videos
          .filter((v) =>
            filtro === 'todos'
              ? true
              : filtro === 'sin-facebook'
                ? v.origen === 'biblioteca' && (!v.plataformas.facebook || v.plataformas.facebook.estado === 'pendiente')
                : filtro === 'otros'
                  ? v.origen !== 'biblioteca'
                  : v.canal === filtro,
          )
          .map((v) => {
          const enCurso = r.enCurso.filter((p) => p.ruta === v.ruta)
          const pubs = [...v.publicaciones.filter((p) => !enCurso.some((x) => x.id === p.id)), ...enCurso].sort((a, b) => b.fecha.localeCompare(a.fecha))
          return (
            <div key={v.ruta} className="tarjeta-video">
              <video src={urlVideo(v.ruta)} preload="metadata" controls />
              <b title={v.nombre}>{v.datos?.titulo || v.nombre}</b>
              <small className="tenue">
                {v.origen === 'biblioteca' ? v.canal : v.origen === 'flujo' ? 'Flujo' : 'Estudio'} · {new Date(v.fecha).toLocaleDateString()} · {(v.bytes / 1e6).toFixed(1)} MB
              </small>
              {v.origen === 'biblioteca' && <Plataformas p={v.plataformas} />}
              {v.origen === 'biblioteca' && <Facebook v={v} recargar={cargar} />}
              {v.anteriores.length > 0 && (
                <details className="anteriores">
                  <summary className="tenue pequeno">+{v.anteriores.length} versión(es) anterior(es)</summary>
                  {v.anteriores.map((a) => (
                    <a key={a.ruta} className="pequeno" href={urlVideo(a.ruta)} target="_blank" rel="noreferrer">
                      {new Date(a.fecha).toLocaleString()}
                    </a>
                  ))}
                </details>
              )}
              {pubs.slice(0, 2).map((p) => (
                <Estado key={p.id} p={p} />
              ))}
              <button className="primario" onClick={() => setSel(v)}>
                Publicar
              </button>
            </div>
          )
        })}
        {r && !r.videos.length && <p className="tenue">Todavía no hay videos renderizados.</p>}
      </div>
      {sel && r && (
        <Publicar
          v={sel}
          canales={r.canales}
          tiktokDisponible={r.tiktok}
          cerrar={() => setSel(null)}
          recargar={cargar}
          listo={() => {
            setSel(null)
            cargar()
          }}
        />
      )}
    </div>
  )
}
