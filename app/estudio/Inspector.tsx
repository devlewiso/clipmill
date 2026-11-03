// Inspector de elementos (estándar de video, fotograma/escena): para los videos hechos de escenas en un JSON.
// Muestra la escena del cabezal, sus elementos (los que se están dibujando) y los ajustes de cada uno.
// Cada cambio se ve al instante (props) y «Guardar» lo escribe en el JSON del video.
import { useMemo, useState } from 'react'
import { CAMPOS_AJUSTE, MOVIMIENTOS, type Ajuste, type Ajustes } from '../../src/escena'
import type { ElementoVisible } from '../../src/nucleo/contexto'

type Escena = { tipo: string; seg: number; id?: string; ajustes?: Ajustes; transicion?: string; colorFondo?: string; sfx?: false | unknown[] }
type Props = { escenas: Escena[]; ajustes?: Ajustes; volumenMusica?: number; volumenSfx?: number; volumenVoz?: number; [k: string]: unknown }

const TRANSICIONES = ['', 'glitch', 'zoom', 'barrido', 'corte', 'ninguna']
// Elementos que existen en todo el video (escena -1).
const GLOBALES = ['presentador', 'textura']

export const esVideoDeEscenas = (props: any) => Array.isArray(props?.escenas) && props.escenas.every((e: any) => e && typeof e.tipo === 'string' && typeof e.seg === 'number')

const limpiar = (a: Ajuste) => Object.fromEntries(Object.entries(a).filter(([, v]) => v !== undefined && v !== '')) as Ajuste
const limpiarAjustes = (aj: Ajustes) => {
  const r: Ajustes = {}
  for (const [k, v] of Object.entries(aj)) if (Object.keys(limpiar(v)).length) r[k] = limpiar(v)
  return Object.keys(r).length ? r : undefined
}

export const Inspector = ({
  props,
  cambiar,
  elementos,
  frame,
  fps,
  irA,
  archivo,
  guardar,
  estado,
}: {
  props: Props
  cambiar: (p: Props) => void
  elementos: ElementoVisible[]
  frame: number
  fps: number
  irA: (f: number) => void
  archivo?: string
  guardar: () => void
  estado: '' | 'guardando' | 'guardado' | 'error' | 'cambios'
}) => {
  const tramos = useMemo(() => {
    let t = 0
    return props.escenas.map((e) => {
      const desde = t
      t += Math.round(e.seg * fps)
      return { desde, hasta: t }
    })
  }, [props.escenas, fps])
  const delCabezal = Math.max(0, tramos.findIndex((x) => frame < x.hasta))
  // null = sigue al cabezal · -1 = todo el video · n = escena fija
  const [fija, setFija] = useState<number | null>(null)
  const escena = fija ?? delCabezal
  const [elegido, setElegido] = useState<string>('')

  const nombres = useMemo(() => {
    const vistos = elementos.filter((e) => e.escena === escena).map((e) => e.nombre)
    const guardados = Object.keys((escena < 0 ? props.ajustes : props.escenas[escena]?.ajustes) ?? {})
    const base = escena < 0 ? [...GLOBALES, ...vistos] : vistos
    return [...new Set([...base, ...guardados])]
  }, [elementos, escena, props])
  const nombre = nombres.includes(elegido) ? elegido : nombres[0] ?? ''

  const ajustesActuales: Ajustes = (escena < 0 ? props.ajustes : props.escenas[escena]?.ajustes) ?? {}
  const ajuste: Ajuste = ajustesActuales[nombre] ?? {}

  const ponerAjuste = (campo: keyof Ajuste, valor: unknown) => {
    const nuevo = limpiarAjustes({ ...ajustesActuales, [nombre]: { ...ajuste, [campo]: valor } })
    if (escena < 0) cambiar({ ...props, ajustes: nuevo })
    else cambiar({ ...props, escenas: props.escenas.map((e, i) => (i === escena ? { ...e, ajustes: nuevo } : e)) })
  }
  const borrarElemento = () => {
    const { [nombre]: _, ...resto } = ajustesActuales
    const nuevo = limpiarAjustes(resto)
    if (escena < 0) cambiar({ ...props, ajustes: nuevo })
    else cambiar({ ...props, escenas: props.escenas.map((e, i) => (i === escena ? { ...e, ajustes: nuevo } : e)) })
  }
  const ponerEscena = (campo: string, valor: unknown) =>
    cambiar({ ...props, escenas: props.escenas.map((e, i) => (i === escena ? limpiarEscena({ ...e, [campo]: valor }) : e)) })
  const limpiarEscena = (e: Escena) => Object.fromEntries(Object.entries(e).filter(([, v]) => v !== undefined && v !== '')) as Escena

  const elegirEscena = (v: string) => {
    if (v === 'cabezal') return setFija(null)
    const n = Number(v)
    setFija(n)
    if (n >= 0 && tramos[n]) irA(tramos[n].desde + Math.min(15, tramos[n].hasta - tramos[n].desde - 1))
  }

  const e = escena >= 0 ? props.escenas[escena] : null
  return (
    <div className="inspector formulario">
      <label className="campo">
        <span>Escena</span>
        <select value={fija === null ? 'cabezal' : String(fija)} onChange={(ev) => elegirEscena(ev.target.value)}>
          <option value="cabezal">Seguir el cabezal ({delCabezal + 1} · {props.escenas[delCabezal]?.id || props.escenas[delCabezal]?.tipo})</option>
          <option value="-1">Todo el video</option>
          {props.escenas.map((x, i) => (
            <option key={i} value={i}>
              {i + 1} · {x.id || x.tipo}
            </option>
          ))}
        </select>
      </label>

      {e && (
        <div className="fila">
          <label className="campo">
            <span>Dura (s)</span>
            <input type="number" min={0.2} step={0.1} value={e.seg} onChange={(ev) => ponerEscena('seg', Math.max(0.2, Number(ev.target.value)))} />
          </label>
          <label className="campo">
            <span>Transición</span>
            <select value={e.transicion ?? ''} onChange={(ev) => ponerEscena('transicion', ev.target.value || undefined)}>
              {TRANSICIONES.map((t) => (
                <option key={t} value={t}>{t || 'la del estilo'}</option>
              ))}
            </select>
          </label>
        </div>
      )}
      {e && (
        <div className="fila">
          <label className="campo">
            <span>Fondo (CSS)</span>
            <input value={e.colorFondo ?? ''} placeholder="el del estilo" onChange={(ev) => ponerEscena('colorFondo', ev.target.value || undefined)} />
          </label>
          <label className="campo campo-check">
            <span>Sin sonidos</span>
            <input type="checkbox" checked={e.sfx === false} onChange={(ev) => ponerEscena('sfx', ev.target.checked ? false : undefined)} />
          </label>
        </div>
      )}
      {!e && (
        <div className="fila">
          {(['volumenMusica', 'volumenSfx', 'volumenVoz'] as const).map((k) => (
            <label key={k} className="campo">
              <span>{{ volumenMusica: 'Música', volumenSfx: 'SFX (×)', volumenVoz: 'Voz (×)' }[k]}</span>
              <input type="number" min={0} max={k === 'volumenMusica' ? 1 : 3} step={0.01} value={props[k] ?? ''} placeholder="auto" onChange={(ev) => cambiar({ ...props, [k]: ev.target.value === '' ? undefined : Number(ev.target.value) })} />
            </label>
          ))}
        </div>
      )}

      <div className="campo">
        <span>Elementos {escena < 0 ? '(todo el video: valen en todas las escenas)' : 'de la escena'}</span>
        <div className="chips">
          {nombres.length === 0 && <small className="tenue">Mové el cabezal dentro de la escena para ver sus elementos.</small>}
          {nombres.map((n) => (
            <button key={n} className={'chip' + (n === nombre ? ' on' : '') + (ajustesActuales[n] ? ' ajustado' : '')} onClick={() => setElegido(n)} title={ajustesActuales[n] ? 'Tiene ajustes' : ''}>
              {n}
            </button>
          ))}
        </div>
      </div>

      {nombre && (
        <>
          {CAMPOS_AJUSTE.map((c) => {
            const v = ajuste[c.clave]
            const quitar = v !== undefined && (
              <button className="mini" title="Quitar ajuste" onClick={() => ponerAjuste(c.clave, undefined)}>
                ×
              </button>
            )
            let control
            if (c.tipo === 'booleano') control = <input type="checkbox" checked={!!v} onChange={(ev) => ponerAjuste(c.clave, ev.target.checked || undefined)} />
            else if (c.tipo === 'movimiento')
              control = (
                <select value={(v as string) ?? 'ninguno'} onChange={(ev) => ponerAjuste(c.clave, ev.target.value === 'ninguno' ? undefined : ev.target.value)}>
                  {MOVIMIENTOS.map((m) => <option key={m}>{m}</option>)}
                </select>
              )
            else if (c.tipo === 'color')
              control = (
                <div className="fila">
                  <input type="color" value={/^#[\da-f]{6}$/i.test(String(v)) ? String(v) : '#ffffff'} onChange={(ev) => ponerAjuste(c.clave, ev.target.value)} />
                  <input value={(v as string) ?? ''} placeholder="el de la plantilla" onChange={(ev) => ponerAjuste(c.clave, ev.target.value || undefined)} />
                </div>
              )
            else if (c.tipo === 'texto') control = <input value={(v as string) ?? ''} placeholder="la de la plantilla" onChange={(ev) => ponerAjuste(c.clave, ev.target.value || undefined)} />
            else {
              const num = (v as number | undefined) ?? (c.neutro as number | undefined)
              const poner = (x: string) => ponerAjuste(c.clave, x === '' || Number(x) === c.neutro ? undefined : Number(x))
              control = (
                <div className="fila">
                  <input type="range" min={c.min} max={c.max} step={c.paso} value={num ?? c.min ?? 0} onChange={(ev) => poner(ev.target.value)} />
                  <input type="number" min={c.min} max={c.max} step={c.paso} value={v === undefined ? '' : String(v)} placeholder={c.neutro === undefined ? '—' : String(c.neutro)} onChange={(ev) => poner(ev.target.value)} />
                </div>
              )
            }
            return (
              <label key={c.clave} className={'campo' + (c.tipo === 'booleano' ? ' campo-check' : '')}>
                <span>
                  {c.etiqueta} {quitar}
                </span>
                {control}
              </label>
            )
          })}
          {ajustesActuales[nombre] && (
            <button className="mini-izq" onClick={borrarElemento}>
              Restablecer «{nombre}»
            </button>
          )}
        </>
      )}

      {archivo && (
        <button className="primario" disabled={estado === 'guardando'} onClick={guardar}>
          {estado === 'guardando' ? 'Guardando…' : estado === 'guardado' ? '✓ Guardado' : estado === 'error' ? 'Error: reintentar' : `Guardar en ${archivo}`}
        </button>
      )}
    </div>
  )
}
