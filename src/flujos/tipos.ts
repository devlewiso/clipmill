// Tipos compartidos entre el editor (navegador) y el motor (Node).

export type Item = {
  json: Record<string, any>
  // Ruta absoluta de un archivo asociado al item (video, audio, imagen…). Equivale al "binary" de n8n.
  archivo?: string
  // De qué item de cada nodo anterior viene este item (para $('Nodo').item, como el pairedItem de n8n).
  pareo?: Record<string, number>
}

export type NodoFlujo = {
  id: string
  nombre: string // único dentro del flujo; es lo que se usa en $('Nombre')
  tipo: string // id del catálogo, p. ej. "http" o "llm"
  posicion: { x: number; y: number }
  params: Record<string, any>
  desactivado?: boolean
  continuarEnError?: boolean
  siempreSalida?: boolean // si no devuelve items, sigue con uno vacío ("Always Output Data" de n8n)
}

export type Conexion = {
  id: string
  origen: string // id del nodo
  salida: number // índice de salida del nodo de origen
  destino: string
  entrada: number
}

export type Flujo = {
  id: string
  nombre: string
  activo: boolean // si está activo, sus triggers programados y webhooks funcionan
  nodos: NodoFlujo[]
  conexiones: Conexion[]
  actualizado?: string
  origenN8n?: string // id del workflow de n8n del que se importó
}

export type EstadoNodo = 'esperando' | 'corriendo' | 'ok' | 'error'

export type CorridaNodo = {
  nodo: string // nombre
  inicio: string
  ms: number
  estado: 'ok' | 'error'
  entrada: Item[]
  salidas: Item[][]
  error?: string
}

export type Ejecucion = {
  id: string
  flujoId: string
  flujoNombre: string
  modo: 'manual' | 'programado' | 'webhook'
  estado: 'corriendo' | 'ok' | 'error' | 'cancelada'
  inicio: string
  fin?: string
  corridas: CorridaNodo[]
  error?: string
}

// Eventos que el motor envía en vivo al editor (Server-Sent Events).
export type EventoMotor =
  | { tipo: 'inicio'; ejecucion: string; flujoId: string }
  | { tipo: 'nodo-inicio'; ejecucion: string; nodo: string }
  | { tipo: 'nodo-fin'; ejecucion: string; nodo: string; ms: number; items: number[] }
  | { tipo: 'nodo-error'; ejecucion: string; nodo: string; error: string }
  | { tipo: 'log'; ejecucion: string; nodo: string; mensaje: string }
  | { tipo: 'fin'; ejecucion: string; estado: Ejecucion['estado']; error?: string }
