import type { Guion, LineaGuion, Personaje } from './tipos'

const normalizar = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()

export const slug = (s: string) => normalizar(s).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'x'

export type ResultadoParseo = { lineas: LineaGuion[]; desconocidos: string[] }

// Convierte el texto del guion en líneas:
//   Ana: Hola a todos.          → línea de Ana
//   sigue hablando…             → continúa la línea anterior
//   # comentario                → se ignora
// Conserva el audio de las líneas que no cambiaron (misma posición, texto y voz).
export const parsearGuion = (texto: string, personajes: Personaje[], anteriores: LineaGuion[] = []): ResultadoParseo => {
  const porNombre = new Map(personajes.map((p) => [normalizar(p.nombre), p]))
  const lineas: { personaje: string; texto: string }[] = []
  const desconocidos = new Set<string>()

  for (const crudo of texto.split('\n')) {
    const l = crudo.trim()
    if (!l || l.startsWith('#')) continue
    const m = l.match(/^([^:]{1,40}):\s*(.*)$/)
    const p = m ? porNombre.get(normalizar(m[1])) : undefined
    if (m && p) {
      if (m[2]) lineas.push({ personaje: p.id, texto: m[2] })
      else lineas.push({ personaje: p.id, texto: '' })
    } else if (m && !p && /^[\p{L} ]+$/u.test(m[1])) {
      desconocidos.add(m[1].trim())
      lineas.push({ personaje: '', texto: m[2] })
    } else if (lineas.length) {
      const ult = lineas[lineas.length - 1]
      ult.texto = (ult.texto + ' ' + l).trim()
    }
  }

  const usadas = new Set<number>()
  const resultado = lineas
    .filter((l) => l.texto)
    .map((l, i): LineaGuion => {
      const voz = personajes.find((p) => p.id === l.personaje)?.voz ?? ''
      const firma = `${voz}|${l.texto}`
      // Reutiliza el audio de una línea idéntica (aunque se haya movido de lugar).
      const k = anteriores.findIndex((a, j) => !usadas.has(j) && a.firma === firma && a.audio)
      if (k >= 0) {
        usadas.add(k)
        return { ...anteriores[k], personaje: l.personaje, texto: l.texto }
      }
      // Sin audio todavía: si hay una línea igual (mismo personaje y texto), conserva su id y sus ajustes
      // (p. ej. el silencio después que se edita en la línea de tiempo).
      const s = anteriores.findIndex((a, j) => !usadas.has(j) && !a.audio && a.personaje === l.personaje && a.texto === l.texto)
      if (s >= 0) {
        usadas.add(s)
        return { ...anteriores[s] }
      }
      return { id: `l${i + 1}-${Date.now().toString(36)}`, personaje: l.personaje, texto: l.texto }
    })
  return { lineas: resultado, desconocidos: [...desconocidos] }
}

// Duración estimada cuando todavía no hay audio (~14 caracteres por segundo).
export const duracionEstimadaMs = (texto: string) => Math.max(1200, Math.round((texto.length / 14) * 1000))

export const pendientesDeAudio = (g: Guion) => g.lineas.filter((l) => !l.audio || l.firma !== `${g.personajes.find((p) => p.id === l.personaje)?.voz}|${l.texto}`)

// Mueve la línea `de` del guion a la posición `a` reordenando el TEXTO por bloques (la línea «Nombre: …» con sus
// continuaciones; los comentarios y renglones vacíos van con el bloque que sigue), con las mismas reglas de
// parsearGuion. Así reordenar en la línea de tiempo no pierde comentarios ni audios.
export const moverLineaEnTexto = (texto: string, personajes: Personaje[], de: number, a: number) => {
  const nombres = new Set(personajes.map((p) => normalizar(p.nombre)))
  const bloques: { renglones: string[]; tieneTexto: boolean }[] = []
  let pendientes: string[] = [] // comentarios / vacíos antes de un bloque
  for (const crudo of texto.split('\n')) {
    const l = crudo.trim()
    const m = l.match(/^([^:]{1,40}):\s*(.*)$/)
    const empieza = !!m && !l.startsWith('#') && (nombres.has(normalizar(m[1])) || /^[\p{L} ]+$/u.test(m[1]))
    if (empieza) {
      bloques.push({ renglones: [...pendientes, crudo], tieneTexto: !!m![2] })
      pendientes = []
    } else if (!l || l.startsWith('#') || !bloques.length) pendientes.push(crudo)
    else {
      const b = bloques[bloques.length - 1]
      b.renglones.push(...pendientes, crudo)
      pendientes = []
      b.tieneTexto = true
    }
  }
  // Solo los bloques con texto son líneas del guion (igual que parsearGuion).
  const conTexto = bloques.map((b, i) => (b.tieneTexto ? i : -1)).filter((i) => i >= 0)
  if (de < 0 || de >= conTexto.length || a < 0 || a >= conTexto.length || de === a) return texto
  const [movido] = bloques.splice(conTexto[de], 1)
  const destino = bloques.map((b, i) => (b.tieneTexto ? i : -1)).filter((i) => i >= 0)
  const lugar = a >= destino.length ? bloques.length : destino[a]
  bloques.splice(lugar, 0, movido)
  return [...bloques.flatMap((b) => b.renglones), ...pendientes].join('\n')
}
