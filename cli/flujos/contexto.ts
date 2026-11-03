// Lo que los nodos de Fotograma necesitan del estudio: el servidor de Vite (para renderizar)
// y la API de guiones del proyecto abierto.
import type { abrirServidor } from '../servidor'
import type { crearApiGuiones } from '../guiones'
import type { Cola } from '../cola'

export const estudio: {
  servidor: Awaited<ReturnType<typeof abrirServidor>> | null
  guiones: ReturnType<typeof crearApiGuiones> | null
  cola: Cola | null
} = { servidor: null, guiones: null, cola: null }
