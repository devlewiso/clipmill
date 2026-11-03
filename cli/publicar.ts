// Publicar videos renderizados en YouTube y TikTok desde el estudio (con las credenciales importadas de n8n).
import { existsSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync, mkdirSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import type { Guion } from '../src/guion/tipos'
import { listarCredenciales } from './flujos/credenciales'
import { anotarPublicacion, leerCanales, listarBiblioteca, rutaBiblioteca } from './biblioteca'
import { publicarTiktok, subirYoutube, type OpcionesYoutube } from './flujos/nodos/integraciones'

export type Publicacion = {
  id: string
  ruta: string
  fecha: string
  youtube?: { estado: 'subiendo' | 'listo' | 'error'; url?: string; error?: string; credencial: string; privacidad?: string; mensaje?: string }
  tiktok?: { estado: 'subiendo' | 'listo' | 'error'; error?: string; privado?: boolean; mensaje?: string; modo?: 'direct' | 'draft'; status?: string; postId?: string | null }
}

export const crearApiPublicar = (proyecto: string) => {
  const dirOut = join(proyecto, 'out')
  const dirFlujos = join(proyecto, '.fotograma', 'archivos')
  const registro = join(proyecto, '.fotograma', 'publicaciones.json')

  const leerRegistro = (): Publicacion[] => {
    try {
      return JSON.parse(readFileSync(registro, 'utf8'))
    } catch {
      return []
    }
  }
  const guardarRegistro = (l: Publicacion[]) => {
    mkdirSync(join(proyecto, '.fotograma'), { recursive: true })
    writeFileSync(registro + '.tmp', JSON.stringify(l, null, 2))
    renameSync(registro + '.tmp', registro)
  }
  // Las publicaciones en curso se actualizan en memoria y se escriben al cambiar.
  const enCurso = new Map<string, Publicacion>()
  const actualizar = (p: Publicacion) => {
    const l = leerRegistro().filter((x) => x.id !== p.id)
    l.push(p)
    guardarRegistro(l)
  }

  const permitido = (ruta: string) => {
    const r = resolve(ruta)
    const bib = rutaBiblioteca()
    return [dirOut, dirFlujos, ...(bib ? [bib] : [])].some((d) => r.startsWith(d + '/')) && existsSync(r) && /\.(mp4|mov|webm)$/i.test(r)
  }

  // Nombre sin extensión ni la fecha que agrega el render del estudio (Formas-2026-10-01-00-26-01 → Formas).
  const base = (archivo: string) => basename(archivo).replace(/\.(mp4|mov|webm)$/i, '').replace(/-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}$/, '')

  // Datos para prellenar: si el video es de un guion (Guion-<id>.mp4) se usan su título y lo que escribió la IA.
  const datosGuion = (archivo: string) => {
    const id = base(archivo).match(/^Guion-(.+)$/)?.[1]
    if (!id) return null
    const p = join(proyecto, 'guiones', id + '.json')
    if (!existsSync(p)) return null
    const g: Guion = JSON.parse(readFileSync(p, 'utf8'))
    return { guion: g.id, titulo: g.publicacion?.titulo || g.titulo, descripcion: g.publicacion?.descripcion || '', hashtags: g.publicacion?.hashtags || [], canal: g.publicacion?.canal, categoria: g.publicacion?.categoria, idioma: g.idioma }
  }

  return {
    videos: () => {
      const reg = leerRegistro()
      const archivos: string[] = []
      if (existsSync(dirOut)) for (const f of readdirSync(dirOut)) archivos.push(join(dirOut, f))
      if (existsSync(dirFlujos))
        for (const d of readdirSync(dirFlujos)) {
          const sub = join(dirFlujos, d)
          if (statSync(sub).isDirectory()) for (const f of readdirSync(sub)) archivos.push(join(sub, f))
        }
      const todos = archivos
        .filter((f) => /\.(mp4|mov|webm)$/i.test(f))
        .map((f) => {
          const st = statSync(f)
          return {
            ruta: f,
            nombre: basename(f),
            origen: f.startsWith(dirFlujos) ? 'flujo' : 'estudio',
            bytes: st.size,
            fecha: st.mtime.toISOString(),
            datos: datosGuion(f),
            publicaciones: reg.filter((p) => p.ruta === f),
          }
        })
        .sort((a, b) => b.fecha.localeCompare(a.fecha))
      // Varias versiones del mismo video (re-renders) se muestran como una sola tarjeta: la más reciente.
      const grupos = new Map<string, (typeof todos)[number] & { anteriores: { ruta: string; nombre: string; fecha: string }[] }>()
      for (const v of todos) {
        const clave = base(v.ruta)
        const g = grupos.get(clave)
        if (!g) grupos.set(clave, { ...v, anteriores: [] })
        else {
          g.anteriores.push({ ruta: v.ruta, nombre: v.nombre, fecha: v.fecha })
          g.publicaciones.push(...v.publicaciones)
        }
      }
      // La biblioteca (disco externo): un video por carpeta, con lo que dice su info.json.
      // Cuenta de YouTube y categoría por canal (carpeta de la biblioteca): ~/.config/fotograma/config.json → canales.
      const canalesConfig = leerCanales()
      const CUENTA: Record<string, string> = Object.fromEntries(Object.entries(canalesConfig).map(([k, v]) => [k, v.cuenta]))
      const CATEGORIA: Record<string, string> = Object.fromEntries(Object.entries(canalesConfig).map(([k, v]) => [k, v.categoria || '22']))
      const enBiblioteca = listarBiblioteca()
      const biblioteca = enBiblioteca.map((v) => ({
        ruta: v.video,
        nombre: basename(v.carpeta),
        origen: 'biblioteca' as const,
        canal: v.canal,
        bytes: existsSync(v.video) ? statSync(v.video).size : 0,
        fecha: v.fecha,
        datos: {
          guion: v.guion || '',
          titulo: v.titulo,
          descripcion: v.descripcion,
          hashtags: v.hashtags,
          canal: v.plataformas.youtube?.cuenta || CUENTA[v.canal],
          categoria: CATEGORIA[v.canal],
          idioma: v.idioma,
        },
        plataformas: v.plataformas,
        publicaciones: reg.filter((p) => p.ruta === v.video),
        anteriores: [],
      }))
      // Un render que ya se guardó en la biblioteca aparece allá (con sus textos), no repetido acá.
      const archivados = new Set(enBiblioteca.map((v) => v.archivoOriginal).filter(Boolean))
      const sueltos = [...grupos.values()].filter((g) => !archivados.has(g.ruta))
      return [...biblioteca, ...sueltos.map((g) => ({ ...g, canal: '', plataformas: {} }))]
    },

    canales: () => listarCredenciales().filter((c) => c.tipo === 'oauth2').map((c) => c.nombre),

    tiktokDisponible: () => existsSync(join(process.env.HOME || '', 'docker', 'n8n', 'tools', 'tiktok', 'token.json')),

    publicaciones: () => [...enCurso.values()],

    publicar: (b: {
      ruta: string
      youtube?: Omit<OpcionesYoutube, 'tags'> & { tags?: string[] | string }
      tiktok?: { texto: string; publico?: boolean }
    }) => {
      if (!permitido(b.ruta)) throw new Error('Ese archivo no es un video renderizado del proyecto.')
      if (!b.youtube && !b.tiktok) throw new Error('Elige YouTube, TikTok o ambos.')
      if (b.youtube && !b.youtube.titulo?.trim()) throw new Error('Falta el título para YouTube.')
      const p: Publicacion = { id: Date.now().toString(36), ruta: resolve(b.ruta), fecha: new Date().toISOString() }
      if (b.youtube) p.youtube = { estado: 'subiendo', credencial: b.youtube.credencial, privacidad: b.youtube.privacidad }
      if (b.tiktok) p.tiktok = { estado: 'subiendo', privado: !b.tiktok.publico }
      enCurso.set(p.id, p)
      actualizar(p)
      ;(async () => {
        if (b.youtube && p.youtube) {
          try {
            const tags = Array.isArray(b.youtube.tags) ? b.youtube.tags : String(b.youtube.tags || '').split(',')
            const r = await subirYoutube(p.ruta, { ...b.youtube, tags: tags.map((t) => t.replace(/^#/, '').trim()).filter(Boolean) }, undefined, (m) => {
              p.youtube!.mensaje = m
            })
            Object.assign(p.youtube, { estado: 'listo', url: r.url, mensaje: undefined })
            anotarPublicacion(p.ruta, 'youtube', { estado: b.youtube.privacidad === 'private' ? 'privado' : 'publicado', url: r.url, id: r.id, cuenta: b.youtube.credencial })
          } catch (e: any) {
            Object.assign(p.youtube, { estado: 'error', error: e.message, mensaje: undefined })
          }
          actualizar(p)
        }
        if (b.tiktok && p.tiktok) {
          try {
            p.tiktok.mensaje = 'Subiendo a TikTok…'
            const r = await publicarTiktok(p.ruta, b.tiktok.texto, undefined, !!b.tiktok.publico)
            const x: any = r
            Object.assign(p.tiktok, { estado: 'listo', modo: x.modo, status: x.status, postId: x.post_id, privado: x.modo !== 'draft' && r.privacy !== 'PUBLIC_TO_EVERYONE', mensaje: undefined })
            anotarPublicacion(p.ruta, 'tiktok', x.modo === 'draft' ? { estado: 'borrador', nota: 'En la bandeja de TikTok: terminar de publicar desde la app.' } : { estado: x.privacy === 'PUBLIC_TO_EVERYONE' ? 'publicado' : 'privado', id: x.post_id || x.publish_id })
          } catch (e: any) {
            Object.assign(p.tiktok, { estado: 'error', error: e.message, mensaje: undefined })
          }
          actualizar(p)
        }
        setTimeout(() => enCurso.delete(p.id), 60_000)
      })()
      return p
    },

    // Para ver el video en el navegador.
    permitido,
  }
}
