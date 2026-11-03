// Producción desde guion: personajes (ingredientes) + guion → audio con ElevenLabs → composición.
import { useEffect, useRef, useState } from 'react'
import { composicionDeGuion, tomasDe } from '../../src/guion/composicion'
import { pendientesDeAudio, slug } from '../../src/guion/parsear'
import type { Formato, Guion, Personaje } from '../../src/guion/tipos'
import { resolverComposicion } from '../../src/nucleo/contexto'
import { api, tiempo } from './api'
import { alCambiarDatos, contextoAgente } from './contextoAgente'
import { Reproductor } from './Reproductor'

type Resumen = { id: string; titulo: string; formato: Formato; lineas: number; pendientes: number }
type Voz = { id: string; nombre: string; categoria: string; genero?: string; acento?: string; muestra?: string; usable: boolean }
type Progreso = { hechas: number; total: number; actual?: string; estado: 'corriendo' | 'listo' | 'error'; error?: string } | null

const FONDOS = [
  'linear-gradient(160deg, #1b1035 0%, #0d1b2a 100%)',
  'linear-gradient(160deg, #0f2027, #203a43, #2c5364)',
  'linear-gradient(160deg, #3a1c71, #d76d77, #ffaf7b)',
  'linear-gradient(160deg, #11998e, #38ef7d)',
  'linear-gradient(160deg, #141e30, #243b55)',
  '#111111',
]
const COLORES = ['#ff6b9a', '#4cc9f0', '#ffd166', '#06d6a0', '#a78bfa', '#f97316', '#ef4444', '#22c55e']

// Reproductor pequeño para la vista previa.
const Previa = ({ g }: { g: Guion }) => {
  const comp = composicionDeGuion(g)
  const r = resolverComposicion(comp)
  const [frame, setFrame] = useState(0)
  const [play, setPlay] = useState(false)
  useEffect(() => {
    if (!play) return
    let raf = 0
    const t0 = performance.now()
    const f0 = frame >= r.duracion - 1 ? 0 : frame
    const paso = () => {
      const f = f0 + Math.floor(((performance.now() - t0) / 1000) * r.fps)
      if (f >= r.duracion) return (setFrame(r.duracion - 1), setPlay(false))
      setFrame(f)
      raf = requestAnimationFrame(paso)
    }
    raf = requestAnimationFrame(paso)
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [play])
  return (
    <div className="previa">
      <Reproductor comp={comp} ancho={r.ancho} alto={r.alto} frame={Math.min(frame, r.duracion - 1)} props={{}} reproduciendo={play} volumen={1} tablero={false} />
      <div className="controles">
        <button className="play" onClick={() => setPlay((p) => !p)}>
          {play ? '❚❚' : '▶'}
        </button>
        <input className="vol" style={{ flex: 1 }} type="range" min={0} max={r.duracion - 1} value={Math.min(frame, r.duracion - 1)} onChange={(e) => (setPlay(false), setFrame(Number(e.target.value)))} />
        <span className="tiempo">
          {tiempo(frame, r.fps)} <small>/ {tiempo(r.duracion, r.fps)}</small>
        </span>
      </div>
    </div>
  )
}

// incrustado: se abre desde Composiciones para un guion concreto (sin la lista de la izquierda) y
// "volver" regresa a la vista previa. alGuardar avisa para que la composición se actualice.
export const Guiones = ({
  abrirComposicion,
  idInicial,
  volver,
  alGuardar,
}: {
  abrirComposicion?: (id: string) => void
  idInicial?: string
  volver?: () => void
  alGuardar?: () => void
}) => {
  const incrustado = !!volver
  const [lista, setLista] = useState<Resumen[]>([])
  const [id, setId] = useState<string | null>(idInicial ?? null)
  const [g, setG] = useState<Guion | null>(null)
  const [desconocidos, setDesconocidos] = useState<string[]>([])
  const [voces, setVoces] = useState<Voz[]>([])
  const [error, setError] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [progreso, setProgreso] = useState<Progreso>(null)
  const temporizador = useRef<ReturnType<typeof setTimeout>>(undefined)
  const sonido = useRef<HTMLAudioElement | null>(null)

  const cargarLista = () => api<Resumen[]>('guiones').then(setLista).catch((e) => setError(e.message))
  useEffect(() => {
    cargarLista()
  }, [])
  // Las voces dependen del proveedor del guion (Kie Gemini por defecto).
  const proveedor = g?.proveedorVoz || 'kie-gemini'
  useEffect(() => {
    api<Voz[]>('voces?proveedor=' + proveedor).then(setVoces).catch((e) => setError('No se pudieron cargar las voces: ' + e.message))
  }, [proveedor])
  useEffect(() => {
    if (!id && lista[0]) setId(lista[0].id)
  }, [lista])
  useEffect(() => {
    contextoAgente.guion = id || undefined
    return () => void (contextoAgente.guion = undefined)
  }, [id])
  useEffect(
    () =>
      alCambiarDatos((cambios) => {
        if (!cambios.some((c) => c.tipo === 'guion')) return
        cargarLista()
        const abierto = contextoAgente.guion
        if (abierto && cambios.some((c) => c.id === abierto)) api<Guion>('guiones/' + abierto).then(setG).catch(() => {})
      }),
    [],
  )
  useEffect(() => {
    if (!id) return
    api<Guion>('guiones/' + id).then(setG).catch((e) => setError(e.message))
    api<Progreso>('guiones/' + id + '/progreso').then(setProgreso)
  }, [id])

  // Guardado automático (el servidor vuelve a partir el texto en líneas).
  const cambiar = (cambios: Partial<Guion>) => {
    if (!g) return
    const nuevo = { ...g, ...cambios }
    setG(nuevo)
    clearTimeout(temporizador.current)
    temporizador.current = setTimeout(async () => {
      setGuardando(true)
      try {
        const r = await api<{ guion: Guion; desconocidos: string[] }>('guiones/' + nuevo.id, { metodo: 'PUT', cuerpo: nuevo })
        setG((actual) => (actual ? { ...actual, lineas: r.guion.lineas } : actual))
        setDesconocidos(r.desconocidos)
        setError('')
        cargarLista()
        alGuardar?.()
      } catch (e: any) {
        setError(e.message)
      } finally {
        setGuardando(false)
      }
    }, 600)
  }

  const cambiarPersonaje = (pid: string, c: Partial<Personaje>) => g && cambiar({ personajes: g.personajes.map((p) => (p.id === pid ? { ...p, ...c } : p)) })

  const agregarPersonaje = () => {
    if (!g) return
    const n = g.personajes.length
    const nombre = `Personaje ${n + 1}`
    const voz = voces.find((v) => v.usable && !g.personajes.some((p) => p.voz === v.id)) ?? voces[0]
    cambiar({
      personajes: [...g.personajes, { id: slug(nombre) + '-' + Date.now().toString(36), nombre, color: COLORES[n % COLORES.length], voz: voz?.id ?? '', vozNombre: voz?.nombre.split(' - ')[0] }],
    })
  }

  const subirImagen = async (pid: string, archivo: File) => {
    if (!g) return
    try {
      // Se guarda primero por si el personaje es nuevo y el servidor aún no lo conoce.
      await api('guiones/' + g.id, { metodo: 'PUT', cuerpo: g })
      const r = await api<Guion>(`guiones/${g.id}/imagen?personaje=${encodeURIComponent(pid)}&nombre=${encodeURIComponent(archivo.name)}`, { bytes: archivo })
      setG(r)
    } catch (e: any) {
      setError(e.message)
    }
  }

  const generarAudio = async () => {
    if (!g) return
    clearTimeout(temporizador.current)
    await api('guiones/' + g.id, { metodo: 'PUT', cuerpo: g })
    setProgreso(await api<Progreso>(`guiones/${g.id}/audio`, { metodo: 'POST' }))
  }

  // Mientras se genera, se consulta el avance y se recarga el guion con los audios nuevos.
  useEffect(() => {
    if (progreso?.estado !== 'corriendo' || !id) return
    const t = setInterval(async () => {
      const p = await api<Progreso>(`guiones/${id}/progreso`)
      setProgreso(p)
      if (p && p.hechas !== progreso.hechas) api<Guion>('guiones/' + id).then(setG)
      if (p?.estado !== 'corriendo') (api<Guion>('guiones/' + id).then(setG), cargarLista())
    }, 1000)
    return () => clearInterval(t)
  }, [progreso?.estado, progreso?.hechas, id])

  const nuevo = async () => {
    const titulo = prompt('Título del guion', 'Mi video')
    if (!titulo) return
    const r = await api<Guion>('guiones', { cuerpo: { titulo } })
    await cargarLista()
    setId(r.id)
  }

  const borrar = async () => {
    if (!g || !confirm(`¿Borrar el guion "${g.titulo}" y sus audios?`)) return
    await api('guiones/' + g.id, { metodo: 'DELETE' })
    setId(null)
    setG(null)
    cargarLista()
    alGuardar?.()
    volver?.()
  }

  const escuchar = (url?: string) => {
    if (!url) return
    sonido.current?.pause()
    sonido.current = new Audio(url)
    sonido.current.play()
  }

  const pendientes = g ? pendientesDeAudio(g) : []
  const totalCaracteres = pendientes.reduce((n, l) => n + l.texto.length, 0)
  const { tomas } = g ? tomasDe(g) : { tomas: [] }

  return (
    <div className={'vista-guiones' + (incrustado ? ' incrustado' : '')}>
      {!incrustado && <aside className="lado">
        <button className="primario ancho" onClick={nuevo}>
          + Nuevo guion
        </button>
        {lista.map((x) => (
          <button key={x.id} className={x.id === id ? 'comp activa' : 'comp'} onClick={() => setId(x.id)}>
            <span>{x.titulo}</span>
            <small>
              {x.formato} · {x.lineas} líneas {x.pendientes ? `· ${x.pendientes} sin audio` : '· ✓ audio'}
            </small>
          </button>
        ))}
        {!lista.length && <p className="tenue pequeno">Todavía no hay guiones. Crea uno para empezar.</p>}
      </aside>}

      {g ? (
        <main className="editor-guion">
          <div className="cabecera">
            <input className="titulo" value={g.titulo} onChange={(e) => cambiar({ titulo: e.target.value })} />
            <span className="tenue pequeno">{guardando ? 'Guardando…' : 'Guardado'}</span>
            <span className="espacio" />
            {incrustado ? (
              <button className="primario" onClick={volver}>
                ← Vista previa
              </button>
            ) : (
              <button className="secundario" onClick={() => abrirComposicion?.('Guion-' + g.id)}>
                Abrir en Composiciones →
              </button>
            )}
            <button className="mini" onClick={borrar}>
              borrar
            </button>
          </div>
          {error && <div className="aviso bloque">{error}</div>}

          <div className="columnas">
            <section>
              <h3>Ingredientes · personajes</h3>
              <div className="personajes">
                {g.personajes.map((p) => {
                  const voz = voces.find((v) => v.id === p.voz)
                  return (
                    <div key={p.id} className="personaje" style={{ borderColor: p.color }}>
                      <label className="foto" style={{ background: p.color }} title="Subir imagen">
                        {p.imagen ? <img src={p.imagen} alt="" /> : <span>{p.nombre.slice(0, 2).toUpperCase()}</span>}
                        <input type="file" accept="image/*" hidden onChange={(e) => e.target.files?.[0] && subirImagen(p.id, e.target.files[0])} />
                      </label>
                      <div className="datos">
                        <div className="fila">
                          <input value={p.nombre} onChange={(e) => cambiarPersonaje(p.id, { nombre: e.target.value })} />
                          <input type="color" value={p.color} onChange={(e) => cambiarPersonaje(p.id, { color: e.target.value })} />
                        </div>
                        <div className="fila">
                          <select
                            value={p.voz}
                            onChange={(e) => {
                              const v = voces.find((x) => x.id === e.target.value)
                              cambiarPersonaje(p.id, { voz: e.target.value, vozNombre: v?.nombre.split(' - ')[0] })
                            }}
                          >
                            {!voz && <option value={p.voz}>{p.vozNombre || p.voz || 'Elige una voz'}</option>}
                            {voces.map((v) => (
                              <option key={v.id} value={v.id} disabled={!v.usable}>
                                {v.nombre} {v.genero ? `· ${v.genero}` : ''} {!v.usable ? '(no disponible en tu plan)' : ''}
                              </option>
                            ))}
                          </select>
                          <button title={voz?.muestra ? 'Escuchar la voz' : 'Sin muestra (genera una línea para oírla)'} disabled={!voz?.muestra} onClick={() => escuchar(voz?.muestra)}>
                            ▶
                          </button>
                          <button
                            title="Quitar personaje"
                            onClick={() => cambiar({ personajes: g.personajes.filter((x) => x.id !== p.id) })}
                          >
                            ✕
                          </button>
                        </div>
                      </div>
                    </div>
                  )
                })}
                <button className="secundario" onClick={agregarPersonaje}>
                  + Agregar personaje
                </button>
              </div>

              <h3>Guion</h3>
              <p className="tenue pequeno">
                Una línea por intervención: <code>Nombre: lo que dice</code>. Las líneas sin nombre continúan la anterior; <code># comentario</code> se ignora.
              </p>
              <textarea className="guion" spellCheck value={g.texto} onChange={(e) => cambiar({ texto: e.target.value })} />
              {desconocidos.length > 0 && (
                <div className="aviso">
                  No hay personaje para: {desconocidos.join(', ')}. Agrégalo o corrige el nombre.
                </div>
              )}

              <h3>Estilo</h3>
              <div className="fila envolver">
                <label className="campo">
                  <span>Voz</span>
                  <select value={proveedor} onChange={(e) => cambiar({ proveedorVoz: e.target.value as Guion['proveedorVoz'] })}>
                    <option value="kie-gemini">Kie · Gemini (≈ $0.01 por video)</option>
                    <option value="elevenlabs">ElevenLabs (cuota mensual)</option>
                  </select>
                </label>
                <label className="campo">
                  <span>Formato</span>
                  <select value={g.formato} onChange={(e) => cambiar({ formato: e.target.value as Formato })}>
                    <option value="vertical">Vertical 9:16 (Shorts, Reels, TikTok)</option>
                    <option value="horizontal">Horizontal 16:9 (YouTube)</option>
                    <option value="cuadrado">Cuadrado 1:1</option>
                  </select>
                </label>
                <label className="campo">
                  <span>Pausa entre líneas (ms)</span>
                  <input type="number" step={50} value={g.pausaMs} onChange={(e) => cambiar({ pausaMs: Number(e.target.value) })} />
                </label>
                <label className="campo">
                  <span>Idioma</span>
                  <input value={g.idioma} onChange={(e) => cambiar({ idioma: e.target.value })} />
                </label>
              </div>
              {proveedor === 'kie-gemini' && (
                <label className="campo">
                  <span>Cómo debe sonar la narración (Gemini)</span>
                  <input
                    placeholder="Ej.: narración entusiasta y clara para un canal de ciencia, estudio silencioso"
                    value={g.estiloVoz || ''}
                    onChange={(e) => cambiar({ estiloVoz: e.target.value })}
                  />
                </label>
              )}
              <div className="fondos">
                {FONDOS.map((f) => (
                  <button key={f} className={g.fondo === f ? 'fondo on' : 'fondo'} style={{ background: f }} onClick={() => cambiar({ fondo: f })} />
                ))}
                <input value={g.fondo} onChange={(e) => cambiar({ fondo: e.target.value })} title="Color o gradiente CSS" />
              </div>
              <div className="fila">
                <label className="campo campo-check">
                  <span>Portada con el título</span>
                  <input type="checkbox" checked={g.portada} onChange={(e) => cambiar({ portada: e.target.checked })} />
                </label>
                <label className="campo campo-check">
                  <span>Subtítulos</span>
                  <input type="checkbox" checked={g.subtitulos} onChange={(e) => cambiar({ subtitulos: e.target.checked })} />
                </label>
              </div>
            </section>

            <section>
              <h3>Audio</h3>
              <div className="caja-audio">
                {progreso?.estado === 'corriendo' ? (
                  <>
                    <div className="progreso">
                      <div style={{ width: `${(progreso.hechas / Math.max(1, progreso.total)) * 100}%` }} />
                    </div>
                    <small>
                      Generando {progreso.hechas + 1}/{progreso.total}: {progreso.actual}
                    </small>
                  </>
                ) : (
                  <>
                    <button className="primario" disabled={!pendientes.length} onClick={generarAudio}>
                      {pendientes.length ? `Generar audio de ${pendientes.length} línea(s)` : '✓ Todo el audio está listo'}
                    </button>
                    {pendientes.length > 0 && (
                      <small className="tenue">
                        {proveedor === 'kie-gemini' ? `≈ $${Math.max(0.01, (totalCaracteres / 330) * 0.009).toFixed(2)} en Kie` : `≈ ${totalCaracteres} caracteres de tu cuota de ElevenLabs`}
                      </small>
                    )}
                    {progreso?.estado === 'error' && <small className="aviso">{progreso.error}</small>}
                  </>
                )}
              </div>

              <div className="lineas">
                {tomas.map((t, i) => {
                  const p = g.personajes.find((x) => x.id === t.linea.personaje)
                  const lista = pendientes.some((x) => x.id === t.linea.id)
                  return (
                    <div key={t.linea.id} className="linea">
                      <span className="num">{i + 1}</span>
                      <i style={{ background: p?.color ?? '#555' }} />
                      <div>
                        <b>{p?.nombre ?? '¿?'}</b> {t.linea.texto}
                        <small className="tenue">
                          {' '}
                          · {lista ? 'sin audio' : `${((t.linea.duracionMs ?? 0) / 1000).toFixed(1)} s`}
                        </small>
                      </div>
                      {t.linea.audio && !lista && (
                        <button className="mini" onClick={() => escuchar(t.linea.audio)}>
                          ▶
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>

              <h3>Vista previa</h3>
              <Previa g={g} />
            </section>
          </div>
        </main>
      ) : (
        <div className="vacio">Crea o elige un guion.</div>
      )}
    </div>
  )
}
