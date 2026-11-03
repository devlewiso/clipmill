// Edición de una toma por su texto (pestaña Limpiar): las mismas reglas que tutorial.py, en el navegador,
// para que la vista previa y la duración estimada sean exactamente lo que va a salir.
export type Palabra = [string, number, number] // texto, inicio, fin (segundos de la toma original)
export type Corte = { id: number; a: number; b: number; tipo: string; motivo: string; texto: string; activo: boolean }
export type Movido = { a: number; b: number; despues: number } // el bloque [a, b] va después de la palabra que empieza en `despues`
export type Tramo = { a: number; b: number; palabras: number[] } // un pedazo continuo del video final

// El corte quita la palabra si tapa su mitad y su final; si solo tapa el inicio (palabra estirada), la recorta.
export const tapa = (c: { a: number; b: number }, p: Palabra) => c.a <= (p[1] + p[2]) / 2 && (p[1] + p[2]) / 2 <= c.b && p[2] <= c.b + 0.05
export const recorta = (c: { a: number; b: number }, p: Palabra) => c.a <= p[1] && p[1] < c.b && c.b < p[2]

export const bloqueDe = (movidos: Movido[], p: Palabra) => movidos.findIndex((m) => m.a <= (p[1] + p[2]) / 2 && (p[1] + p[2]) / 2 <= m.b)
// Orden en el video final: su tiempo, o justo después de la palabra donde se pegó su bloque.
export const clave = (movidos: Movido[], p: Palabra) => {
  const k = bloqueDe(movidos, p)
  return k < 0 ? p[1] : movidos[k].despues + 0.001 + (p[1] - movidos[k].a) * 1e-5
}

// Índices de las palabras en el orden en que se leen después de mover bloques (las cortadas quedan en su lugar).
export const ordenDeLectura = (palabras: Palabra[], movidos: Movido[]) => palabras.map((_, i) => i).sort((x, y) => clave(movidos, palabras[x]) - clave(movidos, palabras[y]))

// Los tramos del video final, en orden: igual que tutorial.py (aire de -0.1 / +0.14 s, jump-cut en pausas > `pausa`).
export const armarTramos = (palabras: Palabra[], cortes: Corte[], movidos: Movido[], pausa: number, duracion: number): Tramo[] => {
  const quitar = cortes.filter((c) => c.activo)
  const quedan = palabras
    .map((p, i) => ({ i, p, ini: p[1], fin: p[2] }))
    .filter(({ p }) => !quitar.some((c) => tapa(c, p)))
  for (const q of quedan)
    for (const c of quitar) {
      if (c.a <= q.ini && q.ini < c.b && c.b < q.fin) q.ini = c.b
      if (q.ini < c.a && c.a < q.fin && q.fin <= c.b) q.fin = c.a
    }
  const tramos: { ini: number; fin: number; palabras: number[]; bloque: number; a?: number; b?: number }[] = []
  for (const q of quedan) {
    const u = tramos.at(-1)
    const bloque = bloqueDe(movidos, q.p)
    if (u && q.ini - u.fin <= pausa && !quitar.some((c) => u.fin <= c.a && c.a < q.ini) && u.bloque === bloque) (u.fin = q.fin), u.palabras.push(q.i)
    else tramos.push({ ini: q.ini, fin: q.fin, palabras: [q.i], bloque })
  }
  tramos.forEach((t, k) => {
    const antes = k ? tramos[k - 1].fin : 0
    const despues = k + 1 < tramos.length ? tramos[k + 1].ini : duracion
    t.a = Math.max(antes + 0.02, t.ini - 0.1, 0)
    t.b = Math.min(despues - 0.02, t.fin + 0.14, duracion)
  })
  if (movidos.length) tramos.sort((x, y) => clave(movidos, palabras[x.palabras[0]]) - clave(movidos, palabras[y.palabras[0]]))
  return tramos.map((t) => ({ a: t.a!, b: t.b!, palabras: t.palabras }))
}

// Índices seguidos → rangos [desde, hasta] (para cortar una selección que cruza un bloque movido).
export const rachas = (indices: number[]) =>
  [...indices]
    .sort((a, b) => a - b)
    .reduce<[number, number][]>((r, i) => {
      const u = r.at(-1)
      if (u && i === u[1] + 1) u[1] = i
      else r.push([i, i])
      return r
    }, [])
