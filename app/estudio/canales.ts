import type { Composicion } from '../../src/nucleo/contexto'

// Pestaña «Canales» de Composiciones (incluye los guiones del usuario, que van al canal según su id): cada composición va a su canal (por id o carpeta) y, dentro, a una subcarpeta.
// Para un canal nuevo basta con agregar una línea aquí; la primera regla que coincide gana.
type Canal = { nombre: string; icono: string; prueba: (c: Composicion) => boolean }

const id = (re: RegExp) => (c: Composicion) => re.test(c.id)
const carpeta = (re: RegExp) => (c: Composicion) => re.test(c.carpeta || '')
const alguno = (...ps: ((c: Composicion) => boolean)[]) => (c: Composicion) => ps.some((p) => p(c))

export const CANALES: Canal[] = [
  { nombre: 'Estilos y plantillas', icono: '🧰', prueba: carpeta(/^(Estilos|Personajes|Plantillas)$/) },
  // Ejemplo de canal propio: todo lo que empiece con «MiCanal-» o esté en la carpeta «Mi canal».
  { nombre: 'Mi canal', icono: '📺', prueba: alguno(id(/^MiCanal-/), carpeta(/^Mi canal/)) },
  { nombre: 'Otros', icono: '🗂️', prueba: () => true },
]

export const ORDEN = ['Mi canal', 'Otros', 'Estilos y plantillas']

export const canalDe = (c: Composicion) => CANALES.find((k) => k.prueba(c))!

const fechaDe = (c: Composicion) => c.id.match(/\d{4}-\d{2}-\d{2}/)?.[0]
const diaCorto = (f: string) => new Date(f + 'T12:00').toLocaleDateString('es', { weekday: 'short', day: 'numeric', month: 'short' }).replace(/,/g, '')

// Subcarpeta dentro del canal: la carpeta sin el nombre del canal delante («Mi canal · clips» → «clips»).
// Si el id trae fecha, el día se escribe siempre igual («Domingo 11 · Facebook», «flujo · 2026-10-15» → «dom 11 oct · …»)
// y las carpetas genéricas («Mi canal») se parten por día para no tener 40 videos sueltos.
const DIA = /^(lunes|martes|miércoles|jueves|viernes|sábado|domingo|lun|mar|mié|jue|vie|sáb|dom)\.? \d{1,2}\b\s*/i
const subcarpetaDe = (c: Composicion) => {
  if (c.carpeta === 'Guiones') return '✎ Mis videos (guiones)'
  let sub = (c.carpeta || '').replace(/^(Mi canal)\s*·\s*/, '')
  if (/^(Mi canal)$/.test(sub)) sub = ''
  const f = fechaDe(c)
  if (!f) return sub || 'General'
  const resto = sub.replace(DIA, '').replace(/\d{4}-\d{2}-\d{2}/, '').replace(/^[\s·]+|[\s·]+$/g, '')
  if (sub && resto === sub) return sub // carpeta con nombre propio (Evolución, Noticias, Semana 1…)
  return diaCorto(f) + (resto ? ' · ' + resto : '')
}

export type GrupoCanal = { canal: Canal; total: number; subcarpetas: [string, Composicion[]][] }

// Canales en el orden de ORDEN (las reglas de CANALES van en otro orden para que la más específica gane); subcarpetas con lo más nuevo arriba.
export const agruparPorCanal = (lista: Composicion[]): GrupoCanal[] => {
  const grupos = new Map<Canal, Map<string, Composicion[]>>()
  for (const c of lista) {
    const k = canalDe(c)
    const subs = grupos.get(k) ?? grupos.set(k, new Map()).get(k)!
    const s = subcarpetaDe(c)
    ;(subs.get(s) ?? subs.set(s, []).get(s)!).push(c)
  }
  const cuando = (c: Composicion) => String(c.props?.guion?.actualizado || fechaDe(c) || '')
  const reciente = (cs: Composicion[]) => cs.map(fechaDe).filter(Boolean).sort().pop() || ''
  const orden = ORDEN.map((n) => CANALES.find((k) => k.nombre === n)!)
  return orden
    .filter((k) => grupos.has(k))
    .map((canal) => {
      const subcarpetas = [...grupos.get(canal)!.entries()]
        .map(([n, cs]) => [n, cs.sort((a, b) => cuando(b).localeCompare(cuando(a)) || a.id.localeCompare(b.id))] as [string, Composicion[]])
        // Los guiones (lo que el usuario edita) van primero en su canal; después, lo más nuevo arriba.
        .sort(([na, a], [nb, b]) => Number(nb.startsWith('✎')) - Number(na.startsWith('✎')) || reciente(b).localeCompare(reciente(a)) || na.localeCompare(nb, 'es'))
      return { canal, total: subcarpetas.reduce((n, [, cs]) => n + cs.length, 0), subcarpetas }
    })
}

// Pestaña «Ejemplos»: el mismo formato de bloques plegables, uno por carpeta (Título, Demos, Edits…).
const ICONOS_EJEMPLOS: Record<string, string> = { Título: '🔤', Demos: '✨', Edits: '🎞️', Plantillas: '🧩' }
export const agruparEjemplos = (lista: Composicion[]): GrupoCanal[] => {
  const grupos = new Map<string, Composicion[]>()
  for (const c of lista) (grupos.get(c.carpeta || 'Otros') ?? grupos.set(c.carpeta || 'Otros', []).get(c.carpeta || 'Otros')!).push(c)
  return [...grupos.entries()]
    .sort(([a], [b]) => a.localeCompare(b, 'es'))
    .map(([nombre, cs]) => ({ canal: { nombre, icono: ICONOS_EJEMPLOS[nombre] ?? '🧪', prueba: () => true }, total: cs.length, subcarpetas: [['', cs]] }))
}
