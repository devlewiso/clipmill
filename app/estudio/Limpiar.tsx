// Limpiar: editar una toma a cámara por su texto. limpiar.py propone cortes (muletillas, tomas repetidas, arranques
// en falso, palabras estiradas) y aquí se revisan como en un procesador de texto: seleccionar y borrar (Supr),
// devolver, mover frases (Ctrl+X → Ctrl+V), deshacer (Ctrl+Z). La vista previa reproduce el video tal como va a quedar.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from './api'
import { armarTramos, ordenDeLectura, rachas, recorta, tapa, bloqueDe, type Corte, type Movido, type Palabra } from './edicionTexto'

type Toma = { slug: string; propuesta: boolean; cortes: number; activos: number; duracion: number; clip: number | null; fecha: number }
type VideoCrudo = { nombre: string; ruta: string; bytes: number; fecha: number }
type Datos = { slug: string; propuesta: { video: string; duracion: number; cortes: Corte[]; movidos?: Movido[] } | null; palabras: Palabra[]; video: string }
type Trabajo = { id: number; tipo: string; composicion: string; estado: string; progreso: { mensaje?: string }; error?: string; salida: string }
type Edicion = { cortes: Corte[]; movidos: Movido[] }

const COLORES: Record<string, string> = { 'toma repetida': '#ff6b6b', 'arranque en falso': '#ff9f43', repetición: '#feca57', muletilla: '#a29bfe', 'palabra estirada': '#48dbfb', manual: '#f5b83d' }
const seg = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`
const escribiendo = (e: KeyboardEvent) => /^(INPUT|TEXTAREA|SELECT)$/.test((e.target as HTMLElement)?.tagName) || (e.target as HTMLElement)?.isContentEditable

export const Limpiar = () => {
  const [tomas, setTomas] = useState<Toma[]>([])
  const [crudos, setCrudos] = useState<VideoCrudo[]>([])
  const [slug, setSlug] = useState(() => localStorage.getItem('fotograma:limpiar') || '')
  const [datos, setDatos] = useState<Datos | null>(null)
  const [ed, setEd] = useState<Edicion>({ cortes: [], movidos: [] })
  const deshacer = useRef<Edicion[]>([])
  const rehacer = useRef<Edicion[]>([])
  const [guardado, setGuardado] = useState(true)
  const [error, setError] = useState('')
  const [aviso, setAviso] = useState('')
  const [trabajos, setTrabajos] = useState<Trabajo[]>([])
  const [nuevo, setNuevo] = useState({ video: '', slug: '' })
  const [reencuadre, setReencuadre] = useState({ video: '', formato: '9:16', zoom: 1 })
  const [reencuadres, setReencuadres] = useState<Trabajo[]>([])
  const [pausa, setPausa] = useState(0.3)
  const [look, setLook] = useState('natural')
  const [audio, setAudio] = useState<'pro' | 'original'>('pro')
  const [destino, setDestino] = useState<'tutorial' | 'noticiero'>('tutorial')
  const [ruido, setRuido] = useState<'no' | 'suave' | 'normal' | 'fuerte'>('suave')
  const [muestra, setMuestra] = useState<{ antes: string; despues: string; t: number } | null>(null)
  const [comparando, setComparando] = useState(false)
  const [previa, setPrevia] = useState(true)
  const [ahora, setAhora] = useState(0)
  const [sel, setSel] = useState<[number, number] | null>(null) // posiciones en el orden de lectura
  const [portapapeles, setPortapapeles] = useState<{ a: number; b: number; texto: string } | null>(null)
  const arrastrando = useRef(false)
  const video = useRef<HTMLVideoElement>(null)

  const [luts, setLuts] = useState<string[]>([])
  const [lut, setLut] = useState('')
  const cargarLista = useCallback(() => api<{ tomas: Toma[]; videos: VideoCrudo[]; luts: string[] }>('limpieza').then((r) => (setTomas(r.tomas), setCrudos(r.videos), setLuts(r.luts || []))), [])
  const cargar = useCallback(
    (s: string) =>
      api<Datos>('limpieza/' + s)
        .then((d) => {
          setDatos(d)
          setEd({ cortes: d.propuesta?.cortes || [], movidos: d.propuesta?.movidos || [] })
          deshacer.current = []
          rehacer.current = []
          setSel(null)
          setPortapapeles(null)
          setGuardado(true)
          setError('')
        })
        .catch((e) => (setDatos(null), setError(e.message))),
    [],
  )
  useEffect(() => void cargarLista(), [cargarLista])
  useEffect(() => {
    localStorage.setItem('fotograma:limpiar', slug)
    if (slug) cargar(slug)
  }, [slug, cargar])

  // Progreso de los trabajos de limpieza en la cola; al terminar el de esta toma, se recarga.
  const antes = useRef<Record<number, string>>({})
  useEffect(() => {
    const leer = () =>
      api<Trabajo[]>('trabajos').then((ts) => {
        const l = ts.filter((t) => t.tipo === 'limpieza')
        setTrabajos(l)
        setReencuadres(ts.filter((t) => t.tipo === 'reencuadre').slice(0, 5))
        for (const t of l) {
          if (antes.current[t.id] === 'corriendo' && t.estado === 'listo') {
            cargarLista()
            if (t.composicion === 'Analizar · ' + slug) cargar(slug)
          }
          antes.current[t.id] = t.estado
        }
      })
    leer()
    const t = setInterval(leer, 1500)
    return () => clearInterval(t)
  }, [slug, cargar, cargarLista])

  // Guardado automático.
  useEffect(() => {
    if (guardado || !slug) return
    const t = setTimeout(() => api('limpieza/' + slug, { metodo: 'PUT', cuerpo: ed }).then(() => setGuardado(true)).catch((e) => setError(e.message)), 500)
    return () => clearTimeout(t)
  }, [ed, guardado, slug])

  // Todo cambio pasa por aquí: guarda el estado anterior para Ctrl+Z. (Fuera del updater de React: en modo estricto
  // los updaters corren dos veces y el historial se duplicaría.)
  const edRef = useRef(ed)
  edRef.current = ed
  const editar = (f: (e: Edicion) => Edicion) => {
    const e = edRef.current
    const n = f(e)
    if (n === e) return
    deshacer.current = [...deshacer.current.slice(-99), e]
    rehacer.current = []
    edRef.current = n
    setEd(n)
    setGuardado(false)
  }
  const volver = (de: typeof deshacer, a: typeof rehacer) => {
    const previo = de.current.at(-1)
    if (!previo) return
    de.current = de.current.slice(0, -1)
    a.current = [...a.current, edRef.current]
    edRef.current = previo
    setEd(previo)
    setGuardado(false)
  }

  const palabras = datos?.palabras || []
  const duracion = datos?.propuesta?.duracion || palabras.at(-1)?.[2] || 0
  const { cortes, movidos } = ed
  const activos = cortes.filter((c) => c.activo)
  const orden = useMemo(() => ordenDeLectura(palabras, movidos), [palabras, movidos])
  const tramos = useMemo(() => armarTramos(palabras, cortes, movidos, pausa, duracion), [palabras, cortes, movidos, pausa, duracion])
  const final = tramos.reduce((n, t) => n + t.b - t.a, 0)
  const porCortes = activos.reduce((n, c) => n + (c.b - c.a), 0)
  const corteDe = (p: Palabra) => cortes.find((c) => c.a < p[2] && p[1] < c.b && (tapa(c, p) || recorta(c, p)))

  // Vista previa: reproduce los tramos en orden (salta cortes y pausas, y sigue los bloques movidos).
  const actual = useRef(-1)
  useEffect(() => {
    let id = 0
    const paso = () => {
      const v = video.current
      if (v && !v.paused) {
        const t = v.currentTime
        if (previa && tramos.length) {
          let k = actual.current
          const tr = tramos[k]
          if (!tr || t < tr.a - 0.15 || t > tr.b + 0.15) {
            // el usuario saltó: se busca el tramo donde cayó (o el siguiente)
            k = tramos.findIndex((x) => x.a - 0.05 <= t && t < x.b)
            if (k < 0) {
              k = tramos.findIndex((x) => x.a > t)
              if (k >= 0) v.currentTime = tramos[k].a
            }
            actual.current = k
          } else if (t >= tr.b - 0.02) {
            if (k + 1 < tramos.length) ((actual.current = k + 1), (v.currentTime = tramos[k + 1].a))
            else (v.pause(), (actual.current = -1))
          }
        }
        setAhora(v.currentTime)
      }
      id = requestAnimationFrame(paso)
    }
    id = requestAnimationFrame(paso)
    return () => cancelAnimationFrame(id)
  }, [tramos, previa])

  const ir = (t: number, reproducir = false) => {
    const v = video.current
    if (!v) return
    v.currentTime = Math.max(0, t)
    actual.current = -1
    setAhora(t)
    if (reproducir) v.play()
  }

  // ───── Acciones sobre la selección ─────
  const seleccion = sel ? orden.slice(Math.min(...sel), Math.max(...sel) + 1) : []
  const todasCortadas = seleccion.length > 0 && seleccion.every((i) => activos.some((c) => tapa(c, palabras[i])))
  const textoDe = (is: number[]) => is.map((i) => palabras[i][0]).join(' ')

  const cortarODevolver = () => {
    if (!seleccion.length) return
    if (todasCortadas) {
      // Devolver: los manuales se borran, los propuestos se apagan.
      const tocados = new Set(cortes.filter((c) => c.activo && seleccion.some((i) => tapa(c, palabras[i]))))
      editar((e) => ({ ...e, cortes: e.cortes.filter((c) => !(tocados.has(c) && c.tipo === 'manual')).map((c) => (tocados.has(c) ? { ...c, activo: false } : c)) }))
      return
    }
    const libres = seleccion.filter((i) => !activos.some((c) => tapa(c, palabras[i])))
    const nuevos: Corte[] = rachas(libres).map(([x, y], k) => {
      const sig = palabras[y + 1]
      return { id: Date.now() + k, a: palabras[x][1], b: sig ? Math.min(sig[1] - 0.02, palabras[y][2] + 0.05) : palabras[y][2], tipo: 'manual', motivo: 'lo borraste vos', texto: textoDe(range(x, y)), activo: true }
    })
    editar((e) => ({ ...e, cortes: [...e.cortes, ...nuevos].sort((a, b) => a.a - b.a) }))
  }

  const tomarParaMover = () => {
    const r = rachas(seleccion)
    if (r.length !== 1) return setAviso('Para mover, seleccioná un tramo seguido de la toma.')
    const [x, y] = r[0]
    setPortapapeles({ a: palabras[x][1], b: palabras[y][2], texto: textoDe(range(x, y)) })
    setAviso('')
  }

  const pegar = () => {
    if (!portapapeles || !seleccion.length) return setAviso('Seleccioná la palabra después de la cual va el bloque.')
    const destinoI = seleccion.at(-1)!
    const p = palabras[destinoI]
    if (portapapeles.a <= p[1] && p[1] <= portapapeles.b) return setAviso('No se puede pegar el bloque dentro de sí mismo.')
    if (bloqueDe(movidos, p) >= 0) return setAviso('Pegalo después de una palabra que esté en su lugar original (no dentro de otro bloque movido).')
    const m = portapapeles
    editar((e) => ({ ...e, movidos: [...e.movidos.filter((x) => !(x.a < m.b && m.a < x.b)), { a: m.a, b: m.b, despues: p[1] }] }))
    setPortapapeles(null)
    setSel(null)
    setAviso('')
  }
  const devolverBloque = (m: Movido) => editar((e) => ({ ...e, movidos: e.movidos.filter((x) => x !== m) }))

  // Teclado: Supr/Backspace cortar o devolver · Ctrl+X mover · Ctrl+V pegar · Ctrl+Z / Ctrl+Shift+Z · Esc.
  const accionesRef = useRef({ cortarODevolver, tomarParaMover, pegar })
  accionesRef.current = { cortarODevolver, tomarParaMover, pegar }
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      if (escribiendo(e)) return
      const ctrl = e.ctrlKey || e.metaKey
      const k = e.key.toLowerCase()
      if (ctrl && k === 'z' && !e.shiftKey) (e.preventDefault(), volver(deshacer, rehacer))
      else if (ctrl && (k === 'y' || (k === 'z' && e.shiftKey))) (e.preventDefault(), volver(rehacer, deshacer))
      else if (ctrl && k === 'x') (e.preventDefault(), accionesRef.current.tomarParaMover())
      else if (ctrl && k === 'v') (e.preventDefault(), accionesRef.current.pegar())
      else if (e.key === 'Delete' || e.key === 'Backspace') (e.preventDefault(), accionesRef.current.cortarODevolver())
      else if (e.key === 'Escape') (setSel(null), setPortapapeles(null), setAviso(''))
    }
    // Al soltar, la selección termina en la palabra donde se soltó (por si no llegó ningún mouseenter en el camino).
    const soltar = (e: MouseEvent) => {
      if (!arrastrando.current) return
      arrastrando.current = false
      const pos = Number((e.target as HTMLElement)?.closest?.('[data-pos]')?.getAttribute('data-pos'))
      if (Number.isFinite(pos)) setSel((s) => (s ? [s[0], pos] : [pos, pos]))
    }
    window.addEventListener('keydown', tecla)
    window.addEventListener('mouseup', soltar)
    return () => (window.removeEventListener('keydown', tecla), window.removeEventListener('mouseup', soltar))
  }, [])

  const tipos = [...new Set(cortes.map((c) => c.tipo))]
  const todos = (tipo: string, activo: boolean) => editar((e) => ({ ...e, cortes: e.cortes.map((c) => (c.tipo === tipo ? { ...c, activo } : c)) }))
  const deEsta = trabajos.filter((t) => t.composicion.endsWith('· ' + slug))
  const enCurso = deEsta.find((t) => t.estado === 'corriendo' || t.estado === 'pendiente')
  const ultimoClip = deEsta.find((t) => t.estado === 'listo' && t.composicion.startsWith('Limpiar'))
  const fallo = deEsta.find((t) => t.estado === 'error')
  const enSel = new Set(seleccion)

  const analizar = (s: string, v?: string, retranscribir = false) =>
    api('limpieza/' + s + '/analizar', { cuerpo: { video: v, retranscribir } })
      .then(() => setSlug(s))
      .catch((e) => setError(e.message))

  return (
    <div className="vista-limpiar">
      <aside className="lado">
        <h3>Tomas</h3>
        {tomas.map((t) => (
          <button key={t.slug} className={'comp' + (t.slug === slug ? ' activa' : '')} onClick={() => setSlug(t.slug)}>
            <span>{t.slug}</span>
            <small>{t.propuesta ? `${t.activos}/${t.cortes} cortes · ${seg(t.duracion)}${t.clip ? ' · clip ✓' : ''}` : 'sin analizar'}</small>
          </button>
        ))}
        {!tomas.length && <p className="tenue pequeno">Todavía no hay tomas.</p>}

        <h3>Nueva toma</h3>
        <select value={nuevo.video} onChange={(e) => setNuevo({ video: e.target.value, slug: nuevo.slug || e.target.selectedOptions[0]?.dataset.slug || '' })}>
          <option value="">Elegí un video de uploads/…</option>
          {crudos.map((v) => (
            <option key={v.ruta} value={v.ruta} data-slug={v.nombre.replace(/\.\w+$/, '').toLowerCase().replace(/[^\w-]+/g, '-')}>
              {v.nombre} · {(v.bytes / 1e6).toFixed(0)} MB · {new Date(v.fecha).toLocaleDateString()}
            </option>
          ))}
        </select>
        <input placeholder="nombre-corto (slug)" value={nuevo.slug} onChange={(e) => setNuevo({ ...nuevo, slug: e.target.value.replace(/[^\w-]/g, '-') })} />
        <button className="primario" disabled={!nuevo.video || !nuevo.slug} onClick={() => analizar(nuevo.slug, nuevo.video, true)} title="Transcribe (con muletillas) y propone los cortes. Va a la cola.">
          ✂ Analizar
        </button>
        <p className="tenue pequeno">Los videos crudos van en <code>~/Desktop/uploads</code>.</p>
        <h3>📐 Reencuadrar</h3>
        <p className="tenue pequeno">Pasa un video a otro formato siguiendo la cara (p. ej. horizontal → vertical para Reels).</p>
        <select value={reencuadre.video} onChange={(e) => setReencuadre({ ...reencuadre, video: e.target.value })}>
          <option value="">Elegí un video de uploads/…</option>
          {crudos.map((v) => (
            <option key={v.ruta} value={v.ruta}>
              {v.nombre}
            </option>
          ))}
        </select>
        <div className="fila">
          <select value={reencuadre.formato} onChange={(e) => setReencuadre({ ...reencuadre, formato: e.target.value })} title="Formato final">
            <option value="9:16">9:16 Reel / Short</option>
            <option value="4:5">4:5 feed</option>
            <option value="1:1">1:1 cuadrado</option>
            <option value="16:9">16:9 horizontal</option>
          </select>
          <select value={reencuadre.zoom} onChange={(e) => setReencuadre({ ...reencuadre, zoom: Number(e.target.value) })} title="Acercar">
            {[1, 1.15, 1.3, 1.5].map((z) => (
              <option key={z} value={z}>
                zoom {z}×
              </option>
            ))}
          </select>
        </div>
        <button
          disabled={!reencuadre.video}
          onClick={() => api('reencuadrar', { cuerpo: reencuadre }).catch((e) => setError(e.message))}
          title="Detecta la cara (YuNet, local) y recorta siguiéndola como un camarógrafo → out/ (va a la cola)"
        >
          📐 Reencuadrar
        </button>
        {reencuadres.map((t) => (
          <small key={t.id} className="tenue reencuadre-item">
            {t.estado === 'listo' ? (
              <a href={'/__fotograma/api/archivo?ruta=' + encodeURIComponent(t.salida)} target="_blank" rel="noreferrer">
                ✓ {t.salida.split('/').pop()}
              </a>
            ) : t.estado === 'error' ? (
              <span className="aviso-mini">✕ {t.composicion}: {t.error?.slice(0, 120)}</span>
            ) : (
              <span>
                ⏳ {t.composicion} {t.progreso.mensaje ? '· ' + t.progreso.mensaje : ''}
              </span>
            )}
          </small>
        ))}

        <h3>Atajos</h3>
        <p className="tenue pequeno atajos-limpiar">
          Arrastrá sobre el texto para seleccionar (Shift+clic extiende) · <kbd>Supr</kbd> cortar / devolver · <kbd>Ctrl+X</kbd> tomar para mover ·{' '}
          <kbd>Ctrl+V</kbd> pegar después de la palabra · <kbd>Ctrl+Z</kbd> deshacer · <kbd>Ctrl+Shift+Z</kbd> rehacer · doble clic escucha desde ahí · <kbd>Esc</kbd>
        </p>
      </aside>

      <main className="limpiar-centro">
        {error && <div className="aviso">{error}</div>}
        {!slug || !datos ? (
          <div className="vacio">Elegí una toma o analizá un video nuevo: Clipmill propone qué cortar (muletillas, tomas repetidas, arranques en falso) y lo editás como texto.</div>
        ) : (
          <>
            <div className="limpiar-barra">
              <b>{slug}</b>
              <span className="tenue">
                {seg(duracion)} → <b className="verde">{seg(final)}</b> · cortes {seg(porCortes)} · pausas {seg(Math.max(0, duracion - final - porCortes))}
                {movidos.length ? ` · ${movidos.length} bloque${movidos.length > 1 ? 's' : ''} movido${movidos.length > 1 ? 's' : ''}` : ''}
              </span>
              <span className="tenue pequeno">{guardado ? '✓ guardado' : 'guardando…'}</span>
              <span className="espacio" />
              {enCurso && <span className="trabajo-limpiar">⏳ {enCurso.progreso.mensaje || (enCurso.estado === 'pendiente' ? 'en la cola…' : 'trabajando…')}</span>}
              <button className="mini" onClick={() => analizar(slug, undefined, true)} disabled={!!enCurso} title="Vuelve a transcribir pidiendo las muletillas y recalcula la propuesta (pierde tus cambios)">
                ↻ Reanalizar
              </button>
            </div>

            <div className="limpiar-cuerpo">
              <div className="limpiar-video">
                <video ref={video} src={`/__fotograma/api/limpieza/${slug}/video`} controls playsInline onSeeked={(e) => setAhora(e.currentTarget.currentTime)} />
                <label className="campo-check">
                  <input type="checkbox" checked={previa} onChange={(e) => setPrevia(e.target.checked)} /> Vista previa de cómo queda (cortes, pausas y orden)
                </label>
                <h3>Generar</h3>
                <label className="campo">
                  <span>Para</span>
                  <select value={destino} onChange={(e) => setDestino(e.target.value as 'tutorial' | 'noticiero')}>
                    <option value="tutorial">Tutorial Viral (clip 1080×1920 con color y audio)</option>
                    <option value="noticiero">Noticiero (toma limpia en uploads/, sin color)</option>
                  </select>
                </label>
                <div className="fila">
                  {destino === 'tutorial' && (
                    <label className="campo">
                      <span>Look</span>
                      <select value={look} onChange={(e) => setLook(e.target.value)}>
                        <option value="natural">Natural</option>
                        <option value="cine">Cine</option>
                        <option value="noche">Noche (celular oscuro)</option>
                      </select>
                    </label>
                  )}
                  <label className="campo">
                    <span>Pausa máx.</span>
                    <select value={pausa} onChange={(e) => setPausa(Number(e.target.value))}>
                      {[0.2, 0.3, 0.45, 0.6, 1].map((p) => (
                        <option key={p} value={p}>
                          {p} s
                        </option>
                      ))}
                    </select>
                  </label>
                  {destino === 'tutorial' && (
                    <label className="campo">
                      <span>LUT</span>
                      <select value={lut} onChange={(e) => setLut(e.target.value)} title="LUT .cube después del look (agregá las tuyas en public/luts/)">
                        <option value="">Ninguna</option>
                        {luts.map((l) => (
                          <option key={l} value={l}>
                            {l.replace(/\.(cube|3dl)$/i, '')}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  {destino === 'tutorial' && (
                    <label className="campo">
                      <span>Audio</span>
                      <select value={audio} onChange={(e) => setAudio(e.target.value as 'pro' | 'original')}>
                        <option value="pro">Pro (limpia la voz)</option>
                        <option value="original">Original</option>
                      </select>
                    </label>
                  )}
                </div>
                <div className="fila">
                  <label className="campo">
                    <span>Ruido de fondo</span>
                    <select value={ruido} onChange={(e) => (setRuido(e.target.value as typeof ruido), setMuestra(null))} title="normal y fuerte usan RNNoise (red neuronal para voz): calle, viento, ventilador">
                      <option value="no">Sin reducir</option>
                      <option value="suave">Suave (como siempre)</option>
                      <option value="normal">Normal · RNNoise</option>
                      <option value="fuerte">Fuerte · RNNoise</option>
                    </select>
                  </label>
                  <button
                    className="mini"
                    disabled={ruido === 'no' || comparando}
                    title="8 s desde donde está el video: antes y después, al mismo volumen"
                    onClick={async () => {
                      setComparando(true)
                      try {
                        const r = await api<{ antes: string; despues: string }>('limpieza/' + slug + '/ruido', { cuerpo: { nivel: ruido, desde: video.current?.currentTime || 0 } })
                        setMuestra({ ...r, t: Date.now() })
                      } catch (e: any) {
                        setError(e.message)
                      }
                      setComparando(false)
                    }}
                  >
                    {comparando ? '…' : '🎧 Comparar'}
                  </button>
                </div>
                {muestra && (
                  <div className="comparar-ruido">
                    <span className="tenue pequeno">Antes</span>
                    <audio controls src={`/__fotograma/api/${muestra.antes}?t=${muestra.t}`} />
                    <span className="tenue pequeno">Después</span>
                    <audio controls src={`/__fotograma/api/${muestra.despues}?t=${muestra.t}`} />
                  </div>
                )}
                <button
                  className="primario"
                  disabled={!datos.propuesta || !!enCurso}
                  onClick={() => api('limpieza/' + slug + '/aplicar', { cuerpo: { look, pausa, audio, destino, ruido, lut: destino === 'tutorial' ? lut || undefined : undefined } }).catch((e) => setError(e.message))}
                  title={destino === 'tutorial' ? 'public/tutoriales/<slug>/clip.mp4 + palabras.json (va a la cola)' : 'uploads/<slug>-limpio-<fecha>.mp4: después pasala por preparar.py del Noticiero'}
                >
                  ✂ Generar ({seg(final)})
                </button>
                {ultimoClip && (
                  <p className="pequeno">
                    ✓ Listo:{' '}
                    <a href={'/__fotograma/api/archivo?ruta=' + encodeURIComponent(ultimoClip.salida)} target="_blank" rel="noreferrer">
                      abrir
                    </a>{' '}
                    <span className="tenue">({ultimoClip.salida.split('/').slice(-3).join('/')})</span>
                  </p>
                )}
                {fallo && !enCurso && <div className="aviso">{fallo.error}</div>}
              </div>

              <div className="limpiar-texto">
                {!datos.propuesta && <div className="aviso">Esta toma tiene transcripción pero no propuesta: tocá «Reanalizar».</div>}
                <div className="barra-edicion">
                  <button className="mini" disabled={!deshacer.current.length} onClick={() => volver(deshacer, rehacer)} title="Deshacer (Ctrl+Z)">
                    ↶
                  </button>
                  <button className="mini" disabled={!rehacer.current.length} onClick={() => volver(rehacer, deshacer)} title="Rehacer (Ctrl+Shift+Z)">
                    ↷
                  </button>
                  {portapapeles ? (
                    <>
                      <span className="pequeno">
                        Moviendo «{portapapeles.texto.slice(0, 50)}{portapapeles.texto.length > 50 ? '…' : ''}»: seleccioná la palabra después de la cual va.
                      </span>
                      <button className="mini primario" onClick={pegar} disabled={!seleccion.length}>
                        Pegar aquí (Ctrl+V)
                      </button>
                      <button className="mini" onClick={() => setPortapapeles(null)}>
                        Cancelar
                      </button>
                    </>
                  ) : seleccion.length ? (
                    <>
                      <span className="pequeno">{seleccion.length} palabra{seleccion.length > 1 ? 's' : ''}</span>
                      <button className="mini" onClick={cortarODevolver}>
                        {todasCortadas ? '↺ Devolver' : '✂ Cortar'} (Supr)
                      </button>
                      <button className="mini" onClick={tomarParaMover}>
                        ⤴ Mover (Ctrl+X)
                      </button>
                      <button className="mini" onClick={() => ir(palabras[seleccion[0]][1] - 0.3, true)}>
                        ▶ Escuchar
                      </button>
                      <button className="mini" onClick={() => setSel(null)}>
                        ✕
                      </button>
                    </>
                  ) : (
                    <span className="tenue pequeno">Arrastrá sobre el texto para seleccionar.</span>
                  )}
                  {aviso && <span className="aviso-mini">{aviso}</span>}
                </div>
                <div className="limpiar-tipos">
                  {tipos.map((t) => {
                    const cs = cortes.filter((c) => c.tipo === t)
                    const on = cs.filter((c) => c.activo).length
                    return (
                      <button key={t} className="chip" style={{ borderColor: COLORES[t] || '#888' }} onClick={() => todos(t, on < cs.length)} title={on < cs.length ? 'Activar todos' : 'Desactivar todos'}>
                        <i style={{ background: COLORES[t] || '#888' }} /> {t} {on}/{cs.length}
                      </button>
                    )
                  })}
                </div>
                <p className="transcripcion" onMouseLeave={() => (arrastrando.current = false)}>
                  {orden.map((i, pos) => {
                    const p = palabras[i]
                    const c = corteDe(p)
                    const movida = bloqueDe(movidos, p) >= 0
                    const anterior = pos > 0 ? palabras[orden[pos - 1]] : null
                    const salto = anterior && (bloqueDe(movidos, anterior) >= 0) !== movida
                    const pausaAntes = anterior && !salto && p[1] - anterior[2] > pausa
                    const cls = [
                      'palabra',
                      c?.activo ? (tapa(c, p) ? 'cortada' : 'recortada') : c ? 'propuesta' : '',
                      movida ? 'movida' : '',
                      enSel.has(i) ? 'elegida' : '',
                      portapapeles && portapapeles.a <= p[1] && p[2] <= portapapeles.b + 0.01 ? 'en-portapapeles' : '',
                      ahora >= p[1] && ahora < p[2] ? 'sonando' : '',
                    ].join(' ')
                    return (
                      <span key={i}>
                        {salto && <span className="marca-movida" title="Aquí empieza o termina un bloque movido">⤴</span>}
                        {pausaAntes && <span className="pausa" title={`pausa de ${(p[1] - anterior![2]).toFixed(1)} s (se corta)`}>·</span>}
                        <span
                          className={cls}
                          data-pos={pos}
                          style={c ? { textDecorationColor: COLORES[c.tipo] || '#888', background: c.activo && !enSel.has(i) ? (COLORES[c.tipo] || '#888') + '22' : undefined } : undefined}
                          title={c ? `${c.tipo}: ${c.motivo}` : `${p[1].toFixed(2)} s`}
                          onMouseDown={(e) => {
                            e.preventDefault()
                            if (e.altKey) return ir(p[1])
                            arrastrando.current = true
                            setSel((s) => (e.shiftKey && s ? [s[0], pos] : [pos, pos]))
                          }}
                          onMouseEnter={() => arrastrando.current && setSel((s) => (s ? [s[0], pos] : [pos, pos]))}
                          onDoubleClick={() => ir(p[1] - 0.3, true)}
                        >
                          {p[0]}
                        </span>{' '}
                      </span>
                    )
                  })}
                </p>

                {movidos.length > 0 && (
                  <>
                    <h3>Bloques movidos</h3>
                    <div className="lista-cortes">
                      {movidos.map((m, k) => {
                        const de = palabras.filter((p) => m.a <= (p[1] + p[2]) / 2 && (p[1] + p[2]) / 2 <= m.b)
                        const tras = palabras.find((p) => p[1] === m.despues)
                        return (
                          <div key={k} className="corte">
                            <i style={{ background: '#a55eea' }} />
                            <div>
                              «{de.map((p) => p[0]).join(' ').slice(0, 80)}» <span className="tenue">→ después de «{tras?.[0]}» ({seg(m.despues)})</span>
                            </div>
                            <button className="mini" onClick={() => devolverBloque(m)} title="Devolverlo a su lugar">
                              ↩
                            </button>
                          </div>
                        )
                      })}
                    </div>
                  </>
                )}

                <h3>Cortes ({activos.length} de {cortes.length})</h3>
                <div className="lista-cortes">
                  {cortes.map((c) => (
                    <div key={c.id + '-' + c.a} className={'corte' + (c.activo ? '' : ' apagado')}>
                      <input type="checkbox" checked={c.activo} onChange={() => editar((e) => ({ ...e, cortes: e.cortes.map((x) => (x === c ? { ...x, activo: !x.activo } : x)) }))} />
                      <i style={{ background: COLORES[c.tipo] || '#888' }} />
                      <button className="mini" onClick={() => (setPrevia(false), ir(c.a - 1, true))} title="Escuchar desde 1 s antes (sin saltar)">
                        ▶ {seg(c.a)}
                      </button>
                      <div>
                        <b>{c.tipo}</b> <span className="tenue">({(c.b - c.a).toFixed(1)} s)</span> «{c.texto.slice(0, 90)}»
                        <small className="tenue"> {c.motivo}</small>
                      </div>
                      {c.tipo === 'manual' && (
                        <button className="mini" onClick={() => editar((e) => ({ ...e, cortes: e.cortes.filter((x) => x !== c) }))} title="Quitar este corte">
                          ✕
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  )
}

const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, k) => a + k)
