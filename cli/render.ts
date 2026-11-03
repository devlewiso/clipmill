// Renderer de Fotograma: abre la composición en Chrome headless, captura cada frame en paralelo
// y arma el video con ffmpeg, mezclando las pistas de audio registradas.
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { cpus, homedir, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import puppeteer, { type Browser, type Page } from 'puppeteer-core'
import { abrirServidor, type OpcionesServidor } from './servidor'

export type Codec = 'h264' | 'vp9' | 'prores' | 'gif' | 'png'

export type InfoComposicion = { id: string; ancho: number; alto: number; fps: number; duracion: number; props?: any; descripcion?: string; carpeta?: string; lufs?: number; ejemplo?: boolean }

export type Progreso = { etapa: 'preparando' | 'capturando' | 'codificando' | 'listo'; hechos: number; total: number; mensaje?: string }

export type OpcionesRender = OpcionesServidor & {
  composicion: string
  salida: string
  props?: Record<string, any>
  codec?: Codec
  frames?: [number, number] // rango inclusivo
  frame?: number // para imágenes fijas (codec png)
  concurrencia?: number
  calidad?: number // CRF (menor = mejor). h264 18 por defecto
  escala?: number // multiplicador de resolución (2 = el doble)
  alProgresar?: (p: Progreso) => void
  senal?: AbortSignal
  servidor?: Awaited<ReturnType<typeof abrirServidor>> // reutilizar uno ya abierto (el estudio)
}

const CHROME = [process.env.FOTOGRAMA_CHROME, '/usr/bin/google-chrome-stable', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find(
  (p) => p && existsSync(p),
)
const FFMPEG = process.env.FOTOGRAMA_FFMPEG || 'ffmpeg'

// Quitar el ruido de fondo de una voz (prop `limpiarRuido` de <Audio>/<Video>, pestaña Limpiar, preparar.py):
// 'suave' = afftdn; 'normal'/'fuerte' = RNNoise (arnndn de ffmpeg, modelo sh.rnnn «voz sobre ruido de grabación»; normal
// al 85 %). Medido en una toma de calle de 92 s a -14 LUFS: pausas -28.7 dB con afftdn → -38.1 dB con RNNoise; sumarle
// afftdn antes o después no mejora. RNNoise trabaja en mono.
export const MODELO_RUIDO = process.env.FOTOGRAMA_RNNOISE || join(homedir(), '.cache/clipmill/rnnoise-sh.rnnn')
export const filtroRuido = (nivel: string) =>
  nivel === 'no'
    ? 'anull'
    : nivel === 'normal' || nivel === 'fuerte'
      ? `aformat=channel_layouts=mono,aresample=48000,arnndn=m=${MODELO_RUIDO}${nivel === 'normal' ? ':mix=0.85' : ''}`
      : 'afftdn=nr=10:nf=-55:tn=1'

const abrirChrome = () => {
  if (!CHROME) throw new Error('No encontré Chrome/Chromium. Define FOTOGRAMA_CHROME con la ruta.')
  return puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    protocolTimeout: 600_000,
    args: [
      // Las pestañas en paralelo no deben quedar "en segundo plano" (se congelan los timers y el pintado).
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows',
      // Raster por software: con el raster GPU (SwiftShader) las capas grandes que se escalan cada frame
      // salían con mosaicos viejos (copias fantasma del frame anterior; tutorial n8n, oct 2026).
      '--disable-partial-raster', '--disable-gpu-rasterization',
      '--mute-audio', '--autoplay-policy=no-user-gesture-required', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--hide-scrollbars'],
  })
}

const abrirPagina = async (browser: Browser, url: string, info: InfoComposicion, props: Record<string, any>, escala: number) => {
  const page = await browser.newPage()
  page.on('pageerror', (e) => console.error('[fotograma] error en la página:', (e as Error).message))
  await page.setViewport({ width: info.ancho, height: info.alto, deviceScaleFactor: escala })
  await page.goto(url + '/__fotograma/render', { waitUntil: 'load', timeout: 120_000 })
  await page.waitForFunction('window.__fotograma && window.__fotograma.listo', { timeout: 120_000 })
  await page.evaluate((id, p) => (window as any).__fotograma.preparar(id, p), info.id, props)
  return page
}

export const listarComposiciones = async (o: OpcionesServidor & { servidor?: OpcionesRender['servidor'] } = {}) => {
  const srv = o.servidor ?? (await abrirServidor(o))
  const browser = await abrirChrome()
  try {
    const page = await browser.newPage()
    page.on('pageerror', (e) => console.error('[fotograma] error en la página:', (e as Error).message))
    await page.goto(srv.url + '/__fotograma/render', { waitUntil: 'load', timeout: 120_000 })
    await page.waitForFunction('window.__fotograma && window.__fotograma.listo', { timeout: 120_000 })
    return (await page.evaluate(() => (window as any).__fotograma.composiciones())) as InfoComposicion[]
  } finally {
    await browser.close()
    if (!o.servidor) await srv.server.close()
  }
}

const correr = (args: string[], senal?: AbortSignal, logCompleto = false) =>
  new Promise<string>((ok, mal) => {
    const p = spawn(FFMPEG, args, { signal: senal })
    let err = ''
    p.stderr.on('data', (d) => (err = logCompleto ? err + d : (err + d).slice(-4000)))
    p.on("error", (e: Error) => mal(new Error("No se pudo ejecutar ffmpeg: " + e.message)))
    p.on('close', (c) => (c === 0 ? ok(err) : mal(new Error('ffmpeg falló:\n' + err))))
  })

// Normaliza el audio del archivo ya codificado a `lufs`: mide con ebur128 y aplica la ganancia con un limitador
// (picos ≈ -2 dB, para que el AAC no pase de 0 dB). El limitador baja un poco el volumen con SFX fuertes, así que repite hasta quedar a ±0.5 dB
// (máx. 4 veces). El video se copia sin recodificar.
const medirLufs = async (archivo: string, senal?: AbortSignal) => {
  const log = await correr(['-hide_banner', '-nostats', '-i', archivo, '-map', '0:a', '-af', 'ebur128=framelog=quiet', '-f', 'null', '-'], senal)
  return Number(log.match(/I:\s+(-?[\d.]+) LUFS/g)?.pop()?.match(/-?[\d.]+/)?.[0])
}
const normalizarAudio = async (salida: string, lufs: number, senal?: AbortSignal) => {
  const tmp = salida.replace(/(\.\w+)$/, '.normalizando$1')
  for (let vuelta = 0; vuelta < 4; vuelta++) {
    const medido = await medirLufs(salida, senal)
    if (!Number.isFinite(medido) || medido < -70 || Math.abs(lufs - medido) < 0.5) return
    await correr(['-y', '-hide_banner', '-loglevel', 'error', '-i', salida, '-map', '0', '-c:v', 'copy', '-af', `volume=${(lufs - medido).toFixed(2)}dB,alimiter=limit=0.8:level=false`, '-ar', '48000', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', tmp], senal)
    renameSync(tmp, salida)
  }
}

type Bajar = { con: string[]; db: number; ataque: number; relajacion: number }
type Pista = { clave: string; src: string; inicio: number; fin: number; recorte: number; volumen: number; velocidad: number; grupo?: string; bajar?: Bajar; ruido?: string }

const coincide = (x: Pista, con: string[]) => (con.includes('*') ? !x.bajar : !!x.grupo && con.includes(x.grupo))

// Ducking: dónde se HABLA de verdad en la mezcla de las pistas de voz (silencedetect), en segundos del render.
// Así la música también sube en las pausas dentro de un mismo archivo de voz.
const tramosConVoz = async (entradas: string[], cadenas: string[], duracion: number, senal?: AbortSignal) => {
  const f = cadenas.map((c, k) => `[${k}:a]${c}[v${k}]`)
  f.push(`${cadenas.map((_, k) => `[v${k}]`).join('')}amix=inputs=${cadenas.length}:normalize=0:duration=longest,apad,silencedetect=noise=-40dB:d=0.25`)
  const log = await correr(['-hide_banner', '-nostats', ...entradas, '-filter_complex', f.join(';'), '-t', duracion.toFixed(3), '-f', 'null', '-'], senal, true)
  const silencios: [number, number][] = []
  let ini: number | null = null
  for (const l of log.split('\n')) {
    const a = l.match(/silence_start: (-?[\d.]+)/)
    const b = l.match(/silence_end: (-?[\d.]+)/)
    if (a) ini = Math.max(0, +a[1])
    if (b && ini != null) (silencios.push([ini, +b[1]]), (ini = null))
  }
  if (ini != null) silencios.push([ini, duracion])
  const voz: [number, number][] = []
  let t = 0
  for (const [a, b] of silencios) {
    if (a > t) voz.push([t, a])
    t = b
  }
  if (t < duracion) voz.push([t, duracion])
  // Huecos cortos (< 0.35 s) no hacen subir la música: quedaría «bombeando» entre palabras.
  return voz.reduce<[number, number][]>((r, x) => (r.length && x[0] - r.at(-1)![1] < 0.35 ? ((r.at(-1)![1] = x[1]), r) : [...r, x]), [])
}

// Comandos de volumen para asendcmd: rampas de `ataque` antes de cada tramo con voz y `relajacion` después.
const curvaBajar = (voz: [number, number][], b: Bajar, duracion: number, filtro: string) => {
  const cant = (t: number) => {
    let a = 0
    for (const [i, f] of voz) {
      if (t >= i && t < f) return 1
      if (t < i) a = Math.max(a, 1 - (i - t) / Math.max(0.01, b.ataque))
      else a = Math.max(a, 1 - (t - f) / Math.max(0.01, b.relajacion))
    }
    return Math.max(0, a)
  }
  const cmds: string[] = []
  let previa = -1
  for (let t = 0; t <= duracion; t += 0.02) {
    const g = 10 ** ((b.db * cant(t)) / 20)
    if (Math.abs(g - previa) > 0.002) (cmds.push(`${t.toFixed(3)} ${filtro} volume ${g.toFixed(4)};`), (previa = g))
  }
  return cmds.join('\n')
}

// atempo solo acepta 0.5–2: se encadenan varios para otras velocidades.
const atempo = (v: number) => {
  const f: string[] = []
  let r = v
  while (r > 2) (f.push('atempo=2'), (r /= 2))
  while (r < 0.5) (f.push('atempo=0.5'), (r /= 0.5))
  if (Math.abs(r - 1) > 1e-3) f.push(`atempo=${r}`)
  return f
}

export const renderizar = async (o: OpcionesRender) => {
  const codec = o.codec ?? (o.salida.endsWith('.png') ? 'png' : o.salida.endsWith('.webm') ? 'vp9' : o.salida.endsWith('.mov') ? 'prores' : o.salida.endsWith('.gif') ? 'gif' : 'h264')
  const salida = resolve(o.salida)
  mkdirSync(dirname(salida), { recursive: true })
  const avisar = o.alProgresar ?? (() => {})
  avisar({ etapa: 'preparando', hechos: 0, total: 0 })

  const srv = o.servidor ?? (await abrirServidor(o))
  const browser = await abrirChrome()
  const navegadores: Browser[] = [browser]
  const tmp = mkdtempSync(join(tmpdir(), 'fotograma-'))
  const escala = o.escala ?? 1
  try {
    const lista = await listarComposiciones({ servidor: srv })
    const info = lista.find((c) => c.id === o.composicion)
    if (!info) throw new Error(`No existe la composición "${o.composicion}". Hay: ${lista.map((c) => c.id).join(', ')}`)
    const props = { ...(info.props || {}), ...(o.props || {}) }
    const transparente = codec === 'png' || codec === 'vp9' || codec === 'prores'

    // Imagen fija
    if (codec === 'png') {
      const page = await abrirPagina(browser, srv.url, info, props, escala)
      await page.evaluate((f) => (window as any).__fotograma.irA(f), o.frame ?? 0)
      writeFileSync(salida, await page.screenshot({ type: 'png', omitBackground: true }))
      avisar({ etapa: 'listo', hechos: 1, total: 1 })
      return { salida, info }
    }

    const [desde, hasta] = o.frames ?? [0, info.duracion - 1]
    const frames = Array.from({ length: hasta - desde + 1 }, (_, i) => desde + i)
    const n = Math.max(1, Math.min(o.concurrencia ?? Math.max(1, Math.floor(cpus().length / 3)), frames.length, 8))
    // Un Chrome por trabajador: dentro de un mismo navegador solo la pestaña activa se pinta,
    // y las capturas de las demás se quedan esperando para siempre.
    const extras = await Promise.all(Array.from({ length: n - 1 }, () => abrirChrome()))
    navegadores.push(...extras)
    const paginas: Page[] = await Promise.all([browser, ...extras].map((b) => abrirPagina(b, srv.url, info, props, escala)))

    // Cola compartida: cada pestaña toma el siguiente frame libre.
    let siguiente = 0
    let hechos = 0
    const ext = transparente ? 'png' : 'jpeg'
    const pistas = new Map<string, Pista>()
    await Promise.all(
      paginas.map(async (page) => {
        for (;;) {
          if (o.senal?.aborted) throw new Error('Render cancelado.')
          const i = siguiente++
          if (i >= frames.length) break
          await page.evaluate((f) => (window as any).__fotograma.irA(f), frames[i])
          const img = await page.screenshot({ type: ext, quality: ext === 'jpeg' ? 92 : undefined, omitBackground: transparente, optimizeForSpeed: true })
          writeFileSync(join(tmp, `${String(i).padStart(6, '0')}.${ext === 'jpeg' ? 'jpg' : 'png'}`), img)
          avisar({ etapa: 'capturando', hechos: ++hechos, total: frames.length })
        }
        for (const p of (await page.evaluate(() => (window as any).__fotograma.pistas())) as Pista[]) pistas.set(p.clave, p)
      }),
    )

    // ───── Codificación ─────
    avisar({ etapa: 'codificando', hechos: frames.length, total: frames.length })
    const fps = info.fps
    const duracionS = frames.length / fps
    const args = ['-y', '-hide_banner', '-loglevel', 'error', '-framerate', String(fps), '-i', join(tmp, `%06d.${ext === 'jpeg' ? 'jpg' : 'png'}`)]
    const conAudio = codec !== 'gif' ? [...pistas.values()].filter((p) => p.fin > desde && p.inicio <= hasta) : []
    const filtros: string[] = []
    const entradas: string[][] = []
    const cadenas: string[] = []
    conAudio.forEach((p, k) => {
      // Si el render empieza a mitad de una pista, se salta lo que ya sonó.
      const saltoFrames = Math.max(0, desde - p.inicio)
      const recorte = p.recorte + (saltoFrames / fps) * p.velocidad
      entradas.push(['-ss', String(recorte), '-i', p.src])
      args.push('-ss', String(recorte), '-i', p.src)
      const dur = (Math.min(p.fin, hasta + 1) - Math.max(p.inicio, desde)) / fps
      const retraso = Math.round((Math.max(0, p.inicio - desde) / fps) * 1000)
      if (p.ruido && p.ruido !== 'suave' && !existsSync(MODELO_RUIDO)) throw new Error(`limpiarRuido="${p.ruido}" necesita el modelo ${MODELO_RUIDO}.`)
      const ruido = p.ruido ? [filtroRuido(p.ruido)] : []
      cadenas.push([...ruido, ...atempo(p.velocidad), `atrim=duration=${dur.toFixed(3)}`, `volume=${p.volumen}`, `adelay=${retraso}|${retraso}`].join(','))
    })
    // Ducking: las pistas con `bajar` bajan mientras se habla en las de sus grupos (una curva por pista).
    const curvas = new Map<number, string>()
    for (const [k, p] of conAudio.entries()) {
      if (!p.bajar) continue
      const voces = conAudio.map((x, i) => i).filter((i) => i !== k && coincide(conAudio[i], p.bajar!.con))
      if (!voces.length) continue
      avisar({ etapa: 'codificando', hechos: frames.length, total: frames.length, mensaje: 'Bajando la música bajo la voz' })
      const voz = await tramosConVoz(voces.flatMap((i) => entradas[i]), voces.map((i) => cadenas[i]), duracionS, o.senal)
      const archivo = join(tmp, `bajar-${k}.cmd`)
      writeFileSync(archivo, curvaBajar(voz, p.bajar, duracionS, `volume@b${k}`))
      curvas.set(k, archivo)
    }
    cadenas.forEach((c, k) => filtros.push(`[${k + 1}:a]${c}${curvas.has(k) ? `,asendcmd=f='${curvas.get(k)}',volume@b${k}=1` : ''}[a${k}]`))
    if (conAudio.length) {
      filtros.push(`${conAudio.map((_, k) => `[a${k}]`).join('')}amix=inputs=${conAudio.length}:normalize=0:duration=longest[aout]`)
      args.push('-filter_complex', filtros.join(';'), '-map', '0:v', '-map', '[aout]')
    }

    // Tope de bitrate: con grano o mucho detalle, un CRF solo puede disparar el peso (48 Mbps en un Short).
    if (codec === 'h264') args.push('-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', String(o.calidad ?? 20), '-maxrate', '12M', '-bufsize', '24M', '-preset', 'medium', '-movflags', '+faststart')
    else if (codec === 'vp9') args.push('-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-crf', String(o.calidad ?? 30), '-b:v', '0')
    else if (codec === 'prores') args.push('-c:v', 'prores_ks', '-profile:v', '4444', '-pix_fmt', 'yuva444p10le')
    else if (codec === 'gif') args.push('-vf', 'split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer')
    if (conAudio.length) args.push('-c:a', codec === 'vp9' ? 'libopus' : codec === 'prores' ? 'pcm_s16le' : 'aac', '-b:a', '192k')
    args.push('-t', duracionS.toFixed(3), salida)
    await correr(args, o.senal)
    if (info.lufs != null && conAudio.length && codec === 'h264') await normalizarAudio(salida, info.lufs, o.senal)
    avisar({ etapa: 'listo', hechos: frames.length, total: frames.length })
    return { salida, info, frames: frames.length, pistas: conAudio.length }
  } finally {
    await Promise.all(navegadores.map((b) => b.close().catch(() => {})))
    if (!o.servidor) await srv.server.close()
    if (tmp.startsWith(tmpdir())) rmSync(tmp, { recursive: true, force: true }) // solo la carpeta temporal propia
  }
}
