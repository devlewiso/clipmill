// Fotograma: framework para hacer videos con React.
export { interpolar, interpolate, type OpcionesInterpolar, type Extrapolacion } from './nucleo/interpolar'
export { Curvas, type Curva } from './nucleo/curvas'
export { resorte, duracionResorte, type ConfigResorte, type OpcionesResorte } from './nucleo/resorte'
export { aleatorio } from './nucleo/aleatorio'
export { interpolarColor, aRgba } from './nucleo/color'
export {
  definirComposicion,
  resolverComposicion,
  useVideo,
  useFrame,
  useFrameAbsoluto,
  useTramo,
  useModo,
  type Composicion,
  type ConfigVideo,
  type Modo,
  type CampoEsquema,
  type Pista,
} from './nucleo/contexto'
export { Capa, Secuencia, Serie, Bucle, Congelar, Contador } from './nucleo/estructura'
export { Imagen, Video, Audio, cargarFuenteGoogle, type PistaAudio } from './nucleo/medios'
export { esperarCarga, continuarCarga, useCarga } from './nucleo/esperas'
export { Lienzo } from './nucleo/lienzo'
