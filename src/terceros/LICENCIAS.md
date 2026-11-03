# Código de terceros

Estas carpetas vienen de paquetes con licencia **MIT** del repositorio de Remotion
(https://github.com/remotion-dev/remotion, commit 985ba9f, 30 sep 2026).
Solo se copiaron paquetes MIT; el núcleo, el renderer, las transiciones y el resto de
Fotograma están escritos desde cero y no usan código bajo la "Remotion License".

| Carpeta | Paquete original | Cambios |
|---|---|---|
| `trazos/` | `@remotion/paths` | `interpolate` viene del núcleo de Fotograma |
| `formas/` | `@remotion/shapes` (solo `src/utils`, generadores de trazos) | importa `trazos/` en vez de `@remotion/paths`; los componentes React son propios |
| `subtitulos/` | `@remotion/captions` | ninguno |
| `ruido/` | `@remotion/noise` | `random` viene del núcleo de Fotograma |

## Licencia MIT (original)

Copyright (c) 2023 JonnyBurger

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
