// Remoto: usar el estudio desde el teléfono en la misma red. Es un servidor aparte (0.0.0.0:3061) con su propia
// API, más chica que la del estudio: ver y ordenar la cola, encolar renders, mirar los videos terminados y hablar
// con el asistente. No publica, no ejecuta flujos y no toca archivos.
// Emparejar: el estudio muestra un QR con un código de 6 cifras (10 min, un solo uso, 5 intentos). El teléfono
// lo canjea por un token que queda en una cookie; en remoto.json solo se guarda el hash del token.
import { createHash, randomBytes, randomInt } from 'node:crypto'
import { createReadStream, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { networkInterfaces } from 'node:os'
import { join } from 'node:path'
import QRCode from 'qrcode'
import { canalDe, ORDEN } from '../app/estudio/canales'
import type { Cola } from './cola'
import type { InfoComposicion } from './render'
import type { crearAgente } from './agente'
import { RAIZ_FOTOGRAMA } from './servidor'

type Dispositivo = { id: string; nombre: string; hash: string; creado: number; ultimo: number }
type Config = { activo: boolean; dispositivos: Dispositivo[] }

const PUERTO = Number(process.env.FOTOGRAMA_REMOTO_PUERTO || 3061)
const COOKIE = 'clipmill_remoto'
const hash = (t: string) => createHash('sha256').update(t).digest('hex')

// La IP de la PC en la red de la casa (se saltan Docker y las interfaces virtuales).
const ipLocal = () => {
  const ips = Object.entries(networkInterfaces())
    .filter(([n]) => !/^(docker|br-|veth|virbr|lo|tailscale|zt)/.test(n))
    .flatMap(([, l]) => (l || []).filter((x) => x.family === 'IPv4' && !x.internal).map((x) => x.address))
  return ips.find((ip) => ip.startsWith('192.168.')) || ips[0] || '127.0.0.1'
}

const leerCuerpo = (req: IncomingMessage) =>
  new Promise<any>((ok) => {
    let s = ''
    req.on('data', (d) => (s.length < 2_000_000 ? (s += d) : req.destroy()))
    req.on('end', () => {
      try {
        ok(JSON.parse(s || '{}'))
      } catch {
        ok({})
      }
    })
  })

const json = (res: ServerResponse, datos: unknown, codigo = 200) => {
  res.statusCode = codigo
  res.setHeader('Content-Type', 'application/json')
  res.setHeader('Cache-Control', 'no-store')
  res.end(JSON.stringify(datos))
}

// Video con soporte de Range (el <video> del teléfono lo pide así para poder adelantar).
export const enviarVideo = (req: IncomingMessage, res: ServerResponse, archivo: string) => {
  const total = statSync(archivo).size
  const tipo = archivo.endsWith('.wav') ? 'audio/wav' : archivo.endsWith('.webm') ? 'video/webm' : archivo.endsWith('.mov') ? 'video/quicktime' : archivo.endsWith('.gif') ? 'image/gif' : 'video/mp4'
  const m = String(req.headers.range || '').match(/bytes=(\d*)-(\d*)/)
  res.setHeader('Accept-Ranges', 'bytes')
  res.setHeader('Content-Type', tipo)
  if (!m) {
    res.setHeader('Content-Length', String(total))
    return createReadStream(archivo).pipe(res)
  }
  const ini = m[1] ? Number(m[1]) : Math.max(0, total - Number(m[2]))
  const fin = m[1] && m[2] ? Math.min(Number(m[2]), total - 1) : total - 1
  res.statusCode = 206
  res.setHeader('Content-Range', `bytes ${ini}-${fin}/${total}`)
  res.setHeader('Content-Length', String(fin - ini + 1))
  createReadStream(archivo, { start: ini, end: fin }).pipe(res)
}

export const crearRemoto = (o: { proyecto: string; cola: Cola; agente: () => ReturnType<typeof crearAgente> }) => {
  const archivo = join(o.proyecto, '.fotograma', 'remoto.json')
  let config: Config = { activo: false, dispositivos: [] }
  try {
    config = { ...config, ...JSON.parse(readFileSync(archivo, 'utf8')) }
  } catch {}
  const guardar = () => {
    mkdirSync(join(o.proyecto, '.fotograma'), { recursive: true })
    writeFileSync(archivo + '.tmp', JSON.stringify(config, null, 1))
    renameSync(archivo + '.tmp', archivo)
  }

  let codigo: { valor: string; vence: number; intentos: number } | null = null
  let servidor: Server | null = null
  const url = () => `http://${ipLocal()}:${PUERTO}`

  const dispositivoDe = (req: IncomingMessage) => {
    const token = String(req.headers.cookie || '').match(new RegExp(`${COOKIE}=([a-f0-9]{64})`))?.[1]
    if (!token) return null
    const h = hash(token)
    return config.dispositivos.find((d) => d.hash === h) ?? null
  }

  const pagina = () => readFileSync(join(RAIZ_FOTOGRAMA, 'app', 'remoto', 'index.html'), 'utf8')

  const atender = async (req: IncomingMessage, res: ServerResponse) => {
    const u = new URL(req.url || '/', 'http://x')
    // Lo básico para que otra página no pueda usar la sesión del teléfono.
    res.setHeader('X-Frame-Options', 'DENY')
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Referrer-Policy', 'no-referrer')
    try {
      if (u.pathname === '/' || u.pathname === '/index.html') {
        res.setHeader('Content-Type', 'text/html; charset=utf-8')
        res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' data:; media-src 'self'")
        return res.end(pagina())
      }
      if (!u.pathname.startsWith('/api/')) return json(res, { error: 'No existe.' }, 404)
      const ruta = u.pathname.slice(5)
      if (req.method === 'POST' && !String(req.headers['content-type'] || '').startsWith('application/json')) return json(res, { error: 'Pedido inválido.' }, 415)

      if (ruta === 'emparejar' && req.method === 'POST') {
        const b = await leerCuerpo(req)
        if (!codigo || Date.now() > codigo.vence) return json(res, { error: 'No hay un código vigente: generá uno nuevo en el estudio (botón Remoto).' }, 403)
        if (String(b.codigo || '').trim() !== codigo.valor) {
          if (++codigo.intentos >= 5) codigo = null
          return json(res, { error: 'Código incorrecto.' }, 403)
        }
        codigo = null
        const token = randomBytes(32).toString('hex')
        const d: Dispositivo = { id: randomBytes(4).toString('hex'), nombre: String(b.nombre || 'Teléfono').slice(0, 60), hash: hash(token), creado: Date.now(), ultimo: Date.now() }
        config.dispositivos.push(d)
        guardar()
        res.setHeader('Set-Cookie', `${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=31536000`)
        return json(res, { ok: true, nombre: d.nombre })
      }

      const d = dispositivoDe(req)
      if (!d) return json(res, { error: 'Este teléfono no está emparejado.', emparejar: true }, 401)
      if (Date.now() - d.ultimo > 60_000) ((d.ultimo = Date.now()), guardar())

      if (ruta === 'yo') return json(res, { nombre: d.nombre })
      if (ruta === 'cola') return json(res, o.cola.lista().slice(0, 60))
      if (ruta === 'composiciones') {
        const l = await o.cola.composiciones(u.searchParams.get('fresca') === '1')
        // Mismos grupos que el estudio: un bloque por canal (con tus guiones adentro, primero) y los ejemplos al final.
        const grupo = (c: InfoComposicion) => (c.ejemplo ? { canal: 'Ejemplos', icono: '🧪' } : { canal: canalDe(c as any).nombre, icono: canalDe(c as any).icono })
        const orden = (c: InfoComposicion) => (c.ejemplo ? 99 : ORDEN.indexOf(canalDe(c as any).nombre) + (c.carpeta === 'Guiones' ? 0 : 0.5))
        return json(
          res,
          l
            .slice()
            .sort((a, b) => orden(a) - orden(b))
            .map((c) => ({ id: c.id, titulo: c.carpeta === 'Guiones' ? c.descripcion || c.id : c.id, carpeta: c.carpeta || '', ...grupo(c), segundos: +(c.duracion / c.fps).toFixed(1), formato: `${c.ancho}×${c.alto}` })),
        )
      }
      if (ruta === 'video') {
        const t = o.cola.buscar(Number(u.searchParams.get('id')))
        if (t.estado !== 'listo' || !existsSync(t.salida)) return json(res, { error: 'Ese video no está listo.' }, 404)
        return enviarVideo(req, res, t.salida)
      }
      if (req.method === 'POST') {
        const b = await leerCuerpo(req)
        if (ruta === 'render') return json(res, o.cola.encolar({ id: String(b.id || '') }, 'remoto'))
        if (ruta === 'cancelar') return json(res, o.cola.cancelar(Number(b.id)))
        if (ruta === 'mover') return json(res, o.cola.mover(Number(b.id), b.a))
        if (ruta === 'reintentar') return json(res, o.cola.reintentar(Number(b.id), 'remoto'))
        if (ruta === 'asistente') return json(res, await o.agente().conversar(b.historial || [], { pestana: 'remoto' }, b.decision, true))
        if (ruta === 'salir') {
          config.dispositivos = config.dispositivos.filter((x) => x.id !== d.id)
          guardar()
          res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`)
          return json(res, { ok: true })
        }
      }
      json(res, { error: 'Ruta desconocida.' }, 404)
    } catch (e: any) {
      json(res, { error: e.message }, 400)
    }
  }

  const encender = () =>
    new Promise<void>((ok, mal) => {
      if (servidor) return ok()
      const s = createServer((req, res) => void atender(req, res))
      s.once('error', (e) => mal(new Error(`No pude abrir el puerto ${PUERTO} para Remoto: ${e.message}`)))
      s.listen(PUERTO, '0.0.0.0', () => ((servidor = s), ok()))
    })
  const apagar = () =>
    new Promise<void>((ok) => {
      codigo = null
      if (!servidor) return ok()
      servidor.close(() => ok())
      servidor.closeAllConnections()
      servidor = null
    })

  const estado = () => ({
    activo: config.activo,
    escuchando: !!servidor,
    url: url(),
    dispositivos: config.dispositivos.map(({ hash: _, ...x }) => x),
    codigo: codigo && Date.now() < codigo.vence ? { vence: codigo.vence } : null,
  })

  if (config.activo) encender().catch((e) => console.error('[clipmill]', e.message))

  return {
    estado,
    activar: async (activo: boolean) => {
      config.activo = activo
      guardar()
      await (activo ? encender() : apagar())
      return estado()
    },
    // Código nuevo de emparejamiento + QR con la dirección (el código va en el #, que no viaja al servidor ni queda en logs).
    nuevoCodigo: async () => {
      if (!servidor) throw new Error('Primero activá Remoto.')
      codigo = { valor: String(randomInt(0, 1_000_000)).padStart(6, '0'), vence: Date.now() + 10 * 60_000, intentos: 0 }
      const enlace = `${url()}/#codigo=${codigo.valor}`
      return { codigo: codigo.valor, vence: codigo.vence, enlace, qr: await QRCode.toDataURL(enlace, { margin: 1, width: 320 }) }
    },
    revocar: (id: string) => {
      config.dispositivos = config.dispositivos.filter((d) => d.id !== id)
      guardar()
      return estado()
    },
  }
}

export type Remoto = ReturnType<typeof crearRemoto>
