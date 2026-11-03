// Editor de flujos (tipo n8n): nodos, conexiones, triggers, ejecución en vivo y datos de cada nodo.
import {
  addEdge,
  Background,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { CATALOGO, CATEGORIAS, tipoPorId, valoresPorDefecto, type Campo } from '../../src/flujos/catalogo'
import type { CorridaNodo, Ejecucion, EventoMotor, Flujo, NodoFlujo } from '../../src/flujos/tipos'
import { DURACIONES, ESTRATEGIA, duracionPorId, type DuracionId } from '../../src/flujos/duraciones'
import { alCambiarDatos, contextoAgente } from './contextoAgente'
import { Manija, usePanel } from './Paneles'

const BASE = '/__fotograma/flujos/'
const pedir = async <T = any,>(ruta: string, metodo = 'GET', cuerpo?: unknown): Promise<T> => {
  const r = await fetch(BASE + ruta, { method: metodo, headers: cuerpo ? { 'Content-Type': 'application/json' } : undefined, body: cuerpo ? JSON.stringify(cuerpo) : undefined })
  const d = await r.json().catch(() => ({}))
  if (!r.ok || d?.error) throw new Error(d?.error || `Error ${r.status}`)
  return d
}

type Resumen = { id: string; nombre: string; activo: boolean; nodos: number; origenN8n?: string }
type Estado = { estado: 'corriendo' | 'ok' | 'error'; items?: number[]; ms?: number; error?: string }
type DatosNodo = { nodo: NodoFlujo; estado?: Estado }

// Estados en vivo de cada nodo (por nombre) para que el lienzo no tenga que rehacer los nodos.
const CtxEstados = createContext<Record<string, Estado>>({})

// ───────── Resultados en el lienzo (como Spaces): miniaturas de lo que generó cada nodo ─────────
type Medio = { ruta: string; tipo: 'imagen' | 'video' | 'audio'; pie?: string }
// Resumen de lo que analizó un nodo (p. ej. los videos que miró Tendencias del nicho).
type FilaAnalisis = { titulo: string; sub: string; img?: string; url?: string; extra?: string }
type Analisis = { titulo: string; detalle: string; filas: FilaAnalisis[] }
// Campos que devolvió un nodo (la respuesta de un LLM, lo que agregó un nodo Código…), por item.
type Dato = { clave: string; valor: any }
type Detalle = { titulo: string; items: Dato[][]; total: number; prompt?: string; sistema?: string }
type Vista = {
  medios: Medio[]
  texto?: string
  analisis?: Analisis
  detalle?: Detalle
  insignia?: string // una línea de estado: modelo usado, "sí 3 · no 1", "48 s · 1080×1920"…
  enlace?: { url: string; texto: string; img?: string }
}

const compacto = (n: number) => (n >= 1e6 ? (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M' : n >= 1e3 ? Math.round(n / 1e3) + 'K' : String(n))
const idYoutube = (url = '') => url.match(/(?:youtu\.be\/|v=|shorts\/)([\w-]{11})/)?.[1]

const analisisDe = (j: any): Analisis | undefined => {
  const vids: any[] = Array.isArray(j?.tendenciasVideos) ? j.tendenciasVideos : []
  if (!vids.length) return
  const busquedas = [...new Set(vids.map((v) => v.busqueda).filter(Boolean))]
  const ordenados = [...vids].sort((a, b) => (b.vistasPorDia || 0) - (a.vistasPorDia || 0))
  const total = vids.reduce((a, v) => a + (v.vistas || 0), 0)
  return {
    titulo: `${vids.length} videos analizados · ${compacto(total)} vistas`,
    detalle: busquedas.length ? 'Búsquedas: ' + busquedas.join(', ') : '',
    filas: ordenados.map((v) => {
      const id = idYoutube(v.url)
      const dur = v.segundos ? (v.segundos < 60 ? '<1 min' : Math.round(v.segundos / 60) + ' min') : ''
      return {
        titulo: String(v.titulo || ''),
        sub: [v.canal?.trim(), compacto(v.vistas || 0) + ' vistas', dur].filter(Boolean).join(' · '),
        extra: v.vistasPorDia ? compacto(v.vistasPorDia) + '/día' : undefined,
        img: id ? `https://i.ytimg.com/vi/${id}/mqdefault.jpg` : undefined,
        url: v.url,
      }
    }),
  }
}
const EXT: [RegExp, Medio['tipo']][] = [
  [/\.(jpe?g|png|webp|gif|avif)$/i, 'imagen'],
  [/\.(mp4|webm|mov|m4v)$/i, 'video'],
  [/\.(mp3|wav|ogg|m4a|aac|opus)$/i, 'audio'],
]
const tipoMedio = (r: string) => EXT.find(([re]) => re.test(r))?.[1]
const urlArchivo = (ruta: string) => BASE + 'archivo?ruta=' + encodeURIComponent(ruta)
const CLAVES_TEXTO = ['titulo', 'title', 'texto', 'guion', 'prompt', 'respuesta', 'mensaje', 'pregunta', 'descripcion']

// Archivos de la salida del nodo (item.archivo y rutas absolutas dentro del json) y, si no hay, un texto de muestra.
// Solo estos nodos crean archivos. Los de datos (tablas, código, LLM…) pueden traer rutas viejas en sus filas
// (p. ej. el historial con videos de hace semanas) y no deben verse como si las hubieran generado.
const GENERAN_MEDIOS = new Set(['vozGuion', 'render', 'imagen', 'animar', 'elevenlabs', 'kie', 'http', 'archivo', 'comando', 'siguienteStock'])

// Resumen de las filas que leyó o guardó un nodo Tabla (p. ej. los últimos videos del historial).
const CLAVES_FILA = ['titulo', 'tema', 'especie', 'pregunta', 'nombre']
const CLAVES_DETALLE = ['especie', 'tema', 'categoria', 'comportamiento']
const analisisTabla = (filas: any[], nodo: NodoFlujo): Analisis | undefined => {
  if (!filas.length) return
  const op = nodo.params?.operacion ?? 'leer'
  // Si el nombre es una expresión ({{ $json.tabla }}) no se muestra: no se sabe cómo se resolvió.
  const crudo = String(nodo.params?.tabla || '')
  const tabla = !crudo || crudo.includes('{{') ? 'la tabla' : crudo
  const cuando = (f: any) => String(f.creado || f.createdAt || f.fecha || '')
  const recientes = [...filas].sort((a, b) => cuando(b).localeCompare(cuando(a))).slice(0, 10)
  const verbo = op === 'insertar' ? 'guardada' : op === 'actualizar' ? 'actualizada' : op === 'borrar' ? 'borrada' : ''
  return {
    titulo: verbo ? `${filas.length} fila${filas.length > 1 ? 's' : ''} ${verbo}${filas.length > 1 ? 's' : ''} en ${tabla}` : `${filas.length >= 50 ? '50+' : filas.length} filas en ${tabla} · últimas ${recientes.length}`,
    // La ejecución guarda como mucho 50 items por nodo: con más filas, las más nuevas no están en el registro.
    detalle: verbo ? '' : filas.length >= 50 ? 'La tabla tiene más de 50 filas y la ejecución solo guardó 50: puede faltar lo más reciente.' : 'Lo que el flujo ya hizo (para no repetir temas). Más recientes primero.',
    filas: recientes.map((f) => {
      const kTitulo = CLAVES_FILA.find((k) => typeof f[k] === 'string' && f[k].trim())
      const yt = typeof f.youtube === 'string' && f.youtube.startsWith('http') ? f.youtube : undefined
      const id = idYoutube(yt)
      return {
        titulo: kTitulo ? String(f[kTitulo]) : JSON.stringify(f).slice(0, 80),
        sub: [String(f.fecha || cuando(f)).slice(0, 10), ...CLAVES_DETALLE.filter((k) => k !== kTitulo && typeof f[k] === 'string' && f[k] && f[k] !== f[kTitulo!]).slice(0, 2).map((k) => f[k])].filter(Boolean).join(' · '),
        extra: yt ? '▶ YouTube' : undefined,
        img: id ? `https://i.ytimg.com/vi/${id}/mqdefault.jpg` : undefined,
        url: yt,
      }
    }),
  }
}

const corto = (v: any): string =>
  typeof v === 'string'
    ? v
    : Array.isArray(v)
      ? v.every((x) => typeof x !== 'object') ? v.join(', ') : `${v.length} elemento${v.length === 1 ? '' : 's'}`
      : v && typeof v === 'object'
        ? '{ ' + Object.keys(v).join(', ') + ' }'
        : String(v)
const comoDatos = (o: any): Dato[] =>
  o && typeof o === 'object' && !Array.isArray(o) ? Object.entries(o).map(([clave, valor]) => ({ clave, valor })) : o == null || o === '' ? [] : [{ clave: 'respuesta', valor: o }]
// Lo que el nodo agregó o cambió respecto de lo que le llegó (lo que pasa de largo no interesa).
const camposNuevos = (sal: any, ent: any): Dato[] =>
  comoDatos(sal).filter(({ clave, valor }) => !ent || JSON.stringify(ent[clave]) !== JSON.stringify(valor))
// Nodos que no muestran campos: su resultado ya se ve de otra forma (enlace, estado, análisis) o solo dejan pasar datos.
const SIN_CAMPOS = new Set(['vozGuion', 'manual', 'programado', 'webhook', 'tabla', 'tendencias', 'youtube', 'tiktok', 'telegram', 'si', 'loop', 'unir', 'esperar', 'vistaPrevia', 'cuotaCloudflare'])
const sinCloud = (m: any) => String(m || '').replace(/:cloud$/, '')

const vistaDe = (c: CorridaNodo | undefined, nodo: NodoFlujo | undefined): Vista | undefined => {
  const tipo = nodo?.tipo
  if (!c || c.estado !== 'ok') return
  const items = c.salidas.flat()
  const rutasDe = (lista: typeof items) => {
    const rutas = new Set<string>()
    const juntar = (v: any, prof: number) => {
      if (typeof v === 'string') v.startsWith('/') && tipoMedio(v) && rutas.add(v)
      else if (prof < 3 && v && typeof v === 'object') for (const x of Array.isArray(v) ? v.slice(0, 30) : Object.values(v)) juntar(x, prof + 1)
    }
    for (const it of lista) {
      if (it.archivo && tipoMedio(it.archivo)) rutas.add(it.archivo)
      juntar(it.json, 0)
    }
    return rutas
  }
  // Solo lo que generó este nodo: lo que ya le llegó de entrada (un video que pasa a Subir a YouTube) no se repite.
  const recibidas = rutasDe(c.entrada)
  // El prompt de cada imagen va de pie en el visor.
  const pies = new Map<string, string>()
  for (const it of items) if (typeof it.json?.prompt === 'string') for (const r of rutasDe([it])) pies.set(r, it.json.prompt)
  const medios: Medio[] = GENERAN_MEDIOS.has(tipo ?? '')
    ? [...rutasDe(items)].filter((r) => !recibidas.has(r)).map((ruta) => ({ ruta, tipo: tipoMedio(ruta)!, pie: pies.get(ruta) }))
    : []
  const j = items[0]?.json
  const v: Vista = { medios }

  // Una línea de estado según el tipo de nodo.
  if (tipo === 'llm') {
    const modelos = [...new Set(items.map((x) => sinCloud(x.json?.modelo)).filter(Boolean))]
    const intentos = Math.max(...items.map((x) => Number(x.json?.intentos) || 1))
    v.insignia = [modelos.join(' / ') || sinCloud(nodo?.params?.modelo), items.length > 1 && `${items.length} respuestas`, intentos > 1 && `${intentos} intentos`].filter(Boolean).join(' · ')
  } else if (tipo === 'si') v.insignia = `sí ${c.salidas[0]?.length ?? 0} · no ${c.salidas[1]?.length ?? 0}`
  else if (tipo === 'render' && j?.segundos) v.insignia = `${Math.round(j.segundos)} s` + (j.ancho ? ` · ${j.ancho}×${j.alto}` : '')
  else if (tipo === 'vozGuion' && j?.segundosVoz) v.insignia = `🎙 ${j.segundosVoz} s de voz` + (j.lineas ? ` · ${j.lineas} líneas` : '')
  else if (tipo === 'tiktok' && j?.tiktok) v.insignia = j.tiktok.modo === 'draft' ? '📥 Borrador en tu bandeja de TikTok' : j.tiktok.ok ? '✓ Publicado en TikTok' : 'TikTok: ' + (j.tiktok.status || 'sin confirmar')
  else if (tipo === 'telegram') v.insignia = `✓ ${items.length} mensaje${items.length === 1 ? '' : 's'} enviado${items.length === 1 ? '' : 's'}`
  else if (tipo === 'imagen' || tipo === 'kie' || tipo === 'animar') {
    const prov = [...new Set(items.map((x) => [x.json?.proveedor, x.json?.modelo].filter(Boolean).join(' ')).filter(Boolean))]
    if (prov.length) v.insignia = prov.join(' / ')
  }
  if (tipo === 'youtube' && typeof j?.url === 'string') {
    const id = idYoutube(j.url)
    v.enlace = { url: j.url, texto: String(j.titulo || j.url), img: id ? `https://i.ytimg.com/vi/${id}/mqdefault.jpg` : undefined }
  }
  if (medios.length || v.enlace) return v
  if (v.insignia && SIN_CAMPOS.has(tipo ?? '')) return v
  // Como con los medios: solo el nodo que hizo el análisis lo muestra, no los que lo reciben después.
  const analisis =
    tipo === 'tabla' && nodo ? analisisTabla(items.map((x) => x.json), nodo) : c.entrada.some((x) => x.json?.tendenciasVideos) ? undefined : analisisDe(j)
  if (analisis) return { ...v, analisis }

  // Campos: la respuesta del LLM, o lo que agregó/cambió el nodo (Código, Establecer, Crear guion…).
  if (!SIN_CAMPOS.has(tipo ?? '')) {
    const porItem = items.slice(0, 20).map((it, i) =>
      tipo === 'llm' ? comoDatos(it.json?.output ?? it.json?.texto) : camposNuevos(it.json, (c.entrada[i] ?? c.entrada[0])?.json),
    )
    if (porItem.some((d) => d.length)) {
      const n = porItem[0].length
      return {
        ...v,
        detalle: {
          titulo: tipo === 'llm' ? 'Respuesta' + (items.length > 1 ? `s (${items.length})` : '') : `${n} campo${n === 1 ? '' : 's'} nuevo${n === 1 ? '' : 's'}` + (items.length > 1 ? ` · ${items.length} items` : ''),
          items: porItem,
          total: items.length,
          prompt: tipo === 'llm' ? String(nodo?.params?.prompt || '') : undefined,
          sistema: tipo === 'llm' ? String(nodo?.params?.sistema || '') : undefined,
        },
      }
    }
  }
  const clave = j && CLAVES_TEXTO.find((k) => typeof j[k] === 'string' && j[k].trim())
  return clave ? { ...v, texto: String(j[clave]).slice(0, 220) } : v.insignia ? v : undefined
}

const CtxVistas = createContext<Record<string, Vista>>({})
type Acciones = { ver: (medios: Medio[], i: number, nodo: string) => void; verAnalisis: (a: Analisis, nodo: string) => void; verDetalle: (d: Detalle, nodo: string) => void; rehacer: (nodo: string, solo: boolean) => void; puedeRehacer: boolean; miniaturas: boolean }
const CtxAcciones = createContext<Acciones>({ ver: () => {}, verAnalisis: () => {}, verDetalle: () => {}, rehacer: () => {}, puedeRehacer: false, miniaturas: true })

// Un archivo que ya no existe (render temporal borrado, etc.) se quita de la tira en vez de dejar un hueco.
const ocultarRoto = (e: React.SyntheticEvent<HTMLElement>) => {
  const b = e.currentTarget.closest('button')
  if (b) b.style.display = 'none'
}
const Miniatura = ({ m, grande }: { m: Medio; grande?: boolean }) =>
  m.tipo === 'imagen' ? (
    <img src={urlArchivo(m.ruta)} loading="lazy" alt="" onError={grande ? undefined : ocultarRoto} />
  ) : m.tipo === 'video' ? (
    grande ? <video src={urlArchivo(m.ruta)} controls autoPlay /> : (
      <>
        <img src={BASE + 'miniatura?ruta=' + encodeURIComponent(m.ruta)} loading="lazy" alt="" onError={ocultarRoto} />
        <span className="play-medio">▶</span>
      </>
    )
  ) : grande ? (
    <audio src={urlArchivo(m.ruta)} controls autoPlay />
  ) : (
    <span className="mini-audio">♪</span>
  )

const MediosNodo = ({ nombre }: { nombre: string }) => {
  const vista = useContext(CtxVistas)[nombre]
  const acc = useContext(CtxAcciones)
  if (!vista || !acc.miniaturas) return null
  const { medios, texto, analisis, detalle, insignia, enlace } = vista
  const MAX = medios.length > 4 ? 3 : 4
  const datos = detalle?.items[0] ?? []
  return (
    <div className="medios-nodo">
      {insignia && <span className="insignia-nodo">{insignia}</span>}
      {enlace ? (
        <a className="nodrag enlace-nodo" href={enlace.url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
          {enlace.img && <img src={enlace.img} alt="" loading="lazy" />}
          <span>{enlace.texto}</span>
        </a>
      ) : detalle ? (
        <button className="nodrag datos-nodo" title="Ver todos los campos" onClick={(e) => (e.stopPropagation(), acc.verDetalle(detalle, nombre))}>
          <b>{detalle.titulo}</b>
          {datos.slice(0, 4).map((d) => (
            <span key={d.clave} className="dato">
              <em>{d.clave}</em> {corto(d.valor).slice(0, 120)}
            </span>
          ))}
          {datos.length > 4 && <small className="tenue">+{datos.length - 4} campos · ver todo</small>}
        </button>
      ) : analisis ? (
        <button className="nodrag analisis-nodo" title="Ver todo lo que analizó" onClick={(e) => (e.stopPropagation(), acc.verAnalisis(analisis, nombre))}>
          <b>{analisis.titulo}</b>
          {analisis.filas.slice(0, 3).map((f, i) => (
            <span key={i} className="fila-analisis">
              {f.img ? <img src={f.img} alt="" loading="lazy" /> : <i />}
              <span>
                <span className="t">{f.titulo}</span>
                <small>{f.extra ?? f.sub}</small>
              </span>
            </span>
          ))}
          {analisis.filas.length > 3 && <small className="tenue">+{analisis.filas.length - 3} más · ver todo</small>}
        </button>
      ) : medios.length > 0 ? (
        <div className={'rejilla-medios n' + Math.min(medios.length, 4)}>
          {medios.slice(0, MAX).map((m, i) => (
            <button key={m.ruta} className="nodrag" title={m.ruta.split('/').pop()} onClick={(e) => (e.stopPropagation(), acc.ver(medios, i, nombre))}>
              <Miniatura m={m} />
            </button>
          ))}
          {medios.length > MAX && (
            <button className="nodrag mas" onClick={(e) => (e.stopPropagation(), acc.ver(medios, MAX, nombre))}>
              +{medios.length - MAX}
            </button>
          )}
        </div>
      ) : texto ? (
        <p className="texto-nodo">{texto}</p>
      ) : null}
      {acc.puedeRehacer && (
        <button className="nodrag rehacer-nodo" title="Rehacer solo este nodo (reutiliza el resto de la ejecución)" onClick={(e) => (e.stopPropagation(), acc.rehacer(nombre, true))}>
          ↻
        </button>
      )}
    </div>
  )
}

// Todos los campos que devolvió un nodo, item por item (y el prompt, si es un LLM).
const ValorDato = ({ v }: { v: any }) =>
  typeof v === 'string' ? (
    <p className="valor-texto">{v}</p>
  ) : Array.isArray(v) && v.every((x) => typeof x !== 'object') ? (
    <ul className="valor-lista">
      {v.map((x, i) => (
        <li key={i}>{String(x)}</li>
      ))}
    </ul>
  ) : typeof v === 'object' && v !== null ? (
    <pre className="valor-json">{JSON.stringify(v, null, 2)}</pre>
  ) : (
    <p className="valor-texto">{String(v)}</p>
  )

const VisorDetalle = ({ d, nodo, cerrar }: { d: Detalle; nodo: string; cerrar: () => void }) => {
  const [i, setI] = useState(0)
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => e.key === 'Escape' && cerrar()
    window.addEventListener('keydown', tecla)
    return () => window.removeEventListener('keydown', tecla)
  }, [cerrar])
  return (
    <div className="visor-medios" onClick={cerrar}>
      <div className="visor-cab" onClick={(e) => e.stopPropagation()}>
        <b>{nodo}</b>
        <span className="tenue">{d.titulo}</span>
        <span className="espacio" />
        <button className="mini" onClick={cerrar}>
          ✕
        </button>
      </div>
      <div className="lista-analisis" onClick={(e) => e.stopPropagation()}>
        {d.items.length > 1 && (
          <div className="selector">
            {d.items.map((_, k) => (
              <button key={k} className={k === i ? 'on' : ''} onClick={() => setI(k)}>
                {k + 1}
              </button>
            ))}
            {d.total > d.items.length && <span className="tenue pequeno"> (se muestran {d.items.length} de {d.total})</span>}
          </div>
        )}
        {d.items[i]?.map((x) => (
          <div key={x.clave} className="campo-dato">
            <small>{x.clave}</small>
            <ValorDato v={x.valor} />
          </div>
        ))}
        {(d.sistema || d.prompt) && (
          <details className="prompt-dato">
            <summary>Prompt usado (plantilla del nodo)</summary>
            {d.sistema && (
              <>
                <small>Sistema</small>
                <pre>{d.sistema}</pre>
              </>
            )}
            {d.prompt && (
              <>
                <small>Prompt</small>
                <pre>{d.prompt}</pre>
              </>
            )}
          </details>
        )}
      </div>
    </div>
  )
}

// Resumen completo de lo que analizó un nodo.
const VisorAnalisis = ({ a, nodo, cerrar }: { a: Analisis; nodo: string; cerrar: () => void }) => {
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => e.key === 'Escape' && cerrar()
    window.addEventListener('keydown', tecla)
    return () => window.removeEventListener('keydown', tecla)
  }, [cerrar])
  return (
    <div className="visor-medios" onClick={cerrar}>
      <div className="visor-cab" onClick={(e) => e.stopPropagation()}>
        <b>{nodo}</b>
        <span className="tenue">{a.titulo}</span>
        <span className="espacio" />
        <button className="mini" onClick={cerrar}>
          ✕
        </button>
      </div>
      <div className="lista-analisis" onClick={(e) => e.stopPropagation()}>
        {a.detalle && <p className="tenue">{a.detalle}</p>}
        {a.filas.map((f, i) => (
          <a key={i} className="item-analisis" href={f.url} target="_blank" rel="noreferrer">
            <span className="pos">{i + 1}</span>
            {f.img ? <img src={f.img} alt="" loading="lazy" /> : <i />}
            <span className="cuerpo">
              <b>{f.titulo}</b>
              <small className="tenue">{f.sub}</small>
            </span>
            {f.extra && <span className="ritmo">{f.extra}</span>}
          </a>
        ))}
      </div>
    </div>
  )
}

// Visor grande de los resultados de un nodo, con flechas para recorrerlos.
const Visor = ({ medios, inicio, nodo, cerrar, rehacer }: { medios: Medio[]; inicio: number; nodo: string; cerrar: () => void; rehacer?: () => void }) => {
  const [i, setI] = useState(inicio)
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      if (e.key === 'Escape') cerrar()
      if (e.key === 'ArrowRight') setI((x) => (x + 1) % medios.length)
      if (e.key === 'ArrowLeft') setI((x) => (x - 1 + medios.length) % medios.length)
    }
    window.addEventListener('keydown', tecla)
    return () => window.removeEventListener('keydown', tecla)
  }, [medios.length, cerrar])
  const m = medios[i]
  return (
    <div className="visor-medios" onClick={cerrar}>
      <div className="visor-cab" onClick={(e) => e.stopPropagation()}>
        <b>{nodo}</b>
        <span className="tenue">
          {i + 1} / {medios.length} · {m.ruta.split('/').pop()}
        </span>
        <span className="espacio" />
        <a className="secundario" href={urlArchivo(m.ruta)} target="_blank" rel="noreferrer">
          Abrir
        </a>
        {rehacer && (
          <button className="secundario" onClick={rehacer}>
            ↻ Rehacer este nodo
          </button>
        )}
        <button className="mini" onClick={cerrar}>
          ✕
        </button>
      </div>
      <div className="visor-centro" onClick={(e) => e.stopPropagation()}>
        {medios.length > 1 && <button className="flecha" onClick={() => setI((i - 1 + medios.length) % medios.length)}>‹</button>}
        <div className="visor-medio" key={m.ruta}>
          <Miniatura m={m} grande />
        </div>
        {medios.length > 1 && <button className="flecha" onClick={() => setI((i + 1) % medios.length)}>›</button>}
      </div>
      {m.pie && (
        <p className="visor-pie" onClick={(e) => e.stopPropagation()}>
          {m.pie}
        </p>
      )}
      {medios.length > 1 && (
        <div className="visor-tira" onClick={(e) => e.stopPropagation()}>
          {medios.map((x, k) => (
            <button key={x.ruta} className={k === i ? 'on' : ''} onClick={() => setI(k)}>
              <Miniatura m={x} />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

const NodoVisual = ({ data, selected }: NodeProps<Node<DatosNodo>>) => {
  const estados = useContext(CtxEstados)
  const n = data.nodo
  const t = tipoPorId(n.tipo)
  const e = estados[n.nombre]
  if (n.tipo === 'nota')
    return (
      <div className={'nota-flujo' + (selected ? ' sel' : '')}>
        <pre>{String(n.params.texto || '').slice(0, 600)}</pre>
      </div>
    )
  const entradas = t?.entradas ?? 1
  const salidas = t?.salidas ?? ['']
  return (
    <div className={['nodo', selected && 'sel', n.desactivado && 'apagado', e?.estado].filter(Boolean).join(' ')} style={{ ['--c' as any]: t?.color ?? '#888' }}>
      {Array.from({ length: entradas }, (_, i) => (
        <Handle key={'e' + i} id={'e' + i} type="target" position={Position.Left} style={{ top: `${((i + 1) / (entradas + 1)) * 100}%` }} />
      ))}
      <div className="icono">{t?.icono ?? '?'}</div>
      <div className="texto">
        <b>{n.nombre}</b>
        <small>{t?.nombre ?? n.tipo}</small>
      </div>
      {e?.estado === 'corriendo' && <span className="girando" />}
      {e?.estado === 'ok' && <span className="insignia ok">✓ {e.items?.reduce((a, b) => a + b, 0) ?? 0}</span>}
      {e?.estado === 'error' && <span className="insignia mal">!</span>}
      {salidas.map((s, i) => (
        <div key={'s' + i}>
          <Handle id={'s' + i} type="source" position={Position.Right} style={{ top: `${((i + 1) / (salidas.length + 1)) * 100}%` }} />
          {s && (
            <span className="etiqueta-salida" style={{ top: `${((i + 1) / (salidas.length + 1)) * 100}%` }}>
              {s}
            </span>
          )}
        </div>
      ))}
      <MediosNodo nombre={n.nombre} />
    </div>
  )
}
const tiposNodo = { nodo: NodoVisual }

const aNodos = (f: Flujo): Node<DatosNodo>[] =>
  f.nodos.map((n) => ({ id: n.id, type: 'nodo', position: n.posicion, data: { nodo: n }, ...(n.tipo === 'nota' ? { zIndex: -1 } : {}) }))
const aAristas = (f: Flujo): Edge[] =>
  f.conexiones.map((c) => ({ id: c.id, source: c.origen, sourceHandle: 's' + c.salida, target: c.destino, targetHandle: 'e' + c.entrada }))

// ───────── Campo de parámetro ─────────
const ControlCampo = ({ campo, valor, cambiar, credenciales }: { campo: Campo; valor: any; cambiar: (v: any) => void; credenciales: string[] }) => {
  switch (campo.tipo) {
    case 'textoLargo':
    case 'codigo':
    case 'json':
      return (
        <textarea
          className={campo.tipo === 'textoLargo' ? '' : 'mono'}
          rows={campo.tipo === 'codigo' ? 16 : campo.tipo === 'json' ? 6 : 4}
          spellCheck={false}
          value={typeof valor === 'string' ? valor : JSON.stringify(valor ?? '', null, 2)}
          onChange={(e) => cambiar(e.target.value)}
        />
      )
    case 'numero':
      return <input type="number" value={valor ?? ''} onChange={(e) => cambiar(e.target.value === '' ? '' : Number(e.target.value))} />
    case 'booleano':
      return <input type="checkbox" checked={valor === true} onChange={(e) => cambiar(e.target.checked)} />
    case 'opciones':
      return (
        <select value={valor ?? ''} onChange={(e) => cambiar(e.target.value)}>
          {campo.opciones?.map((o) => (
            <option key={o.valor} value={o.valor}>
              {o.etiqueta}
            </option>
          ))}
        </select>
      )
    case 'credencial':
      return (
        <select value={valor ?? ''} onChange={(e) => cambiar(e.target.value)}>
          <option value="">Ninguna</option>
          {[...new Set([...credenciales, ...(valor ? [valor] : [])])].map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
      )
    default:
      return <input value={valor ?? ''} onChange={(e) => cambiar(e.target.value)} />
  }
}

const VerJson = ({ items }: { items?: { json: any; archivo?: string }[] }) => {
  if (!items?.length) return <p className="tenue pequeno">Sin datos.</p>
  return (
    <div className="ver-json">
      {items.slice(0, 20).map((it, i) => (
        <div key={i}>
          <small className="tenue">item {i}</small>
          {it.archivo && (
            <div className="pequeno">
              📎 <a href={BASE + 'archivo?ruta=' + encodeURIComponent(it.archivo)} target="_blank" rel="noreferrer">{it.archivo.split('/').pop()}</a>
            </div>
          )}
          <pre>{JSON.stringify(it.json, null, 2).slice(0, 6000)}</pre>
        </div>
      ))}
      {items.length > 20 && <p className="tenue pequeno">… y {items.length - 20} más</p>}
    </div>
  )
}

// ───────── Panel de un nodo ─────────
const PanelNodo = ({
  nodo,
  cambiar,
  borrar,
  cerrar,
  corrida,
  credenciales,
  ejecutarDesde,
  rehacer,
}: {
  nodo: NodoFlujo
  cambiar: (n: NodoFlujo) => void
  borrar: () => void
  cerrar: () => void
  corrida?: CorridaNodo
  credenciales: string[]
  ejecutarDesde: () => void
  rehacer?: (solo: boolean) => void
}) => {
  const t = tipoPorId(nodo.tipo)
  const [pestana, setPestana] = useState<'params' | 'entrada' | 'salida'>('params')
  const visible = (c: Campo) => {
    if (!c.si) return true
    const v = nodo.params[c.si.clave] ?? t?.campos.find((x) => x.clave === c.si!.clave)?.porDefecto
    return Array.isArray(c.si.valor) ? c.si.valor.includes(v) : v === c.si.valor
  }
  return (
    <aside className="panel-nodo">
      <div className="cab">
        <span className="icono" style={{ background: t?.color }}>
          {t?.icono}
        </span>
        <input className="nombre-nodo" value={nodo.nombre} onChange={(e) => cambiar({ ...nodo, nombre: e.target.value })} />
        <button className="mini" onClick={cerrar}>
          ✕
        </button>
      </div>
      <p className="tenue pequeno">{t?.descripcion}</p>
      <div className="selector">
        {(['params', 'entrada', 'salida'] as const).map((p) => (
          <button key={p} className={pestana === p ? 'on' : ''} onClick={() => setPestana(p)}>
            {p === 'params' ? 'Parámetros' : p === 'entrada' ? 'Entrada' : 'Salida'}
          </button>
        ))}
      </div>
      {corrida?.error && <div className="aviso bloque-chico">{corrida.error}</div>}
      {pestana === 'params' && (
        <div className="formulario">
          {t?.campos.filter(visible).map((c) => (
            <label key={c.clave} className={'campo' + (c.tipo === 'booleano' ? ' campo-check' : '')}>
              <span>{c.etiqueta}</span>
              <ControlCampo campo={c} valor={nodo.params[c.clave] ?? c.porDefecto} credenciales={credenciales} cambiar={(v) => cambiar({ ...nodo, params: { ...nodo.params, [c.clave]: v } })} />
              {c.ayuda && <small className="tenue">{c.ayuda}</small>}
            </label>
          ))}
          <label className="campo campo-check">
            <span>Desactivado (deja pasar los datos)</span>
            <input type="checkbox" checked={!!nodo.desactivado} onChange={(e) => cambiar({ ...nodo, desactivado: e.target.checked || undefined })} />
          </label>
          <label className="campo campo-check">
            <span>Seguir aunque no devuelva datos</span>
            <input type="checkbox" checked={!!nodo.siempreSalida} onChange={(e) => cambiar({ ...nodo, siempreSalida: e.target.checked || undefined })} />
          </label>
          <label className="campo campo-check">
            <span>Continuar si falla</span>
            <input type="checkbox" checked={!!nodo.continuarEnError} onChange={(e) => cambiar({ ...nodo, continuarEnError: e.target.checked || undefined })} />
          </label>
          <p className="tenue pequeno">
            Expresiones: <code>{'{{ $json.campo }}'}</code>, <code>{"{{ $('Nodo').first().json.x }}"}</code>, <code>{'{{ $now }}'}</code>
          </p>
          <div className="fila">
            {t?.categoria === 'trigger' && (
              <button className="secundario" onClick={ejecutarDesde}>
                ▶ Ejecutar desde aquí
              </button>
            )}
            {rehacer && t?.categoria !== 'trigger' && (
              <>
                <button className="secundario" title="Vuelve a correr solo este nodo con la misma entrada; el resto de la ejecución se reutiliza" onClick={() => rehacer(true)}>
                  ↻ Rehacer este nodo
                </button>
                <button className="secundario" title="Rehace este nodo y todo lo que sigue después de él" onClick={() => rehacer(false)}>
                  ▶ Rehacer desde aquí
                </button>
              </>
            )}
            <span className="espacio" />
            <button className="mini" onClick={borrar}>
              Borrar nodo
            </button>
          </div>
        </div>
      )}
      {pestana === 'entrada' && <VerJson items={corrida?.entrada} />}
      {pestana === 'salida' &&
        (corrida ? (
          corrida.salidas.map((s, i) => (
            <div key={i}>
              {corrida.salidas.length > 1 && <h3>{t?.salidas[i] || `salida ${i + 1}`}</h3>}
              <VerJson items={s} />
            </div>
          ))
        ) : (
          <p className="tenue pequeno">Ejecuta el flujo para ver lo que sale de este nodo.</p>
        ))}
    </aside>
  )
}

// ───────── Editor ─────────
const Editor = ({ flujoInicial, alCambiarLista, alBorrar }: { flujoInicial: Flujo; alCambiarLista: () => void; alBorrar: () => void }) => {
  const [flujo, setFlujo] = useState(flujoInicial)
  const [nodos, setNodos, onNodesChange] = useNodesState<Node<DatosNodo>>(aNodos(flujoInicial))
  const [aristas, setAristas, onEdgesChange] = useEdgesState<Edge>(aAristas(flujoInicial))
  const [sel, setSel] = useState<string | null>(null)
  const [paleta, setPaleta] = useState(false)
  const [buscar, setBuscar] = useState('')
  const [estados, setEstados] = useState<Record<string, Estado>>({})
  const [ejecucion, setEjecucion] = useState<Ejecucion | null>(null)
  const [enCurso, setEnCurso] = useState<string | null>(null)
  const [logs, setLogs] = useState<string[]>([])
  const [historial, setHistorial] = useState<any[]>([])
  const [verHistorial, setVerHistorial] = useState(false)
  const [credenciales, setCredenciales] = useState<string[]>([])
  const [guardado, setGuardado] = useState('Guardado')
  const [aviso, setAviso] = useState('')
  const [visor, setVisor] = useState<{ medios: Medio[]; i: number; nodo: string } | null>(null)
  const [visorAnalisis, setVisorAnalisis] = useState<{ a: Analisis; nodo: string } | null>(null)
  const [visorDetalle, setVisorDetalle] = useState<{ d: Detalle; nodo: string } | null>(null)
  const [miniaturas, setMiniaturas] = useState(() => {
    try {
      return localStorage.getItem('fotograma:miniaturas') !== 'no'
    } catch {
      return true
    }
  })
  const rf = useReactFlow()
  const temporizador = useRef<ReturnType<typeof setTimeout>>(undefined)
  // Siempre lo último del lienzo (los callbacks diferidos no deben guardar una versión vieja).
  const nodosRef = useRef(nodos)
  const aristasRef = useRef(aristas)
  const flujoRef = useRef(flujo)
  nodosRef.current = nodos
  aristasRef.current = aristas
  flujoRef.current = flujo
  const enCursoRef = useRef<string | null>(null)

  useEffect(() => {
    pedir<{ nombre: string }[]>('credenciales').then((c) => setCredenciales(c.map((x) => x.nombre)))
    pedir('ejecuciones?flujo=' + flujo.id).then(setHistorial)
  }, [flujo.id])

  // Reconstruye el flujo desde el lienzo y lo guarda (con un pequeño retraso).
  const guardar = useCallback(
    (n = nodosRef.current, a = aristasRef.current, extra: Partial<Flujo> = {}) => {
      const f: Flujo = {
        ...flujoRef.current,
        ...extra,
        nodos: n.map((x) => ({ ...x.data.nodo, posicion: { x: Math.round(x.position.x), y: Math.round(x.position.y) } })),
        conexiones: a.map((e) => ({ id: e.id, origen: e.source, salida: Number((e.sourceHandle || 's0').slice(1)), destino: e.target, entrada: Number((e.targetHandle || 'e0').slice(1)) })),
      }
      setFlujo(f)
      setGuardado('Sin guardar…')
      clearTimeout(temporizador.current)
      temporizador.current = setTimeout(async () => {
        try {
          const r = await pedir<{ avisos: string[] }>('flujos/' + f.id, 'PUT', f)
          setGuardado('Guardado')
          setAviso(r.avisos?.join(' ') || '')
          alCambiarLista()
        } catch (e: any) {
          setGuardado('No se guardó')
          setAviso(e.message)
        }
      }, 700)
      return f
    },
    [alCambiarLista],
  )

  // Guarda cuando cambian posiciones o conexiones (no en cada píxel del arrastre).
  const alSoltar = () => guardar()
  const onConnect = (c: Connection) => {
    const a = addEdge({ ...c, id: Math.random().toString(36).slice(2, 10) }, aristas)
    setAristas(a)
    guardar(nodos, a)
  }

  const cambiarNodo = (n: NodoFlujo) => {
    const ns = nodosRef.current.map((x) => (x.id === n.id ? { ...x, data: { ...x.data, nodo: n } } : x))
    setNodos(ns)
    guardar(ns, aristas)
  }

  const agregar = (tipo: string) => {
    const t = tipoPorId(tipo)!
    let nombre = t.nombre
    for (let k = 2; nodos.some((x) => x.data.nodo.nombre === nombre); k++) nombre = `${t.nombre} ${k}`
    const centro = rf.screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 })
    const nodo: NodoFlujo = { id: Math.random().toString(36).slice(2, 10), nombre, tipo, posicion: centro, params: valoresPorDefecto(t) }
    const ns = [...nodos, { id: nodo.id, type: 'nodo', position: centro, data: { nodo } }]
    setNodos(ns)
    guardar(ns, aristas)
    setPaleta(false)
    setSel(nodo.id)
  }

  const borrarNodo = (id: string) => {
    const ns = nodos.filter((x) => x.id !== id)
    const as = aristas.filter((e) => e.source !== id && e.target !== id)
    setNodos(ns)
    setAristas(as)
    setSel(null)
    guardar(ns, as)
  }

  // ───── Ejecución en vivo ─────
  useEffect(() => {
    const es = new EventSource(BASE + 'eventos')
    es.onmessage = (m) => {
      const e: EventoMotor = JSON.parse(m.data)
      if (e.tipo === 'inicio') {
        if (e.flujoId !== flujo.id) return
        enCursoRef.current = e.ejecucion
        setEnCurso(e.ejecucion)
        setEstados({})
        setLogs([])
        setEjecucion(null)
        return
      }
      if (enCursoRef.current !== e.ejecucion) return
      if (e.tipo === 'nodo-inicio') setEstados((s) => ({ ...s, [e.nodo]: { estado: 'corriendo' } }))
      if (e.tipo === 'nodo-fin') {
        setEstados((s) => ({ ...s, [e.nodo]: { estado: 'ok', items: e.items, ms: e.ms } }))
        // Las miniaturas aparecen en cuanto cada nodo termina, sin esperar al final del flujo.
        if (e.items.some((x) => x > 0))
          pedir<Ejecucion>('ejecuciones/' + e.ejecucion).then((x) => enCursoRef.current === e.ejecucion && setEjecucion(x)).catch(() => {})
      }
      if (e.tipo === 'nodo-error') setEstados((s) => ({ ...s, [e.nodo]: { estado: 'error', error: e.error } }))
      if (e.tipo === 'log') setLogs((l) => [...l.slice(-200), `${e.nodo}: ${e.mensaje}`])
      if (e.tipo === 'fin') {
        enCursoRef.current = null
        setEnCurso(null)
        pedir<Ejecucion>('ejecuciones/' + e.ejecucion).then(setEjecucion)
        pedir('ejecuciones?flujo=' + flujo.id).then(setHistorial)
        setLogs((l) => [...l, e.error ? '✗ ' + e.error : '✓ Ejecución terminada'])
      }
    }
    // Al abrir el editor (o volver a la pestaña) se recupera la ejecución en curso o la última: el motor
    // corre en el servidor y no se detiene al cambiar de pestaña, solo se había perdido la vista.
    pedir<{ id: string; estado: string }[]>('ejecuciones?flujo=' + flujo.id).then(async (l) => {
      const ultima = l[0]
      if (!ultima || enCursoRef.current) return
      const e = await pedir<Ejecucion>('ejecuciones/' + ultima.id)
      if (enCursoRef.current) return
      if (e.estado === 'corriendo') {
        enCursoRef.current = e.id
        setEnCurso(e.id)
      } else setEjecucion(e)
      const s: Record<string, Estado> = {}
      for (const c of e.corridas) s[c.nodo] = c.estado === 'ok' ? { estado: 'ok', items: c.salidas.map((x) => x.length), ms: c.ms } : { estado: 'error', error: c.error }
      // El nodo que está trabajando ahora (todavía no tiene corrida guardada): el que sigue al último que terminó.
      const ultimo = flujo.nodos.find((n) => n.nombre === e.corridas.at(-1)?.nodo)
      if (e.estado === 'corriendo' && ultimo)
        for (const c of flujo.conexiones.filter((k) => k.origen === ultimo.id)) {
          const sig = flujo.nodos.find((n) => n.id === c.destino)
          if (sig && !s[sig.nombre]) s[sig.nombre] = { estado: 'corriendo' }
        }
      setEstados(s)
      setLogs(
        e.estado === 'corriendo'
          ? [`↻ Reconectado a la ejecución en curso (${e.corridas.length} nodos listos)…`]
          : [e.estado === 'error' ? '✗ ' + e.error : `✓ Última ejecución: ${e.estado} (${new Date(e.fin || e.inicio).toLocaleString()})`],
      )
    })
    return () => es.close()
  }, [flujo.id])

  const ejecutar = async (desde?: string) => {
    clearTimeout(temporizador.current)
    await pedir('flujos/' + flujo.id, 'PUT', guardar())
    await pedir('flujos/' + flujo.id + '/ejecutar', 'POST', { desde })
  }

  const abrirEjecucion = async (id: string) => {
    const e = await pedir<Ejecucion>('ejecuciones/' + id)
    setEjecucion(e)
    const s: Record<string, Estado> = {}
    for (const c of e.corridas) s[c.nodo] = c.estado === 'ok' ? { estado: 'ok', items: c.salidas.map((x) => x.length), ms: c.ms } : { estado: 'error', error: c.error }
    setEstados(s)
    setLogs(e.error ? ['✗ ' + e.error] : [])
  }

  // Rehacer un nodo de la ejecución que se está viendo. Avisa si eso vuelve a gastar en Kie o a publicar.
  const rehacer = async (nombre: string, solo: boolean) => {
    if (!ejecucion || enCurso) return
    const f = flujoRef.current
    const raiz = f.nodos.find((n) => n.nombre === nombre)
    if (!raiz) return
    const afectados = new Set([raiz.id])
    if (!solo)
      for (let cambio = true; cambio; ) {
        cambio = false
        for (const k of f.conexiones) if (afectados.has(k.origen) && !afectados.has(k.destino)) (afectados.add(k.destino), (cambio = true))
      }
    const sensibles = f.nodos.filter(
      (n) => afectados.has(n.id) && !n.desactivado && (['kie', 'animar', 'youtube', 'tiktok', 'telegram'].includes(n.tipo) || n.params?.proveedor === 'kie'),
    )
    if (sensibles.length && !confirm(`Esto vuelve a correr nodos que gastan créditos de Kie o publican:\n\n${sensibles.map((n) => '• ' + n.nombre).join('\n')}\n\n¿Seguir?`)) return
    clearTimeout(temporizador.current)
    try {
      await pedir('flujos/' + f.id, 'PUT', guardar())
      await pedir('ejecuciones/' + ejecucion.id + '/rehacer', 'POST', { nodo: nombre, solo })
      setVisor(null)
    } catch (e: any) {
      setAviso(e.message)
    }
  }

  const vistas = useMemo(() => {
    const v: Record<string, Vista> = {}
    const porNombre = new Map(flujo.nodos.map((n) => [n.nombre, n]))
    for (const c of ejecucion?.corridas ?? []) {
      const x = vistaDe(c, porNombre.get(c.nodo))
      if (x) v[c.nodo] = x
      else if (c.estado === 'ok' && c.salidas.some((s) => s.length)) delete v[c.nodo]
    }
    return v
  }, [ejecucion, flujo.nodos])
  const acciones = useMemo<Acciones>(
    () => ({
      ver: (medios, i, nodo) => setVisor({ medios, i, nodo }),
      verAnalisis: (a, nodo) => setVisorAnalisis({ a, nodo }),
      verDetalle: (d, nodo) => setVisorDetalle({ d, nodo }),
      rehacer: (n, solo) => void rehacer(n, solo),
      puedeRehacer: !!ejecucion && ejecucion.estado !== 'corriendo' && !enCurso,
      miniaturas,
    }),
    [ejecucion, enCurso, miniaturas],
  )

  const nodoSel = nodos.find((x) => x.id === sel)?.data.nodo
  const corridaSel = nodoSel && ejecucion ? [...ejecucion.corridas].reverse().find((c) => c.nodo === nodoSel.nombre) : undefined
  const filtrados = CATALOGO.filter((t) => t.id !== 'n8n' && (t.nombre + t.descripcion).toLowerCase().includes(buscar.toLowerCase()))

  return (
    <CtxEstados.Provider value={estados}>
    <CtxVistas.Provider value={vistas}>
    <CtxAcciones.Provider value={acciones}>
      <div className="editor-flujo">
        <div className="barra-flujo">
          <input className="titulo" value={flujo.nombre} onChange={(e) => guardar(nodos, aristas, { nombre: e.target.value })} />
          <span className="tenue pequeno">{guardado}</span>
          {aviso && <span className="aviso">{aviso}</span>}
          <span className="espacio" />
          <label className="interruptor" title="Activo: los triggers programados y webhooks funcionan solos">
            <input type="checkbox" checked={flujo.activo} onChange={(e) => guardar(nodos, aristas, { activo: e.target.checked })} />
            <span>{flujo.activo ? 'Activo' : 'Inactivo'}</span>
          </label>
          <button
            className={'secundario' + (miniaturas ? ' on' : '')}
            title="Mostrar en cada nodo lo que generó (imágenes, video, audio o texto)"
            onClick={() =>
              setMiniaturas((v) => {
                try {
                  localStorage.setItem('fotograma:miniaturas', v ? 'no' : 'si')
                } catch {}
                return !v
              })
            }
          >
            🖼 Resultados
          </button>
          <button className="secundario" onClick={() => setPaleta(true)}>
            + Nodo
          </button>
          <button className="secundario" onClick={() => setVerHistorial((v) => !v)}>
            Ejecuciones
          </button>
          <button
            className="secundario borrar-flujo"
            disabled={!!enCurso}
            title={enCurso ? 'No se puede borrar mientras se ejecuta' : 'Borrar este flujo (va a la papelera del proyecto)'}
            onClick={async () => {
              if (!confirm(`¿Borrar el flujo "${flujo.nombre}"?\n\nSe mueve a la papelera del proyecto (.fotograma/papelera/flujos) y se puede recuperar.`)) return
              clearTimeout(temporizador.current)
              await pedir('flujos/' + flujo.id, 'DELETE')
              alBorrar()
            }}
          >
            🗑 Borrar flujo
          </button>
          {!enCurso && ejecucion?.estado === 'error' && (
            <button
              className="secundario"
              title="Sigue desde el nodo que falló, reutilizando lo que ya se hizo (y pagó)"
              onClick={async () => {
                clearTimeout(temporizador.current)
                await pedir('flujos/' + flujo.id, 'PUT', guardar())
                await pedir('ejecuciones/' + ejecucion.id + '/reanudar', 'POST', {})
              }}
            >
              ↻ Reanudar desde el error
            </button>
          )}
          {enCurso ? (
            <button className="peligro" onClick={() => pedir('ejecuciones/' + enCurso + '/cancelar', 'POST')}>
              ■ Detener
            </button>
          ) : (
            <button className="primario" onClick={() => ejecutar()}>
              ▶ Ejecutar flujo
            </button>
          )}
        </div>

        <div className="lienzo-flujo">
          <ReactFlow
            nodes={nodos}
            edges={aristas}
            nodeTypes={tiposNodo}
            onNodesChange={onNodesChange}
            onEdgesChange={(c) => {
              onEdgesChange(c)
              if (c.some((x) => x.type === 'remove')) setTimeout(() => guardar(), 0)
            }}
            onNodesDelete={() => setTimeout(() => guardar(), 0)}
            onConnect={onConnect}
            onNodeDragStop={alSoltar}
            onNodeDoubleClick={(_, n) => setSel(n.id)}
            onNodeClick={(_, n) => sel && setSel(n.id)}
            onPaneClick={() => setSel(null)}
            deleteKeyCode={['Delete', 'Backspace']}
            fitView
            colorMode="dark"
            defaultEdgeOptions={{ animated: !!enCurso }}
            proOptions={{ hideAttribution: true }}
          >
            <Background gap={20} size={1} />
            <Controls />
            <MiniMap pannable zoomable nodeColor={(n) => tipoPorId((n.data as DatosNodo).nodo.tipo)?.color ?? '#555'} />
          </ReactFlow>

          {nodoSel && (
            <PanelNodo
              key={nodoSel.id}
              nodo={nodoSel}
              cambiar={cambiarNodo}
              borrar={() => borrarNodo(nodoSel.id)}
              cerrar={() => setSel(null)}
              corrida={corridaSel}
              credenciales={credenciales}
              ejecutarDesde={() => ejecutar(nodoSel.id)}
              rehacer={acciones.puedeRehacer && corridaSel ? (solo) => void rehacer(nodoSel.nombre, solo) : undefined}
            />
          )}

          {paleta && (
            <div className="paleta">
              <input autoFocus placeholder="Buscar nodo…" value={buscar} onChange={(e) => setBuscar(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && setPaleta(false)} />
              {Object.entries(CATEGORIAS).map(([cat, titulo]) => {
                const ts = filtrados.filter((t) => t.categoria === cat)
                if (!ts.length) return null
                return (
                  <div key={cat}>
                    <h3>{titulo}</h3>
                    {ts.map((t) => (
                      <button key={t.id} className="opcion-nodo" onClick={() => agregar(t.id)}>
                        <span className="icono" style={{ background: t.color }}>
                          {t.icono}
                        </span>
                        <span>
                          <b>{t.nombre}</b>
                          <small className="tenue">{t.descripcion}</small>
                        </span>
                      </button>
                    ))}
                  </div>
                )
              })}
              <button className="mini" onClick={() => setPaleta(false)}>
                cerrar
              </button>
            </div>
          )}
        </div>

        {(logs.length > 0 || verHistorial) && (
          <div className="consola">
            {verHistorial && (
              <div className="historial">
                {historial.map((h) => (
                  <button key={h.id} className={'ejec ' + h.estado + (ejecucion?.id === h.id ? ' on' : '')} onClick={() => abrirEjecucion(h.id)}>
                    <b>{h.estado === 'ok' ? '✓' : h.estado === 'corriendo' ? '…' : '✗'}</b> {new Date(h.inicio).toLocaleString()} <small className="tenue">{h.modo}</small>
                  </button>
                ))}
                {!historial.length && <p className="tenue pequeno">Sin ejecuciones todavía.</p>}
              </div>
            )}
            <pre className="logs">{logs.join('\n') || 'Doble clic en un nodo para ver sus datos.'}</pre>
          </div>
        )}
        {visorDetalle && <VisorDetalle d={visorDetalle.d} nodo={visorDetalle.nodo} cerrar={() => setVisorDetalle(null)} />}
        {visorAnalisis && <VisorAnalisis a={visorAnalisis.a} nodo={visorAnalisis.nodo} cerrar={() => setVisorAnalisis(null)} />}
        {visor && (
          <Visor
            medios={visor.medios}
            inicio={visor.i}
            nodo={visor.nodo}
            cerrar={() => setVisor(null)}
            rehacer={acciones.puedeRehacer ? () => void rehacer(visor.nodo, true) : undefined}
          />
        )}
      </div>
    </CtxAcciones.Provider>
    </CtxVistas.Provider>
    </CtxEstados.Provider>
  )
}

// ───────── Vista principal ─────────
export const Flujos = () => {
  const izq = usePanel('flujos-lado', 264)
  const [lista, setLista] = useState<Resumen[]>([])
  const [id, setId] = useState<string | null>(() => localStorage.getItem('fotograma:flujo'))
  const [flujo, setFlujo] = useState<Flujo | null>(null)
  const [modal, setModal] = useState<'n8n' | 'credenciales' | 'plantillas' | null>(null)
  const [version, setVersion] = useState(0) // sube cuando el asistente cambia el flujo abierto
  const cargar = () => pedir<Resumen[]>('flujos').then(setLista)
  useEffect(() => {
    cargar()
  }, [])
  useEffect(() => {
    contextoAgente.flujo = id || undefined
    if (!id) return
    localStorage.setItem('fotograma:flujo', id)
    pedir<Flujo>('flujos/' + id).then(setFlujo).catch(() => setFlujo(null))
  }, [id])
  useEffect(
    () =>
      alCambiarDatos((cambios) => {
        const deFlujos = cambios.filter((c) => c.tipo === 'flujo')
        if (!deFlujos.length) return
        cargar()
        const abierto = contextoAgente.flujo
        if (deFlujos.some((c) => c.id === abierto)) pedir<Flujo>('flujos/' + abierto).then((f) => (setFlujo(f), setVersion((v) => v + 1)))
        else if (deFlujos[0].id) setId(deFlujos[0].id) // un flujo nuevo: se abre
      }),
    [],
  )
  useEffect(() => () => void (contextoAgente.flujo = undefined), [])


  return (
    <div className="vista-flujos" style={{ gridTemplateColumns: `${izq.columna} minmax(0, 1fr)` }}>
      <aside className={'lado' + (izq.oculto ? ' colapsado' : '')}>
        <button className="primario ancho" onClick={() => setModal('plantillas')}>
          + Nuevo flujo
        </button>
        <button className="secundario" onClick={() => setModal('n8n')}>
          Importar de n8n
        </button>
        <button className="secundario" onClick={() => setModal('credenciales')}>
          🔑 Credenciales
        </button>
        <div className="carpeta">Flujos</div>
        {lista.map((f) => (
          <button key={f.id} className={f.id === id ? 'comp activa' : 'comp'} onClick={() => setId(f.id)}>
            <span>
              {f.activo && <i className="punto-activo" />} {f.nombre}
            </span>
            <small>
              {f.nodos} nodos {f.origenN8n ? '· de n8n' : ''}
            </small>
          </button>
        ))}
      </aside>
      {flujo ? (
        <ReactFlowProvider key={flujo.id + ':' + version}>
          <Editor
            flujoInicial={flujo}
            alCambiarLista={cargar}
            alBorrar={() => {
              localStorage.removeItem('fotograma:flujo')
              setFlujo(null)
              setId(null)
              cargar()
            }}
          />
        </ReactFlowProvider>
      ) : (
        <div className="vacio">Crea un flujo, usa una plantilla o importa uno de n8n.</div>
      )}
      <Manija panel={izq} lado="izq" nombre="la lista de flujos" />
      {modal === 'n8n' && <ModalN8n cerrar={() => setModal(null)} importado={(fid) => (cargar(), setId(fid), setModal(null))} />}
      {modal === 'credenciales' && <ModalCredenciales cerrar={() => setModal(null)} />}
      {modal === 'plantillas' && <ModalPlantillas cerrar={() => setModal(null)} creado={(fid) => (cargar(), setId(fid), setModal(null))} />}
    </div>
  )
}

const ModalN8n = ({ cerrar, importado }: { cerrar: () => void; importado: (id: string) => void }) => {
  const [lista, setLista] = useState<any[] | null>(null)
  const [error, setError] = useState('')
  const [avisos, setAvisos] = useState<string[]>([])
  const [ocupado, setOcupado] = useState<string | null>(null)
  const [nuevoId, setNuevoId] = useState<string | null>(null)
  useEffect(() => {
    pedir('n8n/workflows').then(setLista).catch((e) => setError(e.message))
  }, [])
  const importar = async (wid: string) => {
    setOcupado(wid)
    try {
      const r = await pedir<{ flujo: { id: string }; avisos: string[] }>('n8n/importar', 'POST', { id: wid })
      setAvisos(r.avisos)
      setNuevoId(r.flujo.id)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setOcupado(null)
    }
  }
  return (
    <div className="modal" onClick={cerrar}>
      <div className="caja ancha" onClick={(e) => e.stopPropagation()}>
        <h3>Importar desde n8n</h3>
        {error && <div className="aviso">{error}</div>}
        {nuevoId ? (
          <>
            <ul className="avisos">{avisos.map((a, i) => <li key={i}>{a}</li>)}</ul>
            <button className="primario" onClick={() => importado(nuevoId)}>
              Abrir el flujo importado
            </button>
          </>
        ) : (
          <div className="lista-n8n">
            {!lista && !error && <p className="tenue">Cargando workflows de n8n…</p>}
            {lista?.map((w) => (
              <button key={w.id} className="comp" disabled={!!ocupado} onClick={() => importar(w.id)}>
                <span>
                  {w.activo && <i className="punto-activo" />} {w.nombre}
                </span>
                <small>{ocupado === w.id ? 'Importando…' : `${w.nodos} nodos`}</small>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

const ModalCredenciales = ({ cerrar }: { cerrar: () => void }) => {
  const [lista, setLista] = useState<any[]>([])
  const [nueva, setNueva] = useState({ nombre: '', header: 'Authorization', valor: '' })
  const cargar = () => pedir('credenciales').then(setLista)
  useEffect(() => {
    cargar()
  }, [])
  return (
    <div className="modal" onClick={cerrar}>
      <div className="caja ancha" onClick={(e) => e.stopPropagation()}>
        <h3>Credenciales</h3>
        <p className="tenue pequeno">Se guardan en ~/.config/fotograma/credenciales.json (permisos 600). El navegador nunca ve los valores.</p>
        {lista.map((c) => (
          <div key={c.nombre} className="fila cred">
            <b>{c.nombre}</b>
            <span className="tenue">
              {c.tipo === 'oauth2' ? 'OAuth2' : c.detalle} {c.integrada ? '· de ~/.config' : ''}
            </span>
            <span className="espacio" />
            {!c.integrada && (
              <button className="mini" onClick={() => confirm(`¿Borrar "${c.nombre}"?`) && pedir('credenciales/' + encodeURIComponent(c.nombre), 'DELETE').then(cargar)}>
                borrar
              </button>
            )}
          </div>
        ))}
        <h3>Nueva (header)</h3>
        <div className="fila">
          <input placeholder="Nombre" value={nueva.nombre} onChange={(e) => setNueva({ ...nueva, nombre: e.target.value })} />
          <input placeholder="Header" value={nueva.header} onChange={(e) => setNueva({ ...nueva, header: e.target.value })} />
          <input placeholder="Valor (p. ej. Bearer …)" type="password" value={nueva.valor} onChange={(e) => setNueva({ ...nueva, valor: e.target.value })} />
          <button
            className="primario"
            onClick={() =>
              pedir('credenciales', 'POST', nueva).then(() => {
                setNueva({ nombre: '', header: 'Authorization', valor: '' })
                cargar()
              })
            }
          >
            Guardar
          </button>
        </div>
      </div>
    </div>
  )
}

type Tarjeta = {
  id: string
  nombre: string
  descripcion: string
  canal?: string
  idioma?: string
  visual?: string
  costo?: string
  duracion?: string
  publica?: string
  opciones?: ('revisar' | 'youtube' | 'tiktok')[]
  nombreFlujo?: string
  idiomaBase?: 'es' | 'en'
  duracionPorDefecto?: DuracionId
  duraciones?: { id: DuracionId; costo: string; tiempo: string; imagenes: number; neuronas: number; detalle?: string }[]
}

const ICONOS: Record<string, string> = { dialogo: '💬', blanco: '➕' }
const ETIQUETAS_OPCION: Record<string, string> = {
  revisar: 'Vista previa antes de publicar (espera tu clic)',
  youtube: 'Publicar en YouTube',
  tiktok: 'Publicar en TikTok (llega como borrador)',
}

// "Nuevo flujo": tarjetas con los flujos listos para usar y sus opciones.
const ModalPlantillas = ({ cerrar, creado }: { cerrar: () => void; creado: (id: string) => void }) => {
  const [lista, setLista] = useState<Tarjeta[]>([])
  const [sel, setSel] = useState<Tarjeta | null>(null)
  const [opciones, setOpciones] = useState({ revisar: true, youtube: true, tiktok: true })
  const [nombre, setNombre] = useState('')
  const [duracion, setDuracion] = useState<DuracionId>('30s')
  const [idioma, setIdioma] = useState<'es' | 'en'>('es')
  const [creando, setCreando] = useState(false)
  useEffect(() => {
    pedir<Tarjeta[]>('plantillas').then((l) => (setLista(l), setSel(l[0] || null)))
  }, [])
  useEffect(() => setDuracion(sel?.duracionPorDefecto || '30s'), [sel?.id])
  useEffect(() => setIdioma(sel?.idiomaBase || 'es'), [sel?.id])
  const d = duracionPorId(duracion)
  const larga = !!sel?.duraciones && d.tipo === 'largo'
  useEffect(
    () =>
      setNombre(
        sel
          ? (sel.nombreFlujo || sel.nombre).replace(/\b(ES|EN)\)/, idioma.toUpperCase() + ')') +
              (sel.idiomaBase && idioma !== sel.idiomaBase && !/\b(ES|EN)\)/.test(sel.nombreFlujo || '') ? ` (${idioma.toUpperCase()})` : '') +
              (sel.duraciones ? ' · ' + d.etiqueta : '')
          : '',
      ),
    [sel?.id, duracion, idioma],
  )
  // Para la tarjeta elegida se muestran el costo y el tiempo de la duración elegida.
  const datosDe = (t: Tarjeta) => t.duraciones?.find((x) => x.id === (sel?.id === t.id ? duracion : t.duracionPorDefecto))
  const crear = async () => {
    if (!sel) return
    setCreando(true)
    const f = await pedir<{ id: string }>('plantillas/' + sel.id, 'POST', { opciones: { ...opciones, tiktok: opciones.tiktok && !larga, duracion, idioma }, nombre })
    creado(f.id)
  }
  return (
    <div className="modal" onClick={cerrar}>
      <div className="caja nuevo-flujo" onClick={(e) => e.stopPropagation()}>
        <div className="fila">
          <h2 style={{ margin: 0 }}>Nuevo flujo</h2>
          <span className="espacio" />
          <button className="mini" onClick={cerrar}>
            cerrar
          </button>
        </div>
        <div className="tarjetas">
          {lista.map((t) => (
            <button key={t.id} className={'tarjeta-flujo' + (sel?.id === t.id ? ' on' : '')} onClick={() => setSel(t)} onDoubleClick={crear}>
              <div className="cab-tarjeta">
                <span className="emoji">{ICONOS[t.id] || '⚙'}</span>
                <b>{t.nombre}</b>
              </div>
              <p>{t.descripcion}</p>
              <div className="etiquetas">
                {t.canal && <span>▶ {t.canal}</span>}
                {t.idioma && <span>{t.idioma}</span>}
                {t.visual && <span>{t.visual}</span>}
              </div>
              {(t.costo || t.duracion) && (
                <div className="pie-tarjeta">
                  {datosDe(t) && <span>🎬 {duracionPorId(datosDe(t)!.id).etiqueta}</span>}
                  <span>💲 {datosDe(t)?.costo ?? t.costo}</span>
                  <span>⏱ {datosDe(t)?.tiempo ?? t.duracion}</span>
                </div>
              )}
            </button>
          ))}
        </div>
        {sel?.duraciones && (
          <div className="duraciones">
            <div className="fila-duraciones">
              <span className="titulo-duracion">Duración del video</span>
              {DURACIONES.map((x) => (
                <button key={x.id} className={'chip-duracion' + (duracion === x.id ? ' on' : '')} onClick={() => setDuracion(x.id)} title={x.sirve}>
                  <b>{x.etiqueta}</b>
                  <span className="estrellas">{'★'.repeat(x.estrellas)}{'☆'.repeat(5 - x.estrellas)}</span>
                </button>
              ))}
            </div>
            <div className="info-duracion">
              <div>
                <b>Potencial de ingresos:</b> {d.potencial} · <b>Sirve para:</b> {d.sirve}
              </div>
              <div>{d.nota}</div>
              <div className="sub">
                {d.tipo === 'short' ? 'Short vertical 9:16' : datosDe(sel)?.detalle ? 'Horizontal 16:9' : `Horizontal 16:9 en ${d.capitulos} capítulos`} ·{' '}
                {datosDe(sel)?.detalle ?? `~${datosDe(sel)?.imagenes} imágenes`} · {datosDe(sel)?.costo}
                {!!datosDe(sel)?.neuronas && ` · ${datosDe(sel)?.neuronas.toLocaleString('en')} de 10,000 neuronas diarias`} · {datosDe(sel)?.tiempo}
                {larga && ' · TikTok no aplica (video horizontal largo)'}
              </div>
              <div className="sub">📈 Estrategia: {ESTRATEGIA}</div>
            </div>
          </div>
        )}
        {sel?.idiomaBase && (
          <div className="fila-duraciones idiomas">
            <span className="titulo-duracion">Idioma del video</span>
            {(
              [
                ['es', 'Español'],
                ['en', 'English'],
              ] as const
            ).map(([k, t]) => (
              <button key={k} className={'chip-duracion' + (idioma === k ? ' on' : '')} onClick={() => setIdioma(k)}>
                <b>{t}</b>
                <span className="estrellas">{k === sel.idiomaBase ? 'original' : 'adaptado'}</span>
              </button>
            ))}
            {idioma !== sel.idiomaBase && <span className="tenue pequeno">La IA escribe y la voz habla en {idioma === 'en' ? 'inglés' : 'español'}; se publica en el mismo canal ({sel.canal || 'sin canal'}).</span>}
          </div>
        )}
        {sel && (
          <div className="config-nuevo">
            <label className="campo" style={{ flex: 1 }}>
              <span>Nombre</span>
              <input value={nombre} onChange={(e) => setNombre(e.target.value)} />
            </label>
            {sel.opciones?.filter((o) => !(larga && o === 'tiktok')).map((o) => (
              <label key={o} className="campo-check opcion">
                <input type="checkbox" checked={opciones[o]} onChange={(e) => setOpciones({ ...opciones, [o]: e.target.checked })} />
                {ETIQUETAS_OPCION[o]}
              </label>
            ))}
            <button className="primario" disabled={creando} onClick={crear}>
              {creando ? 'Creando…' : 'Crear flujo'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
