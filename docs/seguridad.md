# Seguridad de Clipmill (versión pública)

Clipmill corre en tu computadora: renderiza con Chrome y ffmpeg y lee y escribe archivos de tu proyecto. Esta guía explica cómo está protegido, qué probamos y qué te toca cuidar.

Última revisión: **23 de noviembre de 2026**, ejercicio Red, Blue y Purple Team.

## La decisión más importante: sin flujos
La versión pública **no trae** flujos de automatización, nodos que ejecutan comandos o código, webhooks, publicación en redes, control remoto ni asistente integrado. En el ejercicio vimos que los filtros de esos nodos (listas de cosas prohibidas) se pueden esquivar. Un flujo compartido por otra persona podría ejecutar cualquier cosa en tu PC. Por eso no vienen. Si tu IA agrega funciones nuevas, que sean código del framework que podés leer, no automatizaciones que ejecutan comandos.

## Cómo te protege

| Riesgo | Protección | Dónde está |
|---|---|---|
| Que alguien de tu red o de internet entre al estudio | Escucha solo en `127.0.0.1` (tu propia máquina) | `cli/servidor.ts` |
| Que una página web le dé órdenes al estudio (CSRF) | Todo lo que no es lectura en `/__fotograma/*` se rechaza si el navegador avisa que viene de otro sitio (`Origin`, `Referer`, `Sec-Fetch-Site`). La terminal y los scripts siguen funcionando. | `cli/origen.ts` |
| Que un sitio se haga pasar por el estudio (DNS rebinding) | Vite rechaza los nombres de host que no son locales (403) | Vite |
| Que una web lea tus datos | Sin encabezados CORS: el navegador no deja leer las respuestas | — |
| Leer archivos fuera del proyecto | La descarga de renders solo sirve archivos dentro de `out/`. El inspector solo edita JSON de `reels/` y `videos/`, y los recursos se suben a `public/` | `cli/estudio.ts` |
| Secretos | No hay llaves en el repo. Si una función las necesita (por ejemplo, voces), se leen de `~/.config/fotograma/` o de variables de entorno y no se imprimen | — |

## Lo que te toca a vos
- No abras el estudio a la red (`FOTOGRAMA_HOST=0.0.0.0`): no tiene contraseña.
- Revisá el código que tu IA agrega antes de correrlo, sobre todo si usa `child_process`, `fs` o descarga cosas.
- No ejecutes proyectos ni plantillas de desconocidos sin leerlos: una composición es código.
- Mantené las dependencias al día (`npm audit`).

## Resultado del ejercicio (23 nov 2026)

| # | Escenario | Resultado |
|---|---|---|
| 1 | Llaves, tokens o datos personales en el repo | Resistió |
| 2 | DNS rebinding | Resistió |
| 3 | Leer datos del estudio desde otra web | Resistió |
| 4 | Una web encola o cancela renders (CSRF) | **Corregido** (`cli/origen.ts`) |
| 5 | Una web crea flujos (CSRF) | **Eliminado:** ya no hay flujos |
| 6 | Esquivar los filtros de los nodos Comando y Código | **Eliminado:** ya no hay esos nodos |
| 7 | Webhooks llamados desde una web | **Eliminado:** ya no hay webhooks |
| 8 | Dependencias vulnerables | **Mitigado:** `npm audit fix` bajó de 13 a 9. Las 9 restantes vienen de puppeteer (un cliente FTP de proxy que Clipmill no usa) y de zod; arreglarlas exige cambiar puppeteer de versión mayor. |

Verificación en un laboratorio aislado: las órdenes de otras webs se rechazan con 403; la terminal sigue funcionando; las rutas de flujos y webhooks ya no existen (404); el render funciona.

## Reportar un problema
Escribí a **devlewiso@gmail.com** con los pasos para reproducirlo. No pruebes contra computadoras ajenas.
