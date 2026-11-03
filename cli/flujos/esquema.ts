// Validador mínimo de JSON Schema (lo que usan los parsers de n8n): type, properties, required,
// items, minItems/maxItems, minLength/maxLength, minimum/maximum, enum.
// Devuelve la lista de errores en español, para mostrarlos y para pedirle al LLM que corrija.

const tipoDe = (v: any) => (Array.isArray(v) ? 'array' : v === null ? 'null' : Number.isInteger(v) ? 'integer' : typeof v)

export const validar = (v: any, s: any, ruta = '$'): string[] => {
  if (!s || typeof s !== 'object') return []
  const e: string[] = []
  const t = tipoDe(v)
  if (s.type) {
    const tipos: string[] = Array.isArray(s.type) ? s.type : [s.type]
    const ok = tipos.some((x) => x === t || (x === 'number' && t === 'integer'))
    if (!ok) return [`${ruta} debe ser ${tipos.join(' o ')} y es ${t}`]
  }
  if (s.enum && !s.enum.some((x: any) => JSON.stringify(x) === JSON.stringify(v))) e.push(`${ruta} debe ser uno de ${JSON.stringify(s.enum)}`)
  if (typeof v === 'string') {
    if (s.minLength != null && v.length < s.minLength) e.push(`${ruta} tiene ${v.length} caracteres; mínimo ${s.minLength}`)
    if (s.maxLength != null && v.length > s.maxLength) e.push(`${ruta} tiene ${v.length} caracteres; máximo ${s.maxLength}`)
  }
  if (typeof v === 'number') {
    if (s.minimum != null && v < s.minimum) e.push(`${ruta} vale ${v}; mínimo ${s.minimum}`)
    if (s.maximum != null && v > s.maximum) e.push(`${ruta} vale ${v}; máximo ${s.maximum}`)
  }
  if (Array.isArray(v)) {
    if (s.minItems != null && v.length < s.minItems) e.push(`${ruta} tiene ${v.length} elementos; mínimo ${s.minItems}`)
    if (s.maxItems != null && v.length > s.maxItems) e.push(`${ruta} tiene ${v.length} elementos; máximo ${s.maxItems}`)
    if (s.items) v.forEach((x, i) => e.push(...validar(x, s.items, `${ruta}[${i}]`)))
  }
  if (t === 'object') {
    for (const r of s.required || []) if (!(r in v)) e.push(`${ruta}.${r} es obligatorio y falta`)
    for (const [k, sub] of Object.entries(s.properties || {})) if (k in v) e.push(...validar(v[k], sub, `${ruta}.${k}`))
  }
  return e
}
