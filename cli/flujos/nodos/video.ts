import { aplicarCredencial } from '../credenciales'
import type { CtxNodo, Ejecutor } from '../motor'
import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename } from 'node:path'
import type { Item } from '../../../src/flujos/tipos'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import { guardarRespuesta } from './datos'
import { conTimeout, dormir, porItem, recorte, rutaSalida } from './util'

// ───────── ElevenLabs ─────────
const elevenlabs: Ejecutor = async (c) =>
  porItem(c, async (_it, i) => {
    const texto = String(c.param('texto', i) || '').trim()
    if (!texto) throw new Error('No hay texto para convertir en voz.')
    const voz = String(c.param('voz', i) || '').trim()
    const headers = await aplicarCredencial('ElevenLabs', { 'Content-Type': 'application/json', Accept: 'audio/mpeg' })
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voz)}?output_format=mp3_44100_128`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ text: texto, model_id: c.param('modelo', i), language_code: c.param('idioma', i) || undefined }),
      signal: conTimeout(c.senal, 180),
    })
    if (!res.ok) throw new Error(`ElevenLabs ${res.status}: ${recorte(await res.text())}`)
    const ruta = rutaSalida(c, c.param('nombreArchivo', i), `voz_${c.runIndex}_${i}.mp3`)
    const bytes = await guardarRespuesta(res, ruta)
    return { json: { ruta, bytes, caracteres: texto.length }, archivo: ruta }
  })

// ───────── Kie.ai (API de jobs) ─────────
const KIE = 'https://api.kie.ai/api/v1/jobs'

// Crea una tarea en Kie, espera a que termine y devuelve las URLs del resultado.
export const tareaKie = async (c: CtxNodo, modelo: string, input: Record<string, any>, intervaloS = 20, limiteMin = 30) => {
  const headers = await aplicarCredencial('Kie', { 'Content-Type': 'application/json' })
  const crear = await fetch(`${KIE}/createTask`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ model: modelo, input }),
    signal: conTimeout(c.senal, 60),
  })
  const d: any = await crear.json().catch(() => ({}))
  const taskId = d?.data?.taskId
  if (!crear.ok || !taskId) throw new Error(`Kie no creó la tarea (${crear.status}): ${recorte(d?.msg || JSON.stringify(d))}`)
  c.log(`Tarea ${taskId} creada (${modelo})`)
  const limite = Date.now() + Math.max(1, limiteMin) * 60_000
  let info: any
  for (;;) {
    await dormir(Math.max(3, intervaloS) * 1000, c.senal)
    const r = await fetch(`${KIE}/recordInfo?taskId=${encodeURIComponent(taskId)}`, { headers, signal: conTimeout(c.senal, 30) })
    info = ((await r.json().catch(() => ({}))) as any)?.data || {}
    if (info.state === 'success') break
    if (info.state === 'fail') throw new Error(`Kie reportó un fallo: ${info.failMsg || info.failCode || 'sin detalle'} (tarea ${taskId})`)
    if (Date.now() > limite) throw new Error(`La tarea ${taskId} sigue en "${info.state}" después del tiempo máximo.`)
    c.log(`Tarea ${taskId}: ${info.state || 'esperando'}`)
  }
  const resultado = typeof info.resultJson === 'string' ? JSON.parse(info.resultJson || '{}') : info.resultJson || {}
  return { taskId, info, resultado, urls: (resultado.resultUrls || []) as string[] }
}

const descargar = async (c: CtxNodo, url: string, nombre: string) => {
  const res = await fetch(url, { signal: conTimeout(c.senal, 300) })
  if (!res.ok) throw new Error(`No se pudo descargar ${new URL(url).host} (${res.status}).`)
  const ruta = rutaSalida(c, '', nombre)
  const bytes = await guardarRespuesta(res, ruta)
  return { ruta, bytes }
}

const kie: Ejecutor = async (c) =>
  porItem(c, async (_it, i) => {
    const modelo = String(c.param('modelo', i) || '').trim()
    const { taskId, info, resultado, urls } = await tareaKie(c, modelo, c.json('input', i) || {}, Number(c.param('intervalo', i)) || 20, Number(c.param('limite', i)) || 30)
    const salida: Record<string, any> = { taskId, estado: info.state, url: urls[0], urls, costo: info.costTime, resultado }
    if (c.param('descargar', i) !== false && urls[0]) {
      const ext = (new URL(urls[0]).pathname.match(/\.\w{2,4}$/) || ['.mp4'])[0]
      Object.assign(salida, await descargar(c, urls[0], `kie_${c.runIndex}_${i}_${taskId}${ext}`))
      return { json: salida, archivo: salida.ruta }
    }
    return { json: salida }
  })

// Imagen desde texto: gratis con Pollinations (para probar) o con Kie (mejor calidad, ~0.02–0.03 USD por imagen).
const TAMANOS = {
  vertical: { ancho: 1080, alto: 1920, seedream: 'portrait_16_9', ratio: '9:16' },
  horizontal: { ancho: 1920, alto: 1080, seedream: 'landscape_16_9', ratio: '16:9' },
  cuadrado: { ancho: 1080, alto: 1080, seedream: 'square_hd', ratio: '1:1' },
} as const

// Cloudflare Workers AI: usa el login de wrangler (o CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID).
// FLUX schnell sale ~0.001 USD por imagen y la cuota gratis diaria cubre unas cien.
const CONFIG_WRANGLER = join(homedir(), '.config', '.wrangler', 'config', 'default.toml')
const credCloudflare = async () => {
  const cuenta = process.env.CLOUDFLARE_ACCOUNT_ID
  if (process.env.CLOUDFLARE_API_TOKEN && cuenta) return { token: process.env.CLOUDFLARE_API_TOKEN, cuenta }
  const leer = () => {
    const t = existsSync(CONFIG_WRANGLER) ? readFileSync(CONFIG_WRANGLER, 'utf8') : ''
    return { token: t.match(/^oauth_token\s*=\s*"([^"]+)"/m)?.[1], expira: t.match(/^expiration_time\s*=\s*"([^"]+)"/m)?.[1] }
  }
  let w = leer()
  // El token de wrangler dura poco: cualquier comando de wrangler lo renueva.
  if (!w.token || (w.expira && Date.parse(w.expira) - Date.now() < 60_000)) {
    await promisify(execFile)('npx', ['-y', 'wrangler@4', 'whoami'], { timeout: 120_000 }).catch(() => {})
    w = leer()
  }
  if (!w.token) throw new Error('No hay sesión de Cloudflare: corre `npx wrangler login` o define CLOUDFLARE_API_TOKEN.')
  let id = cuenta
  if (!id) {
    const r: any = await fetch('https://api.cloudflare.com/client/v4/accounts', { headers: { Authorization: 'Bearer ' + w.token } }).then((x) => x.json())
    id = r?.result?.[0]?.id
    if (!id) throw new Error('No encontré la cuenta de Cloudflare (define CLOUDFLARE_ACCOUNT_ID).')
  }
  return { token: w.token, cuenta: id }
}

// FLUX.2 (klein / dev) va por multipart y acepta imágenes de referencia (input_image_0…3) para
// mantener el mismo sujeto entre escenas. FLUX.1 schnell va por JSON, sale cuadrada y sin referencias.
const MEDIDAS_FLUX2 = { vertical: [768, 1360], horizontal: [1360, 768], cuadrado: [1024, 1024] } as const
const imagenCloudflare = async (c: CtxNodo, prompt: string, modelo: string, ruta: string, formato: keyof typeof MEDIDAS_FLUX2, referencias: string[] = []) => {
  const { token, cuenta } = await credCloudflare()
  const url = `https://api.cloudflare.com/client/v4/accounts/${cuenta}/ai/run/${modelo}`
  let res: Response
  if (modelo.includes('flux-2')) {
    const [ancho, alto] = MEDIDAS_FLUX2[formato] ?? MEDIDAS_FLUX2.vertical
    const form = new FormData()
    form.set('prompt', prompt.slice(0, 2000))
    form.set('width', String(ancho))
    form.set('height', String(alto))
    referencias.slice(0, 4).forEach((r, k) => form.set(`input_image_${k}`, new Blob([readFileSync(r)], { type: 'image/jpeg' }), basename(r)))
    res = await fetch(url, { method: 'POST', headers: { Authorization: 'Bearer ' + token }, body: form, signal: conTimeout(c.senal, 180) })
  } else {
    res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: prompt.slice(0, 2000), steps: 6 }), // flux-1-schnell no acepta seed
      signal: conTimeout(c.senal, 120),
    })
  }
  const d: any = await res.json().catch(() => ({}))
  if (!res.ok || !d?.result?.image) throw new Error(`Cloudflare AI ${res.status}: ${recorte(JSON.stringify(d.errors || d))}`)
  mkdirSync(dirname(ruta), { recursive: true })
  writeFileSync(ruta, Buffer.from(d.result.image, 'base64'))
  return ruta
}

const imagen: Ejecutor = async (c) =>
  porItem(c, async (it, i) => {
    const prompt = String(c.param('prompt', i) || '').trim()
    if (!prompt) throw new Error('Falta el prompt de la imagen.')
    const t = TAMANOS[(c.param('formato', i) as keyof typeof TAMANOS) || 'vertical'] ?? TAMANOS.vertical
    const estilo = String(c.param('estilo', i) || '').trim()
    const completo = estilo ? `${prompt}. ${estilo}` : prompt
    const semilla = Number(c.param('semilla', i)) || Math.floor(Math.random() * 1e6)
    const nombre = `img_${c.runIndex}_${i}_${semilla}`

    // Si el item ya trae su imagen (p. ej. una toma clave hecha antes), pasa sin generar nada.
    const existente = String(c.param('existente', i) || '').trim()
    if (existente && existsSync(existente)) return { json: { ...it.json, ruta: existente, reutilizada: true }, archivo: existente }
    const referencias = comoRutas(c.json('referencias', i)).filter((r) => existsSync(r))
    const formato = (t === TAMANOS.horizontal ? 'horizontal' : t === TAMANOS.cuadrado ? 'cuadrado' : 'vertical') as keyof typeof TAMANOS

    const proveedor = String(c.param('proveedor', i) || 'cloudflare')
    if (proveedor === 'cloudflare' || proveedor === 'gratis') {
      const modelo = String(c.param('modeloCloudflare', i) || '@cf/black-forest-labs/flux-1-schnell')
      // Sale cuadrada (1024×1024): se pide el sujeto centrado para que el recorte vertical/horizontal no lo corte.
      const encuadre = modelo.includes('flux-2') ? '' : t.alto > t.ancho ? ', subject centered, vertical framing' : t.ancho > t.alto ? ', wide framing' : ''
      const conRef = referencias.length && modelo.includes('flux-2') ? ' Keep the main subject identical to the reference image (same model, color and details).' : ''
      let ultimo: unknown
      for (let intento = 1; intento <= 3; intento++) {
        try {
          const ruta = await imagenCloudflare(c, completo + encuadre + conRef, modelo, rutaSalida(c, '', nombre + '.jpg'), formato, modelo.includes('flux-2') ? referencias : [])
          return { json: { ...it.json, ruta, proveedor: 'cloudflare', modelo, referencias: referencias.length }, archivo: ruta }
        } catch (e: any) {
          if (c.senal.aborted) throw e
          // Cuota diaria agotada: reintentar no sirve (se reinicia a medianoche UTC).
          if (/4006|daily free allocation/.test(e.message))
            throw new Error('Se acabó la cuota gratis de Cloudflare (10,000 neuronas en 24 h; se libera ~24 h después del uso fuerte). Reanuda la ejecución más tarde o cambia este nodo a Kie.')
          ultimo = e
          c.log(`Imagen ${i + 1}: ${e.message} (intento ${intento}/3)`)
          await dormir(4000 * intento, c.senal)
        }
      }
      throw ultimo
    }

    if (proveedor === 'kie') {
      const modelo = String(c.param('modeloKie', i) || 'bytedance/seedream-v4-text-to-image')
      // Nano Banana (2 / Pro) acepta hasta 8 imágenes de referencia: se suben a Kie para tener URL.
      const nano = modelo.startsWith('nano-banana')
      const refsUrl = nano && referencias.length ? await Promise.all(referencias.slice(0, 8).map((r) => subirAKie(c, r))) : []
      const conRef = refsUrl.length ? ' Keep the main subject identical to the reference image (same model, color and details).' : ''
      const input = nano
        ? { prompt: completo + conRef, ...(refsUrl.length ? { image_input: refsUrl } : {}), aspect_ratio: t.ratio, resolution: String(c.param('resolucion', i) || '1K'), output_format: 'jpg' }
        : modelo.includes('seedream')
          ? { prompt: completo, image_size: t.seedream, image_resolution: '1K', max_images: 1, seed: semilla }
          : { prompt: completo, aspect_ratio: t.ratio, output_format: 'png' }
      const { urls, taskId } = await tareaKie(c, modelo, input, 5, 10)
      if (!urls[0]) throw new Error('Kie no devolvió la imagen.')
      const ext = (new URL(urls[0]).pathname.match(/\.\w{2,4}$/) || ['.png'])[0]
      const d = await descargar(c, urls[0], nombre + ext)
      return { json: { ...it.json, ruta: d.ruta, proveedor: 'kie', modelo, taskId, referencias: refsUrl.length }, archivo: d.ruta }
    }

    // Pollinations: gratis y sin llave, con límites: prompts cortos (si no responde 402), lado mayor
    // de ~1024 px y una petición a la vez (se espera entre imágenes). El video escala la imagen.
    const lado = 1024
    const [w, h] = t.ancho >= t.alto ? [lado, Math.round((lado * t.alto) / t.ancho)] : [Math.round((lado * t.ancho) / t.alto), lado]
    const corto = (prompt.slice(0, 220) + (estilo ? '. ' + estilo.slice(0, 120) : '')).slice(0, 350)
    const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(corto)}?width=${w}&height=${h}&seed=${semilla}&nologo=true&model=flux`
    if (i > 0) await dormir(6000, c.senal)
    let ultimo: unknown
    for (let intento = 1; intento <= 4; intento++) {
      try {
        const res = await fetch(url, { signal: conTimeout(c.senal, 150) })
        if (!res.ok) throw new Error(`Pollinations respondió ${res.status}`)
        const ruta = rutaSalida(c, '', nombre + '.jpg')
        await guardarRespuesta(res, ruta)
        return { json: { ...it.json, ruta, proveedor: 'gratis' }, archivo: ruta }
      } catch (e: any) {
        if (c.senal.aborted) throw e
        ultimo = e
        c.log(`Imagen ${i + 1}: ${e.message || e} (intento ${intento}/4), reintentando…`)
        await dormir(10_000 * intento, c.senal)
      }
    }
    throw ultimo
  })

// Acepta una ruta, una lista de rutas o items con .ruta.
const comoRutas = (v: any): string[] =>
  (Array.isArray(v) ? v : v ? [v] : []).map((x: any) => (typeof x === 'string' ? x : x?.ruta || x?.json?.ruta || '')).filter(Boolean)

// Sube un archivo local a Kie para tener una URL pública (Kie la borra a los 3 días). Se recuerda
// por un día para no subir 50 veces la misma imagen de referencia.
const subidas = new Map<string, { url: string; hasta: number }>()
const subirAKie = async (c: CtxNodo, ruta: string) => {
  const previa = subidas.get(ruta)
  if (previa && previa.hasta > Date.now()) return previa.url
  const url = await subirArchivoKie(c, ruta)
  subidas.set(ruta, { url, hasta: Date.now() + 864e5 })
  return url
}
const subirArchivoKie = async (c: CtxNodo, ruta: string) => {
  const headers = await aplicarCredencial('Kie', {})
  const form = new FormData()
  form.set('file', new Blob([readFileSync(ruta)]), basename(ruta))
  form.set('uploadPath', 'fotograma')
  const r = await fetch('https://kieai.redpandaai.co/api/file-stream-upload', { method: 'POST', headers, body: form, signal: conTimeout(c.senal, 120) })
  const d: any = await r.json().catch(() => ({}))
  const url = d?.data?.fileUrl || d?.data?.downloadUrl || d?.fileUrl
  if (!url) throw new Error(`Kie no aceptó la imagen (${r.status}): ${recorte(JSON.stringify(d))}`)
  return url as string
}

// Animar: las primeras N imágenes pasan a video con Kie; el resto sigue igual (mismo orden de items).
const animar: Ejecutor = async (c) => {
  const cuantas = Math.max(0, Number(c.param('cuantas', 0)) || 0)
  const salida: Item[] = []
  for (let i = 0; i < c.items.length; i++) {
    const it = c.items[i]
    if (i >= cuantas || !it.archivo || !/\.(png|jpe?g|webp)$/i.test(it.archivo)) {
      salida.push(it)
      continue
    }
    c.log(`Animando la imagen ${i + 1} de ${Math.min(cuantas, c.items.length)}…`)
    const url = await subirAKie(c, it.archivo)
    const { urls, taskId } = await tareaKie(
      c,
      'grok-imagine/image-to-video',
      {
        image_urls: [url],
        prompt: String(c.param('prompt', i) || 'Slow cinematic camera push-in, natural subtle motion'),
        duration: String(Number(c.param('segundos', i)) || 6),
        resolution: String(c.param('resolucion', i) || '480p'),
        aspect_ratio: String(c.param('formato', i) || '9:16'),
        mode: 'normal',
      },
      10,
      20,
    )
    if (!urls[0]) throw new Error('Kie no devolvió el video animado.')
    const d = await descargar(c, urls[0], `anim_${c.runIndex}_${i}_${taskId}.mp4`)
    salida.push({ json: { ...it.json, ruta: d.ruta, imagen: it.archivo, animada: true, taskId }, archivo: d.ruta })
  }
  return [salida]
}

// Cuota de Cloudflare: cuántas neuronas se usaron en las últimas 24 h según la API de analíticas (en la
// práctica la cuota no se reinicia a medianoche UTC: es una ventana móvil). Se pone al inicio de los
// flujos para frenar ANTES de gastar en Kie si las imágenes gratis no van a alcanzar.
export const CUOTA_DIARIA = 10_000
export const neuronasUsadasHoy = async () => {
  const { token, cuenta } = await credCloudflare()
  const query = `query($a: string!, $d: Time!) { viewer { accounts(filter: { accountTag: $a }) { aiInferenceAdaptiveGroups(filter: { datetime_geq: $d }, limit: 1000) { sum { totalNeurons } } } } }`
  const r: any = await fetch('https://api.cloudflare.com/client/v4/graphql', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables: { a: cuenta, d: new Date(Date.now() - 24 * 3600e3).toISOString() } }),
    signal: AbortSignal.timeout(30_000),
  }).then((x) => x.json())
  const grupos = r?.data?.viewer?.accounts?.[0]?.aiInferenceAdaptiveGroups
  if (!Array.isArray(grupos)) throw new Error('Cloudflare no devolvió el uso: ' + JSON.stringify(r?.errors || r).slice(0, 200))
  return Math.round(grupos.reduce((n: number, g: any) => n + (g.sum?.totalNeurons || 0), 0))
}

const cuotaCloudflare: Ejecutor = async (c) => {
  const necesarias = Math.max(0, Number(c.param('necesarias', 0)) || 0)
  let usadas: number
  try {
    usadas = await neuronasUsadasHoy()
  } catch (e: any) {
    // Si no se puede consultar, no se frena el flujo (el nodo de imágenes avisará si falta cuota).
    c.log(`No se pudo consultar la cuota: ${e.message}`)
    return [c.items]
  }
  const quedan = Math.max(0, CUOTA_DIARIA - usadas)
  c.log(`Cloudflare (últimas 24 h): ${usadas.toLocaleString('en')} de ${CUOTA_DIARIA.toLocaleString('en')} neuronas usadas; quedan ${quedan.toLocaleString('en')} y este video necesita ~${necesarias.toLocaleString('en')}.`)
  if (quedan < necesarias)
    throw new Error(
      `No alcanza la cuota gratis de Cloudflare: en las últimas 24 h quedan ${quedan.toLocaleString('en')} neuronas y este video necesita ~${necesarias.toLocaleString('en')}. Se va liberando 24 h después de cada uso. No se gastó nada.`,
    )
  return [c.items]
}

export const video: Record<string, Ejecutor> = { elevenlabs, kie, imagen, animar, cuotaCloudflare }
