# Limpiar: quitar muletillas y editar el video por su texto

La pestaña **✂ Limpiar** hace lo que «quitar muletillas» y «editar por transcripción» de CapCut: Clipmill propone qué
sacar de una toma a cámara y vos editás el video **como si fuera texto** — seleccionar y borrar, devolver, mover
frases, deshacer — con una vista previa que reproduce exactamente cómo va a quedar.

Piezas:

| Archivo | Qué hace |
|---|---|
| [`skills/editor-videos/scripts/limpiar.py`](../skills/editor-videos/scripts/limpiar.py) | Transcribe (faster-whisper) y detecta qué cortar → `tutoriales/<slug>/propuesta.json` |
| [`skills/editor-videos/scripts/tutorial.py`](../skills/editor-videos/scripts/tutorial.py) `--propuesta` | Aplica los cortes activos + jump-cut en las pausas → clip limpio |
| [`cli/limpieza.ts`](../cli/limpieza.ts) | API del estudio (tomas, propuesta, video) |
| [`app/estudio/Limpiar.tsx`](../app/estudio/Limpiar.tsx) | La pestaña (editor de texto) |
| [`app/estudio/edicionTexto.ts`](../app/estudio/edicionTexto.ts) | Las reglas de `tutorial.py` en el navegador: tramos, orden, duración final |

## Uso

1. Subí la toma a `~/Desktop/uploads` (es `public/uploads` del proyecto).
2. **Limpiar → Nueva toma**: elegí el video, poné un nombre corto (slug) y tocá **✂ Analizar**. Va a la
   [cola](cola-y-retake.md): transcribe pidiéndole a whisper que escriba las muletillas y propone los cortes.
3. Editá la transcripción:
   - **tachado** = se corta · **subrayado ondulado** = se recorta solo el inicio de la palabra ·
     **punteado** = propuesto pero apagado · **·** = pausa (se corta sola) · **subrayado morado y ⤴** = bloque movido.
   - **Seleccionar:** arrastrá sobre el texto (Shift+clic extiende). La barra de arriba muestra qué podés hacer.
   - **Supr / Backspace:** corta la selección; si ya estaba cortada, la **devuelve** (los cortes manuales se borran,
     los propuestos se apagan).
   - **Mover una frase:** seleccionala → **Ctrl+X** → seleccioná la palabra después de la cual va → **Ctrl+V**.
     En «Bloques movidos» se ve cada uno y **↩** lo devuelve a su lugar. (Un bloque se pega después de una palabra
     que esté en su lugar original, no dentro de otro bloque movido.)
   - **Ctrl+Z / Ctrl+Shift+Z** (o Ctrl+Y): deshacer y rehacer (también los botones ↶ ↷). **Esc** cancela.
   - **Doble clic** en una palabra escucha desde ahí; **Alt+clic** solo lleva el video.
   - Los botones de tipo activan/desactivan todos los cortes de ese tipo; en la lista de cortes, **▶** escucha
     desde 1 s antes sin saltar.
   - **Vista previa de cómo queda:** el video se reproduce tramo por tramo, saltando cortes y pausas y siguiendo el
     orden nuevo. La duración final de arriba es la misma cuenta que hace `tutorial.py` (±1 cuadro).
   - Todo se guarda solo.
4. **✂ Generar**, según el destino:
   - **Tutorial Viral** (look natural/cine/noche, pausa máxima, audio pro u original) →
     `public/tutoriales/<slug>/clip.mp4` (1080×1920, 30 fps, -14 LUFS) + `tutoriales/<slug>/palabras.json`, listo para
     la plantilla Tutorial Viral (falta su `plan.json`).
   - **Noticiero** → `public/uploads/<slug>-limpio-<fecha>.mp4`: la toma limpia **sin color y con el audio original**,
     para pasarla después por `preparar.py` del Noticiero (que pone el look cine y el audio pro).

## Qué detecta

| Tipo | Ejemplo | Por defecto |
|---|---|---|
| Toma repetida | Dice una frase, se equivoca y la vuelve a decir más adelante: queda la **última** | activo |
| Arranque en falso | «Cambiando cuando dice, cambiarlo cuando dice el manual» | activo |
| Repetición | «el el», «vamos a vamos a» (no corta «muy muy»: suele ser énfasis) | activo |
| Muletilla | eh, em, mmm, ah… | activo |
| Muletilla suelta | «este», «o sea», «bueno», «pues» entre pausas | **apagado** (muchas veces sí van) |
| Palabra estirada | whisper le pega a la palabra el «eeeh» de antes (dura mucho más de lo normal): se recorta su inicio | activo |

Lo que no detecta: frases que sobran por contenido. Esas se marcan a mano tocándolas.

Comparación aproximada: «cambiando» y «cambiarlo» cuentan como la misma palabra al buscar arranques en falso.

## Línea de comandos

```bash
cd ejemplo
PY=python3   # o el Python de un venv con faster-whisper y onnxruntime
$PY ../skills/editor-videos/scripts/limpiar.py ~/Desktop/uploads/toma.mp4 --slug mi-toma [--retranscribir] [--modelo small]
$PY ../skills/editor-videos/scripts/tutorial.py ~/Desktop/uploads/toma.mp4 --slug mi-toma --propuesta --look noche
```

`limpiar.py` reutiliza `tutoriales/<slug>/transcripcion-original.json` si es del mismo video; `--retranscribir`
la rehace con muletillas. `tutorial.py --propuesta` suma los cortes activos a `--quitar` y respeta los bloques
movidos; `--look ninguno` no aplica color y `--salida` cambia el archivo de salida.

Regla de corte (igual en `tutorial.py` y en la vista): una palabra se quita si el corte tapa su mitad **y** su final;
si solo tapa el inicio, se recorta.

## `propuesta.json`

```json
{
  "video": "/ruta/a/toma.mp4", "slug": "mi-toma", "duracion": 92.91,
  "cortes": [
    { "id": 1, "a": 64.82, "b": 65.98, "tipo": "arranque en falso", "texto": "Cambiando cuando dice,",
      "motivo": "vuelve a decir «cambiarlo cuando dice»", "activo": true }
  ],
  "movidos": [ { "a": 0.67, "b": 3.29, "despues": 34.87 } ]
}
```

`movidos`: el bloque `[a, b]` (segundos de la toma) va después de la palabra que empieza en `despues`. Cada tramo
calcula su aire (-0.1 / +0.14 s) con sus vecinos reales y después se reordena.

## API (`/__fotograma/api/…`)

| Método | Ruta | Qué hace |
|---|---|---|
| GET | `limpieza` | `{ tomas, videos }`: tomas con propuesta/transcripción y videos crudos de uploads |
| GET | `limpieza/<slug>` | Propuesta + palabras |
| PUT | `limpieza/<slug>` | Guarda la edición `{ cortes, movidos }` |
| GET | `limpieza/<slug>/video` | El video crudo (con Range, para adelantar) |
| POST | `limpieza/<slug>/analizar` | `{ video?, retranscribir? }` → trabajo en la cola |
| POST | `limpieza/<slug>/aplicar` | `{ look, pausa, audio, destino: 'tutorial' \| 'noticiero' }` → trabajo en la cola |

El video para analizar tiene que estar en `public/uploads`.
