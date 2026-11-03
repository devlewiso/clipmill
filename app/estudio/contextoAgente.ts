// Lo que el usuario tiene abierto (para que el asistente entienda "este clip", "este flujo") y el
// aviso de cambios hechos por el asistente, para que cada pestaña recargue lo suyo.
export type CambioAgente = { tipo: 'guion' | 'flujo' | 'recurso'; id?: string }

export const contextoAgente: { pestana?: string; composicion?: string; guion?: string; flujo?: string } = {}

export const avisarCambios = (cambios: CambioAgente[]) => {
  if (cambios.length) window.dispatchEvent(new CustomEvent('fotograma:cambios', { detail: cambios }))
}

export const alCambiarDatos = (fn: (cambios: CambioAgente[]) => void) => {
  const h = (e: Event) => fn((e as CustomEvent<CambioAgente[]>).detail)
  window.addEventListener('fotograma:cambios', h)
  return () => window.removeEventListener('fotograma:cambios', h)
}
