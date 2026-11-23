# Clipmill · framework de video para IAs

**Un framework para hacer videos con React, pensado para que una IA (Claude, Codex, Gemini…) cree los videos y le agregue funciones nuevas por vos.** Escribís (o tu IA escribe) composiciones en código, las ves en el estudio y las renderizás a MP4.

> Clipmill es el nombre comercial. El paquete, la CLI y las rutas internas se llaman `fotograma`.

Núcleo, renderer, estudio, transiciones y efectos propios (sin código bajo la «Remotion License»; ver [src/terceros/LICENCIAS.md](src/terceros/LICENCIAS.md)). Licencia MIT.

```bash
npx fotograma estudio                       # ver y renderizar en el navegador (http://127.0.0.1:3060)
npx fotograma render Efectos out/fx.mp4     # renderizar (h264 | vp9 | prores | gif)
npx fotograma imagen Portada out/p.png      # un frame como PNG
npx fotograma revisar Efectos               # antes de renderizar: archivos que faltan, errores, huecos sin audio
npx fotograma lista                         # composiciones del proyecto
npx fotograma ritmo musica.mp3              # beats, compases y acentos → musica.ritmo.json
```

## Qué trae (y qué no)

| Trae | No trae (a propósito) |
|---|---|
| El framework (`fotograma`, transiciones, fx, formas, trazos, ruido, subtítulos, color, ritmo, guiones) | Flujos de automatización, nodos de comandos o código, webhooks |
| El estudio: composiciones, línea de tiempo, props, cola de render y retake, recursos | Publicar en redes, control remoto desde el teléfono, asistente con IA integrado |
| La CLI y el renderer (Chrome headless + ffmpeg) | Limpieza de tomas a cámara y reencuadre |
| **Un** proyecto de ejemplo y las skills de motion graphics para tu IA | |

Lo que «no trae» existe en la versión privada de NeuralCodeLab. Acá quedó fuera para que el framework sea simple y **seguro de instalar**: ver [docs/seguridad.md](docs/seguridad.md).

## Usarlo con tu IA

1. Abrí la carpeta del proyecto con tu IA (Claude Code, Codex, Cursor…).
2. Pedile el video: «hacé una intro de 8 s con mi logo y una transición de iris», «un reel vertical con estos 5 datos».
3. La IA escribe la composición en `ejemplo/src/composiciones.tsx` (o un archivo nuevo), la mirás en el estudio y la renderiza con `npx fotograma revisar` + `render`.
4. ¿Falta algo? Pedile que lo agregue al framework: un efecto, una transición o un tipo de gráfico. Todo es código TypeScript/React legible y con nombres en español.

Las skills de `skills/` (motion-cine, motion-fx-core y los estilos de Saul Bass, Kyle Cooper, Patrick Clair…) le enseñan a tu IA recetas de motion graphics.

### Guías

| Guía | Qué explica |
|---|---|
| [docs/seguridad.md](docs/seguridad.md) | Cómo está protegido el estudio y qué cuidar |
| [docs/cola-y-retake.md](docs/cola-y-retake.md) | Cola de render persistente, reordenar, cancelar, reintentar y Retake de un tramo |
| [docs/estandar-video.md](docs/estandar-video.md) | Estándar para que cada pieza de una escena sea ajustable desde JSON y el inspector |
| [docs/bajar-musica.md](docs/bajar-musica.md) | Ducking: la música baja sola bajo la voz (`bajarCon` / `grupo`) |
| [docs/velocidad.md](docs/velocidad.md) | Velocidad por clip, cámara lenta suave y congelar cuadro |
| [docs/color.md](docs/color.md) | Looks de color por clip (`fotograma/color`) y LUTs `.cube` |
| [docs/linea-de-tiempo.md](docs/linea-de-tiempo.md) | Línea de tiempo editable de los videos de guion |
| [docs/ritmo.md](docs/ritmo.md) | Detectar beats y cortar o animar al golpe de la música |

## Proyecto

El proyecto exporta sus composiciones en `src/composiciones.tsx`:

```tsx
import { Capa, definirComposicion, resorte, useFrame, useVideo } from 'fotograma'

const Hola = ({ texto }: { texto: string }) => {
  const frame = useFrame()
  const { fps } = useVideo()
  const s = resorte({ frame, fps })
  return <Capa style={{ alignItems: 'center', justifyContent: 'center', fontSize: 120, transform: `scale(${s})` }}>{texto}</Capa>
}

export default [
  definirComposicion({
    id: 'Hola',
    componente: Hola,
    props: { texto: 'Hola' },
    esquema: { texto: { tipo: 'texto', etiqueta: 'Texto' } }, // formulario en el estudio
    ancho: 1920, alto: 1080, fps: 30, duracion: 90,
  }),
]
```

`calcularMetadatos(props)` permite que la duración o el tamaño dependan de las props (así funcionan los guiones).

## Módulos

| Import | Qué trae |
|---|---|
| `fotograma` | `useFrame`, `useVideo`, `interpolar`, `interpolarColor`, `Curvas`, `resorte`, `aleatorio`, `Capa`, `Secuencia`, `Serie`, `Bucle`, `Congelar`, `Imagen`, `Video`, `Audio`, `cargarFuenteGoogle`, `useCarga` |
| `fotograma/transiciones` | `SerieTransiciones` + fundido, deslizar, empujar, barrido, iris, zoom, desenfoque, voltear, persiana, reloj, puertas, destello; `tiempoLineal`, `tiempoResorte` |
| `fotograma/fx` | `Grano`, `Vineta`, `Escaneo`, `Parpadeo`, `AberracionCromatica`, `Glitch`, `Sacudida`, `KenBurns`, `Aparecer`, `MaquinaDeEscribir`, `PalabraPorPalabra`, `NumeroAnimado`, `Subtitulos` |
| `fotograma/formas` | `Circulo`, `Elipse`, `Rectangulo`, `Triangulo`, `Estrella`, `Poligono`, `Corazon`, `Pastel`, `Flecha`, `Globo`, `Chispa`, `TrazoAnimado` |
| `fotograma/trazos` | utilidades de trazos SVG (medir, cortar, interpolar, deformar) |
| `fotograma/ruido` | `ruido2D/3D/4D` deterministas |
| `fotograma/subtitulos` | `parseSrt`, `serializeSrt`, páginas estilo TikTok |
| `fotograma/color` | `Color`, `filtroColor`, `LOOKS`: looks de color con intensidad ([guía](docs/color.md)) |
| `fotograma/ritmo` | `usePulso`, `useGolpe`, `pulso`, `faseEntreGolpes`, `cortesAlRitmo`: cortar y animar al golpe de la música ([guía](docs/ritmo.md)) |
| `fotograma/guion` | tipos de guion, `parsearGuion`, `composicionDeGuion` |
| `fotograma/render` | API de Node: `renderizar()`, `listarComposiciones()` |

## Cómo renderiza

1. Vite sirve el proyecto; la página `/__fotograma/render` monta la composición a tamaño real.
2. Varias instancias de Chrome headless (una por núcleo de trabajo) van frame a frame:
   `irA(frame)` pinta con React y espera imágenes, videos y fuentes (`esperarCarga`).
3. ffmpeg une los frames y mezcla las pistas de `<Audio>` y `<Video>` en su posición (bajando la música bajo la
   voz donde se pidió con `bajarCon`, ver [docs/bajar-musica.md](docs/bajar-musica.md)).

Requisitos: Node 20+, Chrome/Chromium (`FOTOGRAMA_CHROME` para otra ruta) y ffmpeg (`FOTOGRAMA_FFMPEG`).

### Variables de entorno

| Variable | Para qué | Por defecto |
|---|---|---|
| `FOTOGRAMA_HOST` | Dónde escucha el estudio. **No lo abras a la red** (`0.0.0.0`): no tiene contraseña | `127.0.0.1` |
| `FOTOGRAMA_CHROME`, `FOTOGRAMA_FFMPEG` | Rutas de Chrome y ffmpeg | autodetectadas |
| `FOTOGRAMA_VIDEOS_DATOS` | Carpetas de JSON de videos que el inspector puede editar | `reels,videos` |
| `CLIPMILL_SIN_CHEQUEO_ORIGEN` | Apaga el chequeo de origen (solo para depurar) | apagado |

## Empezar

```bash
npm install
cd ejemplo && npm install
npx fotograma estudio        # http://127.0.0.1:3060
```

El [`ejemplo/`](ejemplo/) es un solo proyecto con un título en 3 formatos y demos de transiciones, efectos y formas: es la referencia para tu IA.

## Seguridad
Revisado con un ejercicio Red, Blue y Purple Team el 23 de noviembre de 2026. Detalle, resultados y cómo reportar un problema en [docs/seguridad.md](docs/seguridad.md).
