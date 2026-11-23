import { useCallback, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import composiciones from 'virtual:fotograma/proyecto'
import { composicionDeGuion } from '../../src/guion/composicion'
import type { Guion } from '../../src/guion/tipos'
import type { Composicion } from '../../src/nucleo/contexto'
import { api } from './api'
import { Composiciones } from './Composiciones'
import { Recursos } from './Recursos'
import { Avisos, useActividad } from './Avisos'
import { Icono } from './iconos'
import { activarTicGlobal, alCambiarSilencio, setSilenciado, silenciado, sonar } from './sonidos'
import { alCambiarDatos, contextoAgente } from './contextoAgente'
import './estilos.css'

// Los guiones se editan dentro de Composiciones (botón «Editar guion»); ya no tienen pestaña propia.
type Pestana = 'composiciones' | 'recursos'

const App = () => {
  const [pestana, setPestana] = useState<Pestana>(() => {
    const p = localStorage.getItem('fotograma:pestana')
    return p === 'recursos' ? 'recursos' : 'composiciones'
  })
  const [id, setId] = useState(() => decodeURIComponent(location.hash.slice(1))) // vacío = el video más reciente
  const [guiones, setGuiones] = useState<Composicion[]>([])
  const [recursos, setRecursos] = useState<{ ruta: string; bytes: number }[]>([])
  const asistente = false
  const [modo, setModo] = useState<'clasico' | 'dinamico'>(() => (localStorage.getItem('fotograma:modo') === 'clasico' ? 'clasico' : 'dinamico'))
  document.documentElement.dataset.modo = modo
  useEffect(() => localStorage.setItem('fotograma:modo', modo), [modo])
  const [mudo, setMudo] = useState(silenciado)
  const actividad = useActividad()
  useEffect(() => alCambiarSilencio(setMudo), [])
  useEffect(() => activarTicGlobal(), [])
  contextoAgente.pestana = pestana
  if (pestana !== 'composiciones') contextoAgente.composicion = undefined

  // Los guiones llegan por la API (no por el módulo del proyecto) para no recargar la página al guardarlos.
  const cargarGuiones = useCallback(() => api<Guion[]>('guiones-completos').then((gs) => setGuiones(gs.map(composicionDeGuion))).catch(() => {}), [])
  const cargarRecursos = useCallback(() => api('recursos').then(setRecursos).catch(() => {}), [])

  useEffect(() => {
    cargarGuiones()
    cargarRecursos()
    // Un enlace con #Composicion abre esa composición aunque la página ya esté abierta.
    const alCambiar = () => {
      const h = decodeURIComponent(location.hash.slice(1))
      if (h) (setId(h), setPestana('composiciones'))
    }
    window.addEventListener('hashchange', alCambiar)
    // Lo que cambia el asistente se ve al instante.
    const quitar = alCambiarDatos((cambios) => {
      if (cambios.some((c) => c.tipo === 'guion')) cargarGuiones()
      if (cambios.some((c) => c.tipo === 'recurso')) cargarRecursos()
    })
    return () => (window.removeEventListener('hashchange', alCambiar), quitar())
  }, [])
  useEffect(() => {
    localStorage.setItem('fotograma:pestana', pestana)
    sonar('pestana')
    if (pestana === 'composiciones') cargarGuiones()
    if (pestana === 'recursos') cargarRecursos()
  }, [pestana])

  const lista = [...(composiciones as Composicion[]), ...guiones]

  return (
    <div className={'app' + (asistente ? ' con-asistente' : '')}>
      <header className="cabeza">
        <div className="marca">
          <span className={'logo' + (actividad ? ' girando' : '')} aria-hidden="true" title={actividad ? `${actividad} en marcha` : undefined}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 3v6M12 15v6M3 12h6M15 12h6" />
              <circle cx="12" cy="12" r="2.5" />
            </svg>
          </span>
          <span className="nombre-marca">
            Clip<b>mill</b>
          </span>
          <small>estudio</small>
          {actividad > 0 && <span className="actividad">{actividad} en marcha</span>}
        </div>
        <nav>
          {(
            [
              ['composiciones', 'Composiciones'],
              ['recursos', 'Recursos'],
            ] as [Pestana, string][]
          ).map(([k, t]) => (
            <button key={k} className={pestana === k ? 'on' : ''} onClick={() => setPestana(k)}>
              {modo === 'dinamico' && <Icono n={k} t={17} />}
              {t}
            </button>
          ))}
        </nav>
        <span className="espacio" />
        <div className="selector-modo" title="Clásico = estudio de siempre · Dinámico = iconos, sonidos y animaciones">
          {(['clasico', 'dinamico'] as const).map((m) => (
            <button
              key={m}
              className={modo === m ? 'on' : ''}
              onClick={() => {
                document.documentElement.dataset.modo = m
                setModo(m)
                if (m === 'dinamico') setTimeout(() => sonar('exito'), 30)
              }}
            >
              {m === 'clasico' ? 'Clásico' : 'Dinámico'}
            </button>
          ))}
        </div>
        {modo === 'dinamico' && <button
          className={'boton-sonido' + (mudo ? ' mudo' : '')}
          onClick={() => {
            setSilenciado(!mudo)
            if (mudo) setTimeout(() => sonar('aviso'), 30)
          }}
          title={mudo ? 'Activar sonidos' : 'Silenciar sonidos'}
        >
          <Icono n={mudo ? 'silencio' : 'sonido'} t={16} />
        </button>}
      </header>
      <div className="cuerpo" key={pestana}>
        {pestana === 'composiciones' && (
          <Composiciones
            lista={lista}
            id={id}
            setId={setId}
            recursos={recursos.map((r) => r.ruta)}
            nuevoGuion={async () => {
              const g = await api<Guion>('guiones', { metodo: 'POST', cuerpo: { titulo: 'Video nuevo' } })
              await cargarGuiones()
              return 'Guion-' + g.id
            }}
            recargarGuiones={cargarGuiones}
            borrarGuion={async (idGuion) => {
              await api('guiones/' + idGuion, { metodo: 'DELETE' })
              if (id === 'Guion-' + idGuion) setId('')
              await cargarGuiones()
            }}
          />
        )}
        {pestana === 'recursos' && <Recursos recursos={recursos} recargar={cargarRecursos} />}
      </div>
      <Avisos />
    </div>
  )
}

createRoot(document.getElementById('raiz')!).render(<App />)
