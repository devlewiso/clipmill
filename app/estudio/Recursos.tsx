// Recursos del proyecto (carpeta public/): ver, subir arrastrando y copiar la ruta.
// Galería agrupada por carpeta: imágenes y video en tarjetas, audio en filas con su reproductor.
// Abajo, lo que generaron los flujos (Cloudflare, Kie, voces) por ejecución. Doble clic abre el visor.
import { useEffect, useRef, useState } from 'react'
import { api } from './api'
import { pulso, ultimoGolpe, type Ritmo } from '../../src/ritmo'

type Recurso = { ruta: string; bytes: number }
type Generado = { ruta: string; bytes: number; fecha: string; ejecucion: string; flujo: string }
// Un archivo tal como se muestra: src para verlo, ruta para copiar (pública o absoluta).
type Item = { src: string; miniatura: string; ruta: string; nombre: string; bytes: number; fecha?: string; origen?: string }

const tipo = (r: string) =>
  /\.(png|jpe?g|webp|gif|avif|svg)$/i.test(r) ? 'imagen' : /\.(mp3|wav|ogg|m4a|aac)$/i.test(r) ? 'audio' : /\.(mp4|webm|mov)$/i.test(r) ? 'video' : 'otro'

const tamano = (b: number) => (b >= 1024 * 1024 ? (b / 1024 / 1024).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB')
const extension = (r: string) => (r.split('.').pop() || '').toUpperCase()
const carpetaDe = (r: string) => {
  const partes = r.replace(/^\//, '').split('/')
  return partes.length > 1 ? partes.slice(0, -1).join('/') + '/' : ''
}
const fechaLarga = (iso?: string) => (iso ? new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '')
// Barras decorativas para los audios (siempre las mismas para el mismo archivo).
const barras = (r: string) => Array.from({ length: 22 }, (_, i) => 4 + ((r.charCodeAt(i % r.length) * (i + 3)) % 11))

const ARCHIVO = '/__fotograma/flujos/archivo?ruta='
const MINIATURA = '/__fotograma/flujos/miniatura?ruta='
const dePublic = (r: Recurso): Item => ({ src: r.ruta, miniatura: r.ruta, ruta: r.ruta, nombre: r.ruta.split('/').pop() || r.ruta, bytes: r.bytes })
const deGenerado = (g: Generado): Item => ({
  src: ARCHIVO + encodeURIComponent(g.ruta),
  // Los videos generados pueden pesar mucho: en la tarjeta va un cuadro (ffmpeg, en caché).
  miniatura: (tipo(g.ruta) === 'video' ? MINIATURA : ARCHIVO) + encodeURIComponent(g.ruta),
  ruta: g.ruta,
  nombre: g.ruta.split('/').pop() || g.ruta,
  bytes: g.bytes,
  fecha: g.fecha,
  origen: g.flujo,
})

const Icono = ({ d, tam = 15 }: { d: string; tam?: number }) => (
  <svg width={tam} height={tam} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={d} />
  </svg>
)
const CARPETA = 'M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z'
const SUBIR = 'M12 16V4M7 9l5-5 5 5M5 20h14'
const BAJAR = 'M12 4v12M7 11l5 5 5-5M5 20h14'
const RAYO = 'M13 3L5 13h6l-1 8 8-10h-6z'

// Tarjetas de un grupo: imágenes/video en rejilla, audio en filas. Clic copia la ruta; doble clic abre el visor.
const Grupo = ({ items, sel, elegir, abrir }: { items: Item[]; sel: string | null; elegir: (i: Item) => void; abrir: (i: Item) => void }) => {
  const visuales = items.filter((r) => tipo(r.nombre) !== 'audio')
  const audios = items.filter((r) => tipo(r.nombre) === 'audio')
  return (
    <>
      {!!visuales.length && (
        <div className="rejilla">
          {visuales.map((r) => {
            const t = tipo(r.nombre)
            const generadoVideo = t === 'video' && r.miniatura !== r.src
            return (
              <button
                key={r.ruta}
                className={'recurso' + (sel === r.ruta ? ' on' : '')}
                onClick={() => elegir(r)}
                onDoubleClick={() => abrir(r)}
                title={`${r.ruta}\nClic: copiar la ruta · Doble clic: ver y descargar`}
              >
                <div className="miniatura">
                  {(t === 'imagen' || generadoVideo) && <img src={r.miniatura} alt="" loading="lazy" />}
                  {t === 'video' && !generadoVideo && <video src={r.src + '#t=0.5'} muted preload="metadata" />}
                  {t === 'otro' && <Icono d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8zM14 3v5h5" tam={26} />}
                  <span className="ext">{extension(r.nombre)}</span>
                  {t === 'video' && <span className="play-recurso">▶</span>}
                </div>
                <span className="nombre">{r.nombre}</span>
                <small className={sel === r.ruta ? 'copiada' : ''}>{sel === r.ruta ? 'ruta copiada' : tamano(r.bytes)}</small>
              </button>
            )
          })}
        </div>
      )}
      {!!audios.length && (
        <div className="rejilla-audios">
          {audios.map((r) => (
            <button
              key={r.ruta}
              className={'recurso-audio' + (sel === r.ruta ? ' on' : '')}
              onClick={() => elegir(r)}
              onDoubleClick={() => abrir(r)}
              title={`${r.ruta}\nClic: copiar la ruta y escuchar · Doble clic: ver y descargar`}
            >
              <span className="boton-oir">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M7 4l13 8-13 8z" />
                </svg>
              </span>
              <span className="cuerpo-audio">
                <span className="nombre">{r.nombre}</span>
                <span className="onda">
                  {barras(r.nombre).map((h, i) => (
                    <i key={i} style={{ height: h }} />
                  ))}
                </span>
              </span>
              <small>{tamano(r.bytes)}</small>
            </button>
          ))}
        </div>
      )}
    </>
  )
}

// Visor grande: el archivo, sus datos, copiar ruta, descargar y abrir. Flechas para recorrer.
const Visor = ({ lista, inicio, cerrar, copiar }: { lista: Item[]; inicio: number; cerrar: () => void; copiar: (i: Item) => void }) => {
  const [i, setI] = useState(inicio)
  const r = lista[i]
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      if (e.key === 'Escape') cerrar()
      if (e.key === 'ArrowRight') setI((x) => Math.min(lista.length - 1, x + 1))
      if (e.key === 'ArrowLeft') setI((x) => Math.max(0, x - 1))
    }
    window.addEventListener('keydown', tecla)
    return () => window.removeEventListener('keydown', tecla)
  }, [lista.length, cerrar])
  if (!r) return null
  const t = tipo(r.nombre)
  return (
    <div className="visor-recurso" onClick={cerrar}>
      <div className="visor-recurso-caja" onClick={(e) => e.stopPropagation()}>
        <div className="visor-recurso-medio">
          {i > 0 && (
            <button className="flecha izq" aria-label="Anterior" onClick={() => setI(i - 1)}>
              ‹
            </button>
          )}
          {t === 'imagen' && <img key={r.src} src={r.src} alt={r.nombre} />}
          {t === 'video' && <video key={r.src} src={r.src} controls autoPlay />}
          {t === 'audio' && (
            <div className="visor-audio">
              <span className="onda grande">
                {barras(r.nombre).map((h, k) => (
                  <i key={k} style={{ height: h * 4 }} />
                ))}
              </span>
              <RitmoAudio key={r.src} src={r.src} />
            </div>
          )}
          {t === 'otro' && <Icono d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8zM14 3v5h5" tam={64} />}
          {i < lista.length - 1 && (
            <button className="flecha der" aria-label="Siguiente" onClick={() => setI(i + 1)}>
              ›
            </button>
          )}
        </div>
        <aside className="visor-recurso-datos">
          <div className="fila-cerrar">
            <span className="mono tenue">
              {i + 1} / {lista.length}
            </span>
            <button className="cerrar" aria-label="Cerrar" onClick={cerrar}>
              ✕
            </button>
          </div>
          <h2>{r.nombre}</h2>
          <dl>
            <dt>Tipo</dt>
            <dd>{extension(r.nombre)}</dd>
            <dt>Tamaño</dt>
            <dd>{tamano(r.bytes)}</dd>
            {r.fecha && (
              <>
                <dt>Creado</dt>
                <dd>{fechaLarga(r.fecha)}</dd>
              </>
            )}
            {r.origen && (
              <>
                <dt>Flujo</dt>
                <dd>{r.origen}</dd>
              </>
            )}
          </dl>
          <div className="ruta-recurso">
            <small>Ruta</small>
            <code>{r.ruta}</code>
          </div>
          <a className="primario descargar" href={r.src} download={r.nombre}>
            <Icono d={BAJAR} />
            Descargar
          </a>
          <button className="secundario" onClick={() => copiar(r)}>
            Copiar ruta
          </button>
          <a className="secundario abrir-pestana" href={r.src} target="_blank" rel="noreferrer">
            Abrir en una pestaña nueva
          </a>
        </aside>
      </div>
    </div>
  )
}

export const Recursos = ({ recursos, recargar }: { recursos: Recurso[]; recargar: () => void }) => {
  const [arrastrando, setArrastrando] = useState(false)
  const [sel, setSel] = useState<string | null>(null)
  const [aviso, setAviso] = useState('')
  const [generados, setGenerados] = useState<Generado[]>([])
  const [visor, setVisor] = useState<{ lista: Item[]; i: number } | null>(null)

  useEffect(() => {
    fetch('/__fotograma/flujos/generados')
      .then((r) => r.json())
      .then((g) => setGenerados(Array.isArray(g) ? g : []))
      .catch(() => {})
  }, [recursos])

  // El aviso de "ruta copiada" se va solo.
  useEffect(() => {
    if (!aviso) return
    const t = setTimeout(() => setAviso(''), 2500)
    return () => clearTimeout(t)
  }, [aviso])

  const subir = async (archivos: FileList | null) => {
    for (const f of Array.from(archivos || [])) await api('recursos?nombre=' + encodeURIComponent(f.name), { bytes: f })
    recargar()
  }
  const copiar = (r: Item) => (navigator.clipboard?.writeText(r.ruta), setAviso(r.ruta))
  const elegir = (r: Item) => (setSel(r.ruta), copiar(r))

  const grupos = recursos.reduce<Record<string, Item[]>>((m, r) => ((m[carpetaDe(r.ruta)] ??= []).push(dePublic(r)), m), {})
  const ordenGrupos = Object.entries(grupos).sort(([a], [b]) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b)))
  const porEjecucion = generados.reduce<Record<string, Item[]>>((m, g) => ((m[g.ejecucion] ??= []).push(deGenerado(g)), m), {})
  const total = recursos.reduce((n, r) => n + r.bytes, 0)
  const totalGenerados = generados.reduce((n, r) => n + r.bytes, 0)
  // El visor recorre todo lo que se ve, en el mismo orden.
  const todos = [...ordenGrupos.flatMap(([, l]) => l), ...Object.values(porEjecucion).flat()]
  const abrir = (r: Item) => setVisor({ lista: todos, i: Math.max(0, todos.findIndex((x) => x.ruta === r.ruta)) })

  return (
    <div
      className={'vista-recursos' + (arrastrando ? ' arrastrando' : '')}
      onDragOver={(e) => (e.preventDefault(), setArrastrando(true))}
      onDragLeave={() => setArrastrando(false)}
      onDrop={(e) => (e.preventDefault(), setArrastrando(false), subir(e.dataTransfer.files))}
    >
      <div className="cabecera">
        <div className="titulo-recursos">
          <h1>Recursos</h1>
          <span className="tenue">
            Archivos de <code>public/</code> para usar en tus composiciones ·{' '}
            <span className="mono">
              {recursos.length} archivos · {tamano(total)}
            </span>
          </span>
        </div>
        <span className="espacio" />
        <span className="tenue pequeno">Clic copia la ruta · doble clic abre y descarga</span>
        <label className="primario subir-recursos">
          <Icono d={SUBIR} />
          Subir archivos
          <input type="file" multiple hidden onChange={(e) => subir(e.target.files)} />
        </label>
      </div>

      {!recursos.length && (
        <div className="recursos-vacio">
          <Icono d={SUBIR} tam={28} />
          <b>La carpeta public/ está vacía</b>
          <span className="tenue">Arrastra archivos aquí o usa «Subir archivos».</span>
        </div>
      )}

      {ordenGrupos.map(([carpeta, lista]) => (
        <section key={carpeta} className="grupo-recursos">
          <div className="cab-grupo">
            <Icono d={CARPETA} />
            <span className="mono">{carpeta || 'raíz /'}</span>
            <span className="cuenta">{lista.length}</span>
            <i />
          </div>
          <Grupo items={lista} sel={sel} elegir={elegir} abrir={abrir} />
        </section>
      ))}

      {!!generados.length && (
        <>
          <div className="titulo-generados">
            <h2>Generados por los flujos</h2>
            <span className="tenue">
              Imágenes, videos y voces de Cloudflare y Kie, por ejecución ·{' '}
              <span className="mono">
                {generados.length} archivos · {tamano(totalGenerados)}
              </span>
            </span>
          </div>
          {Object.entries(porEjecucion).map(([ej, lista]) => (
            <section key={ej} className="grupo-recursos">
              <div className="cab-grupo">
                <Icono d={RAYO} />
                <span className="mono">{lista[0].origen}</span>
                <span className="tenue pequeno">{fechaLarga(lista[0].fecha)}</span>
                <span className="cuenta">{lista.length}</span>
                <i />
              </div>
              <Grupo items={lista} sel={sel} elegir={elegir} abrir={abrir} />
            </section>
          ))}
        </>
      )}

      {arrastrando && (
        <div className="soltar-recursos">
          <span className="icono-soltar">
            <Icono d={SUBIR} tam={30} />
          </span>
          <b>Suelta para subir a public/</b>
          <span className="tenue">Imágenes, audio y video quedan listos para usar en tus composiciones.</span>
        </div>
      )}

      {visor && <Visor lista={visor.lista} inicio={visor.i} cerrar={() => setVisor(null)} copiar={copiar} />}

      {aviso && (
        <div className="aviso-copiado">
          <Icono d="M5 12l5 5 9-10" />
          Ruta copiada <code>{aviso}</code>
        </div>
      )}
      {!visor && sel && tipo(sel) === 'audio' && <audio src={todos.find((x) => x.ruta === sel)?.src ?? sel} controls autoPlay className="oir" />}
      {!visor && sel && tipo(sel) === 'video' && <video src={todos.find((x) => x.ruta === sel)?.src ?? sel} controls autoPlay className="ver" />}
    </div>
  )
}

// Audio con «🥁 Ritmo»: analiza beats/compases (→ <audio>.ritmo.json para fotograma/ritmo) y, mientras suena,
// un punto late en cada beat (más grande en el 1 de cada compás) para comprobarlo de oído.
const RitmoAudio = ({ src }: { src: string }) => {
  const audio = useRef<HTMLAudioElement>(null)
  const [ritmo, setRitmo] = useState<(Ritmo & { json: string }) | null>(null)
  const [estado, setEstado] = useState('')
  const [golpe, setGolpe] = useState({ beat: 0, compas: 0, n: 0 })
  useEffect(() => {
    if (!ritmo) return
    let id = 0
    const paso = () => {
      const t = audio.current?.currentTime ?? 0
      setGolpe({ beat: pulso(ritmo.beats, t, { caida: 0.18 }), compas: pulso(ritmo.compases, t, { caida: 0.25 }), n: ultimoGolpe(ritmo.beats, t) + 1 })
      id = requestAnimationFrame(paso)
    }
    id = requestAnimationFrame(paso)
    return () => cancelAnimationFrame(id)
  }, [ritmo])
  const analizar = async () => {
    setEstado('Analizando…')
    try {
      setRitmo(await api('ritmo', { cuerpo: { archivo: decodeURIComponent(src) } }))
      setEstado('')
    } catch (e: any) {
      setEstado(e.message)
    }
  }
  return (
    <>
      <audio ref={audio} src={src} controls autoPlay />
      <div className="ritmo-audio">
        {!ritmo ? (
          <button onClick={analizar} disabled={estado === 'Analizando…'} title="Detecta beats, compases y acentos; guarda <audio>.ritmo.json">
            🥁 Ritmo
          </button>
        ) : (
          <>
            <span className="latido" style={{ transform: `scale(${1 + golpe.beat * 0.6 + golpe.compas * 0.8})`, background: golpe.compas > 0.3 ? 'var(--acento)' : '#fff' }} />
            <b>{ritmo.bpm} BPM</b>
            <span className="tenue">
              beat {golpe.n} · {ritmo.beats.length} beats · {ritmo.compases.length} compases · {ritmo.acentos.length} acentos
            </span>
            <code title="Clic: copiar el import" onClick={() => navigator.clipboard?.writeText(`import ritmo from '../public${ritmo.json}'`)}>
              {ritmo.json}
            </code>
          </>
        )}
        {estado && <span className="tenue pequeno">{estado}</span>}
      </div>
    </>
  )
}

