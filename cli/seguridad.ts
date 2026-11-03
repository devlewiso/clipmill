// Guardarraíles de Fotograma para lo que se ejecuta desde los flujos (que pueden armar una IA o un LLM):
// nada de borrados masivos, nada fuera de lo permitido y todo lo que se borra va a una papelera recuperable.
import { cpSync, existsSync, mkdirSync, renameSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join, resolve } from 'node:path'

const H = homedir()

// Lugares que nunca se borran ni se sobrescriben desde un flujo.
export const PROTEGIDOS = [
  ...(process.env.FOTOGRAMA_PROTEGIDOS || '').split(':').filter(Boolean), // rutas extra (p. ej. tu disco de videos)
  '/mnt',
  join(H, 'docker'),
  join(H, '.config'),
  join(H, '.ssh'),
  join(H, '.claude'),
  join(H, 'Documents'),
  '/etc',
  '/usr',
  '/boot',
  '/var',
  '/dev',
]

export const dentroDe = (ruta: string, base: string) => {
  const r = resolve(ruta)
  return r === base || r.startsWith(base + '/')
}

// Comandos de terminal (nodo Comando): se rechaza lo destructivo o peligroso.
const PELIGROS: [RegExp, string][] = [
  [/\brm\s+(-[a-zA-Z]*[rR][a-zA-Z]*|--recursive)\b/, 'borrado recursivo (rm -r)'],
  [/\b(rmdir|shred|wipefs|mkfs(\.\w+)?|fdisk|parted|sfdisk)\b/, 'borrado o formateo de disco'],
  [/\bdd\b[^|;&]*\bof=/, 'escritura directa a disco (dd of=)'],
  [/\bfind\b[^|;&]*(-delete\b|-exec\s+rm\b)/, 'borrado masivo con find'],
  [/\b(mount|umount)\b/, 'montar o desmontar discos'],
  [/\bchmod\s+-R\b|\bchown\s+-R\b/, 'cambio de permisos recursivo'],
  [/\bdocker\s+(volume\s+(rm|prune)|system\s+prune|rm\b)|\bdocker\s+compose\b[^|;&]*\bdown\b/, 'borrar contenedores o volúmenes de Docker'],
  [/\bgit\s+(push\s+[^|;&]*(--force|-f\b)|reset\s+--hard|clean\s+-[a-z]*f)/, 'operación destructiva de git'],
  [/\b(curl|wget)\b[^|;&]*\|\s*(ba|z)?sh\b/, 'ejecutar un script descargado de internet'],
  [/\b(sudo|su)\b\s/, 'comandos como administrador'],
  [/\b(shutdown|reboot|poweroff|halt)\b|\bsystemctl\s+(stop|disable|mask)\b/, 'apagar o detener servicios del sistema'],
  [/:\(\)\s*\{[^}]*\};\s*:/, 'fork bomb'],
  [/\bcrontab\s+-r\b/, 'borrar las tareas programadas'],
]

export const revisarComando = (cmd: string) => {
  for (const [re, que] of PELIGROS) if (re.test(cmd)) throw new Error(`Comando bloqueado por seguridad: ${que}. Si de verdad hace falta, ejecútalo tú en una terminal.`)
  // rm simple: solo dentro de la carpeta de trabajo de la ejecución o /tmp.
  for (const m of cmd.matchAll(/\b(rm|unlink)\s+((?:-[a-zA-Z]+\s+)*)([^|;&>]+)/g)) {
    const objetivos = m[3].trim().split(/\s+/)
    for (const o of objetivos) {
      if (/[*?]/.test(o) || o === '~' || o === '/' || o.startsWith('$')) throw new Error(`Comando bloqueado por seguridad: borrar "${o}" (comodines o variables).`)
      const abs = o.startsWith('/') ? o : null
      if (abs && !abs.startsWith('/tmp/') && !abs.includes('/.fotograma/archivos/')) throw new Error(`Comando bloqueado por seguridad: borrar ${abs} desde un flujo.`)
    }
  }
}

// Código JavaScript de los flujos: sin acceso directo a archivos ni a procesos (para eso están los nodos).
const CODIGO_PROHIBIDO =
  /\b(child_process|execSync|spawnSync|execFile|rmSync|rmdirSync|unlinkSync|unlink\s*\(|rm\s*\(|writeFileSync|appendFileSync|renameSync|process\.exit|process\.kill)\b|(import|require)\s*\(\s*['"](node:)?(fs|fs\/promises|child_process|os)['"]\s*\)/
export const revisarCodigo = (codigo: string) => {
  const m = codigo.match(CODIGO_PROHIBIDO)
  if (m) throw new Error(`Código bloqueado por seguridad: usa "${m[0]}". Para archivos o comandos usa los nodos Archivo y Comando.`)
}

// Escrituras de archivos desde un flujo: nunca dentro de la biblioteca ni en rutas del sistema.
export const revisarEscritura = (ruta: string, biblioteca: string | null) => {
  const r = resolve(ruta)
  if (biblioteca && dentroDe(r, biblioteca)) throw new Error('Escritura bloqueada: la biblioteca de videos solo la modifica Fotograma al archivar.')
  for (const p of ['/etc', '/usr', '/boot', '/var', '/dev', '/mnt', join(H, '.config'), join(H, '.ssh'), join(H, '.claude')])
    if (dentroDe(r, p)) throw new Error(`Escritura bloqueada por seguridad: ${p} está protegido.`)
}

// Papelera: en vez de borrar, se mueve a <proyecto>/.fotograma/papelera/<tipo>/<fecha>_<nombre>.
export const aPapelera = (proyecto: string, tipo: string, ruta: string) => {
  if (!existsSync(ruta)) return null
  const dir = join(proyecto, '.fotograma', 'papelera', tipo)
  mkdirSync(dir, { recursive: true })
  const destino = join(dir, `${new Date().toISOString().replace(/[:.]/g, '-')}_${basename(ruta)}`)
  try {
    renameSync(ruta, destino)
  } catch {
    cpSync(ruta, destino, { recursive: true }) // otro disco: se copia (y quien llama decide si borra)
  }
  return destino
}
