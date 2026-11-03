// Servidor Vite que sirve el estudio (/) y la página de render (/__fotograma/render) del proyecto del usuario.
import react from '@vitejs/plugin-react'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createServer, type Plugin, type PluginOption, type ViteDevServer } from 'vite'

export const RAIZ_FOTOGRAMA = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const APP = join(RAIZ_FOTOGRAMA, 'app')
const SRC = join(RAIZ_FOTOGRAMA, 'src')

export type OpcionesServidor = {
  proyecto?: string // carpeta del proyecto (por defecto, la actual)
  entrada?: string // archivo que exporta las composiciones
  puerto?: number
  alRecibir?: (s: ViteDevServer) => void // para montar rutas extra (el estudio agrega la API de render)
  recargaEnVivo?: boolean // solo el estudio; en un render una recarga rompería la captura
}

export const buscarEntrada = (proyecto: string, entrada?: string) => {
  const candidatos = entrada ? [entrada] : ['src/composiciones.tsx', 'src/composiciones.ts', 'src/index.tsx']
  for (const c of candidatos) {
    const p = resolve(proyecto, c)
    if (existsSync(p)) return p
  }
  throw new Error(`No encontré el archivo de composiciones (${candidatos.join(', ')}). Usa --entrada.`)
}

const html = (titulo: string, script: string) => `<!doctype html>
<html lang="es"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />
<link rel="icon" href="data:," /><title>${titulo}</title></head><body><div id="raiz"></div>
<script type="module" src="/@fs${script}"></script></body></html>`

const pluginFotograma = (entrada: string, extra?: (s: ViteDevServer) => void): Plugin => ({
  name: 'fotograma',
  resolveId(id) {
    if (id === 'virtual:fotograma/proyecto') return '\0fotograma-proyecto'
    if (id === 'virtual:fotograma/todo') return '\0fotograma-todo'
  },
  load(id) {
    // Solo las del proyecto: el estudio carga los guiones por la API para no recargarse al guardarlos.
    if (id === '\0fotograma-proyecto') return `export { default } from ${JSON.stringify('/@fs' + entrada)}`
    // Para el render: las del proyecto + una por cada guion guardado en guiones/*.json.
    if (id === '\0fotograma-todo')
      return `import usuario from ${JSON.stringify('/@fs' + entrada)}
import { composicionDeGuion } from ${JSON.stringify('/@fs' + join(SRC, 'guion', 'composicion.tsx'))}
const guiones = import.meta.glob('/guiones/*.json', { eager: true, import: 'default' })
export default [...usuario, ...Object.values(guiones).map((g) => composicionDeGuion(g))]`
  },
  // Los datos que escriben los flujos (guiones, audios de la voz, tablas, ejecuciones) no son código:
  // si llegan al recargador de Vite, como el módulo de composiciones importa guiones/*.json y nadie acepta
  // el cambio, Vite recarga TODAS las pestañas (el editor de flujos "parpadea" en cada audio de la voz).
  // Se invalida el módulo para que el próximo render vea el guion nuevo, pero no se recarga nada.
  hotUpdate(o) {
    const raiz = this.environment.config.root
    const datos = ['guiones', 'flujos', 'datos', 'out', '.fotograma', join('public', 'guiones')].map((d) => join(raiz, d) + '/')
    if (!datos.some((d) => o.file.startsWith(d))) return
    const todo = this.environment.moduleGraph.getModuleById('\0fotograma-todo')
    if (todo) this.environment.moduleGraph.invalidateModule(todo)
    return []
  },
  // Se registra antes que los middlewares de Vite para que estas rutas no caigan en su 404.
  configureServer(server) {
    extra?.(server)
    server.middlewares.use(async (req, res, next) => {
      const ruta = (req.url || '').split('?')[0]
      const pagina = ruta === '/__fotograma/render' ? html('Clipmill · render', join(APP, 'render.tsx')) : ruta === '/' ? html('Clipmill · estudio', join(APP, 'estudio', 'main.tsx')) : null
      if (!pagina) return next()
      res.setHeader('Content-Type', 'text/html; charset=utf-8')
      res.end(await server.transformIndexHtml(ruta, pagina))
    })
  },
})

// Plugins opcionales del proyecto (p. ej. Tailwind v4) si están instalados allí.
const pluginsDelProyecto = async (proyecto: string): Promise<PluginOption[]> => {
  const requerir = createRequire(join(proyecto, 'package.json'))
  try {
    const ruta = requerir.resolve('@tailwindcss/vite')
    const mod = await import(pathToFileURL(ruta).href)
    return [mod.default()]
  } catch {
    return []
  }
}

// Subrutas de "fotograma/…" → archivos de src (las mismas que en package.json#exports).
const SUBRUTAS: Record<string, string> = {
  transiciones: 'transiciones/index.tsx',
  fx: 'fx/index.tsx',
  formas: 'formas/index.tsx',
  trazos: 'trazos.ts',
  ruido: 'ruido.ts',
  subtitulos: 'subtitulos.ts',
  guion: 'guion/index.ts',
  ritmo: 'ritmo.ts',
  color: 'color.tsx',
}

export const abrirServidor = async (o: OpcionesServidor = {}) => {
  const proyecto = resolve(o.proyecto || process.cwd())
  const entrada = buscarEntrada(proyecto, o.entrada)
  const server = await createServer({
    configFile: false,
    root: proyecto,
    publicDir: join(proyecto, 'public'),
    logLevel: 'warn',
    clearScreen: false,
    plugins: [react(), pluginFotograma(entrada, o.alRecibir), ...(await pluginsDelProyecto(proyecto))],
    resolve: {
      // Un solo React y un solo núcleo de Fotograma para el estudio y el proyecto.
      dedupe: ['react', 'react-dom'],
      alias: [
        { find: /^fotograma$/, replacement: join(SRC, 'index.ts') },
        ...Object.entries(SUBRUTAS).map(([k, v]) => ({ find: new RegExp(`^fotograma/${k}$`), replacement: join(SRC, v) })),
      ],
    },
    // Se analizan todas las entradas al arrancar: si Vite descubre una dependencia a mitad de un render,
    // la reoptimiza y recarga la página, y la captura se pierde.
    optimizeDeps: {
      entries: [entrada, join(APP, 'render.tsx'), join(APP, 'estudio', 'main.tsx')],
      include: ['react', 'react-dom', 'react-dom/client', 'react/jsx-runtime', 'react/jsx-dev-runtime'],
    },
    server: {
      host: process.env.FOTOGRAMA_HOST || '127.0.0.1',
      port: o.puerto ?? 0,
      strictPort: !!o.puerto,
      hmr: o.recargaEnVivo ? undefined : false,
      fs: { allow: [proyecto, RAIZ_FOTOGRAMA] },
    },
  })
  await server.listen()
  const direccion = server.httpServer?.address()
  const puerto = typeof direccion === 'object' && direccion ? direccion.port : o.puerto
  return { server, url: `http://127.0.0.1:${puerto}`, proyecto, entrada }
}
