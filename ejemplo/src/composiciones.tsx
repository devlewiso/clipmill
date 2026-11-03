import { Audio, Capa, Curvas, definirComposicion, interpolar, interpolarColor, resorte, Secuencia, useFrame, useVideo } from 'fotograma'
import { Circulo, Estrella, TrazoAnimado, Corazon } from 'fotograma/formas'
import { Aparecer, Glitch, Grano, KenBurns, MaquinaDeEscribir, NumeroAnimado, PalabraPorPalabra, Sacudida, Vineta, Escaneo, Subtitulos } from 'fotograma/fx'
import { Efectos, SerieTransiciones, tiempoLineal, tiempoResorte, type Efecto } from 'fotograma/transiciones'


// ───────── Título animado (3 formatos) ─────────
type PropsTitulo = { titulo: string; subtitulo: string; color: string }

const Titulo = ({ titulo, subtitulo, color }: PropsTitulo) => {
  const frame = useFrame()
  const { fps, ancho, alto } = useVideo()
  const base = Math.min(ancho, alto)
  const entrada = resorte({ frame, fps, config: { amortiguacion: 200 } })
  return (
    <Capa style={{ alignItems: 'center', justifyContent: 'center', background: '#0b0b0f', fontFamily: 'system-ui, sans-serif', textAlign: 'center', padding: base * 0.08 }}>
      <h1 style={{ margin: 0, color, fontSize: base * 0.11, fontWeight: 900, textTransform: 'uppercase', lineHeight: 1, opacity: entrada, transform: `translateY(${(1 - entrada) * 60}px)` }}>
        {titulo}
      </h1>
      <Aparecer retraso={18}>
        <p style={{ color: '#fffc', fontSize: base * 0.04, marginTop: base * 0.03 }}>{subtitulo}</p>
      </Aparecer>
    </Capa>
  )
}

const propsTitulo: PropsTitulo = { titulo: 'Clipmill', subtitulo: 'Videos con React, hechos en casa', color: '#f5b83d' }

// ───────── Demo de transiciones ─────────
const colores = ['#e63946', '#f4a261', '#2a9d8f', '#457b9d', '#8338ec', '#ff006e', '#06d6a0', '#118ab2', '#ef476f', '#ffd166', '#073b4c', '#3a86ff', '#fb5607']
const nombres = Object.keys(Efectos) as (keyof typeof Efectos)[]

const Tarjeta = ({ texto, color }: { texto: string; color: string }) => (
  <Capa style={{ background: color, alignItems: 'center', justifyContent: 'center', color: '#fff', fontFamily: 'system-ui', fontWeight: 900, fontSize: 120, textTransform: 'uppercase' }}>
    {texto}
  </Capa>
)

const efecto = (n: keyof typeof Efectos): Efecto => (Efectos[n] as () => Efecto)()

const DemoTransiciones = () => (
  <SerieTransiciones>
    {nombres.flatMap((n, i) => [
      <SerieTransiciones.Tramo key={'t' + i} duracion={45}>
        <Tarjeta texto={i === 0 ? 'inicio' : nombres[i - 1]} color={colores[i]} />
      </SerieTransiciones.Tramo>,
      <SerieTransiciones.Transicion key={'x' + i} efecto={efecto(n)} tiempo={i % 2 ? tiempoResorte(30, { amortiguacion: 200 }, 20) : tiempoLineal(20)} />,
    ])}
    <SerieTransiciones.Tramo duracion={45}>
      <Tarjeta texto={nombres[nombres.length - 1]} color={colores[nombres.length]} />
    </SerieTransiciones.Tramo>
  </SerieTransiciones>
)

// ───────── Demo de efectos ─────────
const DemoFx = () => {
  const frame = useFrame()
  const fondo = interpolarColor(frame, [0, 150, 300], ['#1d1b4b', '#4b1d3f', '#0f3b3a'])
  return (
    <Capa style={{ background: fondo, fontFamily: 'system-ui', color: '#fff' }}>
      <Sacudida fuerza={6}>
        <Capa style={{ alignItems: 'center', justifyContent: 'center', gap: 40 }}>
          <Glitch frecuencia={0.12}>
            <Capa style={{ alignItems: 'center', justifyContent: 'center' }}>
              <PalabraPorPalabra texto="Efectos hechos a mano" style={{ fontSize: 110, fontWeight: 900 }} />
            </Capa>
          </Glitch>
        </Capa>
      </Sacudida>
      <Secuencia desde={40}>
        <Capa style={{ justifyContent: 'flex-end', alignItems: 'center', paddingBottom: 140, fontSize: 48 }}>
          <MaquinaDeEscribir texto="grano · viñeta · glitch · escaneo · sacudida" />
        </Capa>
      </Secuencia>
      <Secuencia desde={90}>
        <Capa style={{ alignItems: 'flex-end', justifyContent: 'flex-start', padding: 60, fontSize: 90, fontWeight: 800 }}>
          <NumeroAnimado hasta={128450} prefijo="+" sufijo=" vistas" />
        </Capa>
      </Secuencia>
      <Escaneo />
      <Vineta />
      <Grano />
      <Audio src="/tono.mp3" volumen={0.3} />
    </Capa>
  )
}

// ───────── Demo de formas y subtítulos ─────────
const onda = 'M 40 300 C 200 50, 400 550, 560 300 S 900 50, 1040 300 S 1400 550, 1560 300 S 1800 100, 1880 300'

const DemoFormas = () => {
  const frame = useFrame()
  const { fps } = useVideo()
  const s = resorte({ frame, fps, config: { rigidez: 120, amortiguacion: 9 } })
  return (
    <Capa style={{ background: '#101418', alignItems: 'center', justifyContent: 'center', gap: 40 }}>
      <div style={{ display: 'flex', gap: 80, alignItems: 'center', transform: `scale(${s})` }}>
        <Circulo radius={90} fill="#2a9d8f" />
        <Estrella points={5} innerRadius={50} outerRadius={110} fill="#ffd166" style={{ transformOrigin: 'center', transformBox: 'fill-box', transform: `rotate(${frame * 2}deg)` }} />
        <Corazon height={180} fill="#ef476f" />
      </div>
      <div style={{ color: '#06d6a0' }}>
        <TrazoAnimado d={onda} ancho={1920} alto={600} progreso={interpolar(frame, [20, 110], [0, 1], { extrapolarIzquierda: 'limitar', extrapolarDerecha: 'limitar', curva: Curvas.suaveEntradaSalida })} strokeWidth={10} />
      </div>
      <Capa style={{ justifyContent: 'flex-end', alignItems: 'center', paddingBottom: 60, fontSize: 64, fontWeight: 800, fontFamily: 'system-ui' }}>
        <Subtitulos
          subtitulos={[
            { text: 'Subtítulos', startMs: 0, endMs: 700, timestampMs: 350, confidence: 1 },
            { text: ' palabra', startMs: 700, endMs: 1300, timestampMs: 1000, confidence: 1 },
            { text: ' por', startMs: 1300, endMs: 1700, timestampMs: 1500, confidence: 1 },
            { text: ' palabra', startMs: 1700, endMs: 2400, timestampMs: 2050, confidence: 1 },
            { text: ' estilo', startMs: 2600, endMs: 3100, timestampMs: 2850, confidence: 1 },
            { text: ' TikTok', startMs: 3100, endMs: 4000, timestampMs: 3550, confidence: 1 },
          ]}
        />
      </Capa>
    </Capa>
  )
}

// Composiciones de ejemplo: cada una aparece en el estudio (npx fotograma estudio) y se renderiza con npx fotograma render <id>.
export default [
  definirComposicion({ id: 'Titulo-Vertical', carpeta: 'Título', ejemplo: true, componente: Titulo, props: propsTitulo, ancho: 1080, alto: 1920, fps: 30, duracion: 120 }),
  definirComposicion({ id: 'Titulo-Horizontal', carpeta: 'Título', ejemplo: true, componente: Titulo, props: propsTitulo, ancho: 1920, alto: 1080, fps: 30, duracion: 120 }),
  definirComposicion({ id: 'Titulo-Cuadrado', carpeta: 'Título', ejemplo: true, componente: Titulo, props: propsTitulo, ancho: 1080, alto: 1080, fps: 30, duracion: 120 }),
  definirComposicion({ id: 'Transiciones', carpeta: 'Demos', ejemplo: true, componente: DemoTransiciones, ancho: 1920, alto: 1080, fps: 30, duracion: 45 * (nombres.length + 1) - 20 * nombres.length }),
  definirComposicion({ id: 'Efectos', carpeta: 'Demos', ejemplo: true, componente: DemoFx, ancho: 1920, alto: 1080, fps: 30, duracion: 300 }),
  definirComposicion({ id: 'Formas', carpeta: 'Demos', ejemplo: true, componente: DemoFormas, ancho: 1920, alto: 1080, fps: 30, duracion: 150 }),
]
