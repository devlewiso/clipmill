// Iconos de línea propios (24×24, trazo actual). Sin dependencias.
import type { ReactNode } from 'react'

const trazos: Record<string, ReactNode> = {
  composiciones: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M3 9h18M8 4v5M16 4v5M10 13l5 2.5-5 2.5z" />
    </>
  ),
  limpiar: (
    <>
      <circle cx="6" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <path d="M20 4L8.1 15.9M14.5 14.5L20 20M8.1 8.1L12 12" />
    </>
  ),
  flujos: (
    <>
      <rect x="3" y="3" width="6" height="6" rx="1.5" />
      <rect x="15" y="15" width="6" height="6" rx="1.5" />
      <rect x="15" y="3" width="6" height="6" rx="1.5" />
      <path d="M9 6h6M18 9v6M9 6c3 0 3 12 6 12" />
    </>
  ),
  videos: (
    <>
      <rect x="2" y="5" width="15" height="14" rx="2" />
      <path d="M17 10l5-3v10l-5-3z" />
    </>
  ),
  recursos: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="9" cy="9" r="2" />
      <path d="M21 15l-5-5L5 21" />
    </>
  ),
  personajes: (
    <>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20a6.5 6.5 0 0113 0M16 4.5a3.5 3.5 0 010 7M18 14.5a6.5 6.5 0 013.5 5.5" />
    </>
  ),
  asistente: <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z" />,
  sonido: (
    <>
      <path d="M11 5L6 9H3v6h3l5 4z" />
      <path d="M15.5 8.5a5 5 0 010 7M18.5 5.5a9 9 0 010 13" />
    </>
  ),
  silencio: (
    <>
      <path d="M11 5L6 9H3v6h3l5 4z" />
      <path d="M16 9l6 6M22 9l-6 6" />
    </>
  ),
  ok: <path d="M20 6L9 17l-5-5" />,
  error: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v5M12 16.5v.01" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 7.5v.01" />
    </>
  ),
  claqueta: (
    <>
      <path d="M4 11h16v9a1 1 0 01-1 1H5a1 1 0 01-1-1z" />
      <path d="M4 11l-.7-3.9 15.8-2.8.7 3.9zM8.5 6.3l2 3.6M13.5 5.4l2 3.6" />
    </>
  ),
  cerrar: <path d="M6 6l12 12M18 6L6 18" />,
  play: <path d="M7 4l13 8-13 8z" />,
}

export type NombreIcono = keyof typeof trazos

export const Icono = ({ n, t = 16, className }: { n: string; t?: number; className?: string }) => (
  <svg className={'ico ' + (className ?? '')} width={t} height={t} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {trazos[n]}
  </svg>
)
