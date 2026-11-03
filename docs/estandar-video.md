# Estándar de video (motion graphics)

Un video de motion graphics es **un JSON**: datos del video + una lista de escenas. Cada pieza que se dibuja
(título, subtítulo, cifra, moto, fila de una ficha…) es un **elemento con nombre**. El JSON puede ajustar
cualquier elemento sin tocar código, y el estudio lo edita con el **inspector** (panel «Elementos»).

Código: `src/escena/index.tsx` (`fotograma/escena`). Primera familia migrada: los Reels de `ejemplo/reels/*.json`
(estilos glitch, neón, azul y editorial; el «ilustrado» todavía solo con `escena`, `subtitulos` y capas globales).

## Estructura

```jsonc
{
  "formato": 1,                    // estándar de video (opcional: los JSON viejos siguen valiendo igual)
  "carpeta": "Mi canal",            // carpeta en Composiciones
  "estilo": "glitch",              // glitch · neon · azul · editorial · ilustrado
  "acento": "#3D8BFF", "crema": "#E3EEFF",
  "musica": "/sonidos/…mp3",       // o false
  "volumenMusica": 0.22, "volumenSfx": 1, "volumenVoz": 1,
  "presentador": { "personaje": "mi-personaje", "estilo": "comic" },
  "ajustes": { … },                // ajustes de TODO el video (valen en todas las escenas; los de la escena ganan)
  "escenas": [
    {
      "tipo": "moto", "seg": 5,    // tipo y duración (obligatorios)
      "id": "la-moto",             // nombre propio de la escena (inspector, línea de tiempo)
      "titulo": "PULSAR NS400Z", "sub": "…",   // datos propios del tipo (ver skills/reels-motion/SKILL.md)
      "voz": { "texto": "…", "audio": "/reels-voz/…/0.mp3", "palabras": [ … ] },
      "transicion": "barrido",     // glitch · zoom · barrido · corte · ninguna (si falta, la del estilo)
      "colorFondo": "#101828",     // CSS del fondo de esta escena
      "sfx": false,                // false = sin sonidos automáticos · lista = los reemplaza
      "sfxExtra": [{ "src": "impacto3", "en": 1.2, "vol": 0.6 }],  // src = /sonidos/sfx/<src>.mp3 o ruta con «/»; en = segundos
      "ajustes": {                 // control granular por elemento
        "titulo": { "y": -80, "escala": 1.15, "color": "#FFD400", "en": 0.4, "entrada": "subir" },
        "sub": { "oculto": true }
      }
    }
  ]
}
```

## Ajustes de un elemento

| campo | qué hace |
|---|---|
| `oculto` | no se dibuja |
| `x`, `y` | lo desplaza (px del cuadro 1080×1920) |
| `escala`, `rot`, `opacidad` | tamaño (1 = igual), giro en grados, 0–1 |
| `color`, `tam`, `fuente` | color del texto/figura, multiplica el tamaño de letra, familia tipográfica |
| `en` | arranca a los N s de la escena (su animación propia empieza ahí) |
| `dur` | queda N s en pantalla desde que arranca |
| `velocidad` | 2 = su animación va al doble, 0.5 = a la mitad |
| `entrada`, `salida` | `aparecer` · `subir` · `bajar` · `izquierda` · `derecha` · `zoom` · `pop` (encima de la animación propia) |
| `transicion` | segundos de esa entrada/salida (0.35) |

Sin ajustes, un elemento no agrega nada: el video se ve exactamente como antes.

## Nombres de los elementos (Reels)

En todas las escenas: `escena` (la escena entera), `subtitulos`, `transicion`, `hud` (glitch), `fondo` (grilla de glitch).
En «Todo el video» (`ajustes` de arriba): `presentador`, `textura` (grano, viñeta, escaneo) y cualquier nombre de escena
(p. ej. `"sub": { "oculto": true }` oculta todas las bajadas).

| tipo | elementos |
|---|---|
| `gancho` | glitch: `titulo` · neón: `titulo`, `sub` · azul: `frase` · editorial: `linea1…`, `sub` |
| `palabras` | `frase` |
| `titular` | `linea1`, `linea2`…, `sub` |
| `cifra` | `numero`, `unidad` |
| `dataviz` | `tarjeta` › `etiqueta`, `cifra`, `dona`, `barras` |
| `ficha` | `titulo`, `fila1`, `fila2`… |
| `marcas` | `titulo`, `marcas` › `marca1`, `marca2`… |
| `familia` | `titulo`, `columnas` |
| `moto` | `moto`, `titulo`, `sub` |
| `tablero` | `titulo`, `pantalla`, `sub` |
| `bateria` | `titulo`, `bateria`, `numero`, `sub` |
| `muro` | `muro`, `velo`, `titulo`, `sub` |
| `cinta` | `cinta1`, `cinta2` |
| `flujo` | `particulas`, `titulo`, `sub` |
| `orbe` | `orbe`, `texto`, `sub` |
| `enfoque` | `marco` › `texto`, `sub` |
| `logo` | `rayos`, `titulo`, `sub` |
| `particulas` | `texto` |
| `pregunta` | `titulo`, `opciones` › `opcion1`… (o `precio`), `sub` |
| `cta` | `corazon`, `cuenta`, `boton`, `texto` |

Los anidados (›) se mueven con su grupo y además se ajustan solos.

## En el estudio

Composiciones › un Reel › panel derecho **Elementos**: elegí la escena (o «Todo el video»), tocá un elemento
y movelo con los controles; se ve al instante. **Guardar en reels/<id>.json** escribe el JSON (la carpeta se conserva).

## Hacer una plantilla compatible con el estándar

```tsx
import { Elemento, ElementoAnimado, ElementoTexto, EscenaAjustable } from 'fotograma/escena'

// En el componente del video: cada escena dentro de <EscenaAjustable escena={i} ajustes={e.ajustes} global={props.ajustes}>
// En cada escena, cada pieza con nombre:
<ElementoTexto nombre="titulo" style={(f) => ({ fontSize: 120, color: '#fff', opacity: interpolar(f, [0, 10], [0, 1]) })}>{titulo}</ElementoTexto>
<ElementoAnimado nombre="moto" capa>{(f) => <svg>…</svg>}</ElementoAnimado>
```

- Calculá las animaciones con el `f` que recibís (o con `useFrame()` dentro del elemento): así `en` y `velocidad` las mueven.
- `capa` para lo que ocupa todo el cuadro (svg, fondos). `style`/`envoltura` si el hijo depende del ancho del padre (`width: '100%'`).
- Los textos que dibujes vos pueden leer `useEstiloElemento()` (color, tam, fuente) o usar `<TextoAjustado>`.
- Agregá los nombres a la tabla de arriba y el `archivo` a la composición (`archivo: 'reels/<id>.json'`) para que el inspector guarde.
