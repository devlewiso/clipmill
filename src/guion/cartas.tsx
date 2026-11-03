// Modo cartas: cuenta regresiva de animales con superpoderes reales, cada uno como una carta
// coleccionable (se da vuelta, brilla, se llenan las barras). Líneas: intro, una por carta, cierre.
// Todo lo dibuja Fotograma: solo se paga la voz.
import type { ReactNode } from 'react'
import { Capa } from '../nucleo/estructura'
import { useFrame, useVideo } from '../nucleo/contexto'
import { Audio } from '../nucleo/medios'
import { interpolar } from '../nucleo/interpolar'
import { resorte } from '../nucleo/resorte'
import type { Carta, Guion, LineaGuion } from './tipos'
import { SONIDO_ACIERTO } from './quizTexto'
import { extraCartasMs, lineasCartas, puestoCarta, rolCartas } from './cartasTexto'
export { extraCartasMs, lineasCartas, puestoCarta, rolCartas }

const limitado = { extrapolarIzquierda: 'limitar', extrapolarDerecha: 'limitar' } as const
const FUENTE = 'system-ui, "Segoe UI", sans-serif'

// Rareza según el puesto: el #1 siempre es legendaria (la escalada mantiene al espectador hasta el final).
type Rareza = { nombre: [string, string]; a: string; b: string }
const RAREZAS: Rareza[] = [
  { nombre: ['LEGENDARIA', 'LEGENDARY'], a: '#ffd166', b: '#f77f00' },
  { nombre: ['ÉPICA', 'EPIC'], a: '#e056fd', b: '#7209b7' },
  { nombre: ['RARA', 'RARE'], a: '#4cc9f0', b: '#4361ee' },
  { nombre: ['ESPECIAL', 'SPECIAL'], a: '#06d6a0', b: '#118ab2' },
]
const rarezaDe = (puesto: number) => RAREZAS[Math.min(puesto, RAREZAS.length) - 1]
const es = (g: Guion) => g.idioma.startsWith('es')

// Fondo: dos manchas de luz del color de la carta que se mueven despacio y, en el #1, rayos girando.
const Fondo = ({ r, rayos }: { r: Rareza; rayos?: boolean }) => {
  const frame = useFrame()
  const { ancho, alto } = useVideo()
  const base = Math.min(ancho, alto)
  const mancha = (x: number, y: number, tam: number, color: string, fase: number) => (
    <div
      style={{
        position: 'absolute',
        left: x + Math.sin(frame / 50 + fase) * base * 0.04,
        top: y + Math.cos(frame / 60 + fase) * base * 0.04,
        width: tam,
        height: tam,
        borderRadius: '50%',
        background: color,
        filter: `blur(${base * 0.1}px)`,
        opacity: 0.5,
      }}
    />
  )
  return (
    <Capa>
      {rayos && (
        <div
          style={{
            position: 'absolute',
            left: '50%',
            top: '38%',
            width: base * 2.4,
            height: base * 2.4,
            marginLeft: -base * 1.2,
            marginTop: -base * 1.2,
            background: `repeating-conic-gradient(from ${frame * 0.6}deg, ${r.a}22 0deg 10deg, transparent 10deg 24deg)`,
            borderRadius: '50%',
            maskImage: 'radial-gradient(circle, #000 20%, transparent 65%)',
            WebkitMaskImage: 'radial-gradient(circle, #000 20%, transparent 65%)',
          }}
        />
      )}
      {mancha(-base * 0.3, alto * 0.1, base * 0.9, r.b, 0)}
      {mancha(ancho - base * 0.6, alto * 0.45, base * 0.9, r.a, 2)}
    </Capa>
  )
}

const Cabecera = ({ g, derecha }: { g: Guion; derecha?: ReactNode }) => {
  const { ancho, alto } = useVideo()
  const base = Math.min(ancho, alto)
  return (
    <div style={{ position: 'absolute', top: base * 0.06, left: base * 0.06, right: base * 0.06, display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontFamily: FUENTE }}>
      <div style={{ color: '#fff', fontWeight: 900, fontSize: base * 0.038, letterSpacing: '0.05em', textShadow: '0 2px 12px #0008' }}>{g.cartas?.marca || '✦ CLIPMILL'}</div>
      {derecha}
    </div>
  )
}

// Subtítulos tipo karaoke: grupos de pocas palabras con la que se está diciendo resaltada.
const Karaoke = ({ linea, color, abajo, izquierda, derecha }: { linea: LineaGuion; color: string; abajo: number; izquierda?: number; derecha?: number }) => {
  const frame = useFrame()
  const { fps, ancho, alto } = useVideo()
  const base = Math.min(ancho, alto)
  const ms = (frame / fps) * 1000
  const palabras = linea.palabras?.length ? linea.palabras : null
  let visibles: { texto: string; activa: boolean }[]
  if (palabras) {
    let idx = palabras.findIndex((w) => ms < w.finMs)
    if (idx < 0) idx = palabras.length - 1
    // Páginas de hasta 5 palabras que cortan en la puntuación; una cola de 1-2 palabras se une a la anterior.
    const paginas: number[][] = [[]]
    palabras.forEach((w, k) => {
      const pag = paginas[paginas.length - 1]
      pag.push(k)
      if (pag.length >= 5 || (pag.length >= 3 && /[.,!?;:…]$/.test(w.texto))) paginas.push([])
    })
    if (!paginas[paginas.length - 1].length) paginas.pop()
    if (paginas.length > 1 && paginas[paginas.length - 1].length <= 2) paginas[paginas.length - 2].push(...paginas.pop()!)
    const pag = paginas.find((p) => p.includes(idx)) ?? paginas[0]
    visibles = pag.map((k) => ({ texto: palabras[k].texto, activa: k === idx && ms >= palabras[k].inicioMs }))
  } else visibles = [{ texto: linea.texto, activa: false }]
  return (
    <div style={{ position: 'absolute', left: izquierda ?? base * 0.06, right: derecha ?? base * 0.06, bottom: abajo, textAlign: 'center', fontFamily: FUENTE, fontWeight: 900, fontSize: base * (palabras ? 0.068 : 0.05), lineHeight: 1.2, color: '#fff', textShadow: '0 4px 18px #000c, 0 0 2px #000' }}>
      {visibles.map((w, k) => (
        <span key={k}>
          {k > 0 && ' '}
          <span style={{ color: w.activa ? color : '#fff', display: 'inline-block', transform: w.activa ? 'scale(1.06)' : 'none' }}>{w.texto}</span>
        </span>
      ))}
    </div>
  )
}

// Dorso de la carta: el puesto y un signo de pregunta.
const Dorso = ({ r, puesto, tam }: { r: Rareza; puesto?: number; tam: number }) => (
  <div
    style={{
      position: 'absolute',
      inset: 0,
      borderRadius: tam * 0.06,
      background: `linear-gradient(145deg, ${r.a}, ${r.b})`,
      border: `${tam * 0.02}px solid #ffffffaa`,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: FUENTE,
      color: '#fff',
      boxShadow: `0 ${tam * 0.04}px ${tam * 0.12}px #000a`,
      backgroundImage: `repeating-linear-gradient(45deg, #ffffff14 0 ${tam * 0.03}px, transparent ${tam * 0.03}px ${tam * 0.06}px), linear-gradient(145deg, ${r.a}, ${r.b})`,
    }}
  >
    {puesto !== undefined && <div style={{ fontWeight: 900, fontSize: tam * 0.32, lineHeight: 1, textShadow: '0 6px 24px #0007' }}>#{puesto}</div>}
    <div style={{ fontWeight: 900, fontSize: tam * (puesto !== undefined ? 0.2 : 0.42), opacity: 0.9 }}>?</div>
  </div>
)

// Barra de un stat: se llena y el número cuenta hacia arriba.
const Barra = ({ etiqueta, valor, desde, color, tam }: { etiqueta: string; valor: number; desde: number; color: string; tam: number }) => {
  const frame = useFrame()
  const p = interpolar(frame, [desde, desde + 18], [0, 1], { ...limitado })
  const v = Math.round(Math.max(0, Math.min(100, valor)) * p)
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: tam * 0.025 }}>
      <span style={{ width: tam * 0.3, fontSize: tam * 0.042, fontWeight: 800, color: '#c9d1e3', letterSpacing: '0.04em', textTransform: 'uppercase', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{etiqueta}</span>
      <div style={{ flex: 1, height: tam * 0.04, borderRadius: 999, background: '#ffffff1c', overflow: 'hidden' }}>
        <div style={{ width: `${v}%`, height: '100%', borderRadius: 999, background: `linear-gradient(90deg, ${color}, #fff)`, boxShadow: `0 0 ${tam * 0.03}px ${color}` }} />
      </div>
      <span style={{ width: tam * 0.1, textAlign: 'right', fontSize: tam * 0.048, fontWeight: 900, color: '#fff' }}>{v}</span>
    </div>
  )
}

// Frente de la carta.
const Frente = ({ g, c, r, tam, lleno }: { g: Guion; c: Carta; r: Rareza; tam: number; lleno: number }) => {
  const frame = useFrame()
  const alto = tam * 1.38
  const brillo = ((frame % 90) / 90) * 2.4 - 0.7
  return (
    <div style={{ position: 'absolute', inset: 0, borderRadius: tam * 0.06, padding: tam * 0.022, background: `linear-gradient(145deg, ${r.a}, ${r.b}, ${r.a})`, boxShadow: `0 ${tam * 0.04}px ${tam * 0.14}px #000b, 0 0 ${tam * 0.12}px ${r.a}66` }}>
      <div style={{ position: 'relative', width: '100%', height: '100%', borderRadius: tam * 0.045, background: 'linear-gradient(180deg, #161b2e, #0b0f1c)', overflow: 'hidden', fontFamily: FUENTE, color: '#fff', display: 'flex', flexDirection: 'column', padding: tam * 0.045, gap: tam * 0.022 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: tam * 0.02 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 900, fontSize: tam * (c.nombre.length > 18 ? 0.06 : 0.075), lineHeight: 1.05 }}>{c.nombre}</div>
            {c.cientifico && <div style={{ fontStyle: 'italic', color: '#9aa6c2', fontSize: tam * 0.038, marginTop: tam * 0.006 }}>{c.cientifico}</div>}
          </div>
          <span style={{ flexShrink: 0, fontWeight: 900, fontSize: tam * 0.034, letterSpacing: '0.08em', padding: `${tam * 0.01}px ${tam * 0.025}px`, borderRadius: 999, background: `linear-gradient(90deg, ${r.a}, ${r.b})`, color: '#111' }}>
            {r.nombre[es(g) ? 0 : 1]}
          </span>
        </div>
        {/* Ventana con el animal */}
        <div style={{ position: 'relative', height: alto * 0.43, borderRadius: tam * 0.035, background: `radial-gradient(circle at 50% 55%, ${r.a}66, ${r.b}33 45%, #0b0f1c 75%)`, border: `1px solid ${r.a}55`, display: 'grid', placeItems: 'center', overflow: 'hidden' }}>
          {[0, 1, 2, 3, 4, 5].map((k) => (
            <span key={k} style={{ position: 'absolute', left: `${12 + ((k * 37) % 76)}%`, top: `${10 + ((k * 53) % 70)}%`, fontSize: tam * 0.035, opacity: 0.35 + 0.65 * Math.abs(Math.sin(frame / 12 + k * 1.7)), color: r.a }}>
              ✦
            </span>
          ))}
          <span style={{ fontSize: tam * 0.34, lineHeight: 1, transform: `translateY(${Math.sin(frame / 14) * tam * 0.015}px) scale(${0.5 + 0.5 * lleno})`, filter: `drop-shadow(0 ${tam * 0.02}px ${tam * 0.04}px #000a)` }}>{c.emoji || '🐾'}</span>
        </div>
        <div>
          <div style={{ fontSize: tam * 0.036, fontWeight: 900, color: r.a, letterSpacing: '0.1em' }}>⚡ {es(g) ? 'SUPERPODER' : 'SUPERPOWER'}</div>
          <div style={{ fontSize: tam * (c.poder.length > 40 ? 0.05 : 0.06), fontWeight: 900, lineHeight: 1.12, marginTop: tam * 0.006 }}>{c.poder}</div>
        </div>
        {c.cifra && (
          <div style={{ alignSelf: 'flex-start', fontSize: tam * 0.048, fontWeight: 900, padding: `${tam * 0.012}px ${tam * 0.03}px`, borderRadius: tam * 0.025, background: '#ffffff12', border: `1px solid ${r.a}88`, opacity: lleno }}>
            📊 {c.cifra}
          </div>
        )}
        <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: tam * 0.018 }}>
          {c.stats.slice(0, 3).map((s, k) => (
            <Barra key={k} etiqueta={s.etiqueta} valor={s.valor} desde={22 + k * 7} color={r.a} tam={tam} />
          ))}
        </div>
        {/* Brillo holográfico que cruza la carta */}
        <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', background: `linear-gradient(115deg, transparent ${(brillo - 0.15) * 100}%, #ffffff30 ${brillo * 100}%, transparent ${(brillo + 0.15) * 100}%)`, mixBlendMode: 'screen' }} />
      </div>
    </div>
  )
}

export const TomaCartas = ({ g, linea, indice }: { g: Guion; linea: LineaGuion; indice: number }) => {
  const frame = useFrame()
  const { fps, ancho, alto } = useVideo()
  const base = Math.min(ancho, alto)
  const vertical = alto > ancho
  const rol = rolCartas(g, indice)
  const cs = g.cartas!
  const n = cs.cartas.length
  const entrada = resorte({ frame, fps, config: { amortiguacion: 14, rigidez: 140 } })
  // La carta ocupa casi todo el ancho en vertical; en horizontal, la altura manda.
  const tam = vertical ? base * 0.8 : alto * 0.62
  const top = vertical ? alto * 0.13 : alto * 0.14

  if (rol.tipo === 'intro' || rol.tipo === 'cierre') {
    const r = rarezaDe(1)
    const intro = rol.tipo === 'intro'
    const mini = Math.min(tam * 0.42, (ancho * 0.88) / Math.min(n, 5))
    return (
      <Capa>
        <Fondo r={r} rayos={!intro} />
        <Cabecera g={g} />
        {linea.audio && <Audio src={linea.audio} />}
        <div style={{ position: 'absolute', left: 0, right: 0, top: alto * (vertical ? 0.2 : 0.18), display: 'flex', justifyContent: 'center', alignItems: 'center', height: mini * 1.38 }}>
          {cs.cartas.slice(-5).map((c, k, lista) => {
            const centro = (lista.length - 1) / 2
            const giro = intro ? (k - centro) * 9 + Math.sin(frame / 10 + k) * 2 : 0
            const e = resorte({ frame: frame - k * 4, fps, config: { amortiguacion: 12, rigidez: 160 } })
            const puesto = puestoCarta(cs, n - lista.length + k)
            const rr = rarezaDe(puesto)
            return (
              <div
                key={k}
                style={{
                  position: 'relative',
                  width: mini,
                  height: mini * 1.38,
                  margin: `0 ${intro ? -mini * 0.12 : base * 0.01}px`,
                  transform: `translateY(${(1 - e) * base * 0.4 + (intro ? Math.abs(k - centro) * mini * 0.08 : 0)}px) rotate(${giro}deg)`,
                  zIndex: intro ? lista.length - Math.abs(Math.round(k - centro)) : 1,
                }}
              >
                {intro ? (
                  <Dorso r={rr} tam={mini} />
                ) : (
                  <div style={{ position: 'absolute', inset: 0, borderRadius: mini * 0.06, background: `linear-gradient(145deg, ${rr.a}, ${rr.b})`, padding: mini * 0.03 }}>
                    <div style={{ width: '100%', height: '100%', borderRadius: mini * 0.045, background: '#0f1424', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: mini * 0.03, fontFamily: FUENTE, color: '#fff', padding: mini * 0.05, textAlign: 'center' }}>
                      <span style={{ fontWeight: 900, fontSize: mini * 0.13, color: rr.a }}>#{puesto}</span>
                      <span style={{ fontSize: mini * 0.38, lineHeight: 1 }}>{c.emoji || '🐾'}</span>
                      <span style={{ fontWeight: 800, fontSize: mini * 0.09, lineHeight: 1.1 }}>{c.nombre}</span>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
        {intro && (
          <div style={{ position: 'absolute', left: 0, right: 0, top: alto * (vertical ? 0.2 : 0.18) + mini * 1.38 + base * 0.08, textAlign: 'center', fontFamily: FUENTE, fontWeight: 900, color: '#fff', fontSize: base * 0.085, lineHeight: 1.05, opacity: entrada, transform: `scale(${0.85 + 0.15 * entrada})`, textShadow: '0 6px 30px #000a' }}>
            TOP {n}
            <div style={{ fontSize: base * 0.05, color: r.a, letterSpacing: '0.06em' }}>{es(g) ? 'SUPERPODERES REALES' : 'REAL SUPERPOWERS'}</div>
          </div>
        )}
        {!intro && (
          <div style={{ position: 'absolute', left: 0, right: 0, top: alto * (vertical ? 0.2 : 0.18) + mini * 1.38 + base * 0.08, display: 'flex', justifyContent: 'center', opacity: interpolar(frame, [10, 20], [0, 1], limitado) }}>
            <span style={{ background: '#ff0033', color: '#fff', fontFamily: FUENTE, fontWeight: 900, fontSize: base * 0.045, padding: `${base * 0.02}px ${base * 0.05}px`, borderRadius: 999 }}>🔔 {es(g) ? 'Suscríbete' : 'Subscribe'}</span>
          </div>
        )}
        <Karaoke linea={linea} color={r.a} abajo={alto * (vertical ? 0.12 : 0.08)} />
      </Capa>
    )
  }

  const c = cs.cartas[rol.k]
  const puesto = puestoCarta(cs, rol.k)
  const r = rarezaDe(puesto)
  // Vuelta de la carta: entra desde abajo con el dorso y gira hasta mostrar el frente.
  const sube = resorte({ frame, fps, config: { amortiguacion: 13, rigidez: 150 } })
  const vuelta = resorte({ frame: frame - 10, fps, config: { amortiguacion: 15, rigidez: 110 } })
  const angulo = 180 - 180 * vuelta
  const lleno = interpolar(frame, [16, 30], [0, 1], limitado)
  const golpe = puesto === 1 ? 1 + 0.06 * Math.max(0, Math.sin((frame - 14) / 3)) * interpolar(frame, [14, 40], [1, 0], limitado) : 1
  return (
    <Capa>
      <Fondo r={r} rayos={puesto === 1} />
      <Cabecera
        g={g}
        derecha={
          <span style={{ color: '#111', fontFamily: FUENTE, fontWeight: 900, fontSize: base * 0.05, background: `linear-gradient(90deg, ${r.a}, ${r.b})`, padding: `${base * 0.006}px ${base * 0.03}px`, borderRadius: 999, transform: `scale(${0.6 + 0.4 * entrada})` }}>
            #{puesto}
          </span>
        }
      />
      {linea.audio && <Audio src={linea.audio} />}
      <Audio src={SONIDO_ACIERTO} volumen={puesto === 1 ? 0.7 : 0.35} />
      <div style={{ position: 'absolute', left: vertical ? (ancho - tam) / 2 : ancho * 0.07, top, width: tam, height: tam * 1.38, perspective: tam * 3, transform: `translateY(${(1 - sube) * alto * 0.6}px) scale(${golpe})` }}>
        <div style={{ position: 'relative', width: '100%', height: '100%', transformStyle: 'preserve-3d', transform: `rotateY(${angulo}deg)` }}>
          <div style={{ position: 'absolute', inset: 0, backfaceVisibility: 'hidden', WebkitBackfaceVisibility: 'hidden' }}>
            <Frente g={g} c={c} r={r} tam={tam} lleno={lleno} />
          </div>
          <div style={{ position: 'absolute', inset: 0, backfaceVisibility: 'hidden', WebkitBackfaceVisibility: 'hidden', transform: 'rotateY(180deg)' }}>
            <Dorso r={r} puesto={puesto} tam={tam} />
          </div>
        </div>
      </div>
      {vertical ? (
        <Karaoke linea={linea} color={r.a} abajo={alto * 0.07} />
      ) : (
        <Karaoke linea={linea} color={r.a} abajo={alto * 0.4} izquierda={ancho * 0.07 + tam + ancho * 0.05} derecha={ancho * 0.06} />
      )}
    </Capa>
  )
}
