// Credenciales: se guardan en ~/.config/flujos/credenciales.json (permisos 600), nunca en el repo.
// El navegador solo ve nombres y tipos, jamás los valores.
import { chmodSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { escribirJson, leerJson } from './almacen'
import { DIR_SECRETOS, HERRAMIENTAS_N8N } from './rutas'

export type Credencial =
  | { tipo: 'header'; header: string; valor: string }
  | {
      tipo: 'oauth2'
      clientId: string
      clientSecret: string
      tokenUrl: string
      accessToken?: string
      refreshToken: string
      expira?: number // ms epoch
    }

const ARCHIVO = join(DIR_SECRETOS, 'credenciales.json')

const leerArchivo = (ruta: string) => {
  try {
    return readFileSync(ruta, 'utf8').trim()
  } catch {
    return ''
  }
}

// Llaves que ya existen en la máquina: se ofrecen sin tener que copiarlas.
const integradas = (): Record<string, Credencial> => {
  const r: Record<string, Credencial> = {}
  const kie = leerArchivo(join(homedir(), '.config', 'kie', 'api_key'))
  if (kie) r['Kie'] = { tipo: 'header', header: 'Authorization', valor: 'Bearer ' + kie }
  const el = leerArchivo(join(homedir(), '.config', 'elevenlabs', 'api_key'))
  if (el) r['ElevenLabs'] = { tipo: 'header', header: 'xi-api-key', valor: el }
  return r
}

const guardadas = (): Record<string, Credencial> => leerJson(ARCHIVO, {})

const todas = () => ({ ...integradas(), ...guardadas() })

export const listarCredenciales = () => {
  const integ = integradas()
  return Object.entries(todas()).map(([nombre, c]) => ({
    nombre,
    tipo: c.tipo,
    detalle: c.tipo === 'header' ? c.header : 'OAuth2',
    integrada: nombre in integ && !(nombre in guardadas()),
  }))
}

export const guardarCredencial = (nombre: string, c: Credencial) => {
  mkdirSync(DIR_SECRETOS, { recursive: true, mode: 0o700 })
  const g = guardadas()
  g[nombre] = c
  escribirJson(ARCHIVO, g)
  chmodSync(ARCHIVO, 0o600)
}

export const borrarCredencial = (nombre: string) => {
  const g = guardadas()
  // Copia de seguridad (con los mismos permisos 600) antes de quitarla.
  if (g[nombre]) {
    mkdirSync(join(DIR_SECRETOS, 'papelera'), { recursive: true, mode: 0o700 })
    const copia = join(DIR_SECRETOS, 'papelera', `${new Date().toISOString().replace(/[:.]/g, '-')}_${nombre.replace(/[^\w-]/g, '_')}.json`)
    escribirJson(copia, { [nombre]: g[nombre] })
    chmodSync(copia, 0o600)
  }
  delete g[nombre]
  if (existsSync(ARCHIVO)) {
    escribirJson(ARCHIVO, g)
    chmodSync(ARCHIVO, 0o600)
  }
}

export const existeCredencial = (nombre: string) => nombre in todas()

// Devuelve un access token vigente (lo renueva con el refresh token si venció).
export const tokenOauth = async (nombre: string): Promise<string> => {
  const c = todas()[nombre]
  if (!c || c.tipo !== 'oauth2') throw new Error(`La credencial "${nombre}" no existe o no es OAuth2.`)
  if (c.accessToken && c.expira && c.expira - Date.now() > 60_000) return c.accessToken
  const res = await fetch(c.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: c.clientId,
      client_secret: c.clientSecret,
      refresh_token: c.refreshToken,
      grant_type: 'refresh_token',
    }),
  })
  const d: any = await res.json().catch(() => ({}))
  if (!res.ok || !d.access_token)
    throw new Error(`No se pudo renovar el token de "${nombre}": ${d.error_description || d.error || res.status}`)
  const nueva = { ...c, accessToken: d.access_token, expira: Date.now() + (d.expires_in || 3600) * 1000 }
  if (d.refresh_token) nueva.refreshToken = d.refresh_token
  guardarCredencial(nombre, nueva)
  return nueva.accessToken
}

// Agrega la autenticación de la credencial a los headers de una petición.
export const aplicarCredencial = async (nombre: string, headers: Record<string, string>) => {
  if (!nombre) return headers
  const c = todas()[nombre]
  if (!c) throw new Error(`La credencial "${nombre}" no existe. Créala en Credenciales.`)
  if (c.tipo === 'header') headers[c.header] = c.valor
  else headers['Authorization'] = 'Bearer ' + (await tokenOauth(nombre))
  return headers
}

export const telegramConfig = () => ({
  token: leerArchivo(join(HERRAMIENTAS_N8N, 'telegram', 'token')),
  chatId: leerArchivo(join(HERRAMIENTAS_N8N, 'telegram', 'chat_id')),
})
