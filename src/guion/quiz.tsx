// Modo quiz: pregunta con opciones, cuenta regresiva y revelación de la respuesta.
// Las líneas del guion son: intro, (pregunta, respuesta) × N y cierre; la voz lee cada una y
// después de cada pregunta se agrega el tiempo de la cuenta regresiva.
import { Secuencia, Capa } from '../nucleo/estructura'
import { useFrame, useVideo } from '../nucleo/contexto'
import { Audio } from '../nucleo/medios'
import { interpolar } from '../nucleo/interpolar'
import { resorte } from '../nucleo/resorte'
import type { Guion, LineaGuion } from './tipos'

import { LETRAS, SONIDO_ACIERTO, SONIDO_TIC, extraQuizMs, lineasQuiz, rolQuiz, type RolQuiz } from './quizTexto'
export { LETRAS, SONIDO_ACIERTO, SONIDO_TIC, extraQuizMs, lineasQuiz, rolQuiz, type RolQuiz }

const limitado = { extrapolarIzquierda: 'limitar', extrapolarDerecha: 'limitar' } as const
const FUENTE = 'system-ui, "Segoe UI", sans-serif'

// Tamaño de letra según el largo del texto.
const tamTexto = (t: string, base: number, vertical: boolean) => {
  const n = t.length
  const f = n < 50 ? 0.075 : n < 90 ? 0.064 : n < 140 ? 0.054 : 0.046
  return base * f * (vertical ? 1 : 0.85)
}

const Cabecera = ({ g, n }: { g: Guion; n?: number }) => {
  const { ancho, alto } = useVideo()
  const base = Math.min(ancho, alto)
  const total = g.quiz?.preguntas.length ?? 0
  return (
    <div style={{ position: 'absolute', top: base * 0.06, left: base * 0.06, right: base * 0.06, display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontFamily: FUENTE }}>
      <div style={{ color: '#fff', fontWeight: 900, fontSize: base * 0.04, letterSpacing: '0.04em' }}>{g.quiz?.marca || '🧠 RETO'}</div>
      {n !== undefined && (
        <div style={{ display: 'flex', alignItems: 'center', gap: base * 0.012 }}>
          <span style={{ color: '#fff', fontWeight: 800, fontSize: base * 0.034, background: '#ffffff22', padding: `${base * 0.006}px ${base * 0.022}px`, borderRadius: 999 }}>
            {n + 1} / {total}
          </span>
        </div>
      )}
    </div>
  )
}

const Fondo = () => {
  const frame = useFrame()
  const { ancho, alto } = useVideo()
  const base = Math.min(ancho, alto)
  const burbuja = (x: number, y: number, r: number, color: string, fase: number) => (
    <div
      style={{
        position: 'absolute',
        left: x + Math.sin(frame / 60 + fase) * base * 0.03,
        top: y + Math.cos(frame / 70 + fase) * base * 0.03,
        width: r,
        height: r,
        borderRadius: '50%',
        background: color,
        filter: `blur(${base * 0.08}px)`,
        opacity: 0.55,
      }}
    />
  )
  return (
    <Capa>
      {burbuja(-base * 0.2, alto * 0.05, base * 0.8, '#7b2ff7', 0)}
      {burbuja(ancho - base * 0.5, alto * 0.55, base * 0.9, '#00b4d8', 2)}
      {burbuja(ancho * 0.2, alto * 0.8, base * 0.6, '#f72585', 4)}
    </Capa>
  )
}

const Opcion = ({ texto, letra, indice, estado, base, vertical }: { texto: string; letra: string; indice: number; estado: 'normal' | 'correcta' | 'incorrecta'; base: number; vertical: boolean }) => {
  const frame = useFrame()
  const { fps } = useVideo()
  const entrada = resorte({ frame: frame - 8 - indice * 5, fps, config: { amortiguacion: 13, rigidez: 150 } })
  const color = estado === 'correcta' ? '#06d6a0' : estado === 'incorrecta' ? '#ffffff14' : '#ffffff26'
  const pulso = estado === 'correcta' ? 1 + 0.05 * Math.max(0, Math.sin(frame / 4)) * interpolar(frame, [0, 20], [1, 0], limitado) : 1
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: base * 0.025,
        padding: `${base * 0.022}px ${base * 0.03}px`,
        borderRadius: base * 0.03,
        background: color,
        border: `${base * 0.004}px solid ${estado === 'correcta' ? '#06d6a0' : '#ffffff33'}`,
        color: '#fff',
        opacity: (estado === 'incorrecta' ? 0.45 : 1) * entrada,
        transform: `translateX(${(1 - entrada) * base * 0.15}px) scale(${pulso})`,
        fontFamily: FUENTE,
        boxShadow: estado === 'correcta' ? `0 0 ${base * 0.05}px #06d6a088` : 'none',
      }}
    >
      <span
        style={{
          flexShrink: 0,
          width: base * 0.075,
          height: base * 0.075,
          borderRadius: '50%',
          display: 'grid',
          placeItems: 'center',
          fontWeight: 900,
          fontSize: base * 0.04,
          background: estado === 'correcta' ? '#fff' : '#ffd400',
          color: estado === 'correcta' ? '#06d6a0' : '#1b1035',
        }}
      >
        {estado === 'correcta' ? '✓' : letra}
      </span>
      <span style={{ fontWeight: 800, fontSize: base * (texto.length > 40 ? 0.04 : vertical ? 0.05 : 0.045), lineHeight: 1.15 }}>{texto}</span>
    </div>
  )
}

// Anillo de la cuenta regresiva.
const Cuenta = ({ cuentaS, base }: { cuentaS: number; base: number }) => {
  const frame = useFrame()
  const { fps } = useVideo()
  const t = frame / fps
  const queda = Math.max(0, cuentaS - t)
  const n = Math.ceil(queda)
  const p = queda / cuentaS
  const r = base * 0.09
  const circ = 2 * Math.PI * r
  const color = p > 0.5 ? '#ffd400' : p > 0.25 ? '#ff9f1c' : '#ff4d6d'
  const golpe = interpolar((t % 1) * fps, [0, 6], [1.18, 1], limitado)
  return (
    <div style={{ position: 'relative', width: r * 2.4, height: r * 2.4, display: 'grid', placeItems: 'center' }}>
      <svg width={r * 2.4} height={r * 2.4} style={{ position: 'absolute', inset: 0, transform: 'rotate(-90deg)' }}>
        <circle cx={r * 1.2} cy={r * 1.2} r={r} fill="#0006" stroke="#ffffff22" strokeWidth={base * 0.016} />
        <circle cx={r * 1.2} cy={r * 1.2} r={r} fill="none" stroke={color} strokeWidth={base * 0.016} strokeLinecap="round" strokeDasharray={circ} strokeDashoffset={circ * (1 - p)} />
      </svg>
      <span style={{ color: '#fff', fontFamily: FUENTE, fontWeight: 900, fontSize: base * 0.09, transform: `scale(${golpe})` }}>{n || '!'}</span>
    </div>
  )
}

export const TomaQuiz = ({ g, linea, indice }: { g: Guion; linea: LineaGuion; indice: number }) => {
  const frame = useFrame()
  const { fps, ancho, alto } = useVideo()
  const base = Math.min(ancho, alto)
  const vertical = alto > ancho
  const rol = rolQuiz(g, indice)
  const q = g.quiz!
  const p = q.preguntas[rol.n]
  const entrada = resorte({ frame, fps, config: { amortiguacion: 14, rigidez: 140 } })
  const voz = Math.round(((linea.duracionMs ?? 2500) / 1000) * fps)

  if (rol.tipo === 'intro' || rol.tipo === 'cierre') {
    return (
      <Capa>
        <Fondo />
        <Cabecera g={g} />
        {linea.audio && <Audio src={linea.audio} />}
        <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: base * 0.08, gap: base * 0.04 }}>
          <div style={{ fontSize: base * 0.2, transform: `scale(${0.6 + 0.4 * entrada}) rotate(${Math.sin(frame / 8) * 6}deg)` }}>{rol.tipo === 'intro' ? '🧠' : '🏆'}</div>
          <div style={{ color: '#fff', fontFamily: FUENTE, fontWeight: 900, fontSize: tamTexto(linea.texto, base, vertical) * 1.15, lineHeight: 1.1, textAlign: 'center', opacity: entrada, transform: `translateY(${(1 - entrada) * base * 0.05}px)`, textShadow: '0 6px 24px #0008' }}>
            {linea.texto}
          </div>
          {rol.tipo === 'cierre' && (
            <div style={{ marginTop: base * 0.02, background: '#ff0033', color: '#fff', fontFamily: FUENTE, fontWeight: 900, fontSize: base * 0.045, padding: `${base * 0.02}px ${base * 0.05}px`, borderRadius: 999, opacity: interpolar(frame, [10, 20], [0, 1], limitado) }}>
              🔔 {g.idioma.startsWith('es') ? 'Suscríbete' : 'Subscribe'}
            </div>
          )}
        </div>
      </Capa>
    )
  }

  const revelar = rol.tipo === 'respuesta'
  const estado = (k: number) => (!revelar ? 'normal' : k === p.correcta ? 'correcta' : 'incorrecta')
  return (
    <Capa>
      <Fondo />
      <Cabecera g={g} n={rol.n} />
      {linea.audio && <Audio src={linea.audio} />}
      {revelar && <Audio src={SONIDO_ACIERTO} volumen={0.6} />}
      {!revelar &&
        Array.from({ length: q.cuentaS }, (_, k) => (
          <Secuencia key={k} desde={voz + k * fps} duracion={fps} nombre={`Tic ${k + 1}`}>
            <Audio src={SONIDO_TIC} volumen={0.5} />
          </Secuencia>
        ))}
      <div
        style={{
          position: 'absolute',
          left: base * 0.06,
          right: base * 0.06,
          top: vertical ? alto * 0.12 : alto * 0.14,
          bottom: base * 0.06,
          display: 'flex',
          flexDirection: 'column',
          gap: base * 0.035,
        }}
      >
        <div
          style={{
            background: '#ffffff',
            color: '#1b1035',
            borderRadius: base * 0.04,
            padding: base * 0.045,
            fontFamily: FUENTE,
            fontWeight: 900,
            fontSize: tamTexto(p.pregunta, base, vertical) * (revelar ? 0.8 : 1),
            lineHeight: 1.15,
            textAlign: 'center',
            boxShadow: '0 16px 48px #0007',
            transform: revelar ? 'none' : `scale(${0.9 + 0.1 * entrada})`,
            opacity: revelar ? 1 : entrada,
          }}
        >
          {p.pregunta}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: vertical || p.opciones.some((o) => o.length > 28) ? '1fr' : '1fr 1fr', gap: base * 0.022 }}>
          {p.opciones.map((o, k) => (
            <Opcion key={k} texto={o} letra={LETRAS[k]} indice={revelar ? 0 : k} estado={estado(k)} base={base} vertical={vertical} />
          ))}
        </div>
        {!revelar && (
          <div style={{ display: 'flex', justifyContent: 'center', marginTop: base * 0.01 }}>
            <Secuencia desde={voz} capa={false} nombre="Cuenta regresiva">
              <Cuenta cuentaS={q.cuentaS} base={base} />
            </Secuencia>
          </div>
        )}
        {revelar && p.explicacion && (
          <div
            style={{
              background: '#00000055',
              border: '1px solid #ffffff22',
              color: '#fff',
              borderRadius: base * 0.03,
              padding: base * 0.03,
              fontFamily: FUENTE,
              fontWeight: 700,
              fontSize: base * 0.036,
              lineHeight: 1.3,
              opacity: interpolar(frame, [8, 18], [0, 1], limitado),
            }}
          >
            💡 {p.explicacion}
          </div>
        )}
      </div>
    </Capa>
  )
}
