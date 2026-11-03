// Voz con ElevenLabs: genera el audio de cada línea y los tiempos de cada palabra
// (endpoint /with-timestamps), que después mueven los subtítulos y el "pulso" del personaje.
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Palabra } from '../src/guion/tipos'

const API = 'https://api.elevenlabs.io/v1'

export const llaveElevenLabs = () => {
  if (process.env.ELEVENLABS_API_KEY) return process.env.ELEVENLABS_API_KEY
  for (const p of [join(homedir(), '.config', 'fotograma', 'elevenlabs'), join(homedir(), '.config', 'elevenlabs', 'api_key')])
    if (existsSync(p)) return readFileSync(p, 'utf8').trim()
  throw new Error('Falta la llave de ElevenLabs: define ELEVENLABS_API_KEY o guárdala en ~/.config/fotograma/elevenlabs.')
}

export type Voz = { id: string; nombre: string; categoria: string; genero?: string; acento?: string; muestra?: string; usable: boolean }

let cacheVoces: { t: number; voces: Voz[] } | null = null

export const listarVoces = async (): Promise<Voz[]> => {
  if (cacheVoces && Date.now() - cacheVoces.t < 10 * 60_000) return cacheVoces.voces
  const res = await fetch(`${API}/voices`, { headers: { 'xi-api-key': llaveElevenLabs() } })
  if (!res.ok) throw new Error(`ElevenLabs ${res.status} al listar voces.`)
  const d: any = await res.json()
  const voces: Voz[] = (d.voices || []).map((v: any) => ({
    id: v.voice_id,
    nombre: v.name,
    categoria: v.category,
    genero: v.labels?.gender,
    acento: v.labels?.accent,
    muestra: v.preview_url,
    // El plan gratis solo permite voces "premade" por la API.
    usable: v.category === 'premade' || v.category === 'cloned' || v.category === 'generated',
  }))
  cacheVoces = { t: Date.now(), voces }
  return voces
}

// Agrupa los tiempos por carácter en palabras.
const aPalabras = (a: { characters: string[]; character_start_times_seconds: number[]; character_end_times_seconds: number[] }): Palabra[] => {
  const palabras: Palabra[] = []
  let actual: Palabra | null = null
  a.characters.forEach((c, i) => {
    if (/\s/.test(c)) {
      if (actual) palabras.push(actual)
      actual = null
      return
    }
    const ini = Math.round(a.character_start_times_seconds[i] * 1000)
    const fin = Math.round(a.character_end_times_seconds[i] * 1000)
    if (!actual) actual = { texto: c, inicioMs: ini, finMs: fin }
    else {
      actual.texto += c
      actual.finMs = fin
    }
  })
  if (actual) palabras.push(actual)
  return palabras
}

export const generarVoz = async (o: { texto: string; voz: string; modelo?: string; idioma?: string; senal?: AbortSignal }) => {
  const res = await fetch(`${API}/text-to-speech/${encodeURIComponent(o.voz)}/with-timestamps?output_format=mp3_44100_128`, {
    method: 'POST',
    headers: { 'xi-api-key': llaveElevenLabs(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: o.texto, model_id: o.modelo || 'eleven_multilingual_v2', language_code: o.idioma || undefined }),
    signal: o.senal,
  })
  if (!res.ok) {
    const t = await res.text()
    const detalle = (() => {
      try {
        const d = JSON.parse(t).detail
        return typeof d === 'string' ? d : d?.message || t
      } catch {
        return t
      }
    })()
    throw new Error(`ElevenLabs ${res.status}: ${String(detalle).slice(0, 300)}`)
  }
  const d: any = await res.json()
  const audio = Buffer.from(d.audio_base64, 'base64')
  const palabras = d.alignment ? aPalabras(d.alignment) : []
  const finAlineado = d.alignment?.character_end_times_seconds?.at(-1) ?? 0
  return { audio, palabras, duracionMs: Math.round(finAlineado * 1000) + 120 }
}

// ───────── Voz con Kie (Gemini 2.5 Pro TTS) ─────────
// ~0.009 USD por narración de Short. Devuelve solo el audio: los tiempos de cada palabra se estiman
// repartiendo la parte hablada (sin silencios de inicio y fin) según el largo de cada palabra y las pausas.

// Voces de Gemini TTS (todas hablan cualquier idioma; el acento sale del texto y de las instrucciones).
export const VOCES_GEMINI: { id: string; descripcion: string; genero: 'masculina' | 'femenina' }[] = [
  { id: 'Charon', descripcion: 'informativa, grave', genero: 'masculina' },
  { id: 'Iapetus', descripcion: 'clara', genero: 'masculina' },
  { id: 'Orus', descripcion: 'firme', genero: 'masculina' },
  { id: 'Fenrir', descripcion: 'enérgica', genero: 'masculina' },
  { id: 'Puck', descripcion: 'animada', genero: 'masculina' },
  { id: 'Enceladus', descripcion: 'susurrante, documental', genero: 'masculina' },
  { id: 'Algieba', descripcion: 'suave', genero: 'masculina' },
  { id: 'Alnilam', descripcion: 'firme', genero: 'masculina' },
  { id: 'Schedar', descripcion: 'pareja', genero: 'masculina' },
  { id: 'Sadaltager', descripcion: 'conocedora', genero: 'masculina' },
  { id: 'Kore', descripcion: 'firme', genero: 'femenina' },
  { id: 'Aoede', descripcion: 'ligera', genero: 'femenina' },
  { id: 'Leda', descripcion: 'juvenil', genero: 'femenina' },
  { id: 'Zephyr', descripcion: 'brillante', genero: 'femenina' },
  { id: 'Autonoe', descripcion: 'brillante', genero: 'femenina' },
  { id: 'Despina', descripcion: 'suave', genero: 'femenina' },
  { id: 'Erinome', descripcion: 'clara', genero: 'femenina' },
  { id: 'Laomedeia', descripcion: 'animada', genero: 'femenina' },
  { id: 'Achernar', descripcion: 'suave', genero: 'femenina' },
  { id: 'Sulafat', descripcion: 'cálida', genero: 'femenina' },
]

export const llaveKie = () => {
  if (process.env.KIE_API_KEY) return process.env.KIE_API_KEY
  const p = join(homedir(), '.config', 'kie', 'api_key')
  if (existsSync(p)) return readFileSync(p, 'utf8').trim()
  throw new Error('Falta la llave de Kie (~/.config/kie/api_key).')
}

// Inicio y fin de la parte hablada (ffmpeg silencedetect), en ms.
const zonaHablada = async (archivo: string, duracionMs: number) => {
  const { execFile } = await import('node:child_process')
  const salida = await new Promise<string>((ok) =>
    execFile('ffmpeg', ['-hide_banner', '-i', archivo, '-af', 'silencedetect=noise=-38dB:d=0.12', '-f', 'null', '-'], (_e, _o, err) => ok(String(err))),
  )
  const finSilencios = [...salida.matchAll(/silence_end: ([\d.]+)/g)].map((m) => +m[1] * 1000)
  const inicioSilencios = [...salida.matchAll(/silence_start: ([\d.]+)/g)].map((m) => +m[1] * 1000)
  const inicio = inicioSilencios[0] !== undefined && inicioSilencios[0] < 50 && finSilencios[0] !== undefined ? finSilencios[0] : 0
  const ultimoInicio = inicioSilencios[inicioSilencios.length - 1]
  const fin = ultimoInicio !== undefined && ultimoInicio > inicio && duracionMs - ultimoInicio < 1500 ? ultimoInicio : duracionMs
  return { inicio, fin }
}

// Reparte [inicio, fin] entre las palabras: peso = letras + pausa por puntuación.
export const estimarPalabras = (texto: string, inicio: number, fin: number): Palabra[] => {
  const palabras = texto.split(/\s+/).filter(Boolean)
  const pausa = (w: string) => (/[.!?…]["»”)]?$/.test(w) ? 6 : /[,;:—–]$/.test(w) ? 3 : 0)
  const pesos = palabras.map((w) => w.replace(/[^\p{L}\p{N}]/gu, '').length + 1.5)
  const total = palabras.reduce((n, w, i) => n + pesos[i] + (i < palabras.length - 1 ? pausa(w) : 0), 0) || 1
  const ms = (fin - inicio) / total
  let t = inicio
  return palabras.map((w, i) => {
    const p: Palabra = { texto: w, inicioMs: Math.round(t), finMs: Math.round(t + pesos[i] * ms) }
    t += (pesos[i] + (i < palabras.length - 1 ? pausa(w) : 0)) * ms
    return p
  })
}

export const generarVozKie = async (o: { texto: string; voz: string; idioma?: string; escena?: string; contexto?: string; senal?: AbortSignal; destinoMp3: string }) => {
  const H = { Authorization: 'Bearer ' + llaveKie(), 'Content-Type': 'application/json' }
  const ingles = (o.idioma || 'es').startsWith('en')
  const crear: any = await fetch('https://api.kie.ai/api/v1/jobs/createTask', {
    method: 'POST',
    headers: H,
    signal: o.senal,
    body: JSON.stringify({
      model: 'google/gemini-2-5-pro-tts',
      input: {
        temperature: 1,
        scene: o.escena || (ingles ? 'Clear, engaging narration for a YouTube Shorts channel, recorded in a quiet studio.' : 'Narración clara y entusiasta para un canal de YouTube Shorts, grabada en un estudio silencioso.'),
        sample_context: o.contexto || (ingles ? 'A narrator tells a surprising fact to curious viewers.' : 'Un narrador latinoamericano cuenta un dato sorprendente a una audiencia curiosa.'),
        speakers: [{ speaker_id: 'Speaker 1', voice_name: o.voz || 'Charon', audio_profile: ingles ? 'A confident, warm narrator' : 'Narrador seguro y cálido', style: 'Empathetic', pace: 'Natural', accent: 'Neutral' }],
        dialogue_turns: [{ speaker_id: 'Speaker 1', text: o.texto }],
      },
    }),
  }).then((r) => r.json())
  const taskId = crear?.data?.taskId
  if (!taskId) throw new Error(`Kie no creó la voz: ${crear?.msg || JSON.stringify(crear).slice(0, 200)}`)
  let url = ''
  for (let i = 0; i < 100; i++) {
    await new Promise((r) => setTimeout(r, 3000))
    const d: any = (await fetch(`https://api.kie.ai/api/v1/jobs/recordInfo?taskId=${taskId}`, { headers: H, signal: o.senal }).then((r) => r.json()))?.data || {}
    if (d.state === 'success') {
      url = (typeof d.resultJson === 'string' ? JSON.parse(d.resultJson) : d.resultJson)?.resultUrls?.[0]
      break
    }
    if (d.state === 'fail') throw new Error(`Kie (voz) falló: ${d.failMsg || d.failCode}`)
  }
  if (!url) throw new Error('La voz de Kie tardó demasiado.')
  const wav = Buffer.from(await (await fetch(url, { signal: o.senal })).arrayBuffer())
  const { writeFileSync, unlinkSync } = await import('node:fs')
  const { execFile } = await import('node:child_process')
  const tmpWav = o.destinoMp3.replace(/\.mp3$/, '') + '.wav'
  writeFileSync(tmpWav, wav)
  await new Promise<void>((ok, mal) => execFile('ffmpeg', ['-v', 'error', '-y', '-i', tmpWav, '-c:a', 'libmp3lame', '-b:a', '128k', o.destinoMp3], (e) => (e ? mal(e) : ok())))
  unlinkSync(tmpWav)
  const dur = await new Promise<number>((ok) =>
    execFile('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', o.destinoMp3], (_e, out) => ok(Math.round(parseFloat(String(out)) * 1000) || 0)),
  )
  const { inicio, fin } = await zonaHablada(o.destinoMp3, dur)
  return { duracionMs: dur, palabras: estimarPalabras(o.texto, inicio, fin) }
}
