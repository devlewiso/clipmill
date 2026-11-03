// Efectos visuales y de texto. Implementación propia de Fotograma.
import { useId, type CSSProperties, type ReactNode } from 'react'
import { aleatorio } from '../nucleo/aleatorio'
import { Capa } from '../nucleo/estructura'
import { useFrame, useVideo } from '../nucleo/contexto'
import { Curvas } from '../nucleo/curvas'
import { interpolar } from '../nucleo/interpolar'
import { resorte, type ConfigResorte } from '../nucleo/resorte'
import { noise2D } from '../terceros/ruido'
import { createTikTokStyleCaptions, type Caption } from '../terceros/subtitulos'

const limitado = { extrapolarIzquierda: 'limitar', extrapolarDerecha: 'limitar' } as const

// ───────── Capas de textura ─────────

// Grano de película: una textura de ruido que se genera una sola vez y se desplaza en cada frame
// (mucho más rápido que un filtro SVG a pantalla completa).
let texturaGrano: string | null = null
const textura = () => {
  if (texturaGrano || typeof document === 'undefined') return texturaGrano
  const c = document.createElement('canvas')
  c.width = c.height = 256
  const ctx = c.getContext('2d')!
  const img = ctx.createImageData(256, 256)
  for (let k = 0; k < img.data.length; k += 4) {
    const v = Math.floor(aleatorio('grano-' + k) * 255)
    img.data[k] = img.data[k + 1] = img.data[k + 2] = v
    img.data[k + 3] = 255
  }
  ctx.putImageData(img, 0, 0)
  texturaGrano = c.toDataURL('image/png')
  return texturaGrano
}

// `cada`: cada cuántos frames cambia el ruido (2 = aspecto de película y video mucho más liviano).
export const Grano = ({ intensidad = 0.18, tamano = 1, cada = 2 }: { intensidad?: number; tamano?: number; cada?: number }) => {
  const frame = Math.floor(useFrame() / Math.max(1, cada))
  const x = Math.floor(aleatorio('gx' + frame) * 256)
  const y = Math.floor(aleatorio('gy' + frame) * 256)
  return (
    <Capa
      style={{
        pointerEvents: 'none',
        mixBlendMode: 'overlay',
        opacity: intensidad,
        backgroundImage: `url(${textura()})`,
        backgroundSize: `${256 * tamano}px ${256 * tamano}px`,
        backgroundPosition: `${x}px ${y}px`,
        imageRendering: 'pixelated',
      }}
    />
  )
}

export const Vineta = ({ fuerza = 0.65, color = '0,0,0' }: { fuerza?: number; color?: string }) => (
  <Capa style={{ pointerEvents: 'none', background: `radial-gradient(ellipse at center, transparent 45%, rgba(${color},${fuerza}) 100%)` }} />
)

// Líneas de escaneo tipo monitor CRT.
export const Escaneo = ({ opacidad = 0.12, separacion = 4, mover = true }: { opacidad?: number; separacion?: number; mover?: boolean }) => {
  const frame = useFrame()
  return (
    <Capa
      style={{
        pointerEvents: 'none',
        opacity: opacidad,
        backgroundImage: `repeating-linear-gradient(0deg, #000 0 1px, transparent 1px ${separacion}px)`,
        backgroundPositionY: mover ? frame % separacion : 0,
      }}
    />
  )
}

// Parpadeo de luz irregular (proyector viejo, neón).
export const Parpadeo = ({ children, fuerza = 0.25, semilla = 'parpadeo' }: { children?: ReactNode; fuerza?: number; semilla?: string }) => {
  const frame = useFrame()
  return <Capa style={{ opacity: 1 - aleatorio(`${semilla}-${frame}`) * fuerza }}>{children}</Capa>
}

// ───────── Distorsiones ─────────

// Separa los canales rojo y azul, como un lente barato o una señal dañada.
export const AberracionCromatica = ({ children, desplazamiento = 4 }: { children?: ReactNode; desplazamiento?: number }) => {
  const id = useId().replace(/:/g, '')
  const d = desplazamiento
  return (
    <Capa>
      <svg width="0" height="0" style={{ position: 'absolute' }}>
        <filter id={`aberracion${id}`} colorInterpolationFilters="sRGB">
          <feColorMatrix in="SourceGraphic" type="matrix" values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" result="r" />
          <feOffset in="r" dx={-d} dy={0} result="r2" />
          <feColorMatrix in="SourceGraphic" type="matrix" values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0" result="g" />
          <feColorMatrix in="SourceGraphic" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0" result="b" />
          <feOffset in="b" dx={d} dy={0} result="b2" />
          <feBlend in="r2" in2="g" mode="screen" result="rg" />
          <feBlend in="rg" in2="b2" mode="screen" />
        </filter>
      </svg>
      <Capa style={{ filter: `url(#aberracion${id})` }}>{children}</Capa>
    </Capa>
  )
}

// Glitch digital: en frames sueltos corta la imagen en franjas desplazadas.
export const Glitch = ({
  children,
  frecuencia = 0.15,
  intensidad = 40,
  franjas = 6,
  semilla = 'glitch',
}: {
  children?: ReactNode
  frecuencia?: number // probabilidad de glitch en cada frame (0-1)
  intensidad?: number // desplazamiento máximo en px
  franjas?: number
  semilla?: string
}) => {
  const frame = useFrame()
  const activo = aleatorio(`${semilla}-activo-${frame}`) < frecuencia
  if (!activo) return <Capa>{children}</Capa>
  const cortes = Array.from({ length: franjas }, (_, i) => {
    const y = aleatorio(`${semilla}-y-${frame}-${i}`) * 100
    const alto = 2 + aleatorio(`${semilla}-h-${frame}-${i}`) * 12
    const dx = (aleatorio(`${semilla}-x-${frame}-${i}`) - 0.5) * 2 * intensidad
    return { y, alto, dx }
  })
  return (
    <Capa>
      <AberracionCromatica desplazamiento={intensidad / 6}>{children}</AberracionCromatica>
      {cortes.map((c, i) => (
        <Capa key={i} style={{ clipPath: `inset(${c.y}% 0 ${Math.max(0, 100 - c.y - c.alto)}% 0)`, transform: `translateX(${c.dx}px)` }}>
          {children}
        </Capa>
      ))}
    </Capa>
  )
}

// Cámara en mano / temblor, con ruido suave (no saltos aleatorios).
export const Sacudida = ({
  children,
  fuerza = 12,
  rotacion = 1.2,
  velocidad = 0.04,
  semilla = 'sacudida',
}: {
  children?: ReactNode
  fuerza?: number
  rotacion?: number
  velocidad?: number
  semilla?: string
}) => {
  const frame = useFrame()
  const x = noise2D(semilla + 'x', frame * velocidad, 0) * fuerza
  const y = noise2D(semilla + 'y', 0, frame * velocidad) * fuerza
  const r = noise2D(semilla + 'r', frame * velocidad, frame * velocidad) * rotacion
  return <Capa style={{ transform: `translate(${x}px, ${y}px) rotate(${r}deg) scale(1.04)` }}>{children}</Capa>
}

// Acercamiento lento sobre una imagen (efecto Ken Burns).
export const KenBurns = ({
  children,
  desde = 1,
  hasta = 1.2,
  origen = '50% 50%',
  desplazar = [0, 0],
}: {
  children?: ReactNode
  desde?: number
  hasta?: number
  origen?: string
  desplazar?: [number, number] // % a moverse durante la escena
}) => {
  const frame = useFrame()
  const { duracion } = useVideo()
  const p = interpolar(frame, [0, duracion], [0, 1], limitado)
  const s = desde + (hasta - desde) * p
  return (
    <Capa style={{ transformOrigin: origen, transform: `scale(${s}) translate(${desplazar[0] * p}%, ${desplazar[1] * p}%)` }}>
      {children}
    </Capa>
  )
}

// ───────── Entradas ─────────

export const Aparecer = ({
  children,
  retraso = 0,
  duracion = 20,
  desde = 'abajo',
  distancia = 60,
  style,
}: {
  children?: ReactNode
  retraso?: number
  duracion?: number
  desde?: 'abajo' | 'arriba' | 'izquierda' | 'derecha' | 'ninguno'
  distancia?: number
  style?: CSSProperties
}) => {
  const frame = useFrame()
  const p = interpolar(frame - retraso, [0, duracion], [0, 1], { ...limitado, curva: Curvas.suaveSalida })
  const d = (1 - p) * distancia
  const t = { abajo: `0, ${d}px`, arriba: `0, ${-d}px`, izquierda: `${-d}px, 0`, derecha: `${d}px, 0`, ninguno: '0, 0' }[desde]
  return <div style={{ opacity: p, transform: `translate(${t})`, ...style }}>{children}</div>
}

// ───────── Texto ─────────

export const MaquinaDeEscribir = ({
  texto,
  caracteresPorSegundo = 20,
  retraso = 0,
  cursor = '▍',
  style,
}: {
  texto: string
  caracteresPorSegundo?: number
  retraso?: number
  cursor?: string | null
  style?: CSSProperties
}) => {
  const frame = useFrame()
  const { fps } = useVideo()
  const n = Math.max(0, Math.floor(((frame - retraso) / fps) * caracteresPorSegundo))
  const escribiendo = n < texto.length
  const visible = escribiendo || Math.floor(frame / (fps / 2)) % 2 === 0
  return (
    <span style={{ whiteSpace: 'pre-wrap', ...style }}>
      {texto.slice(0, n)}
      {cursor && <span style={{ opacity: visible ? 1 : 0 }}>{cursor}</span>}
    </span>
  )
}

// Cada palabra entra con un resorte, una detrás de otra.
export const PalabraPorPalabra = ({
  texto,
  separacion = 4,
  retraso = 0,
  config = { amortiguacion: 14, rigidez: 180 },
  style,
  estiloPalabra,
}: {
  texto: string
  separacion?: number // frames entre palabras
  retraso?: number
  config?: ConfigResorte
  style?: CSSProperties
  estiloPalabra?: CSSProperties
}) => {
  const frame = useFrame()
  const { fps } = useVideo()
  return (
    <span style={{ display: 'inline-flex', flexWrap: 'wrap', gap: '0 0.28em', justifyContent: 'center', ...style }}>
      {texto.split(/\s+/).filter(Boolean).map((p, i) => {
        const s = resorte({ frame: frame - retraso - i * separacion, fps, config })
        return (
          <span key={i} style={{ display: 'inline-block', opacity: Math.min(1, s * 1.5), transform: `translateY(${(1 - s) * 40}%) scale(${0.7 + 0.3 * s})`, ...estiloPalabra }}>
            {p}
          </span>
        )
      })}
    </span>
  )
}

// Número que cuenta hasta un valor (ideal para estadísticas).
export const NumeroAnimado = ({
  hasta,
  desde = 0,
  duracion = 45,
  retraso = 0,
  decimales = 0,
  prefijo = '',
  sufijo = '',
  separadorMiles = ',',
  style,
}: {
  hasta: number
  desde?: number
  duracion?: number
  retraso?: number
  decimales?: number
  prefijo?: string
  sufijo?: string
  separadorMiles?: string
  style?: CSSProperties
}) => {
  const frame = useFrame()
  const v = interpolar(frame - retraso, [0, duracion], [desde, hasta], { ...limitado, curva: Curvas.salida(Curvas.cubica) })
  const [ent, dec] = v.toFixed(decimales).split('.')
  const conMiles = ent.replace(/\B(?=(\d{3})+(?!\d))/g, separadorMiles)
  return (
    <span style={{ fontVariantNumeric: 'tabular-nums', ...style }}>
      {prefijo}
      {conMiles}
      {dec ? '.' + dec : ''}
      {sufijo}
    </span>
  )
}

// ───────── Subtítulos ─────────

// Subtítulos estilo TikTok: páginas de pocas palabras y la palabra que suena resaltada.
export const Subtitulos = ({
  subtitulos,
  combinarMenosDeMs = 1200,
  color = '#fff',
  resaltado = '#ffd400',
  style,
}: {
  subtitulos: Caption[]
  combinarMenosDeMs?: number
  color?: string
  resaltado?: string
  style?: CSSProperties
}) => {
  const frame = useFrame()
  const { fps } = useVideo()
  const ms = (frame / fps) * 1000
  const { pages } = createTikTokStyleCaptions({ captions: subtitulos, combineTokensWithinMilliseconds: combinarMenosDeMs })
  const pagina = pages.find((p, i) => ms >= p.startMs && ms < (pages[i + 1]?.startMs ?? p.startMs + p.durationMs))
  if (!pagina) return null
  return (
    <div style={{ textAlign: 'center', whiteSpace: 'pre-wrap', color, ...style }}>
      {pagina.tokens.map((t, i) => (
        <span key={i} style={{ color: ms >= t.fromMs && ms < t.toMs ? resaltado : color }}>
          {t.text}
        </span>
      ))}
    </div>
  )
}
