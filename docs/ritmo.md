# Ritmo: cortar y animar al golpe de la música

Como «beat sync» de CapCut: Clipmill detecta los **beats**, los **compases** (el 1 de cada 4) y los **acentos**
(golpes fuertes) de una canción, y `fotograma/ritmo` los usa para cortar clips, hacer latir un zoom o lanzar
destellos justo en el golpe. Todo local y sin dependencias nuevas.

## 1. Analizar la canción

- **Estudio:** Recursos → abrí el audio → **🥁 Ritmo**. Muestra los BPM, guarda `<audio>.ritmo.json` al lado del
  audio y, mientras suena, un punto late en cada beat (más grande y amarillo en el 1 del compás) para comprobarlo
  de oído. Clic en la ruta copia el `import`.
- **CLI:** `npx fotograma ritmo public/sonidos/musica.mp3 [salida.json]`
- **API:** `POST /__fotograma/api/ritmo { archivo: '/sonidos/musica.mp3' }` (audio de `public/`).

```json
{ "bpm": 150.5, "duracion": 44, "beats": [0.42, 0.81, …], "compases": [0.81, 2.41, …], "acentos": [0.42, …] }
```

Precisión medida con una pista de clics a 128 BPM: tempo 128.6, beats a ±13 ms (menos de medio cuadro a 30 fps) y
compases en los clics fuertes. Una canción de 44 s se analiza en ~0.2 s.

Cómo detecta ([`cli/ritmo.ts`](../cli/ritmo.ts)): flujo espectral (STFT 2048/512) → tempo por autocorrelación entre
60 y 200 BPM → beats por programación dinámica (Ellis 2007) → compás según el bombo (graves < 150 Hz) → acentos en el
percentil 90 de los ataques. Sin beats inventados en los silencios del principio y del final.

## 2. Usarlo en una composición

```tsx
import { cortesAlRitmo, faseEntreGolpes, useGolpe, usePulso, type Ritmo } from 'fotograma/ritmo'
import datos from './musica.ritmo.json'
const ritmo = datos as Ritmo

const zoom = 1 + 0.08 * usePulso(ritmo.beats)               // late con cada beat (1 en el golpe → 0)
const flash = usePulso(ritmo.compases, { caida: 0.12 })     // destello en el 1 de cada compás
const sacudida = 10 * usePulso(ritmo.acentos, { caida: 0.1 })
const n = useGolpe(ritmo.beats)                             // cuántos beats van (clip, color o texto por beat)

// Una foto distinta cada 2 beats durante 10 s:
{cortesAlRitmo(ritmo.beats, fps, { cada: 2, hasta: 10 }).map((t, i) => (
  <Secuencia key={i} desde={t.desde} duracion={t.duracion}>…</Secuencia>
))}
```

| Función | Qué devuelve |
|---|---|
| `pulso(tiempos, t, { caida, anticipo, forma })` | 1 en el golpe y cae a 0 en `caida` s (`exp` o `lineal`); `anticipo` lo adelanta |
| `usePulso(tiempos, opciones)` | Lo mismo con el cuadro actual |
| `useGolpe(tiempos)` / `ultimoGolpe(tiempos, t)` | Cuántos golpes van / índice del último |
| `faseEntreGolpes(tiempos, t)` | 0→1 entre un golpe y el siguiente (barras, giros que duran un beat) |
| `cortesAlRitmo(tiempos, fps, { cada, desde, hasta })` | Tramos `{ desde, duracion }` en cuadros para cortar cada N golpes |

## Demo

**Ejemplos → ✨ Demos → Ritmo-Demo** ([`ejemplo/src/plantillas/ritmo-demo.tsx`](../ejemplo/src/plantillas/ritmo-demo.tsx)):
fotos que cortan cada 2 beats y después en cada beat, zoom que late, destello en el 1 del compás, sacudida en
los acentos, los 4 tiempos del compás y una barra de beat a beat.
