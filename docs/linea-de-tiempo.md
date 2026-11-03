# Línea de tiempo editable (videos de guion)

En Composiciones, con un video de guion abierto: **⏱ Editar tiempo**. Cada cambio se ve al instante en el visor y se
guarda solo en el guion. Las composiciones hechas en código siguen con la línea de tiempo de solo lectura.

| Pista | Qué se hace |
|---|---|
| Clips de fondo | ⏩ velocidad + ✨ cámara lenta suave · **C** congelar cuadro · 🎨 look de color + intensidad (o «a todos») · Arrastrar = reordenar · borde derecho = duración · Alt + arrastrar = deslizar el video · **S** = partir en el cabezal · Supr = borrar |
| Voz | Arrastrar = reordenar frases (también en el texto del guion, con sus comentarios) · borde derecho = silencio después (`pausaDespuesMs`) |
| Textos y stickers | **T** = nuevo en el cabezal · arrastrar = mover · bordes = duración · editar texto/emoji y posición arriba/centro/abajo · Supr |
| Música | Solo se ve |

Ctrl+Z / Ctrl+Shift+Z deshacen y rehacen. Los bordes se pegan al cabezal y a otros bordes.
Código: [`app/estudio/EditorTiempo.tsx`](../app/estudio/EditorTiempo.tsx); datos nuevos del guion: `textos`, `pausaDespuesMs`
por línea y `segundos`/`recorte` en los clips (`tramosDeClips` en `src/guion/composicion.tsx`).
