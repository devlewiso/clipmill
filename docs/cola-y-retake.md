# Cola de trabajos y Retake

Todo lo pesado que pide el estudio (renders, retakes, limpiezas de tomas) pasa por **una sola cola** que corre
de a un trabajo por vez. La implementación está en [`cli/cola.ts`](../cli/cola.ts).

## Cómo funciona

- **Una fila, de a uno.** Un render nuevo queda `pendiente` con su lugar en la fila (`#2 en la fila`). Cuando
  termina el que corre, arranca el siguiente.
- **Reordenar.** En el panel de render (Composiciones → derecha, «Cola»): ⤒ pasa al frente, ↑ / ↓ mueve un lugar.
  Solo se mueven los que esperan.
- **Cancelar.** Si espera, se saca de la fila; si corre, se detiene (Chrome y ffmpeg incluidos).
- **Reintentar.** Un trabajo con error o cancelado vuelve a la cola con las mismas opciones.
- **Limpiar terminados.** Saca de la lista los terminados. **No borra ningún archivo.**
- **Sobrevive a los reinicios.** La cola se guarda en `<proyecto>/.fotograma/cola.json`. Si el estudio se apaga
  a mitad de un render, al volver ese trabajo vuelve a `pendiente` («Se reinició el estudio: vuelve a empezar») y
  la cola retoma sola a los 3 s. Se guardan los últimos 200 terminados; los pendientes nunca se pierden.
- **Origen.** Cada trabajo dice de dónde vino: `estudio`, `asistente` (✦) o `remoto` (📱).

Los guiones (`Guion-<id>`) renderizados completos siguen yendo a la biblioteca (`archivarGuion`), igual que antes.

## Retake: rehacer solo un tramo

Para corregir algo visual de una parte del video sin renderizar todo de nuevo (por ejemplo, un texto mal escrito
en el minuto 3 de un video de 8 minutos).

1. En la línea de tiempo marcá entrada (**I**) y salida (**O**) del tramo.
2. Activá **«Solo el rango marcado»**.
3. Aparece **Retake sobre**: elegí el video base (los MP4 completos de esa composición: los de la cola y los
   que haya en `out/` con su nombre, p. ej. `MotoEvolucion-ES.mp4`).
4. **↻ Retake del tramo** → va a la cola.

Qué hace: renderiza solo los frames `[desde, hasta]`, y con ffmpeg arma un video nuevo = base antes del tramo +
tramo nuevo + base después del tramo.

- **El audio queda igual** (se copia del video base): el retake cambia la imagen, no el tiempo.
- **El resultado es un archivo nuevo** en `out/` (`<base>-retake-<fecha>.mp4`). El video base no se toca, aunque
  esté en la biblioteca.
- Si la composición ya no dura lo mismo que el video base (cambió una voz, se agregó una escena), el retake se
  niega: hay que renderizar completo.
- El tramo se escala al tamaño del video base, así que funciona aunque el render original haya sido con otra escala.

## API (`/__fotograma/api/…`)

| Método | Ruta | Cuerpo | Qué hace |
|---|---|---|---|
| GET | `trabajos` | | Lista (el más nuevo primero; los pendientes con `posicion`) |
| POST | `render` | `{ id, props?, codec?, frames?, calidad?, escala?, frame? }` | Encola un render |
| POST | `retake` | `{ id, base, frames: [desde, hasta], props?, calidad? }` | Encola un retake |
| GET | `cola/bases?composicion=<id>` | | Videos que sirven de base para un retake |
| POST | `cancelar` | `{ id }` | Cancela |
| POST | `cola/mover` | `{ id, a: 'primero' \| 'arriba' \| 'abajo' }` | Reordena un pendiente |
| POST | `cola/reintentar` | `{ id }` | Vuelve a encolar uno terminado |
| POST | `cola/limpiar` | `{}` | Saca los terminados de la lista |

Seguridad: el video base de un retake tiene que ser un MP4 de `out/` o de la biblioteca.

## Forma de un trabajo

```ts
type Trabajo = {
  id: number
  tipo: 'render' | 'retake' | 'limpieza'
  composicion: string
  estado: 'pendiente' | 'corriendo' | 'listo' | 'error' | 'cancelado'
  progreso: { etapa, hechos, total, mensaje? }
  origen: 'estudio' | 'asistente' | 'remoto'
  salida: string           // archivo resultante
  opciones: { props?, frames?, base?, limpieza?, … }
  posicion?: number        // solo en la respuesta, para los pendientes
}
```
