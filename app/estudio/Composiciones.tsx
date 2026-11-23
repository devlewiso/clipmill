import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { resolverComposicion, type Composicion, type ElementoVisible, type Pista } from '../../src/nucleo/contexto'
import { contextoAgente } from './contextoAgente'
import { api, tiempo } from './api'
import { FormularioProps } from './FormularioProps'
import { LineaTiempo } from './LineaTiempo'
import { EditorTiempo } from './EditorTiempo'
import { esVideoDeEscenas, Inspector } from './Inspector'
import type { Guion } from '../../src/guion/tipos'
import { Reproductor, type Zoom } from './Reproductor'
import { Guiones } from './Guiones'
import { Manija, usePanel } from './Paneles'
import { agruparEjemplos, agruparPorCanal, canalDe } from './canales'

type Trabajo = {
  id: number
  tipo: 'render' | 'retake'
  composicion: string
  codec: string
  salida: string
  estado: 'pendiente' | 'corriendo' | 'listo' | 'error' | 'cancelado'
  origen?: 'estudio' | 'asistente' | 'remoto'
  posicion?: number
  progreso: { etapa: string; hechos: number; total: number; mensaje?: string }
  error?: string
  inicio: number
  fin?: number
}

const VELOCIDADES = [0.25, 0.5, 1, 1.5, 2]

export const Composiciones = ({
  lista,
  id,
  setId,
  recursos,
  borrarGuion,
  nuevoGuion,
  recargarGuiones,
}: {
  lista: Composicion[]
  id: string
  setId: (id: string) => void
  recursos: string[]
  borrarGuion: (idGuion: string) => Promise<void>
  nuevoGuion: () => Promise<string> // crea un guion y devuelve el id de su composición
  recargarGuiones: () => Promise<unknown>
}) => {
  // Dos grupos: los canales (tus guiones + el código del proyecto, cada uno en su canal) y los ejemplos (demos con ejemplo: true).
  const esGuion = (c: Composicion) => c.carpeta === 'Guiones'
  const grupoDe = (c: Composicion): 'canales' | 'ejemplos' => (c.ejemplo ? 'ejemplos' : 'canales')
  const misVideos = lista.filter(esGuion).sort((a, b) => String(b.props?.guion?.actualizado || '').localeCompare(String(a.props?.guion?.actualizado || '')))
  const canales = lista.filter((c) => grupoDe(c) === 'canales')
  const ejemplos = lista.filter((c) => grupoDe(c) === 'ejemplos')
  const [grupo, setGrupo] = useState<'canales' | 'ejemplos'>(() => {
    const actual = lista.find((c) => c.id === id)
    return actual ? grupoDe(actual) : 'canales'
  })
  const base = lista.find((c) => c.id === id) ?? misVideos[0] ?? lista[0]
  contextoAgente.composicion = base?.id // lo que de verdad se ve (para el asistente)
  const [buscar, setBuscar] = useState('')
  // Canales desplegados en la pestaña «Canales» (se recuerdan entre sesiones); arranca abierto el del video activo.
  const [abiertos, setAbiertos] = useState<string[]>(() => {
    let guardados: string[] = []
    try {
      guardados = JSON.parse(localStorage.getItem('fotograma:canales-abiertos') || '[]')
    } catch {}
    return guardados
  })
  useEffect(() => {
    const actual = lista.find((c) => c.id === id)
    const bloque = actual && (grupoDe(actual) === 'canales' ? canalDe(actual).nombre : actual.carpeta || 'Otros')
    if (bloque) setAbiertos((as) => (as.includes(bloque) ? as : [...as, bloque]))
  }, [id])
  const alternarCanal = (nombre: string) =>
    setAbiertos((as) => {
      const nuevos = as.includes(nombre) ? as.filter((n) => n !== nombre) : [...as, nombre]
      localStorage.setItem('fotograma:canales-abiertos', JSON.stringify(nuevos))
      return nuevos
    })
  // Barras laterales: se ensanchan arrastrando el borde y se ocultan con el botón de la manija.
  const izq = usePanel('comp-lado', 280)
  const der = usePanel('comp-panel', 320, 240, 640)
  // Los guiones se editan aquí mismo (antes era una pestaña aparte): el video y su guion en un solo lugar.
  const [editando, setEditando] = useState(() => localStorage.getItem('fotograma:editando-guion') === '1')
  useEffect(() => localStorage.setItem('fotograma:editando-guion', editando ? '1' : '0'), [editando])
  const guionBase: { id: string } | undefined = base?.props?.guion
  const [frame, setFrame] = useState(0)
  const [reproduciendo, setReproduciendo] = useState(false)
  const [bucle, setBucle] = useState(true)
  const [velocidad, setVelocidad] = useState(1)
  const [volumen, setVolumen] = useState(1)
  const [silencio, setSilencio] = useState(false)
  const [zoom, setZoom] = useState<Zoom>('ajustar')
  const [tablero, setTablero] = useState(true)
  const [entrada, setEntrada] = useState<number | null>(null)
  const [salida, setSalida] = useState<number | null>(null)
  const [modoProps, setModoProps] = useState<'formulario' | 'json'>('formulario')
  const [textoProps, setTextoProps] = useState('')
  const [codec, setCodec] = useState('h264')
  const [calidad, setCalidad] = useState('')
  const [escala, setEscala] = useState('1')
  const [usarRango, setUsarRango] = useState(false)
  const [trabajos, setTrabajos] = useState<Trabajo[]>([])
  const [ayuda, setAyuda] = useState(false)

  // Al cambiar de composición se reinicia el estado del visor.
  useEffect(() => {
    if (!base) return
    // Mientras cargan los guiones, el id pedido puede no estar todavía: no se pisa el enlace.
    if (base.id === id) location.hash = encodeURIComponent(base.id)
    setFrame(0)
    setReproduciendo(false)
    setEntrada(null)
    setSalida(null)
    setTextoProps(JSON.stringify(base.props || {}, null, 2))
  }, [base?.id])

  // Si la composición cambia por fuera (un guion guardado), se toman sus props nuevas — salvo que haya cambios de la
  // línea de tiempo esperando guardarse (si no, una recarga vieja pisaría lo último que se editó).
  const editadoEn = useRef(0)
  useEffect(() => {
    if (base && Date.now() - editadoEn.current > 2500) setTextoProps(JSON.stringify(base.props || {}, null, 2))
  }, [base?.props])

  // Línea de tiempo editable (solo videos de guion): vista previa al instante y guardado con un respiro.
  const [editarTiempo, setEditarTiempo] = useState(() => localStorage.getItem('fotograma:editar-tiempo') === '1')
  useEffect(() => localStorage.setItem('fotograma:editar-tiempo', editarTiempo ? '1' : '0'), [editarTiempo])
  const [guardandoTiempo, setGuardandoTiempo] = useState<'' | 'guardando' | 'guardado' | 'error'>('')
  const temporizador = useRef<ReturnType<typeof setTimeout>>(undefined)
  const aplicarGuion = (g: Guion) => {
    editadoEn.current = Date.now()
    setTextoProps(JSON.stringify({ ...ultimas.current, guion: g }, null, 2))
    setGuardandoTiempo('guardando')
    clearTimeout(temporizador.current)
    temporizador.current = setTimeout(async () => {
      try {
        await api('guiones/' + g.id, { metodo: 'PUT', cuerpo: { clips: g.clips, colorClips: g.colorClips, textos: g.textos, texto: g.texto, lineas: g.lineas } })
        editadoEn.current = Date.now()
        await recargarGuiones()
        setGuardandoTiempo('guardado')
      } catch {
        setGuardandoTiempo('error')
      }
    }, 700)
  }

  const ultimas = useRef<Record<string, any>>({})
  const { props, errorProps } = useMemo(() => {
    try {
      ultimas.current = JSON.parse(textoProps || '{}')
      return { props: ultimas.current, errorProps: '' }
    } catch (e: any) {
      return { props: ultimas.current, errorProps: e.message as string }
    }
  }, [textoProps])

  const comp = base ? resolverComposicion(base, props) : null
  const duracion = comp?.duracion ?? 1
  const desde = entrada ?? 0
  const hasta = salida ?? duracion - 1

  // ───── Pistas de la línea de tiempo ─────
  const mapa = useRef(new Map<string, Pista>())
  const [pistas, setPistas] = useState<Pista[]>([])
  const pendiente = useRef(0)
  const lineaTiempo = useMemo(() => {
    const publicar = () => {
      if (pendiente.current) return
      pendiente.current = requestAnimationFrame(() => {
        pendiente.current = 0
        setPistas([...mapa.current.values()])
      })
    }
    return {
      registrar: (p: Pista) => (mapa.current.set(p.clave, p), publicar()),
      quitar: (clave: string) => (mapa.current.delete(clave), publicar()),
    }
  }, [])

  // ───── Elementos ajustables a la vista (inspector del estándar de video) ─────
  const mapaElementos = useRef(new Map<string, ElementoVisible>())
  const [elementos, setElementos] = useState<ElementoVisible[]>([])
  const pendienteElementos = useRef(0)
  const registroElementos = useMemo(() => {
    const publicar = () => {
      if (pendienteElementos.current) return
      pendienteElementos.current = requestAnimationFrame(() => {
        pendienteElementos.current = 0
        setElementos([...mapaElementos.current.values()])
      })
    }
    return {
      registrar: (e: ElementoVisible) => (mapaElementos.current.set(e.clave, e), publicar()),
      quitar: (clave: string) => (mapaElementos.current.delete(clave), publicar()),
    }
  }, [])
  const [guardandoDatos, setGuardandoDatos] = useState<'' | 'guardando' | 'guardado' | 'error' | 'cambios'>('')
  const cambiarDesdeInspector = (p: Record<string, any>) => {
    editadoEn.current = Date.now()
    setTextoProps(JSON.stringify(p, null, 2))
    setGuardandoDatos('cambios')
  }
  // Videos de escenas guardados en un JSON (estándar de video): se editan con el inspector.
  const inspeccionable = !!base?.archivo && esVideoDeEscenas(props)
  const guardarDatos = async () => {
    if (!base?.archivo) return
    setGuardandoDatos('guardando')
    try {
      editadoEn.current = Date.now()
      await api('video-datos', { metodo: 'PUT', cuerpo: { archivo: base.archivo, props } })
      setGuardandoDatos('guardado')
    } catch {
      setGuardandoDatos('error')
    }
  }

  // ───── Reproducción ─────
  useEffect(() => {
    if (!reproduciendo || !comp) return
    let raf = 0
    const t0 = performance.now()
    const f0 = frame < desde || frame > hasta ? desde : frame
    const paso = () => {
      let f = f0 + Math.floor(((performance.now() - t0) / 1000) * comp.fps * velocidad)
      if (f > hasta) {
        if (!bucle) {
          setFrame(hasta)
          setReproduciendo(false)
          return
        }
        f = desde + ((f - desde) % (hasta - desde + 1))
      }
      setFrame(f)
      raf = requestAnimationFrame(paso)
    }
    raf = requestAnimationFrame(paso)
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reproduciendo, comp?.id, bucle, velocidad, desde, hasta])

  const irA = useCallback((f: number) => (setReproduciendo(false), setFrame(Math.max(0, Math.min(duracion - 1, f)))), [duracion])
  const mover = useCallback((d: number) => setFrame((f) => Math.max(0, Math.min(duracion - 1, f + d))), [duracion])

  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      const t = (e.target as HTMLElement).tagName
      if (t === 'TEXTAREA' || t === 'INPUT' || t === 'SELECT' || document.querySelector('.vista-guiones.incrustado')) return
      if (e.code === 'Space') (e.preventDefault(), setReproduciendo((r) => !r))
      else if (e.key === 'ArrowRight') mover(e.shiftKey ? comp?.fps ?? 10 : 1)
      else if (e.key === 'ArrowLeft') mover(e.shiftKey ? -(comp?.fps ?? 10) : -1)
      else if (e.key === 'Home') irA(desde)
      else if (e.key === 'End') irA(hasta)
      else if (e.key === 'i') setEntrada(frame)
      else if (e.key === 'o') setSalida(frame)
      else if (e.key === 'x') (setEntrada(null), setSalida(null))
      else if (e.key === 'l') setBucle((b) => !b)
      else if (e.key === 'm') setSilencio((s) => !s)
      else if (e.key === 'f') document.querySelector('.escenario')?.requestFullscreen?.()
      else if (e.key === '?') setAyuda((a) => !a)
    }
    window.addEventListener('keydown', tecla)
    return () => window.removeEventListener('keydown', tecla)
  }, [mover, irA, frame, desde, hasta, comp?.fps])

  // ───── Render ─────
  useEffect(() => {
    let vivo = true
    const leer = () => api<Trabajo[]>('trabajos').then((r) => vivo && setTrabajos(r)).catch(() => {})
    leer()
    const t = setInterval(leer, 1000)
    return () => ((vivo = false), clearInterval(t))
  }, [])

  // Retake: videos ya renderizados de esta composición sobre los que se puede rehacer el tramo marcado.
  const [bases, setBases] = useState<{ ruta: string; fecha: number; retake: boolean }[]>([])
  const [baseRetake, setBaseRetake] = useState('')
  const listos = trabajos.filter((t) => t.estado === 'listo').length
  useEffect(() => {
    api<typeof bases>('cola/bases?composicion=' + encodeURIComponent(base?.id || ''))
      .then((b) => (setBases(b), setBaseRetake((r) => (b.some((x) => x.ruta === r) ? r : b[0]?.ruta || ''))))
      .catch(() => setBases([]))
  }, [base?.id, listos])
  const retake = () => api('retake', { cuerpo: { id: base.id, base: baseRetake, frames: [desde, hasta], props, calidad: calidad ? Number(calidad) : undefined } })

  const renderizar = (formato: string) =>
    api('render', {
      cuerpo: {
        id: base.id,
        props,
        codec: formato,
        frame,
        frames: usarRango && formato !== 'png' ? [desde, hasta] : undefined,
        calidad: calidad ? Number(calidad) : undefined,
        escala: Number(escala) || 1,
      },
    })

  if (!base || !comp) return <div className="vacio">El proyecto no exporta composiciones.</div>

  const filtradas = (grupo === 'canales' ? canales : ejemplos).filter((c) =>
    (c.id + ' ' + (c.descripcion || '') + ' ' + (c.carpeta || '')).toLowerCase().includes(buscar.toLowerCase()),
  )
  const fechaCorta = (iso?: string) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : '')
  const fila = (c: Composicion) => {
    const r = resolverComposicion(c)
    const g = c.props?.guion
    if (!g)
      return (
        <button key={c.id} className={c.id === base.id ? 'comp activa' : 'comp'} onClick={() => setId(c.id)} title={c.descripcion}>
          <span>{c.id}</span>
          <small>
            {r.ancho}×{r.alto} · {r.fps} fps · {(r.duracion / r.fps).toFixed(1)} s
          </small>
        </button>
      )
    const sinAudio = g.lineas?.filter((l: any) => !l.audio).length || 0
    return (
      <div key={c.id} className={'comp comp-video' + (c.id === base.id ? ' activa' : '')} onClick={() => setId(c.id)} title={c.descripcion}>
        <span>{c.descripcion}</span>
        <small>
          {fechaCorta(g.actualizado)} · {(r.duracion / r.fps).toFixed(0)} s · {g.idioma?.toUpperCase()}
          {sinAudio ? ` · ${sinAudio} sin audio` : ''}
        </small>
        <button
          className="borrar-video"
          title="Borrar (va a la papelera; el video renderizado de la biblioteca no se toca)"
          onClick={async (e) => {
            e.stopPropagation()
            if (!confirm(`¿Borrar "${c.descripcion}"?\n\nEl guion va a la papelera del proyecto. Si ya lo renderizaste, el video de la biblioteca se queda.`)) return
            await borrarGuion(g.id)
          }}
        >
          🗑
        </button>
      </div>
    )
  }

  return (
    <div className="vista-comp" style={{ gridTemplateColumns: `${izq.columna} minmax(0, 1fr) ${der.columna}` }}>
      <aside className={'lado' + (izq.oculto ? ' colapsado' : '')}>
        <div className="selector grupos">
          <button className={grupo === 'canales' ? 'on' : ''} onClick={() => setGrupo('canales')}>
            Canales ({canales.length})
          </button>
          <button className={grupo === 'ejemplos' ? 'on' : ''} onClick={() => setGrupo('ejemplos')}>
            Ejemplos ({ejemplos.length})
          </button>
        </div>
        {grupo === 'canales' && (
          <button
            className="primario ancho"
            onClick={async () => {
              const cid = await nuevoGuion()
              setId(cid)
              setEditando(true)
            }}
          >
            + Nuevo video
          </button>
        )}
        <input className="buscar" placeholder={grupo === 'canales' ? 'Buscar en los canales y tus videos…' : 'Buscar ejemplo…'} value={buscar} onChange={(e) => setBuscar(e.target.value)} />
        {grupo === 'ejemplos' && <p className="tenue pequeno nota-ejemplos">Demos de lo que hace Clipmill por sí solo (animación, transiciones, efectos, formas), sin IA. Están en el código del proyecto.</p>}
        {(grupo === 'canales' ? agruparPorCanal(filtradas) : agruparEjemplos(filtradas)).map(({ canal, total, subcarpetas }) => {
          const abierto = !!buscar || abiertos.includes(canal.nombre)
          return (
            <div key={canal.nombre} className="canal">
              <button className="canal-titulo" onClick={() => alternarCanal(canal.nombre)} title={abierto ? 'Plegar' : 'Desplegar'}>
                <span className="flecha">{abierto ? '▾' : '▸'}</span>
                <span>{canal.icono} {canal.nombre}</span>
                <small>{total}</small>
              </button>
              {abierto &&
                subcarpetas.map(([sub, cs]) => (
                  <div key={sub}>
                    {sub && <div className="carpeta">{sub}</div>}
                    {cs.map(fila)}
                  </div>
                ))}
            </div>
          )
        })}
      </aside>

      {editando && guionBase ? (
        <Guiones key={guionBase.id} idInicial={guionBase.id} volver={() => setEditando(false)} alGuardar={recargarGuiones} />
      ) : (
      <>
      <main className="centro">
        <div className="barra-visor">
          <b>{base.id}</b>
          {guionBase && (
            <button className="editar-guion" onClick={() => setEditando(true)} title="Texto, personajes, voces y audio de este video">
              ✎ Editar guion
            </button>
          )}
          {guionBase && (
            <button className={'editar-guion' + (editarTiempo ? ' on' : '')} onClick={() => setEditarTiempo((e) => !e)} title="Línea de tiempo editable: mover, recortar y partir clips, reordenar frases, textos y stickers">
              ⏱ {editarTiempo ? 'Editando tiempo' : 'Editar tiempo'}
              {editarTiempo && guardandoTiempo && <small className="tenue"> · {guardandoTiempo === 'guardando' ? 'guardando…' : guardandoTiempo === 'guardado' ? '✓' : '⚠ no se guardó'}</small>}
            </button>
          )}
          <span className="tenue">
            {comp.ancho}×{comp.alto} · {comp.fps} fps
          </span>
          <span className="espacio" />
          <select value={String(zoom)} onChange={(e) => setZoom(e.target.value === 'ajustar' ? 'ajustar' : Number(e.target.value))} title="Zoom">
            <option value="ajustar">Ajustar</option>
            {[0.25, 0.5, 0.75, 1].map((z) => (
              <option key={z} value={z}>
                {z * 100}%
              </option>
            ))}
          </select>
          <button className={tablero ? 'on' : ''} onClick={() => setTablero((t) => !t)} title="Fondo de tablero (transparencia)">
            ▦
          </button>
          <button onClick={() => document.querySelector('.escenario')?.requestFullscreen?.()} title="Pantalla completa (F)">
            ⛶
          </button>
          <button onClick={() => setAyuda((a) => !a)} title="Atajos (?)">
            ?
          </button>
        </div>
        <Reproductor
          comp={base}
          ancho={comp.ancho}
          alto={comp.alto}
          frame={frame}
          props={props}
          reproduciendo={reproduciendo}
          volumen={silencio ? 0 : volumen}
          zoom={zoom}
          tablero={tablero}
          lineaTiempo={lineaTiempo}
          elementos={registroElementos}
        />
        <div className="controles">
          <button onClick={() => irA(desde)} title="Inicio (Home)">⏮</button>
          <button onClick={() => mover(-1)} title="Frame anterior (←)">◀</button>
          <button className="play" onClick={() => setReproduciendo((r) => !r)} title="Reproducir (espacio)">
            {reproduciendo ? '❚❚' : '▶'}
          </button>
          <button onClick={() => mover(1)} title="Frame siguiente (→)">▶</button>
          <button onClick={() => irA(hasta)} title="Fin (End)">⏭</button>
          <button className={bucle ? 'on' : ''} onClick={() => setBucle((b) => !b)} title="Repetir (L)">↻</button>
          <select value={velocidad} onChange={(e) => setVelocidad(Number(e.target.value))} title="Velocidad">
            {VELOCIDADES.map((v) => (
              <option key={v} value={v}>
                {v}×
              </option>
            ))}
          </select>
          <span className="tiempo">
            {tiempo(frame, comp.fps)} <small>/ {tiempo(duracion, comp.fps)}</small>
          </span>
          <span className="frame">
            {frame} / {duracion - 1}
          </span>
          <button className={entrada !== null ? 'on' : ''} onClick={() => setEntrada(entrada === null ? frame : null)} title="Marcar entrada (I)">
            [
          </button>
          <button className={salida !== null ? 'on' : ''} onClick={() => setSalida(salida === null ? frame : null)} title="Marcar salida (O)">
            ]
          </button>
          <span className="espacio" />
          <button onClick={() => setSilencio((s) => !s)} title="Silenciar (M)">
            {silencio ? '🔇' : '🔊'}
          </button>
          <input className="vol" type="range" min={0} max={1} step={0.05} value={volumen} onChange={(e) => setVolumen(Number(e.target.value))} />
        </div>
        {editarTiempo && props.guion ? (
          <EditorTiempo guion={props.guion} fps={comp.fps} frame={frame} irA={irA} aplicar={aplicarGuion} />
        ) : (
          <LineaTiempo pistas={pistas} duracion={duracion} fps={comp.fps} frame={frame} entrada={entrada} salida={salida} irA={irA} />
        )}
      </main>

      <aside className={'panel' + (der.oculto ? ' colapsado' : '')}>
        <div className="pestanas-mini">
          <h3>{inspeccionable ? 'Elementos' : 'Props'}</h3>
          {base.esquema && (
            <div className="selector">
              <button className={modoProps === 'formulario' ? 'on' : ''} onClick={() => setModoProps('formulario')}>
                Formulario
              </button>
              <button className={modoProps === 'json' ? 'on' : ''} onClick={() => setModoProps('json')}>
                JSON
              </button>
            </div>
          )}
        </div>
        {inspeccionable && (
          <Inspector
            props={props as any}
            cambiar={cambiarDesdeInspector}
            elementos={elementos}
            frame={frame}
            fps={comp.fps}
            irA={irA}
            archivo={base.archivo}
            guardar={guardarDatos}
            estado={guardandoDatos}
          />
        )}
        {inspeccionable && <h3>Props (JSON)</h3>}
        {base.esquema && modoProps === 'formulario' ? (
          <FormularioProps
            esquema={base.esquema}
            valores={props}
            recursos={recursos}
            cambiar={(k, v) => setTextoProps(JSON.stringify({ ...props, [k]: v }, null, 2))}
          />
        ) : (
          <textarea className="json" spellCheck={false} value={textoProps} onChange={(e) => setTextoProps(e.target.value)} />
        )}
        {errorProps && <div className="aviso">JSON inválido: {errorProps}</div>}
        <button className="mini-izq" onClick={() => setTextoProps(JSON.stringify(base.props || {}, null, 2))}>
          Restablecer props
        </button>

        <h3>Render</h3>
        <label className="campo">
          <span>Formato</span>
          <select value={codec} onChange={(e) => setCodec(e.target.value)}>
            <option value="h264">MP4 (H.264)</option>
            <option value="vp9">WebM con transparencia</option>
            <option value="prores">ProRes 4444 (.mov)</option>
            <option value="gif">GIF</option>
          </select>
        </label>
        <div className="fila">
          <label className="campo">
            <span>Calidad (CRF)</span>
            <input placeholder="auto" value={calidad} onChange={(e) => setCalidad(e.target.value)} />
          </label>
          <label className="campo">
            <span>Escala</span>
            <select value={escala} onChange={(e) => setEscala(e.target.value)}>
              <option value="0.5">0.5×</option>
              <option value="1">1×</option>
              <option value="2">2×</option>
            </select>
          </label>
        </div>
        <label className="campo campo-check">
          <span>
            Solo el rango marcado ({desde}–{hasta})
          </span>
          <input type="checkbox" checked={usarRango} onChange={(e) => setUsarRango(e.target.checked)} />
        </label>
        <button className="primario" onClick={() => renderizar(codec)}>
          Renderizar
        </button>
        <button className="secundario" onClick={() => renderizar('png')}>
          Guardar frame {frame} como PNG
        </button>
        {usarRango && bases.length > 0 && (
          <div className="retake">
            <label className="campo">
              <span>Retake sobre</span>
              <select value={baseRetake} onChange={(e) => setBaseRetake(e.target.value)}>
                {bases.map((b) => (
                  <option key={b.ruta} value={b.ruta}>
                    {b.ruta.split('/').slice(-2).join('/')} · {new Date(b.fecha).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                  </option>
                ))}
              </select>
            </label>
            <button className="secundario" onClick={retake} title="Renderiza solo el tramo marcado y lo pega sobre ese video (archivo nuevo en out/; el audio queda igual)">
              ↻ Retake del tramo {tiempo(desde, comp.fps)}–{tiempo(hasta + 1, comp.fps)}
            </button>
          </div>
        )}

        {trabajos.length > 0 && (
          <div className="cola-titulo">
            <h3>Cola</h3>
            <small className="tenue">{trabajos.filter((t) => t.estado === 'pendiente').length} en espera</small>
            {trabajos.some((t) => t.estado !== 'pendiente' && t.estado !== 'corriendo') && (
              <button className="mini" onClick={() => api('cola/limpiar', { cuerpo: {} })} title="Saca de la lista los terminados (los archivos no se borran)">
                limpiar terminados
              </button>
            )}
          </div>
        )}
        <div className="trabajos">
          {trabajos.map((t) => {
            const pct = t.progreso.total ? Math.round((t.progreso.hechos / t.progreso.total) * 100) : 0
            const mover = (a: string) => api('cola/mover', { cuerpo: { id: t.id, a } })
            return (
              <div key={t.id} className={'trabajo ' + t.estado}>
                <div className="t1">
                  <b>{t.composicion}</b> <small>{t.tipo === 'retake' ? 'retake' : t.codec}</small>
                  {t.origen && t.origen !== 'estudio' && <small className="origen">{t.origen === 'remoto' ? '📱' : '✦'} {t.origen}</small>}
                </div>
                {t.estado === 'pendiente' && (
                  <small>
                    #{t.posicion} en la fila{t.progreso.mensaje ? ` · ${t.progreso.mensaje}` : ''}
                    <span className="acciones-cola">
                      <button className="mini" onClick={() => mover('primero')} title="Pasar al frente">⤒</button>
                      <button className="mini" onClick={() => mover('arriba')} title="Subir">↑</button>
                      <button className="mini" onClick={() => mover('abajo')} title="Bajar">↓</button>
                      <button className="mini" onClick={() => api('cancelar', { cuerpo: { id: t.id } })}>
                        cancelar
                      </button>
                    </span>
                  </small>
                )}
                {t.estado === 'corriendo' && (
                  <>
                    <div className="progreso">
                      <div style={{ width: pct + '%' }} />
                    </div>
                    <small>
                      {t.progreso.mensaje || t.progreso.etapa} {t.progreso.total ? `${t.progreso.hechos}/${t.progreso.total}` : ''}
                      <button className="mini" onClick={() => api('cancelar', { cuerpo: { id: t.id } })}>
                        cancelar
                      </button>
                    </small>
                  </>
                )}
                {t.estado === 'listo' && (
                  <small>
                    ✓ {(((t.fin ?? 0) - t.inicio) / 1000).toFixed(1)} s ·{' '}
                    <a href={'/__fotograma/api/archivo?ruta=' + encodeURIComponent(t.salida)} target="_blank" rel="noreferrer">
                      abrir
                    </a>{' '}
                    · <span className="tenue">{t.salida.split('/').pop()}</span>
                  </small>
                )}
                {(t.estado === 'error' || t.estado === 'cancelado') && (
                  <small className="aviso">
                    {t.error}{' '}
                    <button className="mini" onClick={() => api('cola/reintentar', { cuerpo: { id: t.id } })}>
                      reintentar
                    </button>
                  </small>
                )}
              </div>
            )
          })}
        </div>
      </aside>
      </>
      )}

      <Manija panel={izq} lado="izq" nombre="la lista de videos" />
      {!(editando && guionBase) && <Manija panel={der} lado="der" nombre="el panel de render" />}

      {ayuda && (
        <div className="modal" onClick={() => setAyuda(false)}>
          <div className="caja" onClick={(e) => e.stopPropagation()}>
            <h3>Atajos de teclado</h3>
            <table>
              <tbody>
                {[
                  ['Espacio', 'Reproducir / pausar'],
                  ['← / →', 'Frame anterior / siguiente'],
                  ['Shift + ← / →', '1 segundo atrás / adelante'],
                  ['Home / End', 'Inicio / fin del rango'],
                  ['I / O', 'Marcar entrada / salida'],
                  ['X', 'Quitar el rango'],
                  ['L', 'Repetir'],
                  ['M', 'Silenciar'],
                  ['F o doble clic', 'Pantalla completa'],
                  ['?', 'Esta ayuda'],
                ].map(([k, d]) => (
                  <tr key={k}>
                    <td>
                      <kbd>{k}</kbd>
                    </td>
                    <td>{d}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <h3>Seguridad</h3>
            <ul className="tenue">
              <li>El estudio solo acepta órdenes desde esta pestaña o desde la terminal: si otra página web intenta mandarle algo, se rechaza.</li>
              <li>Esta versión no trae flujos ni nodos que ejecuten comandos: lo que agregue tu IA es código que podés leer.</li>
              <li>No abras el estudio a la red ni ejecutes proyectos de desconocidos sin leerlos.</li>
              <li>Todo el detalle está en <code>docs/seguridad.md</code>.</li>
            </ul>
          </div>
        </div>
      )}
    </div>
  )
}
