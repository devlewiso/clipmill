# Asistente

Chat al costado del estudio (**✦ Asistente**) que **hace** las cosas con herramientas: edita guiones y clips,
crea y edita flujos, genera recursos, consulta la biblioteca y maneja la cola de renders.
Código: [`cli/agente.ts`](../cli/agente.ts) y [`app/estudio/Asistente.tsx`](../app/estudio/Asistente.tsx).

## Proveedor del modelo

| `FOTOGRAMA_AGENTE_PROVEEDOR` | Cómo llama al modelo | Modelo por defecto |
|---|---|---|
| `claude` (por defecto) | **Claude Code** headless: `claude -p` con la suscripción del usuario | `sonnet` |
| `ollama` | `OLLAMA_HOST/api/chat` con tool calling nativo | `deepseek-v4.1-flash:cloud` |

`FOTOGRAMA_AGENTE_MODELO` cambia el modelo (`opus`, `haiku`… con Claude).

Con Claude Code las herramientas no se pasan por la CLI: se describen en el mensaje de sistema y el modelo responde
con un JSON validado por `--json-schema`:

```json
{ "texto": "…", "herramientas": [{ "nombre": "encolar_render", "argumentos": { "composiciones": ["MotoEvolucion-ES"] } }] }
```

que se convierte en `tool_calls`, así el resto del ciclo (ejecutar, confirmar, volver a llamar) es idéntico al de
Ollama. Se ejecuta con `--tools ""` (sin herramientas propias de Claude Code), `--strict-mcp-config`,
`--no-session-persistence` y desde `/tmp`, para que no cargue el proyecto ni su CLAUDE.md. Cada paso tarda ~3–5 s.

## Herramientas

- **Guiones**: `listar_guiones`, `leer_guion`, `editar_guion`, `editar_linea`, `cambiar_clip`, `editar_clip`,
  `crear_guion`, `regenerar_voz`, `borrar_guion` (a la papelera).
- **Flujos**: `listar_flujos`, `leer_flujo`, `plantillas_de_flujo`, `crear_flujo`, `editar_nodo`, `tipos_de_nodo`,
  `agregar_nodo`, `ejecutar_flujo`, `activar_flujo`.
- **Recursos y biblioteca**: `generar_recurso`, `listar_recursos`, `listar_videos`.
- **Cola** (local y gratis, sin confirmación):
  - `listar_composiciones` — lo que se puede renderizar.
  - `encolar_render` — una o varias composiciones, completas o un tramo en segundos.
  - `retake_tramo` — rehace un tramo sobre el último render completo (ver [cola-y-retake.md](cola-y-retake.md)).
  - `ver_cola`, `cancelar_trabajo`, `mover_trabajo`.

Ejemplos: «encolá MotoEvolucion en los 3 idiomas», «¿cómo va la cola?», «pasá el Reel ES al frente»,
«hacé retake del segundo 10 al 14 del Reel ES».

## Confirmaciones

Lo que **gasta dinero** (Kie), **ejecuta o activa flujos** (pueden publicar) o **borra** no se hace sin OK: la
herramienta queda pendiente y el chat muestra Confirmar / Cancelar. Desde el [teléfono](remoto.md),
`ejecutar_flujo` y `activar_flujo` están bloqueadas.
