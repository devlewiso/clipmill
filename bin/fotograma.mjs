#!/usr/bin/env node
// Punto de entrada: carga el CLI (TypeScript) con tsx.
import { register } from 'tsx/esm/api'

register()
await import('../cli/index.ts')
