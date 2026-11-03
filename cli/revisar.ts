// Revisión antes de renderizar (fotograma revisar <id>): recorre la composición cuadro a cuadro SIN capturar (mucho más
// rápido que un render) y avisa lo que haría fallar o quedar mal el video:
//  · audios que no existen (el render los pide a ffmpeg y se cae: p. ej. sfx/tecla4.5.mp3, dev stop motion oct 2026)
//  · imágenes, videos o fuentes que dan 404, y errores de la página
//  · huecos sin ningún audio sonando (p. ej. la salida de una despedida sin música)
// y arma una hoja de cuadros (uno cada N s) para mirar el video entero de un vistazo.
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import puppeteer from 'puppeteer-core'
import { listarComposiciones } from './render'
import { abrirServidor, type OpcionesServidor } from './servidor'

const CHROME = [process.env.FOTOGRAMA_CHROME, '/usr/bin/google-chrome-stable', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find(
  (p) => p && existsSync(p),
)
const FFMPEG = process.env.FOTOGRAMA_FFMPEG || 'ffmpeg'

type Pista = { clave: string; src: string; inicio: number; fin: number; volumen: number }
export type Problema = { tipo: 'audio-falta' | 'archivo-falta' | 'error-pagina' | 'sin-audio'; detalle: string; frame?: number }
export type OpcionesRevisar = OpcionesServidor & {
  composicion: string
  props?: Record<string, any>
  paso?: number // revisar 1 de cada N cuadros (5 por defecto; los SFX duran ≥ 1 s, así que no se escapa ninguno)
  hoja?: string | false // ruta de la hoja de cuadros (.jpg); false = sin hoja
  cadaSeg?: number // un cuadro de la hoja cada N segundos (3)
  huecoMin?: number // segundos sin audio que cuentan como problema (1.5)
  alProgresar?: (hechos: number, total: number) => void
}

const ffmpeg = (args: string[]) =>
  new Promise<void>((ok, mal) => {
    const p = spawn(FFMPEG, args)
    let err = ''
    p.stderr.on('data', (d) => (err = (err + d).slice(-2000)))
    p.on('close', (c) => (c === 0 ? ok() : mal(new Error('ffmpeg falló:\n' + err))))
  })

export const revisar = async (o: OpcionesRevisar) => {
  if (!CHROME) throw new Error('No encontré Chrome/Chromium. Define FOTOGRAMA_CHROME con la ruta.')
  const srv = await abrirServidor(o)
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--mute-audio', '--autoplay-policy=no-user-gesture-required', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--hide-scrollbars'],
  })
  const tmp = mkdtempSync(join(tmpdir(), 'fotograma-revisar-'))
  const problemas: Problema[] = []
  try {
    const info = (await listarComposiciones({ servidor: srv })).find((c) => c.id === o.composicion)
    if (!info) throw new Error(`No existe la composición "${o.composicion}".`)
    const page = await browser.newPage()
    let frameActual = 0
    const vistos = new Set<string>()
    const anotar = (p: Problema) => {
      const k = p.tipo + p.detalle
      if (!vistos.has(k)) (vistos.add(k), problemas.push(p))
    }
    page.on('pageerror', (e) => anotar({ tipo: 'error-pagina', detalle: (e as Error).message.slice(0, 200), frame: frameActual }))
    page.on('response', (r) => {
      if (r.status() >= 400) anotar({ tipo: 'archivo-falta', detalle: `${r.status()} ${decodeURI(new URL(r.url()).pathname)}`, frame: frameActual })
    })
    page.on('requestfailed', (r) => {
      // ERR_ABORTED = el navegador cortó una descarga (p. ej. un <video> que salta de cuadro): no es un archivo que falte
      if (!/^data:|^blob:/.test(r.url()) && r.failure()?.errorText !== 'net::ERR_ABORTED') anotar({ tipo: 'archivo-falta', detalle: `${r.failure()?.errorText} ${decodeURI(new URL(r.url()).pathname)}`, frame: frameActual })
    })
    await page.setViewport({ width: info.ancho, height: info.alto, deviceScaleFactor: 1 })
    await page.goto(srv.url + '/__fotograma/render', { waitUntil: 'load', timeout: 120_000 })
    await page.waitForFunction('window.__fotograma && window.__fotograma.listo', { timeout: 120_000 })
    await page.evaluate((id, p) => (window as any).__fotograma.preparar(id, p), info.id, { ...(info.props || {}), ...(o.props || {}) })

    // Recorrido: cada `paso` cuadros (y siempre el último); captura solo los de la hoja.
    const paso = Math.max(1, o.paso ?? 5)
    const cadaHoja = Math.max(1, Math.round((o.cadaSeg ?? 3) * info.fps))
    const frames = new Set<number>()
    for (let f = 0; f < info.duracion; f += paso) frames.add(f)
    for (let f = 0; f < info.duracion; f += cadaHoja) frames.add(f)
    frames.add(info.duracion - 1)
    const lista = [...frames].sort((a, b) => a - b)
    const capturas: string[] = []
    for (const [i, f] of lista.entries()) {
      frameActual = f
      await page.evaluate((x) => (window as any).__fotograma.irA(x), f)
      if (o.hoja !== false && f % cadaHoja === 0) {
        const archivo = join(tmp, `${String(capturas.length).padStart(4, '0')}.jpg`)
        writeFileSync(archivo, await page.screenshot({ type: 'jpeg', quality: 70, optimizeForSpeed: true }))
        capturas.push(archivo)
      }
      o.alProgresar?.(i + 1, lista.length)
    }

    // Audios: ¿existen? (el render se cae si alguno da 404)
    const pistas = (await page.evaluate(() => (window as any).__fotograma.pistas())) as Pista[]
    await Promise.all(
      [...new Set(pistas.map((p) => p.src))].map(async (src) => {
        const r = await fetch(src, { method: 'HEAD' }).catch(() => null)
        if (!r || r.status >= 400) anotar({ tipo: 'audio-falta', detalle: decodeURI(new URL(src).pathname), frame: pistas.find((p) => p.src === src)?.inicio })
      }),
    )
    // Huecos sin ningún audio sonando
    const suena = new Uint8Array(info.duracion)
    for (const p of pistas) if (p.volumen > 0) for (let f = Math.max(0, p.inicio); f < Math.min(info.duracion, p.fin); f++) suena[f] = 1
    const min = Math.round((o.huecoMin ?? 1.5) * info.fps)
    for (let f = 0; f < info.duracion; ) {
      if (suena[f]) { f++; continue }
      let g = f
      while (g < info.duracion && !suena[g]) g++
      if (g - f >= min) anotar({ tipo: 'sin-audio', detalle: `${(f / info.fps).toFixed(1)}–${(g / info.fps).toFixed(1)} s sin ningún audio`, frame: f })
      f = g
    }

    // Hoja de cuadros
    let hoja: string | undefined
    if (o.hoja !== false && capturas.length) {
      hoja = o.hoja || `out/${info.id}.revision.jpg`
      const columnas = info.alto > info.ancho ? 8 : 5
      const filas = Math.ceil(capturas.length / columnas)
      const ancho = info.alto > info.ancho ? 220 : 380
      await ffmpeg(['-y', '-loglevel', 'error', '-framerate', '1', '-i', join(tmp, '%04d.jpg'), '-vf', `scale=${ancho}:-1,drawtext=text='%{eif\\:n*${o.cadaSeg ?? 3}\\:d}s':x=6:y=6:fontsize=22:fontcolor=yellow:box=1:boxcolor=black@0.5,tile=${columnas}x${filas}:padding=3`, '-frames:v', '1', '-q:v', '4', hoja])
    }
    return { info, problemas, pistas: pistas.length, revisados: lista.length, hoja }
  } finally {
    await browser.close()
    await srv.server.close()
    rmSync(tmp, { recursive: true, force: true })
  }
}
