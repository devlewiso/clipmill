# Remoto: Clipmill desde el teléfono

Usar el estudio desde el teléfono (o cualquier navegador) en la **misma red**. Es un servidor aparte, con su
propia API más chica, en `http://<ip-de-la-pc>:3061`. Código: [`cli/remoto.ts`](../cli/remoto.ts) y la página
[`app/remoto/index.html`](../app/remoto/index.html) (sin build, una sola página).

## Encender y emparejar

1. En el estudio, botón **📱 Remoto** (cabecera) → activar.
2. Aparece un **QR** y un código de 6 cifras. Escaneá el QR con la cámara del teléfono (o abrí la dirección y
   escribí el código).
3. Listo: el teléfono queda emparejado (cookie de un año). En la misma ventana se ven los teléfonos emparejados,
   cuándo se usaron por última vez, y se pueden **revocar**.

Al apagarlo se cierra el puerto. Si estaba encendido, vuelve a encenderse solo cuando arranca el estudio.

## Qué se puede hacer desde el teléfono

- **Cola**: ver lo que corre (con progreso), reordenar (⤒ ↑ ↓), cancelar, reintentar y **▶ Ver** los videos terminados.
- **Renderizar**: todas las composiciones agrupadas por canal (con tus guiones arriba) y buscador; **Encolar**.
- **Asistente**: el mismo chat del estudio, con confirmaciones para lo que gasta.

**No se puede:** publicar en redes, ejecutar ni activar flujos (el asistente lo rechaza desde el teléfono),
ni tocar archivos.

## Seguridad

- El código de emparejamiento vale **10 minutos**, sirve para **un solo teléfono** y se invalida tras **5 intentos
  fallidos**. Va en el `#` del enlace del QR, así que no viaja en la URL al servidor ni queda en logs.
- El teléfono recibe un token aleatorio de 256 bits en una cookie `HttpOnly; SameSite=Strict`.
  En `.fotograma/remoto.json` solo se guarda su **hash** SHA-256.
- Los POST exigen `Content-Type: application/json`; cabeceras `X-Frame-Options: DENY`, `nosniff`, CSP.
- Cada teléfono se puede revocar desde el estudio; «salir» desde el teléfono también lo borra.

> Ojo: si el estudio se arranca con `FOTOGRAMA_HOST=0.0.0.0`, el puerto **3060** queda abierto a la red **sin
> contraseña** (desde ahí se puede publicar). Para usar el teléfono conviene el estudio en `127.0.0.1` + Remoto.

## API del puerto 3061

Todo requiere la cookie de un teléfono emparejado, menos `/` y `emparejar`.

| Método | Ruta | Qué hace |
|---|---|---|
| POST | `/api/emparejar` | `{ codigo, nombre }` → cookie |
| GET | `/api/yo` | Nombre del teléfono |
| GET | `/api/cola` | Los últimos 60 trabajos |
| GET | `/api/composiciones[?fresca=1]` | Composiciones con canal e icono (se guardan 10 min) |
| GET | `/api/video?id=<trabajo>` | Video terminado (con Range) |
| POST | `/api/render` | `{ id }` encola un render completo |
| POST | `/api/cancelar`, `/api/mover`, `/api/reintentar` | Igual que en el estudio |
| POST | `/api/asistente` | `{ historial, decision? }` |
| POST | `/api/salir` | Desempareja este teléfono |

API del estudio para manejarlo: `GET remoto`, `POST remoto/activar { activo }`, `POST remoto/codigo`,
`POST remoto/revocar { id }`.
