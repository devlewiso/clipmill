// Línea de tiempo editable para los videos de guion (los de código siguen con la línea de tiempo de solo lectura).
// Pistas: Clips de fondo · Voz (una barra por frase) · Textos y stickers · Música.
//   Clips:  arrastrar = reordenar · borde derecho = duración · Alt + arrastrar = deslizar el video (recorte) · S = partir en el cabezal
//   Voz:    arrastrar = reordenar las frases (también en el texto del guion) · borde derecho = silencio después
//   Textos: arrastrar = mover · bordes = acortar/alargar · doble clic = editar · T = texto nuevo en el cabezal
//   Supr borra lo elegido (clips y textos) · Ctrl+Z / Ctrl+Shift+Z · los bordes se pegan al cabezal y a otros bordes.
// Cada cambio se ve al instante en el visor (props) y se guarda solo en el guion.
import { useEffect, useMemo, useRef, useState } from 'react'
import { tramosDeClips, tomasDe } from '../../src/guion/composicion'
import { moverLineaEnTexto } from '../../src/guion/parsear'
import type { Clip, Guion, TextoEnPantalla } from '../../src/guion/tipos'
import { api, tiempo } from './api'
import { LOOKS } from '../../src/color'

type Eleccion = { tipo: 'clip' | 'linea' | 'texto'; i: number } | null
type Arrastre = {
  tipo: 'clip' | 'linea' | 'texto'
  i: number
  modo: 'mover' | 'borde-der' | 'borde-izq' | 'deslizar'
  x0: number
  inicial: Guion
  // vista previa del reordenamiento (clips / líneas): dónde caería
  destino?: number
  dx?: number
}

const PISTAS = [
  { clave: 'clip', nombre: 'Clips de fondo', color: '#e8590c' },
  { clave: 'linea', nombre: 'Voz', color: '#2f9e44' },
  { clave: 'texto', nombre: 'Textos y stickers', color: '#ae3ec9' },
  { clave: 'musica', nombre: 'Música', color: '#1971c2' },
] as const

const esVideo = (src: string) => /\.(mp4|webm|mov|m4v)(\?|$)/i.test(src)
const nombreArchivo = (src: string) => decodeURIComponent(src.split('/').pop() || src).replace(/\.\w+$/, '')

export const EditorTiempo = ({
  guion,
  fps,
  frame,
  irA,
  aplicar,
}: {
  guion: Guion
  fps: number
  frame: number
  irA: (f: number) => void
  aplicar: (g: Guion) => void // vista previa al instante + guardado (lo maneja Composiciones)
}) => {
  const [g, setG] = useState(guion)
  const gRef = useRef(g)
  gRef.current = g
  // Si el guion cambia por fuera (otra pestaña, audio nuevo), se toma — salvo en medio de un arrastre.
  const arr = useRef<Arrastre | null>(null)
  useEffect(() => {
    if (!arr.current) setG(guion)
  }, [guion])

  const deshacer = useRef<Guion[]>([])
  const rehacer = useRef<Guion[]>([])
  const [eleccion, setEleccion] = useState<Eleccion>(null)
  const [editandoTexto, setEditandoTexto] = useState<string | null>(null)
  const [vista, setVista] = useState(0) // fuerza re-render durante el arrastre
  const area = useRef<HTMLDivElement>(null)

  const { tomas, total } = useMemo(() => tomasDe(g), [g])
  const tramos = useMemo(() => tramosDeClips(g, total, tomas, fps), [g, total, tomas, fps])
  const duracion = Math.max(1, total)
  const pct = (f: number) => `${(Math.max(0, Math.min(f, duracion)) / duracion) * 100}%`
  const anchoPx = () => area.current?.getBoundingClientRect().width || 1
  const pxAFrames = (px: number) => (px / anchoPx()) * duracion

  // Un cambio confirmado: historial + vista previa + guardado.
  const confirmar = (n: Guion, anterior = gRef.current) => {
    if (n === anterior) return
    deshacer.current = [...deshacer.current.slice(-79), anterior]
    rehacer.current = []
    setG(n)
    aplicar(n)
  }
  const volver = (de: typeof deshacer, a: typeof rehacer) => {
    const previo = de.current.at(-1)
    if (!previo) return
    de.current = de.current.slice(0, -1)
    a.current = [...a.current, gRef.current]
    setG(previo)
    aplicar(previo)
  }

  // ───── Operaciones ─────
  // Los clips pasan a tener duración propia (segundos) en cuanto se edita uno, para que nada salte de lugar.
  const fijarClips = (x: Guion) => {
    const { tomas: t, total: tt } = tomasDe(x)
    const tr = tramosDeClips(x, tt, t, fps)
    return (x.clips || []).map((c, i) => (i === (x.clips || []).length - 1 ? { ...c, segundos: undefined } : { ...c, segundos: +(tr[i].dur / fps).toFixed(3) }))
  }
  const partirClip = () => {
    const x = gRef.current
    const clips = fijarClips(x)
    const i = tramos.findIndex((t) => frame >= t.desde && frame < t.desde + t.dur)
    if (i < 0) return
    const t = tramos[i]
    const corte = (frame - t.desde) / fps
    if (corte < 0.2 || (t.dur - (frame - t.desde)) / fps < 0.2) return
    const c = clips[i]
    const a = { ...c, segundos: +corte.toFixed(3) }
    const b = { ...c, recorte: esVideo(c.src) ? +((c.recorte ?? 0) + corte).toFixed(3) : c.recorte, segundos: i === clips.length - 1 ? undefined : +((t.dur / fps) - corte).toFixed(3) }
    confirmar({ ...x, clips: [...clips.slice(0, i), a, b, ...clips.slice(i + 1)] })
    setEleccion({ tipo: 'clip', i: i + 1 })
  }
  // Congelar cuadro: en el cabezal, parte el clip de video y mete 1.5 s de ese cuadro quieto.
  const congelar = () => {
    const x = gRef.current
    const clips = fijarClips(x)
    const i = tramos.findIndex((t) => frame >= t.desde && frame < t.desde + t.dur)
    if (i < 0 || !esVideo(clips[i].src) || clips[i].congelar) return
    const t = tramos[i]
    const c = clips[i]
    const corte = (frame - t.desde) / fps
    const enVideo = +((c.recorte ?? 0) + corte * (c.velocidad ?? 1)).toFixed(3)
    const ultimo = i === clips.length - 1
    const hielo: Clip = { src: c.src, recorte: enVideo, congelar: true, segundos: 1.5, color: c.color, intensidadColor: c.intensidadColor }
    const resto: Clip = { ...c, recorte: enVideo, lento: undefined, segundos: ultimo ? undefined : +((t.dur / fps) - corte).toFixed(3) }
    const antes: Clip[] = corte >= 0.2 ? [{ ...c, segundos: +corte.toFixed(3) }] : []
    const nuevos = [...antes, hielo, ...(ultimo || (t.dur / fps) - corte >= 0.2 ? [resto] : [])]
    confirmar({ ...x, clips: [...clips.slice(0, i), ...nuevos, ...clips.slice(i + 1)] })
    setEleccion({ tipo: 'clip', i: i + antes.length })
  }

  // Cámara lenta suave: se interpola el tramo del clip en la cola; cuando termina, el clip pasa a usarlo.
  const [lentos, setLentos] = useState<{ trabajo: number; src: string; desde: number; velocidad: number; archivo: string }[]>([])
  useEffect(() => {
    if (!lentos.length) return
    const t = setInterval(async () => {
      const ts = await api<{ id: number; estado: string; error?: string }[]>('trabajos').catch(() => [])
      for (const l of lentos) {
        const tr = ts.find((x) => x.id === l.trabajo)
        if (!tr || tr.estado === 'pendiente' || tr.estado === 'corriendo') continue
        setLentos((ls) => ls.filter((x) => x !== l))
        if (tr.estado !== 'listo') continue
        const x = gRef.current
        confirmar({ ...x, clips: (x.clips || []).map((c) => (c.src === l.src && (c.recorte ?? 0) === l.desde && c.velocidad === l.velocidad ? { ...c, lento: { src: '/lento/' + l.archivo, desde: l.desde, velocidad: l.velocidad } } : c)) })
      }
    }, 2000)
    return () => clearInterval(t)
  }, [lentos])
  const suavizar = async () => {
    if (eleccion?.tipo !== 'clip') return
    const c = (gRef.current.clips || [])[eleccion.i]
    const t = tramos[eleccion.i]
    if (!c || !t || !c.velocidad || c.velocidad >= 1) return
    const r = await api<{ id: number; salida: string }>('lento', { cuerpo: { src: c.src, desde: c.recorte ?? 0, segundos: (t.dur / fps) * c.velocidad, velocidad: c.velocidad, fps, guion: gRef.current.id } })
    setLentos((ls) => [...ls, { trabajo: r.id, src: c.src, desde: c.recorte ?? 0, velocidad: c.velocidad!, archivo: r.salida.split('/').pop()! }])
  }

  const nuevoTexto = () => {
    const x = gRef.current
    const desde = +(frame / fps).toFixed(2)
    const t: TextoEnPantalla = { id: 't' + Date.now().toString(36), texto: 'Texto nuevo', desde, hasta: +Math.min(desde + 2.5, total / fps).toFixed(2), posicion: 'arriba' }
    confirmar({ ...x, textos: [...(x.textos || []), t] })
    setEleccion({ tipo: 'texto', i: (x.textos || []).length })
    setEditandoTexto(t.texto)
  }
  const borrar = () => {
    const x = gRef.current
    if (eleccion?.tipo === 'clip' && (x.clips || []).length > 1) {
      const clips = fijarClips(x).filter((_, i) => i !== eleccion.i)
      if (clips.length) clips[clips.length - 1] = { ...clips[clips.length - 1], segundos: undefined }
      confirmar({ ...x, clips })
    } else if (eleccion?.tipo === 'texto') confirmar({ ...x, textos: (x.textos || []).filter((_, i) => i !== eleccion.i) })
    setEleccion(null)
  }

  // ───── Arrastres ─────
  const bordes = () => {
    const b = [frame, 0, duracion, ...tramos.flatMap((t) => [t.desde, t.desde + t.dur]), ...tomas.flatMap((t) => [t.desde, t.desde + t.duracion])]
    for (const t of gRef.current.textos || []) b.push(Math.round(t.desde * fps), Math.round(t.hasta * fps))
    return b
  }
  const pegar = (f: number, excluir: number[] = []) => {
    const umbral = pxAFrames(7)
    let mejor = f
    let d = umbral
    for (const b of bordes()) if (!excluir.includes(b) && Math.abs(b - f) < d) ((d = Math.abs(b - f)), (mejor = b))
    return mejor
  }

  const empezar = (e: React.PointerEvent, tipo: Arrastre['tipo'], i: number, modo: Arrastre['modo']) => {
    e.stopPropagation()
    e.preventDefault()
    setEleccion({ tipo, i })
    arr.current = { tipo, i, modo: tipo === 'clip' && modo === 'mover' && e.altKey ? 'deslizar' : modo, x0: e.clientX, inicial: gRef.current }
    const mov = (ev: PointerEvent) => moverArrastre(ev.clientX)
    const fin = () => {
      window.removeEventListener('pointermove', mov)
      window.removeEventListener('pointerup', fin)
      terminarArrastre()
    }
    window.addEventListener('pointermove', mov)
    window.addEventListener('pointerup', fin)
  }

  const moverArrastre = (x: number) => {
    const a = arr.current
    if (!a) return
    const dF = pxAFrames(x - a.x0)
    const ini = a.inicial
    const { tomas: t0, total: tt0 } = tomasDe(ini)
    if (a.tipo === 'clip') {
      const tr0 = tramosDeClips(ini, tt0, t0, fps)
      if (a.modo === 'borde-der') {
        const clips = fijarClips(ini)
        const fin = pegar(tr0[a.i].desde + tr0[a.i].dur + dF, [tr0[a.i].desde + tr0[a.i].dur])
        const dur = Math.max(Math.round(0.3 * fps), fin - tr0[a.i].desde)
        clips[a.i] = { ...clips[a.i], segundos: +(dur / fps).toFixed(3) }
        setG({ ...ini, clips })
      } else if (a.modo === 'deslizar') {
        const c = (ini.clips || [])[a.i]
        if (!esVideo(c.src)) return
        const clips = [...(ini.clips || [])]
        clips[a.i] = { ...c, recorte: +Math.max(0, (c.recorte ?? 0) - dF / fps).toFixed(3) }
        setG({ ...ini, clips })
      } else {
        // Reordenar: cae en el lugar cuyo centro quedó más cerca.
        const centro = tr0[a.i].desde + tr0[a.i].dur / 2 + dF
        a.destino = tr0.reduce((m, t, k) => (Math.abs(t.desde + t.dur / 2 - centro) < Math.abs(tr0[m].desde + tr0[m].dur / 2 - centro) ? k : m), 0)
        a.dx = x - a.x0
        setVista((v) => v + 1)
      }
    } else if (a.tipo === 'linea') {
      if (a.modo === 'borde-der') {
        const l = ini.lineas[a.i]
        const tm = t0[a.i]
        const fin = pegar(tm.desde + tm.duracion + dF, [tm.desde + tm.duracion])
        const extra = Math.max(0, Math.round(((fin - tm.desde - tm.duracion) / fps) * 1000) + (l.pausaDespuesMs ?? 0))
        const lineas = ini.lineas.map((x, k) => (k === a.i ? { ...x, pausaDespuesMs: extra } : x))
        setG({ ...ini, lineas })
      } else {
        const centro = t0[a.i].desde + t0[a.i].duracion / 2 + dF
        a.destino = t0.reduce((m, t, k) => (Math.abs(t.desde + t.duracion / 2 - centro) < Math.abs(t0[m].desde + t0[m].duracion / 2 - centro) ? k : m), 0)
        a.dx = x - a.x0
        setVista((v) => v + 1)
      }
    } else {
      const t = (ini.textos || [])[a.i]
      const textos = [...(ini.textos || [])]
      const fD = Math.round(t.desde * fps)
      const fH = Math.round(t.hasta * fps)
      const minimo = Math.round(0.3 * fps)
      if (a.modo === 'mover') {
        const largo = fH - fD
        let d = pegar(fD + dF, [fD])
        if (Math.abs(pegar(fH + dF, [fH]) - (fH + dF)) < Math.abs(d - (fD + dF))) d = pegar(fH + dF, [fH]) - largo
        d = Math.max(0, Math.min(duracion - largo, d))
        textos[a.i] = { ...t, desde: +(d / fps).toFixed(2), hasta: +((d + largo) / fps).toFixed(2) }
      } else if (a.modo === 'borde-izq') {
        const d = Math.max(0, Math.min(fH - minimo, pegar(fD + dF, [fD])))
        textos[a.i] = { ...t, desde: +(d / fps).toFixed(2) }
      } else {
        const h = Math.min(duracion, Math.max(fD + minimo, pegar(fH + dF, [fH])))
        textos[a.i] = { ...t, hasta: +(h / fps).toFixed(2) }
      }
      setG({ ...ini, textos })
    }
  }

  const terminarArrastre = () => {
    const a = arr.current
    arr.current = null
    if (!a) return
    const ini = a.inicial
    if (a.modo === 'mover' && (a.tipo === 'clip' || a.tipo === 'linea') && a.destino != null) {
      if (Math.abs(a.dx ?? 0) < 4 || a.destino === a.i) return setVista((v) => v + 1)
      if (a.tipo === 'clip') {
        // Cada clip se lleva su duración actual; el que queda último llena hasta el final.
        const { tomas: t0, total: tt0 } = tomasDe(ini)
        const tr0 = tramosDeClips(ini, tt0, t0, fps)
        const conDur: Clip[] = (ini.clips || []).map((c, k) => ({ ...c, segundos: +(tr0[k].dur / fps).toFixed(3) }))
        const [c] = conDur.splice(a.i, 1)
        conDur.splice(a.destino, 0, c)
        conDur[conDur.length - 1] = { ...conDur[conDur.length - 1], segundos: undefined }
        confirmar({ ...ini, clips: conDur }, ini)
      } else {
        const lineas = [...ini.lineas]
        const [l] = lineas.splice(a.i, 1)
        lineas.splice(a.destino, 0, l)
        confirmar({ ...ini, lineas, texto: moverLineaEnTexto(ini.texto, ini.personajes, a.i, a.destino) }, ini)
      }
      setEleccion({ tipo: a.tipo, i: a.destino })
      return
    }
    if (gRef.current !== ini) confirmar(gRef.current, ini)
  }

  // ───── Teclado ─────
  const acciones = useRef({ partirClip, nuevoTexto, borrar, congelar })
  acciones.current = { partirClip, nuevoTexto, borrar, congelar }
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      if (/^(INPUT|TEXTAREA|SELECT)$/.test((e.target as HTMLElement)?.tagName)) return
      const k = e.key.toLowerCase()
      const ctrl = e.ctrlKey || e.metaKey
      if (ctrl && k === 'z' && !e.shiftKey) (e.preventDefault(), e.stopImmediatePropagation(), volver(deshacer, rehacer))
      else if (ctrl && (k === 'y' || (k === 'z' && e.shiftKey))) (e.preventDefault(), e.stopImmediatePropagation(), volver(rehacer, deshacer))
      else if (!ctrl && k === 's') (e.preventDefault(), acciones.current.partirClip())
      else if (!ctrl && k === 't') (e.preventDefault(), acciones.current.nuevoTexto())
      else if (!ctrl && k === 'c') (e.preventDefault(), acciones.current.congelar())
      else if (e.key === 'Delete' || e.key === 'Backspace') (e.preventDefault(), acciones.current.borrar())
    }
    window.addEventListener('keydown', tecla, true)
    return () => window.removeEventListener('keydown', tecla, true)
  }, [])

  // Click en la regla o en el fondo de una pista mueve el cabezal.
  const buscar = (e: React.PointerEvent) => {
    const r = area.current!.getBoundingClientRect()
    const ir = (x: number) => irA(Math.round(Math.max(0, Math.min(1, (x - r.left) / r.width)) * (duracion - 1)))
    ir(e.clientX)
    setEleccion(null)
    const mov = (ev: PointerEvent) => ir(ev.clientX)
    const fin = () => (window.removeEventListener('pointermove', mov), window.removeEventListener('pointerup', fin))
    window.addEventListener('pointermove', mov)
    window.addEventListener('pointerup', fin)
  }

  const segundos = duracion / fps
  const paso = segundos > 120 ? 10 : segundos > 30 ? 5 : 1
  const marcas = Array.from({ length: Math.floor(segundos / paso) + 1 }, (_, i) => i * paso)
  const a = arr.current
  const textoElegido = eleccion?.tipo === 'texto' ? (g.textos || [])[eleccion.i] : null
  const cambiarTexto = (cambios: Partial<TextoEnPantalla>) => {
    if (!eleccion || eleccion.tipo !== 'texto') return
    const x = gRef.current
    confirmar({ ...x, textos: (x.textos || []).map((t, i) => (i === eleccion.i ? { ...t, ...cambios } : t)) })
  }
  void vista
  const clipElegido = eleccion?.tipo === 'clip' ? (g.clips || [])[eleccion.i] : null
  const cambiarClip = (cambios: Partial<Clip>) => {
    if (!eleccion || eleccion.tipo !== 'clip') return
    const x = gRef.current
    confirmar({ ...x, clips: (x.clips || []).map((c, i) => (i === eleccion.i ? { ...c, ...cambios } : c)) })
  }
  // «A todos»: el look pasa a ser el de todos los clips (los que tenían uno propio lo pierden).
  const colorATodos = (look?: string) => {
    const x = gRef.current
    confirmar({ ...x, colorClips: look, clips: (x.clips || []).map((c) => ({ ...c, color: undefined, intensidadColor: clipElegido?.intensidadColor })) })
  }

  return (
    <div className="editor-tiempo">
      <div className="et-herramientas">
        <button className="mini" onClick={() => volver(deshacer, rehacer)} disabled={!deshacer.current.length} title="Deshacer (Ctrl+Z)">
          ↶
        </button>
        <button className="mini" onClick={() => volver(rehacer, deshacer)} disabled={!rehacer.current.length} title="Rehacer (Ctrl+Shift+Z)">
          ↷
        </button>
        <button className="mini" onClick={partirClip} disabled={!g.clips?.length} title="Partir el clip de fondo en el cabezal (S)">
          ✂ Partir
        </button>
        <button className="mini" onClick={congelar} disabled={!g.clips?.some((c) => esVideo(c.src))} title="Congelar el cuadro del cabezal 1.5 s (C)">
          ❄ Congelar
        </button>
        <button className="mini" onClick={nuevoTexto} title="Texto o sticker nuevo en el cabezal (T)">
          + Texto
        </button>
        <button className="mini" onClick={borrar} disabled={!eleccion || eleccion.tipo === 'linea'} title="Borrar el clip o texto elegido (Supr)">
          🗑
        </button>
        {textoElegido && (
          <span className="et-texto">
            <input
              value={editandoTexto ?? textoElegido.texto}
              onChange={(e) => setEditandoTexto(e.target.value)}
              onBlur={() => (editandoTexto != null && editandoTexto !== textoElegido.texto && cambiarTexto({ texto: editandoTexto || ' ' }), setEditandoTexto(null))}
              onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
              placeholder="Texto o emoji 🏍️🔥"
            />
            <select value={textoElegido.posicion ?? 'abajo'} onChange={(e) => cambiarTexto({ posicion: e.target.value as TextoEnPantalla['posicion'] })}>
              <option value="arriba">Arriba</option>
              <option value="centro">Centro</option>
              <option value="abajo">Abajo</option>
            </select>
          </span>
        )}
        {clipElegido && (
          <span className="et-color">
            🎨
            <select value={clipElegido.color ?? ''} onChange={(e) => cambiarClip({ color: e.target.value || undefined })} title="Look de color de este clip">
              <option value="">{g.colorClips ? `Como todos (${LOOKS[g.colorClips]?.nombre})` : 'Sin color'}</option>
              {Object.entries(LOOKS).map(([k, l]) => (
                <option key={k} value={k}>
                  {l.nombre}
                </option>
              ))}
            </select>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={clipElegido.intensidadColor ?? 1}
              onChange={(e) => setG({ ...g, clips: (g.clips || []).map((c, i) => (i === eleccion!.i ? { ...c, intensidadColor: Number(e.target.value) } : c)) })}
              onPointerUp={(e) => cambiarClip({ intensidadColor: Number((e.target as HTMLInputElement).value) })}
              title="Intensidad del look"
            />
            <button className="mini" onClick={() => colorATodos(clipElegido.color ?? g.colorClips)} title="Usar este look en todos los clips">
              a todos
            </button>
          </span>
        )}
        {clipElegido && esVideo(clipElegido.src) && !clipElegido.congelar && (
          <span className="et-color">
            ⏩
            <select value={clipElegido.velocidad ?? 1} onChange={(e) => cambiarClip({ velocidad: Number(e.target.value) === 1 ? undefined : Number(e.target.value) })} title="Velocidad del clip">
              {[0.25, 0.5, 0.75, 1, 1.5, 2, 3].map((v) => (
                <option key={v} value={v}>
                  {v}×
                </option>
              ))}
            </select>
            {(clipElegido.velocidad ?? 1) < 1 &&
              (clipElegido.lento?.velocidad === clipElegido.velocidad && clipElegido.lento?.desde === (clipElegido.recorte ?? 0) ? (
                <span className="tenue pequeno">✨ suave</span>
              ) : lentos.some((l) => l.src === clipElegido.src && l.desde === (clipElegido.recorte ?? 0) && l.velocidad === clipElegido.velocidad) ? (
                <span className="tenue pequeno">interpolando…</span>
              ) : (
                <button className="mini" onClick={suavizar} title="Genera cuadros intermedios (minterpolate) para que la cámara lenta no se vea a saltos. Va a la cola.">
                  ✨ Suave
                </button>
              ))}
          </span>
        )}
        <span className="espacio" />
        <span className="tenue pequeno">
          {eleccion?.tipo === 'clip' && 'Arrastrá para reordenar · borde = duración · Alt+arrastrar = deslizar el video'}
          {eleccion?.tipo === 'linea' && 'Arrastrá para reordenar las frases · borde = silencio después'}
          {eleccion?.tipo === 'texto' && 'Arrastrá para mover · bordes = duración · doble clic = editar'}
          {!eleccion && `${tiempo(duracion, fps)} · S partir · C congelar · T texto · Supr borrar`}
        </span>
      </div>
      <div className="et-cuerpo">
        <div className="lt-nombres">
          <div className="lt-hueco" />
          {PISTAS.map((p) => (
            <div key={p.clave} className="lt-nombre et-nombre">
              <i style={{ background: p.color }} />
              {p.nombre}
            </div>
          ))}
        </div>
        <div className="lt-pistas" ref={area} onPointerDown={buscar}>
          <div className="lt-regla">
            {marcas.map((s) => (
              <span key={s} style={{ left: pct(s * fps) }}>
                {tiempo(s * fps, fps).replace(/\.\d+$/, '')}
              </span>
            ))}
          </div>

          {/* Clips */}
          <div className="lt-fila et-fila">
            {(g.clips || []).map((c, i) => {
              const t = tramos[i]
              if (!t) return null
              const elegido = eleccion?.tipo === 'clip' && eleccion.i === i
              const moviendo = a?.tipo === 'clip' && a.modo === 'mover' && a.i === i
              const ultimo = i === (g.clips || []).length - 1
              return (
                <div
                  key={i}
                  className={'et-barra' + (elegido ? ' elegida' : '') + (moviendo ? ' arrastrando' : '') + (a?.tipo === 'clip' && a.destino === i && !moviendo ? ' destino' : '')}
                  style={{ left: pct(t.desde), width: `calc(${pct(t.dur)} - 2px)`, background: '#e8590c', transform: moviendo ? `translateX(${a!.dx ?? 0}px)` : undefined }}
                  title={`${nombreArchivo(c.src)} · ${tiempo(t.desde, fps)} → ${tiempo(t.desde + t.dur, fps)}${c.recorte ? ` · desde ${c.recorte.toFixed(1)} s del video` : ''}`}
                  onPointerDown={(e) => empezar(e, 'clip', i, 'mover')}
                >
                  {(c.color ?? g.colorClips) && <i className="et-punto-color" title={LOOKS[(c.color ?? g.colorClips)!]?.nombre} style={{ background: LOOKS[(c.color ?? g.colorClips)!]?.tinte?.color ?? '#fff' }} />}
                  {c.congelar ? '❄ ' : esVideo(c.src) ? '🎞 ' : '🖼 '}
                  {i + 1} · {(t.dur / fps).toFixed(1)} s{c.velocidad && c.velocidad !== 1 ? ` · ${c.velocidad}×${c.lento?.velocidad === c.velocidad ? '✨' : ''}` : ''}
                  {!ultimo && <span className="et-borde der" onPointerDown={(e) => empezar(e, 'clip', i, 'borde-der')} />}
                </div>
              )
            })}
            {!g.clips?.length && <span className="et-vacio">Sin clips de fondo (se agregan en ✎ Editar guion)</span>}
          </div>

          {/* Voz */}
          <div className="lt-fila et-fila">
            {tomas.map((t, i) => {
              const elegido = eleccion?.tipo === 'linea' && eleccion.i === i
              const moviendo = a?.tipo === 'linea' && a.modo === 'mover' && a.i === i
              const extra = t.linea.pausaDespuesMs ?? 0
              const nombre = g.personajes.find((p) => p.id === t.linea.personaje)?.nombre
              return (
                <div
                  key={t.linea.id}
                  className={'et-barra' + (elegido ? ' elegida' : '') + (moviendo ? ' arrastrando' : '') + (a?.tipo === 'linea' && a.destino === i && !moviendo ? ' destino' : '') + (t.linea.audio ? '' : ' sin-audio')}
                  style={{ left: pct(t.desde), width: `calc(${pct(t.duracion)} - 2px)`, background: '#2f9e44', transform: moviendo ? `translateX(${a!.dx ?? 0}px)` : undefined }}
                  title={`${nombre ? nombre + ': ' : ''}${t.linea.texto}${extra ? ` · +${(extra / 1000).toFixed(1)} s de silencio` : ''}${t.linea.audio ? '' : ' · sin audio (duración estimada)'}`}
                  onPointerDown={(e) => empezar(e, 'linea', i, 'mover')}
                >
                  {t.linea.texto}
                  {extra > 0 && <span className="et-silencio" style={{ width: `${Math.min(100, ((extra / 1000) * fps / t.duracion) * 100)}%` }} />}
                  <span className="et-borde der" onPointerDown={(e) => empezar(e, 'linea', i, 'borde-der')} />
                </div>
              )
            })}
          </div>

          {/* Textos */}
          <div className="lt-fila et-fila">
            {(g.textos || []).map((t, i) => {
              const elegido = eleccion?.tipo === 'texto' && eleccion.i === i
              const fD = Math.round(t.desde * fps)
              const fH = Math.round(t.hasta * fps)
              return (
                <div
                  key={t.id}
                  className={'et-barra' + (elegido ? ' elegida' : '')}
                  style={{ left: pct(fD), width: `calc(${pct(fH - fD)} - 2px)`, background: '#ae3ec9' }}
                  title={`${t.texto} · ${t.desde.toFixed(1)} → ${t.hasta.toFixed(1)} s`}
                  onPointerDown={(e) => empezar(e, 'texto', i, 'mover')}
                  onDoubleClick={() => setEditandoTexto(t.texto)}
                >
                  <span className="et-borde izq" onPointerDown={(e) => empezar(e, 'texto', i, 'borde-izq')} />
                  {t.texto}
                  <span className="et-borde der" onPointerDown={(e) => empezar(e, 'texto', i, 'borde-der')} />
                </div>
              )
            })}
          </div>

          {/* Música */}
          <div className="lt-fila et-fila">
            {g.musica && (
              <div className="et-barra fija" style={{ left: 0, width: 'calc(100% - 2px)', background: '#1971c2' }} title={g.musica}>
                🎵 {nombreArchivo(g.musica)} · volumen {Math.round((g.volumenMusica ?? 0.15) * 100)} %
              </div>
            )}
          </div>

          <div className="lt-cabezal" style={{ left: pct(frame) }} />
        </div>
      </div>
    </div>
  )
}
