# Bajar la música bajo la voz (ducking)

La música baja sola mientras alguien habla y vuelve a subir en las pausas, con rampas suaves — como «auto ducking»
de CapCut. Se activa con dos props de `<Audio>` / `<Video>` (de `fotograma`):

```tsx
<Audio src="/sonidos/musica.mp3" volumen={0.9} bajarCon="voz" />   // esta pista baja…
<Audio src="/voz/frase-1.mp3" grupo="voz" />                         // …cuando suena una pista del grupo "voz"
<Video src="/tutoriales/x/clip.mp4" grupo="voz" />                   // la voz también puede venir de un video
```

| Prop | Qué hace | Por defecto |
|---|---|---|
| `grupo` | Nombre del grupo de la pista (`'voz'`, `'sfx'`…) | — |
| `bajarCon` | Grupo(s) que hacen bajar esta pista; `'*'` = cualquier otra pista que no baje ella misma | — |
| `bajarDb` | Cuánto baja, en dB | `-12` |
| `bajarAtaque` | Segundos de rampa **antes** de que empiece la voz | `0.15` |
| `bajarRelajacion` | Segundos de rampa **después** de que termina | `0.45` |

## Cómo funciona

- **Render (exacto):** antes de mezclar, ffmpeg arma una mezcla solo con las pistas de voz y detecta dónde se habla
  de verdad (`silencedetect`, -40 dB, silencios ≥ 0.25 s). Así la música sube también en las pausas *dentro* de un
  mismo archivo de voz. Huecos de menos de 0.35 s no cuentan (la música no «bombea» entre palabras). Con esos tramos
  se arma una curva de volumen con rampas (pasos de 20 ms) que se aplica a la pista con `asendcmd` + `volume`.
  Después, como siempre, el video entero se normaliza a su `lufs` (-14).
- **Estudio (aproximado):** mientras previsualizás, la música baja cuando suena alguna pista del grupo (por su
  tramo, sin detectar pausas internas). Sirve para escuchar el efecto antes de renderizar.

Medido con la curva sola sobre la música: **-12.9 dB** durante la voz y **~0 dB** fuera (pedido: -12 dB).

## Demo

**Ejemplos → ✨ Demos → Bajar-Musica-Demo** ([`ejemplo/src/plantillas/bajar-demo.tsx`](../ejemplo/src/plantillas/bajar-demo.tsx)):
música chiptune con dos frases de voz; la pantalla dice cuándo hay voz y cuándo vuelve la música.

## En las plantillas existentes

No está activado por defecto en ninguna plantilla (para no cambiar videos ya hechos). Para usarlo: poné
`bajarCon="voz"` en la música y `grupo="voz"` en las voces (en Tutorial Viral la voz es el `<Video>` del clip).
