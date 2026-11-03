import type { CSSProperties, ReactNode } from 'react'
import { Capa, Congelar, Secuencia } from '../nucleo/estructura'
import { definirComposicion, useFrame, useVideo, type Composicion } from '../nucleo/contexto'
import { Audio, Imagen, Video } from '../nucleo/medios'
import { interpolar } from '../nucleo/interpolar'
import { resorte } from '../nucleo/resorte'
import { Curvas } from '../nucleo/curvas'
import { Grano, KenBurns, PalabraPorPalabra, Vineta } from '../fx'
import { Efectos, type Efecto } from '../transiciones'
import { Color } from '../color'
import { createTikTokStyleCaptions } from '../terceros/subtitulos'
import { duracionEstimadaMs } from './parsear'
import { MEDIDAS, type Guion, type LineaGuion, type Personaje } from './tipos'
import { TomaQuiz } from './quiz'
import { extraQuizMs } from './quizTexto'
import { TomaCartas } from './cartas'
import { extraCartasMs } from './cartasTexto'

const PORTADA_S = 1.6
const COLA_S = 0.6

export type Toma = { linea: LineaGuion; desde: number; duracion: number }

// Reparte las líneas en el tiempo según la duración real de cada audio.
export const tomasDe = (g: Guion) => {
  const fps = g.fps
  let cursor = g.portada ? Math.round(PORTADA_S * fps) : 0
  const tomas: Toma[] = g.lineas.map((linea, i) => {
    // En quiz, después de cada pregunta corre la cuenta regresiva.
    const ms = (linea.duracionMs ?? duracionEstimadaMs(linea.texto)) + g.pausaMs + (linea.pausaDespuesMs ?? 0) + extraQuizMs(g, i) + extraCartasMs(g, i)
    const t = { linea, desde: cursor, duracion: Math.max(1, Math.round((ms / 1000) * fps)) }
    cursor += t.duracion
    return t
  })
  return { tomas, total: cursor + Math.round(COLA_S * fps) }
}

const limitado = { extrapolarIzquierda: 'limitar', extrapolarDerecha: 'limitar' } as const

// Avatar: la imagen del personaje o sus iniciales en su color.
const Avatar = ({ p, tam, estilo }: { p: Personaje; tam: number; estilo?: CSSProperties }) => (
  <div
    style={{
      width: tam,
      height: tam,
      borderRadius: '50%',
      overflow: 'hidden',
      flexShrink: 0,
      boxShadow: `0 0 0 ${Math.max(4, tam * 0.035)}px ${p.color}, 0 ${tam * 0.08}px ${tam * 0.25}px #0008`,
      background: p.color,
      display: 'grid',
      placeItems: 'center',
      ...estilo,
    }}
  >
    {p.imagen ? (
      <Imagen src={p.imagen} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
    ) : (
      <span style={{ color: '#fff', fontWeight: 900, fontSize: tam * 0.38, fontFamily: 'system-ui, sans-serif' }}>
        {p.nombre
          .split(/\s+/)
          .map((x) => x[0])
          .join('')
          .slice(0, 2)
          .toUpperCase()}
      </span>
    )}
  </div>
)

// Una toma: el que habla al frente, el resto atrás, nombre y subtítulos.
const Toma = ({ g, linea, duracion }: { g: Guion; linea: LineaGuion; duracion: number }) => {
  const frame = useFrame()
  const { fps, ancho, alto } = useVideo()
  const base = Math.min(ancho, alto)
  const vertical = alto > ancho
  const ms = (frame / fps) * 1000
  const habla = g.personajes.find((p) => p.id === linea.personaje)
  const otros = g.personajes.filter((p) => p.id !== linea.personaje)

  const entrada = resorte({ frame, fps, config: { amortiguacion: 14, rigidez: 140 } })
  // Pulso con cada palabra: crece un poco al empezar y vuelve.
  const palabra = linea.palabras?.find((w) => ms >= w.inicioMs && ms < w.finMs)
  const pulso = palabra ? interpolar(ms - palabra.inicioMs, [0, 90, 220], [0, 1, 0.3], limitado) : 0
  const salida = interpolar(frame, [duracion - 6, duracion], [1, 0], limitado)

  const narrador = g.modo === 'narrador'
  const tamHabla = base * (vertical ? 0.46 : 0.36)
  const tamOtro = base * 0.13

  const paginas = linea.palabras?.length
    ? createTikTokStyleCaptions({
        captions: linea.palabras.map((w, i) => ({ text: (i ? ' ' : '') + w.texto, startMs: w.inicioMs, endMs: w.finMs, timestampMs: w.inicioMs, confidence: 1 })),
        combineTokensWithinMilliseconds: vertical ? 800 : 1100,
      }).pages
    : []
  const pagina = paginas.find((p, i) => ms >= p.startMs && ms < (paginas[i + 1]?.startMs ?? Infinity))

  return (
    <Capa>
      {linea.audio && <Audio src={linea.audio} />}

      {/* Los demás personajes, pequeños y apagados */}
      {!narrador && <div style={{ position: 'absolute', top: base * 0.07, left: 0, right: 0, display: 'flex', justifyContent: 'center', gap: base * 0.04, opacity: 0.45 * salida }}>
        {otros.map((p) => (
          <Avatar key={p.id} p={p} tam={tamOtro} />
        ))}
      </div>}

      {/* El que habla */}
      {habla && !narrador && (
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: vertical ? alto * 0.2 : alto * 0.14,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: base * 0.035,
            opacity: salida,
            transform: `translateY(${(1 - entrada) * base * 0.08}px) scale(${0.85 + 0.15 * entrada + 0.035 * pulso})`,
          }}
        >
          <Avatar p={habla} tam={tamHabla} />
          <div
            style={{
              background: habla.color,
              color: '#fff',
              fontFamily: 'system-ui, sans-serif',
              fontWeight: 800,
              fontSize: base * 0.042,
              padding: `${base * 0.008}px ${base * 0.03}px`,
              borderRadius: 999,
              letterSpacing: '0.02em',
              boxShadow: '0 6px 20px #0006',
            }}
          >
            {habla.nombre}
          </div>
        </div>
      )}

      {/* Subtítulos */}
      {g.subtitulos && (
        <div
          style={{
            position: 'absolute',
            left: base * 0.06,
            right: base * 0.06,
            bottom: narrador ? (vertical ? alto * 0.28 : alto * 0.14) : vertical ? alto * 0.16 : alto * 0.1,
            textAlign: 'center',
            fontFamily: 'system-ui, sans-serif',
            fontWeight: 900,
            fontSize: base * (narrador ? (vertical ? 0.085 : 0.065) : vertical ? 0.072 : 0.058),
            lineHeight: 1.15,
            color: '#fff',
            WebkitTextStroke: `${base * 0.004}px #000`,
            paintOrder: 'stroke fill',
            textShadow: '0 6px 18px #000a',
            opacity: salida,
          }}
        >
          {pagina
            ? pagina.tokens.map((t, i) => (
                <span key={i} style={{ color: ms >= t.fromMs && ms < t.toMs ? (narrador ? '#ffd400' : habla?.color ?? '#ffd400') : '#fff', whiteSpace: 'pre-wrap' }}>
                  {t.text}
                </span>
              ))
            : !linea.palabras?.length && <span>{linea.texto}</span>}
        </div>
      )}
    </Capa>
  )
}

// Movimiento de cámara distinto para cada slide (acercar, alejar y desplazarse en varias direcciones).
const MOVIMIENTOS = [
  { desde: 1.04, hasta: 1.2, x: [0, -3], y: [0, -2] },
  { desde: 1.2, hasta: 1.04, x: [2, -2], y: [0, 0] },
  { desde: 1.06, hasta: 1.18, x: [-3, 2], y: [2, 0] },
  { desde: 1.18, hasta: 1.06, x: [0, 0], y: [-3, 2] },
  { desde: 1.05, hasta: 1.16, x: [3, 0], y: [-1, 1] },
]

const SlideImagen = ({ src, indice, duracion }: { src: string; indice: number; duracion: number }) => {
  const frame = useFrame()
  const m = MOVIMIENTOS[indice % MOVIMIENTOS.length]
  const p = interpolar(frame, [0, Math.max(1, duracion)], [0, 1], { ...limitado, curva: Curvas.suaveEntradaSalida })
  const escala = m.desde + (m.hasta - m.desde) * p
  const x = m.x[0] + (m.x[1] - m.x[0]) * p
  const y = m.y[0] + (m.y[1] - m.y[0]) * p
  return (
    <Capa style={{ transform: `scale(${escala}) translate(${x}%, ${y}%)` }}>
      <Imagen src={src} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
    </Capa>
  )
}

const TRANSICIONES: Record<string, () => Efecto> = {
  fundido: () => Efectos.fundido(),
  zoom: () => Efectos.zoom(1.15),
  deslizar: () => Efectos.deslizar('derecha'),
  empujar: () => Efectos.empujar('derecha'),
  barrido: () => Efectos.barrido('izquierda'),
  desenfoque: () => Efectos.desenfoque(30),
  iris: () => Efectos.iris(),
  destello: () => Efectos.destello(),
}
const VARIADAS = ['fundido', 'zoom', 'desenfoque', 'deslizar', 'barrido', 'fundido', 'iris']

// Aplica la transición de entrada durante los primeros frames del clip.
const Entrada = ({ efecto, duracion, children }: { efecto: Efecto | null; duracion: number; children: ReactNode }) => {
  const frame = useFrame()
  const { ancho, alto } = useVideo()
  if (!efecto || frame >= duracion) return <Capa>{children}</Capa>
  const p = Curvas.suaveEntradaSalida(Math.min(1, frame / duracion))
  return (
    <>
      <Capa style={efecto.estilo(p, 'entrada', { ancho, alto })}>{children}</Capa>
      {efecto.encima && <div style={{ position: 'absolute', inset: 0 }}>{efecto.encima(p)}</div>}
    </>
  )
}

// Dónde va cada clip de fondo (frames). Si hay uno por línea (y ninguno tiene duración propia), cada clip acompaña
// su frase; si no, van uno detrás de otro con su `segundos` y los que no tienen se reparten el resto (el último
// llena hasta el final). Lo usa también el editor de la línea de tiempo del estudio.
export const tramosDeClips = (g: Guion, total: number, tomas: Toma[], fps = g.fps) => {
  const clips = g.clips || []
  const tramos: { desde: number; dur: number }[] = []
  if (clips.length === tomas.length && tomas.length && !clips.some((c) => c.segundos)) {
    tomas.forEach((t, i) => tramos.push({ desde: i === 0 ? 0 : t.desde, dur: i === 0 ? t.desde + t.duracion : i === tomas.length - 1 ? total - t.desde : t.duracion }))
  } else {
    const fijos = clips.reduce((n, c) => n + (c.segundos ? Math.round(c.segundos * fps) : 0), 0)
    const libres = clips.filter((c) => !c.segundos).length
    const cada = libres ? Math.max(1, Math.floor((total - fijos) / libres)) : 0
    let cursor = 0
    clips.forEach((c, i) => {
      const dur = i === clips.length - 1 ? Math.max(1, total - cursor) : c.segundos ? Math.round(c.segundos * fps) : cada
      tramos.push({ desde: cursor, dur })
      cursor += dur
    })
  }
  return tramos
}

// Clips de fondo (videos o imágenes). Entre clips hay una transición superpuesta.
const Clips = ({ g, total, tomas }: { g: Guion; total: number; tomas: Toma[] }) => {
  const { fps } = useVideo()
  const clips = g.clips || []
  const tramos = tramosDeClips(g, total, tomas, fps)
  const T = Math.round(fps * 0.45) // duración de cada transición
  const tipo = g.transicion || 'variada'
  return (
    <>
      {clips.map((c, i) => {
        const { desde, dur } = tramos[i]
        // Cada clip (menos el primero) empieza un poco antes para superponerse con el anterior.
        // Un cuadro congelado entra y sale con corte seco (una transición sobre el mismo video se ve rara).
        const solape = i > 0 && tipo !== 'ninguna' && !c.congelar && !clips[i - 1].congelar ? Math.min(T, Math.floor(tramos[i - 1].dur / 2)) : 0
        const nombre = tipo === 'variada' ? VARIADAS[i % VARIADAS.length] : tipo
        const efecto = solape ? (TRANSICIONES[nombre] ?? TRANSICIONES.fundido)() : null
        const esVideo = /\.(mp4|webm|mov|m4v)(\?|$)/i.test(c.src)
        return (
          <Secuencia key={i} desde={desde - solape} duracion={dur + solape} nombre={`Clip ${i + 1}`}>
            <Entrada efecto={efecto} duracion={solape}>
              <Color look={c.color ?? g.colorClips} intensidad={c.intensidadColor ?? 1}>
                {esVideo && c.congelar ? (
                  <Congelar frame={0}>
                    <Video src={c.src} recorteInicio={c.recorte} silenciado style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  </Congelar>
                ) : esVideo ? (
                  // Con cámara lenta suave lista para este mismo tramo y velocidad, se usa la versión interpolada.
                  c.lento && c.lento.velocidad === c.velocidad && c.lento.desde === (c.recorte ?? 0) ? (
                    <Video src={c.lento.src} velocidad={c.velocidad} silenciado style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : (
                    <Video src={c.src} recorteInicio={c.recorte} velocidad={c.velocidad} silenciado style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  )
                ) : (
                  <SlideImagen src={c.src} indice={i} duracion={dur + solape} />
                )}
              </Color>
            </Entrada>
          </Secuencia>
        )
      })}
      {/* Oscurece un poco abajo para que se lean los subtítulos */}
      <Capa style={{ background: 'linear-gradient(to bottom, #0000 45%, #000a 100%)' }} />
    </>
  )
}

export const ComposicionGuion = ({ guion: g }: { guion: Guion }) => {
  const { tomas, total } = tomasDe(g)
  const { fps, ancho, alto } = useVideo()
  const base = Math.min(ancho, alto)
  const frame = useFrame()
  const portada = Math.round(PORTADA_S * fps)
  return (
    <Capa style={{ background: g.fondo, overflow: 'hidden' }}>
      {g.fondoImagen && (
        <KenBurns hasta={1.12}>
          <Imagen src={g.fondoImagen} style={{ width: '100%', height: '100%', objectFit: 'cover', filter: 'brightness(0.55)' }} />
        </KenBurns>
      )}
      {!!g.clips?.length && <Clips g={g} total={total} tomas={tomas} />}
      {g.vineta && <Vineta fuerza={0.55} />}
      {g.grano && <Grano intensidad={0.08} />}
      {g.musica && <Audio src={g.musica} volumen={g.volumenMusica ?? 0.15} />}
      {g.portada && (
        <Secuencia desde={0} duracion={portada} nombre="Portada">
          <Capa
            style={{
              alignItems: 'center',
              justifyContent: 'center',
              padding: base * 0.08,
              opacity: interpolar(frame, [portada - 8, portada], [1, 0], { ...limitado, curva: Curvas.suaveEntrada }),
            }}
          >
            <PalabraPorPalabra texto={g.titulo} style={{ color: '#fff', fontFamily: 'system-ui, sans-serif', fontWeight: 900, fontSize: base * 0.09, lineHeight: 1.05, textAlign: 'center' }} />
          </Capa>
        </Secuencia>
      )}
      {!!g.textos?.length && <TextosEnPantalla textos={g.textos} />}
      {tomas.map((t, i) => (
        <Secuencia key={t.linea.id} desde={t.desde} duracion={t.duracion} nombre={`${g.modo === 'quiz' || g.modo === 'cartas' ? '' : (g.personajes.find((p) => p.id === t.linea.personaje)?.nombre ?? '?') + ': '}${t.linea.texto.slice(0, 32)}`}>
          {g.modo === 'quiz' && g.quiz ? (
            <TomaQuiz g={g} linea={t.linea} indice={i} />
          ) : g.modo === 'cartas' && g.cartas ? (
            <TomaCartas g={g} linea={t.linea} indice={i} />
          ) : (
            <Toma g={g} linea={t.linea} duracion={t.duracion} />
          )}
        </Secuencia>
      ))}
    </Capa>
  )
}

// Textos y stickers en pantalla (se agregan y mueven desde la línea de tiempo): entran con un «pop» y salen con fundido.
const TextosEnPantalla = ({ textos }: { textos: NonNullable<Guion['textos']> }) => {
  const { fps, ancho, alto } = useVideo()
  return (
    <>
      {textos.map((t) => (
        <Secuencia key={t.id} desde={Math.round(t.desde * fps)} duracion={Math.max(1, Math.round((t.hasta - t.desde) * fps))} nombre={`Texto: ${t.texto.slice(0, 24)}`}>
          <TextoPop t={t} ancho={ancho} alto={alto} />
        </Secuencia>
      ))}
    </>
  )
}

const TextoPop = ({ t, ancho, alto }: { t: NonNullable<Guion['textos']>[number]; ancho: number; alto: number }) => {
  const frame = useFrame()
  const { fps } = useVideo()
  const dur = Math.round((t.hasta - t.desde) * fps)
  const base = Math.min(ancho, alto)
  const entra = resorte({ frame, fps, config: { amortiguacion: 12, rigidez: 180 } })
  const sale = interpolar(frame, [dur - 6, dur], [1, 0], limitado)
  const soloEmoji = /^\p{Extended_Pictographic}[\p{Extended_Pictographic}\u200d\ufe0f ]*$/u.test(t.texto.trim())
  const top = t.posicion === 'arriba' ? alto * 0.12 : t.posicion === 'centro' ? alto * 0.42 : alto * 0.62
  return (
    <div style={{ position: 'absolute', left: 0, right: 0, top, display: 'flex', justifyContent: 'center', opacity: sale, transform: `scale(${0.4 + 0.6 * entra})` }}>
      <div
        style={{
          fontFamily: 'system-ui, sans-serif',
          fontWeight: 900,
          fontSize: base * (t.tamano ?? (soloEmoji ? 0.16 : 0.07)),
          lineHeight: 1.1,
          textAlign: 'center',
          maxWidth: ancho * 0.86,
          color: soloEmoji ? undefined : (t.color ?? '#fff'),
          background: soloEmoji ? undefined : '#000a',
          padding: soloEmoji ? 0 : `${base * 0.012}px ${base * 0.03}px`,
          borderRadius: base * 0.02,
          textShadow: soloEmoji ? '0 10px 30px #0008' : undefined,
        }}
      >
        {t.texto}
      </div>
    </div>
  )
}

// Convierte un guion guardado en una composición más del proyecto.
export const composicionDeGuion = (g: Guion): Composicion => {
  const { total } = tomasDe(g)
  const { ancho, alto } = MEDIDAS[g.formato]
  return definirComposicion({
    id: `Guion-${g.id}`,
    carpeta: 'Guiones',
    descripcion: g.titulo,
    componente: ComposicionGuion,
    props: { guion: g },
    ancho,
    alto,
    fps: g.fps,
    duracion: Math.max(1, total),
    // Si se editan las props, la duración y el tamaño se recalculan.
    calcularMetadatos: ({ guion }) => ({ ...MEDIDAS[guion.formato], fps: guion.fps, duracion: Math.max(1, tomasDe(guion).total) }),
  })
}
