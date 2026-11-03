// Texto y tiempos del modo quiz (sin JSX: lo usan también el servidor y los flujos).
import type { Guion, Quiz } from './tipos'

export const LETRAS = ['A', 'B', 'C', 'D']
export const SONIDO_TIC = '/sonidos/quiz-tic.mp3'
export const SONIDO_ACIERTO = '/sonidos/quiz-acierto.mp3'


// Texto que lee la voz en cada línea.
export const lineasQuiz = (q: Quiz, idioma = 'es') => {
  const es = idioma.startsWith('es')
  return [
    q.intro,
    ...q.preguntas.flatMap((p) => [
      p.pregunta,
      `${es ? 'La respuesta es la' : 'The answer is'} ${LETRAS[p.correcta]}: ${p.opciones[p.correcta]}.${p.explicacion ? ' ' + p.explicacion : ''}`,
    ]),
    q.cierre,
  ]
}

export type RolQuiz = { tipo: 'intro' | 'pregunta' | 'respuesta' | 'cierre'; n: number }
export const rolQuiz = (g: Guion, i: number): RolQuiz => {
  const total = g.lineas.length
  if (i === 0) return { tipo: 'intro', n: 0 }
  if (i === total - 1) return { tipo: 'cierre', n: 0 }
  const k = i - 1
  return { tipo: k % 2 === 0 ? 'pregunta' : 'respuesta', n: Math.floor(k / 2) }
}

// Tiempo extra (cuenta regresiva) después de cada pregunta.
export const extraQuizMs = (g: Guion, i: number) => (g.modo === 'quiz' && g.quiz && rolQuiz(g, i).tipo === 'pregunta' ? g.quiz.cuentaS * 1000 : 0)

