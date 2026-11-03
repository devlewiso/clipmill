// Avisos flotantes con sonido: renders y ejecuciones de flujos que empiezan o terminan.
import { useEffect, useRef, useState } from 'react'
import { Icono } from './iconos'
import { sonar } from './sonidos'

type Aviso = { id: number; tipo: 'ok' | 'error' | 'info'; titulo: string; texto?: string }

let siguiente = 1
const oyentes = new Set<(a: Aviso) => void>()
export const avisar = (tipo: Aviso['tipo'], titulo: string, texto?: string) => {
  if (document.documentElement.dataset.modo !== 'dinamico') return
  sonar(tipo === 'ok' ? 'exito' : tipo === 'error' ? 'error' : 'inicio')
  const a = { id: siguiente++, tipo, titulo, texto }
  oyentes.forEach((f) => f(a))
}

// Cuántos trabajos hay corriendo (para animar el logo).
const oyentesActividad = new Set<(n: number) => void>()
export const useActividad = () => {
  const [n, setN] = useState(0)
  useEffect(() => (oyentesActividad.add(setN), () => void oyentesActividad.delete(setN)), [])
  return n
}

type Trabajo = { id: number; estado: string; composicion?: string; error?: string }
type Ejecucion = { id: string; estado: string; flujoNombre?: string; error?: string }

export const Avisos = () => {
  const [lista, setLista] = useState<Aviso[]>([])
  const antes = useRef<Map<string, string> | null>(null)

  useEffect(() => {
    const f = (a: Aviso) => {
      setLista((l) => [...l.slice(-3), a])
      setTimeout(() => setLista((l) => l.filter((x) => x.id !== a.id)), a.tipo === 'error' ? 8000 : 5000)
    }
    oyentes.add(f)
    return () => void oyentes.delete(f)
  }, [])

  // Vigila renders y ejecuciones; avisa en cada cambio de estado (la primera lectura solo sirve de base).
  useEffect(() => {
    let vivo = true
    const leer = async () => {
      const [ts, es] = await Promise.all([
        fetch('/__fotograma/api/trabajos').then((r) => r.json()).catch(() => null) as Promise<Trabajo[] | null>,
        fetch('/__fotograma/flujos/ejecuciones').then((r) => r.json()).catch(() => null) as Promise<Ejecucion[] | null>,
      ])
      if (!vivo || !Array.isArray(ts) || !Array.isArray(es)) return
      const ahora = new Map<string, string>()
      ts.forEach((t) => ahora.set('t:' + t.id, t.estado))
      es.slice(0, 30).forEach((e) => ahora.set('e:' + e.id, e.estado))
      const previo = antes.current
      if (previo) {
        for (const t of ts) {
          const p = previo.get('t:' + t.id)
          const nombre = t.composicion ?? 'Render'
          if ((!p || p === 'pendiente') && t.estado === 'corriendo') avisar('info', 'Render en marcha', nombre)
          if (p === 'corriendo' && t.estado === 'listo') avisar('ok', 'Render listo', nombre)
          if (p === 'corriendo' && t.estado === 'error') avisar('error', 'El render falló', t.error)
        }
        for (const e of es.slice(0, 30)) {
          const p = previo.get('e:' + e.id)
          const nombre = e.flujoNombre ?? 'Flujo'
          if (!p && e.estado === 'corriendo') avisar('info', 'Flujo en marcha', nombre)
          if (p === 'corriendo' && e.estado === 'ok') avisar('ok', 'Flujo terminado', nombre)
          if (p === 'corriendo' && (e.estado === 'error' || e.estado === 'cancelada')) avisar('error', e.estado === 'error' ? 'El flujo falló' : 'Flujo cancelado', e.error?.slice(0, 140) ?? nombre)
        }
      }
      antes.current = ahora
      const activos = [...ahora.values()].filter((v) => v === 'corriendo').length
      oyentesActividad.forEach((f) => f(activos))
    }
    leer()
    const t = setInterval(leer, 2500)
    return () => ((vivo = false), clearInterval(t))
  }, [])

  return (
    <div className="avisos" aria-live="polite">
      {lista.map((a) => (
        <div key={a.id} className={'aviso-flotante ' + a.tipo} onClick={() => setLista((l) => l.filter((x) => x.id !== a.id))}>
          <span className="aviso-icono">
            <Icono n={a.tipo} t={16} />
          </span>
          <div className="aviso-texto">
            <b>{a.titulo}</b>
            {a.texto && <small>{a.texto}</small>}
          </div>
          <i className="aviso-tiempo" />
        </div>
      ))}
    </div>
  )
}
