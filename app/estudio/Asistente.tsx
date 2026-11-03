// Asistente: chat al costado del estudio que hace cambios con herramientas (guiones, clips, flujos,
// recursos). Lo que cuesta dinero, ejecuta flujos o borra aparece como tarjeta para confirmar.
import { useEffect, useRef, useState } from 'react'
import { api } from './api'
import { avisarCambios, contextoAgente, type CambioAgente } from './contextoAgente'

type Mensaje = { role: string; content: string; tool_calls?: any[]; tool_name?: string }
type Paso = { herramienta: string; args: Record<string, any>; ok: boolean; resumen: string }
type Pendiente = { llamada: any; descripcion: string }
type Respuesta = { mensajes: Mensaje[]; pasos: Paso[]; cambios: CambioAgente[]; pendiente?: Pendiente; texto: string }
type Vista = { tipo: 'usuario' | 'asistente' | 'paso' | 'error' | 'aviso'; texto: string; ok?: boolean }

const NOMBRES: Record<string, string> = {
  listar_guiones: 'Revisé tus videos',
  leer_guion: 'Leí el guion',
  editar_guion: 'Edité el guion',
  editar_linea: 'Cambié la frase',
  cambiar_clip: 'Generé el clip',
  editar_clip: 'Ajusté el clip',
  crear_guion: 'Creé el guion',
  regenerar_voz: 'Generando la voz',
  borrar_guion: 'Mandé a la papelera',
  listar_flujos: 'Revisé los flujos',
  leer_flujo: 'Leí el flujo',
  plantillas_de_flujo: 'Revisé las plantillas',
  crear_flujo: 'Creé el flujo',
  editar_nodo: 'Edité el nodo',
  tipos_de_nodo: 'Revisé los tipos de nodo',
  agregar_nodo: 'Agregué el nodo',
  ejecutar_flujo: 'Ejecuté el flujo',
  activar_flujo: 'Cambié el estado del flujo',
  generar_recurso: 'Generé el recurso',
  listar_recursos: 'Revisé los recursos',
  listar_videos: 'Revisé la biblioteca',
  listar_composiciones: 'Revisé las composiciones',
  encolar_render: 'Lo puse en la cola',
  retake_tramo: 'Encolé el retake',
  ver_cola: 'Revisé la cola',
  cancelar_trabajo: 'Cancelé el trabajo',
  mover_trabajo: 'Reordené la cola',
}

const SUGERENCIAS: Record<string, string[]> = {
  composiciones: ['Mejora la imagen del clip 3 manteniendo el mismo sujeto', 'Cambia la transición a fundido y quita el grano', 'Reescribe el gancho de la primera frase'],
  guiones: ['Crea un guion de 6 frases sobre por qué el cielo es azul', 'Revisa este guion y propón un mejor título'],
  flujos: ['Crea un flujo de diálogo entre dos personajes', 'Cambia el horario de este flujo a las 18:00', '¿Qué hace este flujo paso a paso?'],
  videos: ['¿Qué videos tengo sin publicar en TikTok?', 'Encolá el render de Titulo-Vertical', '¿Cómo va la cola?'],
  recursos: ['Genera un fondo horizontal de una ciudad futurista al atardecer'],
}

const GUARDADO = 'fotograma:asistente'
const leerGuardado = (): { historial: Mensaje[]; vista: Vista[] } => {
  try {
    return JSON.parse(localStorage.getItem(GUARDADO) || '') || { historial: [], vista: [] }
  } catch {
    return { historial: [], vista: [] }
  }
}

export const Asistente = ({ abierto, cerrar }: { abierto: boolean; cerrar: () => void }) => {
  const inicial = useRef(leerGuardado()).current
  const [historial, setHistorial] = useState<Mensaje[]>(inicial.historial)
  const [vista, setVista] = useState<Vista[]>(inicial.vista)
  const [pendiente, setPendiente] = useState<Pendiente | null>(null)
  const [texto, setTexto] = useState('')
  const [pensando, setPensando] = useState(false)
  const fin = useRef<HTMLDivElement>(null)
  const entrada = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    try {
      // Se guarda lo último (el historial del modelo puede crecer mucho).
      localStorage.setItem(GUARDADO, JSON.stringify({ historial: historial.slice(-60), vista: vista.slice(-120) }))
    } catch {}
  }, [historial, vista])
  useEffect(() => fin.current?.scrollIntoView({ block: 'end' }), [vista, pensando, pendiente])
  useEffect(() => {
    if (abierto) entrada.current?.focus()
  }, [abierto])

  const procesar = (base: Mensaje[], r: Respuesta) => {
    setHistorial([...base, ...r.mensajes])
    setVista((v) => [
      ...v,
      ...r.pasos.map((p): Vista => ({ tipo: 'paso', ok: p.ok, texto: `${NOMBRES[p.herramienta] || p.herramienta}${p.resumen ? ': ' + p.resumen : ''}` })),
      ...(r.texto.trim() ? [{ tipo: 'asistente' as const, texto: r.texto.trim() }] : []),
    ])
    setPendiente(r.pendiente || null)
    avisarCambios(r.cambios)
  }

  const pedir = async (base: Mensaje[], decision?: { llamada: any; confirmar: boolean }) => {
    setPensando(true)
    try {
      const r = await api<Respuesta>('agente', { cuerpo: { historial: base, contexto: { ...contextoAgente }, decision } })
      procesar(base, r)
    } catch (e: any) {
      setVista((v) => [...v, { tipo: 'error', texto: e.message }])
    } finally {
      setPensando(false)
    }
  }

  const enviar = (t = texto) => {
    const msg = t.trim()
    if (!msg || pensando || pendiente) return
    setTexto('')
    setVista((v) => [...v, { tipo: 'usuario', texto: msg }])
    pedir([...historial, { role: 'user', content: msg }])
  }

  const decidir = (confirmar: boolean) => {
    if (!pendiente) return
    setVista((v) => [...v, { tipo: 'aviso', texto: (confirmar ? '✔ Confirmado: ' : '✕ Cancelado: ') + pendiente.descripcion }])
    const p = pendiente
    setPendiente(null)
    pedir(historial, { llamada: p.llamada, confirmar })
  }

  const nueva = () => {
    setHistorial([])
    setVista([])
    setPendiente(null)
  }

  if (!abierto) return null
  const sugerencias = SUGERENCIAS[contextoAgente.pestana || ''] || []
  return (
    <aside className="asistente">
      <div className="asistente-cab">
        <b>✦ Asistente</b>
        <span className="tenue pequeno">edita, crea y genera por ti</span>
        <span className="espacio" />
        <button className="mini" onClick={nueva} title="Empezar de cero">
          nueva
        </button>
        <button className="mini" onClick={cerrar}>
          ✕
        </button>
      </div>
      <div className="asistente-mensajes">
        {!vista.length && (
          <div className="asistente-vacio">
            <p>Pídeme cambios en lenguaje normal: editar clips con prompts, reescribir frases, crear guiones o flujos, generar imágenes para Recursos…</p>
            <p className="tenue pequeno">Lo que cuesta dinero (Kie), ejecuta flujos o borra te lo pregunto antes. Nunca publico.</p>
            {sugerencias.map((s) => (
              <button key={s} className="sugerencia" onClick={() => enviar(s)}>
                {s}
              </button>
            ))}
          </div>
        )}
        {vista.map((m, i) => (
          <div key={i} className={'burbuja b-' + m.tipo + (m.ok === false ? ' fallo' : '')}>
            {m.tipo === 'paso' && <span className="icono-paso">{m.ok === false ? '⚠' : '⚙'}</span>}
            {m.texto}
          </div>
        ))}
        {pendiente && (
          <div className="confirmar-accion">
            <div>
              <b>¿Lo hago?</b> {pendiente.descripcion}
            </div>
            <div className="fila">
              <button className="primario" onClick={() => decidir(true)}>
                Confirmar
              </button>
              <button onClick={() => decidir(false)}>Cancelar</button>
            </div>
          </div>
        )}
        {pensando && <div className="burbuja b-pensando">Pensando…</div>}
        <div ref={fin} />
      </div>
      <div className="asistente-entrada">
        <textarea
          ref={entrada}
          value={texto}
          rows={2}
          placeholder={pendiente ? 'Confirma o cancela la acción de arriba…' : 'Escribe qué quieres cambiar o crear…'}
          disabled={!!pendiente}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) (e.preventDefault(), enviar())
          }}
        />
        <button className="primario" disabled={pensando || !!pendiente || !texto.trim()} onClick={() => enviar()}>
          Enviar
        </button>
      </div>
    </aside>
  )
}
