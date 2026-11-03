// Imagen, Video y Audio sincronizados con el frame.
// - En el estudio se reproducen en vivo y se corrigen si se desfasan.
// - En el render el video se posiciona en el tiempo exacto de cada frame y el audio se registra
//   para que el renderer lo mezcle con ffmpeg al final.
import { useContext, useEffect, useLayoutEffect, useRef, type CSSProperties, type ImgHTMLAttributes } from 'react'
import { CtxFrame, CtxModo, CtxTramo, useVideo } from './contexto'
import { continuarCarga, esperarCarga } from './esperas'
import { usePista } from './estructura'

export type PistaAudio = {
  clave: string
  src: string
  inicio: number // frame absoluto en que empieza a sonar
  fin: number // frame absoluto en que se corta
  recorte: number // segundos que se saltan del inicio del archivo
  volumen: number
  velocidad: number
  grupo?: string // p. ej. 'voz', 'musica', 'sfx'
  bajar?: Bajar // ducking: esta pista baja mientras suenan las de `con`
  ruido?: 'suave' | 'normal' | 'fuerte' // quitar el ruido de fondo de la voz en el render
}

// Ducking: la pista baja `db` decibeles mientras suena alguna pista de los grupos `con` ('*' = cualquier otra que no
// baje ella misma), con rampas de `ataque` (antes de que empiece la voz) y `relajacion` (después) en segundos.
export type Bajar = { con: string[]; db: number; ataque: number; relajacion: number }

// Pistas registradas durante el render (el renderer las lee de window.__fotograma).
export const pistas = new Map<string, PistaAudio>()

const absoluta = (src: string) => new URL(src, window.location.href).href

export const Imagen = ({ src, onLoad, onError, ...resto }: ImgHTMLAttributes<HTMLImageElement> & { src: string }) => {
  const ref = useRef<HTMLImageElement>(null)
  useLayoutEffect(() => {
    const img = ref.current
    if (!img || (img.complete && img.naturalWidth)) return
    const id = esperarCarga('imagen ' + src)
    const listo = () => continuarCarga(id)
    img.addEventListener('load', listo, { once: true })
    img.addEventListener('error', listo, { once: true })
    return () => {
      img.removeEventListener('load', listo)
      img.removeEventListener('error', listo)
      continuarCarga(id)
    }
  }, [src])
  return <img ref={ref} src={src} onLoad={onLoad} onError={onError} {...resto} />
}

type PropsMedio = {
  src: string
  volumen?: number
  velocidad?: number
  recorteInicio?: number // segundos que se saltan del inicio del archivo
  silenciado?: boolean
  grupo?: string // a qué grupo pertenece ('voz', 'musica'…) para que otras pistas bajen con él
  bajarCon?: string | string[] // bajar esta pista cuando suena ese grupo (p. ej. <Audio src="musica.mp3" bajarCon="voz" />)
  bajarDb?: number // cuánto baja (dB); -12 por defecto
  bajarAtaque?: number // segundos de rampa antes de la voz (0.15)
  bajarRelajacion?: number // segundos de rampa después (0.45)
  limpiarRuido?: 'suave' | 'normal' | 'fuerte' // quita el ruido de fondo de la voz al renderizar (normal/fuerte = RNNoise)
}

const opcionesBajar = (p: PropsMedio): Bajar | undefined =>
  p.bajarCon ? { con: ([] as string[]).concat(p.bajarCon), db: p.bajarDb ?? -12, ataque: p.bajarAtaque ?? 0.15, relajacion: p.bajarRelajacion ?? 0.45 } : undefined

// Todo lo que suena en la composición (estudio y render), para el ducking de la vista previa.
type Sonando = { clave: string; grupo?: string; inicio: number; fin: number; baja: boolean }
const sonando = new Map<string, Sonando>()
const coincide = (x: Sonando, con: string[]) => (con.includes('*') ? !x.baja : !!x.grupo && con.includes(x.grupo))

// Cuánto bajar en este frame (0–1, con rampas) según las pistas de los grupos `con` que suenan cerca.
const cantidadBajar = (frame: number, fps: number, b: Bajar, propia: string) => {
  let a = 0
  for (const x of sonando.values()) {
    if (x.clave === propia || !coincide(x, b.con)) continue
    if (frame >= x.inicio && frame < x.fin) return 1
    if (frame < x.inicio) a = Math.max(a, 1 - (x.inicio - frame) / Math.max(1, b.ataque * fps))
    else a = Math.max(a, 1 - (frame - x.fin) / Math.max(1, b.relajacion * fps))
  }
  return Math.max(0, a)
}

// Registra la pista para el render, calculando dónde empieza y termina dentro de la composición.
const useRegistrarPista = (p: PropsMedio, tipo: string) => {
  const { src, volumen = 1, velocidad = 1, recorteInicio = 0, silenciado, grupo, limpiarRuido } = p
  const bajar = opcionesBajar(p)
  const claveBajar = JSON.stringify(bajar ?? null)
  const { modo } = useContext(CtxModo)
  const tramo = useContext(CtxTramo)
  const { duracion } = useVideo()
  usePista({ nombre: src.split('/').pop() || tipo, tipo: tipo as 'audio' | 'video', inicio: tramo.inicio, duracion: Math.min(tramo.duracion, duracion - tramo.inicio) })
  const fin = Math.min(tramo.inicio + tramo.duracion, duracion)
  const clave = `${tipo}|${src}|${tramo.inicio}|${recorteInicio}`
  useEffect(() => {
    if (silenciado || volumen <= 0) return
    sonando.set(clave, { clave, grupo, inicio: tramo.inicio, fin, baja: !!bajar })
    return () => void sonando.delete(clave)
  }, [clave, grupo, fin, claveBajar, silenciado, volumen])
  useEffect(() => {
    if (modo !== 'render' || silenciado || volumen <= 0) return
    pistas.set(clave, { clave, src: absoluta(src), inicio: tramo.inicio, fin, recorte: recorteInicio, volumen, velocidad, grupo, bajar, ruido: limpiarRuido })
  }, [modo, src, tramo.inicio, tramo.duracion, duracion, recorteInicio, volumen, velocidad, silenciado, tipo, grupo, claveBajar, limpiarRuido])
  return clave
}

// Mantiene un <video>/<audio> alineado con el frame actual.
const useSincronizar = (ref: React.RefObject<HTMLMediaElement | null>, p: PropsMedio, esVideo: boolean, clave: string) => {
  const { modo, reproduciendo, volumen: volGlobal } = useContext(CtxModo)
  const frameAbs = useContext(CtxFrame)
  const tramo = useContext(CtxTramo)
  const { fps } = useVideo()
  const t = ((frameAbs - tramo.inicio) / fps) * (p.velocidad ?? 1) + (p.recorteInicio ?? 0)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.playbackRate = p.velocidad ?? 1
    if (modo === 'render') {
      if (!esVideo) return
      el.muted = true
      if (Math.abs(el.currentTime - t) < 0.001 && el.readyState >= 2) return
      const id = esperarCarga('video ' + p.src)
      const listo = () => continuarCarga(id)
      // Sin metadatos, pedir t=0 no dispara 'seeked' (ya es la posición inicial): basta con que cargue el frame.
      const cargado = () => {
        if (Math.abs(el.currentTime - t) < 0.001) listo()
      }
      el.addEventListener('seeked', listo, { once: true })
      el.addEventListener('error', listo, { once: true })
      el.addEventListener('loadeddata', cargado)
      el.currentTime = t
      return () => {
        el.removeEventListener('seeked', listo)
        el.removeEventListener('error', listo)
        el.removeEventListener('loadeddata', cargado)
        continuarCarga(id)
      }
    }
    el.muted = !!p.silenciado
    // En el render el ducking lo hace ffmpeg (con la voz real); aquí, una aproximación por las pistas que suenan.
    const b = opcionesBajar(p)
    const ganancia = b ? 10 ** ((b.db * cantidadBajar(frameAbs, fps, b, clave)) / 20) : 1
    el.volume = Math.max(0, Math.min(1, (p.volumen ?? 1) * volGlobal * ganancia))
    if (reproduciendo) {
      // Pasado el final del archivo no hay nada que sincronizar (seguir buscando lo trabaría).
      if (Number.isFinite(el.duration) && t >= el.duration - 0.05) {
        if (!el.paused) el.pause()
        return
      }
      // Saltar (seek) detiene el video mientras carga; si se salta por desfases pequeños, cada salto
      // genera el siguiente y el video avanza a tirones. Solo se salta con desfases grandes (al mover el
      // cabezal); los pequeños se corrigen acelerando o frenando un poco el video.
      const d = el.currentTime - t
      const v = p.velocidad ?? 1
      if (!el.seeking) {
        if (Math.abs(d) > 1) el.currentTime = t
        else el.playbackRate = Math.abs(d) > 0.06 ? v * (d > 0 ? 0.9 : 1.1) : v
      }
      if (el.paused) el.play().catch(() => {})
    } else {
      el.pause()
      if (Math.abs(el.currentTime - t) > 0.01) el.currentTime = t
    }
  })
}

export const Video = ({ style, className, ...p }: PropsMedio & { style?: CSSProperties; className?: string }) => {
  const ref = useRef<HTMLVideoElement>(null)
  const clave = useRegistrarPista(p, 'video')
  useSincronizar(ref, p, true, clave)
  return <video ref={ref} src={p.src} style={style} className={className} playsInline preload="auto" />
}

export const Audio = (p: PropsMedio) => {
  const ref = useRef<HTMLAudioElement>(null)
  const { modo } = useContext(CtxModo)
  const clave = useRegistrarPista(p, 'audio')
  useSincronizar(ref, p, false, clave)
  return modo === 'render' ? null : <audio ref={ref} src={p.src} preload="auto" />
}

// Carga una fuente de Google Fonts (licencias OFL/Apache) y retiene el render hasta que esté lista.
const fuentesCargadas = new Set<string>()
export const cargarFuenteGoogle = (familia: string, pesos: number[] = [400, 700]) => {
  const clave = familia + pesos.join()
  if (fuentesCargadas.has(clave) || typeof document === 'undefined') return familia
  fuentesCargadas.add(clave)
  const id = esperarCarga('fuente ' + familia)
  const link = document.createElement('link')
  link.rel = 'stylesheet'
  link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(familia)}:wght@${pesos.join(';')}&display=block`
  link.onload = () => Promise.all(pesos.map((p) => document.fonts.load(`${p} 32px "${familia}"`))).finally(() => continuarCarga(id))
  link.onerror = () => continuarCarga(id)
  document.head.appendChild(link)
  return familia
}
