import { aplicarCredencial } from '../credenciales'
import { validar } from '../esquema'
import type { CtxNodo, Ejecutor } from '../motor'
import { conTimeout, porItem, recorte } from './util'

type Mensaje = { role: 'system' | 'user' | 'assistant'; content: string }

const OLLAMA = process.env.OLLAMA_HOST || 'http://127.0.0.1:11434'

const llamarOllama = async (c: CtxNodo, modelo: string, mensajes: Mensaje[], esquema: any, temperatura: number) => {
  const cuerpo = (pensar: boolean | undefined) => ({
    model: modelo,
    messages: mensajes,
    stream: false,
    ...(pensar === false ? { think: false } : {}),
    ...(esquema ? { format: esquema } : {}),
    options: { temperature: temperatura, num_ctx: 16384 },
  })
  let res = await fetch(OLLAMA + '/api/chat', { method: 'POST', body: JSON.stringify(cuerpo(false)), signal: conTimeout(c.senal, 600) })
  // Algunos modelos no aceptan el parámetro think: se reintenta sin él.
  if (!res.ok && /think/i.test(await res.clone().text())) {
    res = await fetch(OLLAMA + '/api/chat', { method: 'POST', body: JSON.stringify(cuerpo(undefined)), signal: conTimeout(c.senal, 600) })
  }
  if (!res.ok) throw new Error(`Ollama ${res.status}: ${recorte(await res.text())}`)
  const d: any = await res.json()
  return String(d.message?.content ?? '')
}

const llamarOpenAI = async (c: CtxNodo, i: number, modelo: string, mensajes: Mensaje[], esquema: any, temperatura: number) => {
  const base = String(c.param('baseUrl', i) || '').replace(/\/+$/, '')
  const headers = await aplicarCredencial(String(c.param('credencial', i) || ''), { 'Content-Type': 'application/json' })
  const res = await fetch(base + '/chat/completions', {
    method: 'POST',
    headers,
    body: JSON.stringify({ model: modelo, messages: mensajes, temperature: temperatura, ...(esquema ? { response_format: { type: 'json_object' } } : {}) }),
    signal: conTimeout(c.senal, 600),
  })
  if (!res.ok) throw new Error(`${new URL(base).host} ${res.status}: ${recorte(await res.text())}`)
  const d: any = await res.json()
  return String(d.choices?.[0]?.message?.content ?? '')
}

// Saca el JSON de una respuesta aunque venga envuelto en ```json … ``` o con texto alrededor.
const extraerJson = (texto: string) => {
  const bloque = texto.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]
  for (const t of bloque ? [texto, bloque] : [texto]) {
    try {
      return JSON.parse(t)
    } catch {}
    const a = t.indexOf('{')
    const b = t.lastIndexOf('}')
    if (a >= 0 && b > a) {
      try {
        return JSON.parse(t.slice(a, b + 1))
      } catch {}
    }
  }
  throw new Error('La respuesta no es un JSON válido.')
}

const llm: Ejecutor = async (c) =>
  porItem(c, async (_it, i) => {
    const esquema = c.json('esquema', i)
    const temperatura = Number(c.param('temperatura', i) ?? 0.8)
    const reintentos = Math.max(0, Number(c.param('reintentos', i) ?? 2))
    const proveedor = c.param('proveedor', i)
    const modelos = [c.param('modelo', i), c.param('respaldo', i)].map((m) => String(m || '').trim()).filter(Boolean)
    let sistema = String(c.param('sistema', i) || '')
    if (esquema)
      sistema +=
        '\n\nResponde ÚNICAMENTE con un objeto JSON válido (sin texto antes ni después) que cumpla exactamente este JSON Schema:\n' +
        JSON.stringify(esquema)
    const prompt = String(c.param('prompt', i) || '')
    const fallos: string[] = []

    for (const modelo of modelos) {
      const mensajes: Mensaje[] = [
        ...(sistema.trim() ? [{ role: 'system' as const, content: sistema }] : []),
        { role: 'user', content: prompt },
      ]
      for (let intento = 0; intento <= reintentos; intento++) {
        let texto = ''
        try {
          c.log(`${modelo} · intento ${intento + 1}`)
          texto =
            proveedor === 'openai'
              ? await llamarOpenAI(c, i, modelo, mensajes, esquema, temperatura)
              : await llamarOllama(c, modelo, mensajes, esquema, temperatura)
        } catch (e: any) {
          if (c.senal.aborted) throw e
          fallos.push(`${modelo}: ${e.message}`)
          break // error de red o de la API: pasar al modelo de respaldo
        }
        if (!esquema) return { json: { output: texto, modelo } }
        let errores: string[]
        let datos: any
        try {
          datos = extraerJson(texto)
          errores = validar(datos, esquema)
        } catch (e: any) {
          errores = [e.message]
        }
        if (!errores.length) return { json: { output: datos, modelo, intentos: intento + 1 } }
        fallos.push(`${modelo} (intento ${intento + 1}): ${errores.slice(0, 4).join('; ')}`)
        c.log('No cumple el esquema: ' + errores.slice(0, 4).join('; '))
        // Se le devuelve el error al modelo para que corrija, como el "auto-fix" de n8n.
        mensajes.push(
          { role: 'assistant', content: texto },
          { role: 'user', content: 'Tu respuesta no cumple el esquema:\n- ' + errores.slice(0, 8).join('\n- ') + '\nDevuelve el JSON completo corregido.' },
        )
      }
    }
    throw new Error('Ningún modelo dio una respuesta válida.\n' + fallos.join('\n'))
  })

export const ia: Record<string, Ejecutor> = { llm }
