import { spawn } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, extname } from 'node:path'
import type { Item } from '../../../src/flujos/tipos'
import { guardarTabla, leerTabla, type Fila } from '../almacen'
import { aplicarCredencial } from '../credenciales'
import type { CtxNodo, Ejecutor } from '../motor'
import { ENTORNO_HERRAMIENTAS, R } from '../rutas'
import { revisarComando, revisarEscritura } from '../../seguridad'
import { rutaBiblioteca } from '../../biblioteca'
import { join as unir } from 'node:path'
import { cpSync } from 'node:fs'
import { conTimeout, porItem, recorte, rutaSalida } from './util'

const EXT_POR_TIPO: Record<string, string> = {
  'video/mp4': '.mp4',
  'audio/mpeg': '.mp3',
  'audio/wav': '.wav',
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'application/pdf': '.pdf',
}

// Guarda el cuerpo de una respuesta en disco.
export const guardarRespuesta = async (res: Response, ruta: string) => {
  mkdirSync(dirname(ruta), { recursive: true })
  const buf = Buffer.from(await res.arrayBuffer())
  writeFileSync(ruta, buf)
  return buf.length
}

const nombreDesdeUrl = (url: string, tipo: string) => {
  const limpio = basename(new URL(url).pathname) || 'archivo'
  return extname(limpio) ? limpio : limpio + (EXT_POR_TIPO[tipo.split(';')[0]] || '.bin')
}

const http: Ejecutor = async (c) =>
  porItem(c, async (_it, i) => {
    const metodo = String(c.param('metodo', i) || 'GET').toUpperCase()
    const url = new URL(String(c.param('url', i)).trim())
    const query = c.json('query', i)
    if (query && typeof query === 'object') for (const [k, v] of Object.entries(query)) url.searchParams.set(k, String(v))
    const headers: Record<string, string> = { ...(c.json('headers', i) || {}) }
    await aplicarCredencial(String(c.param('credencial', i) || ''), headers)

    let body: string | undefined
    if (metodo !== 'GET') {
      const cuerpo = c.json('cuerpo', i)
      if (cuerpo !== undefined) {
        body = typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo)
        if (typeof cuerpo !== 'string' && !Object.keys(headers).some((h) => h.toLowerCase() === 'content-type'))
          headers['Content-Type'] = 'application/json'
      }
    }

    const res = await fetch(url, { method: metodo, headers, body, signal: conTimeout(c.senal, Number(c.param('timeout', i)) || 60) })
    const tipo = res.headers.get('content-type') || ''
    if (!res.ok) throw new Error(`HTTP ${res.status} en ${url.origin}${url.pathname}: ${recorte(await res.text().catch(() => ''))}`)

    const formato = c.param('respuesta', i)
    if (formato === 'archivo') {
      const ruta = rutaSalida(c, c.param('nombreArchivo', i), `http_${c.runIndex}_${i}_${nombreDesdeUrl(url.href, tipo)}`)
      const bytes = await guardarRespuesta(res, ruta)
      return { json: { ruta, tipo, bytes }, archivo: ruta }
    }
    const texto = await res.text()
    if (formato === 'texto') return { json: { data: texto } }
    let datos: any
    try {
      datos = texto ? JSON.parse(texto) : {}
    } catch {
      return { json: { data: texto } }
    }
    // Como n8n: una respuesta que es un array se convierte en varios items.
    if (Array.isArray(datos)) return datos.map((d) => ({ json: d && typeof d === 'object' ? d : { valor: d } }))
    return { json: datos && typeof datos === 'object' ? datos : { valor: datos } }
  })

// ───────── Tablas ─────────
const cumple = (fila: Fila, filtro: any) =>
  !filtro || typeof filtro !== 'object' || Object.entries(filtro).every(([k, v]) => String(fila[k] ?? '') === String(v ?? ''))

const tabla: Ejecutor = async (c) => {
  const nombre = String(c.param('tabla') || '').trim()
  if (!nombre) throw new Error('Falta el nombre de la tabla.')
  const op = c.param('operacion')
  const filas = leerTabla(nombre)
  // Antes de modificar o borrar filas se guarda una copia de la tabla (recuperable).
  if (op === 'borrar' || op === 'actualizar') {
    const origen = unir(R.DIR_TABLAS, nombre.replace(/[^\w-]/g, '') + '.json')
    const copia = unir(R.proyecto, '.fotograma', 'papelera', 'tablas', `${new Date().toISOString().replace(/[:.]/g, '-')}_${nombre}.json`)
    try {
      mkdirSync(dirname(copia), { recursive: true })
      cpSync(origen, copia)
    } catch {}
  }
  const aItem = (f: Fila): Item => ({ json: f })

  if (op === 'leer') return [filas.filter((f) => cumple(f, c.json('filtro'))).map(aItem)]

  const salida: Item[] = []
  c.items.forEach((_it, i) => {
    if (op === 'insertar') {
      const datos = c.json('fila', i)
      if (!datos || typeof datos !== 'object') throw new Error('La fila debe ser un objeto JSON.')
      const { id: _i, creado: _c, ...resto } = datos
      const fila: Fila = { id: filas.reduce((m, f) => Math.max(m, f.id), 0) + 1, creado: new Date().toISOString(), ...resto }
      filas.push(fila)
      salida.push(aItem(fila))
    } else if (op === 'actualizar') {
      const filtro = c.json('filtro', i)
      const datos = c.json('fila', i) || {}
      filas.forEach((f, k) => {
        if (cumple(f, filtro)) {
          filas[k] = { ...f, ...datos, id: f.id, creado: f.creado }
          salida.push(aItem(filas[k]))
        }
      })
    } else if (op === 'borrar') {
      const filtro = c.json('filtro', i)
      if (!filtro || typeof filtro !== 'object' || !Object.keys(filtro).length) throw new Error('Borrar filas exige un filtro: sin filtro borraría toda la tabla.')
      for (let k = filas.length - 1; k >= 0; k--) if (cumple(filas[k], filtro)) salida.push(aItem(filas.splice(k, 1)[0]))
    }
  })
  guardarTabla(nombre, filas)
  c.log(`${op}: ${salida.length} fila(s) en "${nombre}"`)
  return [salida]
}

// ───────── Archivos ─────────
const archivo: Ejecutor = async (c) =>
  porItem(c, async (it, i) => {
    const op = c.param('operacion', i)
    const ruta = String(c.param('ruta', i) || '').trim()
    if (op === 'guardar') {
      if (!it.archivo) throw new Error('El item no trae archivo para guardar (usa un HTTP con respuesta "Archivo", ElevenLabs, Kie…).')
      const destino = ruta || rutaSalida(c, '', basename(it.archivo))
      revisarEscritura(destino, rutaBiblioteca())
      mkdirSync(dirname(destino), { recursive: true })
      if (destino !== it.archivo) copyFileSync(it.archivo, destino)
      return { json: { ...it.json, ruta: destino }, archivo: destino }
    }
    if (!ruta) throw new Error('Falta la ruta.')
    if (op === 'escribir') {
      revisarEscritura(ruta, rutaBiblioteca())
      mkdirSync(dirname(ruta), { recursive: true })
      const contenido = String(c.param('contenido', i) ?? '')
      writeFileSync(ruta, contenido)
      return { json: { ruta, bytes: Buffer.byteLength(contenido) } }
    }
    if (!existsSync(ruta)) throw new Error(`No existe el archivo ${ruta}`)
    if (op === 'leerTexto') return { json: { ruta, texto: readFileSync(ruta, 'utf8') } }
    return { json: { ruta, nombre: basename(ruta), bytes: statSync(ruta).size }, archivo: ruta }
  })

// ───────── Comando ─────────
const correrComando = (c: CtxNodo, cmd: string, carpeta: string, segundos: number) =>
  new Promise<{ stdout: string; stderr: string; exitCode: number }>((ok, mal) => {
    const p = spawn('bash', ['-c', cmd], {
      cwd: carpeta || c.carpeta,
      env: { ...process.env, ...ENTORNO_HERRAMIENTAS },
      signal: conTimeout(c.senal, segundos),
    })
    let stdout = ''
    let stderr = ''
    const MAX = 2_000_000
    p.stdout.on('data', (d) => (stdout = (stdout + d).slice(-MAX)))
    p.stderr.on('data', (d) => (stderr = (stderr + d).slice(-MAX)))
    p.on('error', (e: any) => mal(new Error(e.name === 'AbortError' ? `El comando superó ${segundos} s o se canceló.` : e.message)))
    p.on('close', (exitCode) => ok({ stdout, stderr, exitCode: exitCode ?? -1 }))
  })

const comando: Ejecutor = async (c) => {
  const lista = c.param('unaVez') === false ? c.items : c.items.slice(0, 1)
  const salida: Item[] = []
  for (let i = 0; i < lista.length; i++) {
    const cmd = String(c.param('comando', i) || '').trim()
    if (!cmd) throw new Error('El comando está vacío.')
    revisarComando(cmd)
    c.log('$ ' + recorte(cmd, 300))
    const r = await correrComando(c, cmd, String(c.param('carpeta', i) || ''), Number(c.param('timeout', i)) || 600)
    if (r.exitCode !== 0) throw new Error(`El comando terminó con código ${r.exitCode}: ${recorte((r.stderr || r.stdout).slice(-800), 800)}`)
    salida.push({ json: r })
  }
  return [salida]
}

export const datos: Record<string, Ejecutor> = { http, tabla, archivo, comando }
