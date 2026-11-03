---
name: estilo-douglas-trumbull
description: |
  Crea efectos ópticos y prácticos inspirados en Douglas Trumbull: slit-scan (corredor de luz), luz pura
  en movimiento, rotación de color con filtros, ciudades de luces en miniatura, streak photography, naves
  retroiluminadas y psicodelia analógica de los 60/70. Usar cuando el usuario pida: estilo Trumbull,
  slit-scan, stargate, túnel de luz, viaje psicodélico, efecto retro analógico de ciencia ficción, luces de
  ciudad en miniatura, light painting, look 2001/Blade Runner/Encuentros cercanos sin copiar planos.
---

# Estilo Douglas Trumbull

> Inspirado en las técnicas de Douglas Trumbull (1942–2022). Obra **original**: no recrear planos
> concretos de *2001*, *Blade Runner* o *Close Encounters*.

**En Clipmill:** renderizar el clip a `ejemplo/public/motion-fx/<id>.mp4` y usarlo con `<Video>` (ver `motion-fx-core` § En Clipmill).

**Requiere** `motion-fx-core`.

## Filosofía
- **Inventar la máquina antes que el plano**: Trumbull construía dispositivos (slit-scan, cámaras
  motion-control, humo en tanques) para obtener imágenes imposibles. Aquí la "máquina" es el algoritmo:
  pensar qué proceso físico genera la imagen y simularlo.
- **Luz como materia**: casi todo es luz real fotografiada (transparencias retroiluminadas, luces de
  ciudad, neones en humo). Evitar el look de gráfico plano: todo debe brillar.
- **Inmersión**: los efectos están pensados para pantalla gigante y movimiento continuo hacia el espectador.
- Hecho a mano y con miniaturas: imperfecciones, humo, escala engañosa.

## Lenguaje visual
| Elemento | Regla |
|---|---|
| Paleta | Saturada y cambiante (filtros de color que rotan): rojo, ámbar, azul, violeta, verde ácido sobre negro |
| Movimiento | Avance continuo hacia un punto de fuga que acelera; nada se detiene |
| Luz | Glow fuerte (umbral 120), halación, rayas de luz, puntos que se estiran |
| Miniaturas | Miles de puntos de luz cálida en profundidad, humo, contraluz |
| Acabado | CA 2, grano medio, viñeta suave |

## Cómo funciona el slit-scan en el demo
- Dos "muros" (arriba/abajo del horizonte). Para cada fila, la profundidad es `z = k / |y - cy|`.
- Coordenada lateral `u = (x - W/2) * z` y avance `v = z*40 + t*velocidad`: se muestrea una **obra 2D**
  (franjas de luz con textura), igual que la cámara real exponía una rendija sobre una transparencia.
- Rotación de color: permutar canales `x[..., [2,0,1]]` en un muro y mezclarlos con el tiempo.
- Para la versión vertical (muros izquierda/derecha), intercambiar x↔y. Para un túnel, usar `z = k / r`
  (radio) y `u = ángulo`.
- **Cambiar la obra cambia el viaje**: probar fotos (`load` en lugar de las franjas), textos repetidos,
  patrones de `value_noise`, rejillas.

## Otras recetas
- **Ciudad de luces**: miles de `circle` pequeños cálidos con profundidad, `glow` y humo (`smoke`) en screen;
  destellos de llamaradas con `light_rays`.
- **Streak photography / logo de luz**: dibujar el logo, aplicar `directional_blur` largo decreciente con el tiempo
  y `glow`: el logo "aterriza" desde rayas de luz.
- **Nave retroiluminada**: silueta negra con cientos de ventanitas `circle` + `glow` y un halo de humo.
- **Nube/humo en tanque**: `smoke()` a gran escala, contraluz con `light_rays`, rotación lenta.

## Demo
```bash
python3 skills/estilo-douglas-trumbull/scripts/demo.py --preview --out trumbull.mp4 --text "UMBRAL"
```
Beats (10 s): corredor slit-scan que acelera con colores que rotan → corte a negro → ciudad de luces en
miniatura → título → fade.

## Checklist
- ¿El movimiento hacia el punto de fuga es continuo y acelera?
- ¿Todo brilla (luz, no pintura)? ¿Cambia el color a lo largo del viaje?
- Revisar en movimiento real, no solo en la hoja de contactos: el efecto vive en el movimiento.
