// Protección contra órdenes que llegan desde otras páginas web (CSRF).
// El estudio escucha solo en 127.0.0.1, pero cualquier página abierta en el navegador puede mandarle un POST
// «simple» (text/plain o un formulario) a http://127.0.0.1:3060 sin que el navegador lo frene. Ejercicio de
// seguridad del 2026-11-23 (bóveda: Seguridad-Asgard/ejercicios/2026-11-23-clipmill-publico.md): así se podían
// encolar renders, cancelar trabajos y crear flujos desde una web cualquiera.
//
// Regla: en /__fotograma/* y /webhook*, todo lo que no sea GET/HEAD/OPTIONS se rechaza si el navegador avisa que viene
// de otro sitio (Origin, Referer o Sec-Fetch-Site). curl, scripts y n8n locales no mandan esos encabezados y siguen
// funcionando. Se puede apagar con CLIPMILL_SIN_CHEQUEO_ORIGEN=1 (no recomendado).
import type { IncomingMessage, ServerResponse } from 'node:http'

const SEGUROS = new Set(['GET', 'HEAD', 'OPTIONS'])

const hostDe = (valor?: string) => {
  if (!valor || valor === 'null') return valor === 'null' ? 'null' : null
  try {
    return new URL(valor).host
  } catch {
    return 'invalido'
  }
}

/** Devuelve el motivo del rechazo, o null si el pedido es aceptable. */
export const motivoRechazo = (req: Pick<IncomingMessage, 'method' | 'url' | 'headers'>): string | null => {
  if (process.env.CLIPMILL_SIN_CHEQUEO_ORIGEN === '1') return null
  const ruta = (req.url || '').split('?')[0]
  if (!ruta.startsWith('/__fotograma/') && !/^\/webhook(-test)?\//.test(ruta)) return null
  if (SEGUROS.has((req.method || 'GET').toUpperCase())) return null
  const h = req.headers
  const propio = String(h.host || '')
  const sitio = String(h['sec-fetch-site'] || '')
  if (sitio && sitio !== 'same-origin' && sitio !== 'none') return `sec-fetch-site ${sitio}`
  const origen = hostDe(h.origin as string | undefined)
  if (origen && origen !== propio) return `origin ${origen}`
  if (!origen) {
    const ref = hostDe(h.referer as string | undefined)
    if (ref && ref !== propio) return `referer ${ref}`
  }
  return null
}

/** Middleware para el servidor del estudio (Vite/connect). Va antes que cualquier ruta de la API. */
export const chequeoOrigen = (req: IncomingMessage, res: ServerResponse, next: () => void) => {
  const motivo = motivoRechazo(req)
  if (!motivo) return next()
  console.warn(`[seguridad] origen rechazado (${motivo}): ${req.method} ${(req.url || '').split('?')[0]}`)
  res.statusCode = 403
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify({ error: 'Pedido rechazado: viene de otra página. El estudio solo acepta órdenes desde su propia pestaña o desde la terminal.' }))
}
