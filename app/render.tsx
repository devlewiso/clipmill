// Página que usa el renderer: monta una composición a tamaño real y expone window.__fotograma
// para ir frame a frame. Cada irA(frame) espera a que React pinte y a que terminen las cargas.
import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
import composiciones from 'virtual:fotograma/todo'
import { Lienzo } from '../src/nucleo/lienzo'
import { cargasPendientes, todoCargado } from '../src/nucleo/esperas'
import { pistas } from '../src/nucleo/medios'
import { resolverComposicion, type Composicion } from '../src/nucleo/contexto'

document.body.style.margin = '0'
document.body.style.background = 'transparent'
const raiz = createRoot(document.getElementById('raiz')!)

let actual: { comp: Composicion; props: Record<string, any> } | null = null

// Espera a que el navegador pinte. Las pestañas en segundo plano pueden no disparar requestAnimationFrame,
// así que un temporizador corto sirve de respaldo.
const dosCuadros = () =>
  Promise.race([
    new Promise<void>((ok) => requestAnimationFrame(() => requestAnimationFrame(() => ok()))),
    new Promise<void>((ok) => setTimeout(ok, 50)),
  ])

const pintar = (frame: number) => {
  if (!actual) throw new Error('Primero llama a preparar().')
  flushSync(() => raiz.render(<Lienzo composicion={actual!.comp} props={actual!.props} frame={frame} modo="render" />))
}

;(window as any).__fotograma = {
  listo: true,
  composiciones: () =>
    (composiciones as Composicion[]).map((c) => resolverComposicion(c)).map(({ id, ancho, alto, fps, duracion, props, descripcion, carpeta, lufs, ejemplo }) => ({
      ejemplo,
      lufs,
      id,
      ancho,
      alto,
      fps,
      duracion,
      props,
      descripcion,
      carpeta,
    })),
  preparar: async (id: string, props: Record<string, any> = {}) => {
    const comp = (composiciones as Composicion[]).find((c) => c.id === id)
    if (!comp) throw new Error(`No existe la composición "${id}".`)
    actual = { comp, props }
    pistas.clear()
    const r = resolverComposicion(comp, props)
    return { id, ancho: r.ancho, alto: r.alto, fps: r.fps, duracion: r.duracion }
  },
  irA: async (frame: number) => {
    pintar(frame)
    await dosCuadros()
    await todoCargado(60_000)
    await document.fonts.ready
    // Un cambio de estado tras la carga (p. ej. useCarga) necesita otro pintado.
    await dosCuadros()
    if (cargasPendientes().length) await todoCargado(60_000)
  },
  pistas: () => [...pistas.values()],
}
