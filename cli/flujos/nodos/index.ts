import type { Ejecutor } from '../motor'
import { basicos } from './basicos'
import { datos } from './datos'
import { ia } from './ia'
import { integraciones } from './integraciones'
import { fotograma } from './fotograma'
import { video } from './video'

export const EJECUTORES: Record<string, Ejecutor> = { ...basicos, ...datos, ...ia, ...video, ...integraciones, ...fotograma }
