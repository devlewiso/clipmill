// Conectar un canal de YouTube nuevo sin n8n.
// Usa el mismo cliente OAuth de Google que ya usaba n8n (sale de una credencial importada) y su misma
// dirección de retorno registrada en Google Cloud (http://localhost:5678/rest/oauth2-credential/callback):
// mientras dura la conexión, Fotograma escucha en ese puerto (n8n no debe estar corriendo).
import { createServer, type Server } from 'node:http'
import { randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { guardarCredencial, type Credencial } from './credenciales'
import { DIR_SECRETOS } from './rutas'

const PUERTO = 5678
const RUTA = '/rest/oauth2-credential/callback'
const REDIRECCION = `http://localhost:${PUERTO}${RUTA}`
const ALCANCES = ['https://www.googleapis.com/auth/youtube.upload', 'https://www.googleapis.com/auth/youtube.readonly']

type Estado = { estado: 'esperando' | 'listo' | 'error'; canal?: string; credencial?: string; error?: string }
let actual: { servidores: Server[]; estado: Estado; vence: NodeJS.Timeout } | null = null

const clienteGoogle = () => {
  const todas: Record<string, Credencial> = JSON.parse(readFileSync(join(DIR_SECRETOS, 'credenciales.json'), 'utf8'))
  const c = Object.values(todas).find((x): x is Extract<Credencial, { tipo: 'oauth2' }> => x.tipo === 'oauth2' && /googleapis|google\.com/.test(x.tokenUrl))
  if (!c) throw new Error('No hay ninguna credencial de Google importada de la que tomar el cliente OAuth.')
  return { clientId: c.clientId, clientSecret: c.clientSecret, tokenUrl: c.tokenUrl }
}

const pagina = (titulo: string, texto: string) =>
  `<!doctype html><meta charset="utf-8"><title>${titulo}</title><body style="font:16px system-ui;background:#0b0d10;color:#e8eaef;display:grid;place-items:center;height:100vh;margin:0"><div style="text-align:center"><h2>${titulo}</h2><p>${texto}</p></div></body>`

const cerrar = () => {
  if (!actual) return
  clearTimeout(actual.vence)
  for (const s of actual.servidores) s.close()
}

export const estadoConexion = () => actual?.estado ?? null

export const iniciarConexionYoutube = async () => {
  cerrar()
  const { clientId, clientSecret, tokenUrl } = clienteGoogle()
  const state = randomBytes(16).toString('hex')
  const estado: Estado = { estado: 'esperando' }

  const atender = async (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => {
    const url = new URL(req.url || '/', REDIRECCION)
    if (url.pathname !== RUTA) return res.writeHead(404).end()
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    try {
      if (url.searchParams.get('state') !== state) throw new Error('La respuesta no corresponde a esta conexión.')
      if (url.searchParams.get('error')) throw new Error('Google canceló la conexión: ' + url.searchParams.get('error'))
      const r = await fetch(tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ code: url.searchParams.get('code') || '', client_id: clientId, client_secret: clientSecret, redirect_uri: REDIRECCION, grant_type: 'authorization_code' }),
      })
      const t: any = await r.json()
      if (!t.refresh_token) throw new Error(t.error_description || t.error || 'Google no devolvió un refresh token.')
      const ch: any = await fetch('https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true', { headers: { Authorization: 'Bearer ' + t.access_token } }).then((x) => x.json())
      const canal = ch.items?.[0]?.snippet?.title
      if (!canal) throw new Error('Esa cuenta no tiene un canal de YouTube.')
      const nombre = `YouTube - ${canal}`
      guardarCredencial(nombre, { tipo: 'oauth2', clientId, clientSecret, tokenUrl, refreshToken: t.refresh_token, accessToken: t.access_token, expira: Date.now() + (t.expires_in || 3600) * 1000 })
      Object.assign(estado, { estado: 'listo', canal, credencial: nombre })
      res.end(pagina('✓ Canal conectado', `<b>${canal}</b> ya está disponible en Fotograma. Puedes cerrar esta pestaña.`))
    } catch (e: any) {
      Object.assign(estado, { estado: 'error', error: e.message })
      res.end(pagina('No se pudo conectar', e.message))
    }
    setTimeout(cerrar, 500)
  }

  // localhost puede resolver a IPv4 o IPv6: se escucha en ambos.
  const servidores: Server[] = []
  for (const host of ['127.0.0.1', '::1']) {
    const s = createServer((req, res) => void atender(req, res))
    await new Promise<void>((ok, mal) => {
      s.once('error', (e: any) => (e.code === 'EADDRNOTAVAIL' ? ok() : mal(e.code === 'EADDRINUSE' ? new Error(`El puerto ${PUERTO} está ocupado (¿n8n está corriendo?). Deténlo para conectar el canal.`) : e)))
      s.listen(PUERTO, host, () => (servidores.push(s), ok()))
    }).catch((e) => {
      servidores.forEach((x) => x.close())
      throw e
    })
  }
  actual = { servidores, estado, vence: setTimeout(() => (Object.assign(estado, { estado: 'error', error: 'Se acabó el tiempo (10 min).' }), cerrar()), 10 * 60_000) }

  const auth = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  auth.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: REDIRECCION,
    response_type: 'code',
    scope: ALCANCES.join(' '),
    access_type: 'offline',
    prompt: 'select_account consent', // para poder elegir el canal (cuenta de marca) y recibir refresh token
    include_granted_scopes: 'true',
    state,
  }).toString()
  return { url: auth.toString() }
}
