// CLI de Fotograma.
import { parseArgs } from 'node:util'
import { iniciarEstudio } from './estudio'
import { writeFileSync } from 'node:fs'
import { listarComposiciones, renderizar, type Codec } from './render'
import { analizarRitmo } from './ritmo'
import { revisar } from './revisar'

const AYUDA = `Clipmill — fábrica de videos con IA (CLI: fotograma)

Uso:
  fotograma estudio                      Abre el estudio para previsualizar y renderizar
  fotograma render <id> [salida]         Renderiza una composición (mp4 por defecto)
  fotograma imagen <id> <salida.png>     Renderiza un frame como PNG
  fotograma revisar <id> [hoja.jpg]      Revisa antes de renderizar: audios/archivos que faltan, errores, huecos sin audio + hoja de cuadros
  fotograma lista                        Lista las composiciones del proyecto
  fotograma ritmo <audio> [salida.json]  Beats, compases y acentos de una canción (→ <audio>.ritmo.json)

Opciones:
  --entrada <archivo>     Archivo que exporta las composiciones (src/composiciones.tsx)
  --props <json>          Props para la composición
  --codec <c>             h264 | vp9 | prores | gif | png
  --frames <a-b>          Solo un rango de frames
  --frame <n>             Frame para "imagen"
  --concurrencia <n>      Pestañas de Chrome en paralelo
  --calidad <crf>         Calidad (menor = mejor)
  --escala <n>            Multiplica la resolución (2 = el doble)
  --puerto <n>            Puerto del estudio (3060)
  --paso <n>              revisar: 1 de cada N cuadros (5)
  --cada <seg>            revisar: un cuadro de la hoja cada N segundos (3)
`

const barra = (hechos: number, total: number) => {
  const n = total ? Math.round((hechos / total) * 30) : 0
  return `[${'█'.repeat(n)}${'░'.repeat(30 - n)}] ${hechos}/${total}`
}

const main = async () => {
  const { values: v, positionals: pos } = parseArgs({
    allowPositionals: true,
    options: {
      entrada: { type: 'string' },
      props: { type: 'string' },
      codec: { type: 'string' },
      frames: { type: 'string' },
      frame: { type: 'string' },
      concurrencia: { type: 'string' },
      calidad: { type: 'string' },
      escala: { type: 'string' },
      puerto: { type: 'string' },
      paso: { type: 'string' },
      cada: { type: 'string' },
      ayuda: { type: 'boolean', short: 'h' },
    },
  })
  const [cmd, id, salida] = pos
  if (!cmd || v.ayuda) return console.log(AYUDA)

  if (cmd === 'estudio') {
    const { url } = await iniciarEstudio({ entrada: v.entrada, puerto: Number(v.puerto) || 3060 })
    console.log(`Clipmill · estudio en ${url}`)
    return
  }

  if (cmd === 'lista') {
    for (const c of await listarComposiciones({ entrada: v.entrada }))
      console.log(`${c.id.padEnd(28)} ${c.ancho}×${c.alto}  ${c.fps} fps  ${(c.duracion / c.fps).toFixed(1)} s`)
    return
  }

  if (cmd === 'ritmo') {
    if (!id) throw new Error('Falta el archivo de audio.')
    const r = await analizarRitmo(id)
    const destino = salida || id.replace(/\.\w+$/, '') + '.ritmo.json'
    writeFileSync(destino, JSON.stringify(r))
    console.log(`✓ ${destino}: ${r.bpm} BPM · ${r.beats.length} beats · ${r.compases.length} compases · ${r.acentos.length} acentos`)
    return
  }

  if (cmd === 'revisar') {
    if (!id) throw new Error('Falta el id de la composición.')
    const t0 = Date.now()
    const r = await revisar({
      entrada: v.entrada,
      composicion: id,
      props: v.props ? JSON.parse(v.props) : undefined,
      paso: v.paso ? Number(v.paso) : undefined,
      cadaSeg: v.cada ? Number(v.cada) : undefined,
      hoja: salida,
      alProgresar: (h, t) => process.stdout.isTTY && process.stdout.write(`\rRevisando ${barra(h, t)}`),
    })
    const icono = { 'audio-falta': '🔇', 'archivo-falta': '🖼', 'error-pagina': '💥', 'sin-audio': '🤫' }
    const seg = (f?: number) => (f === undefined ? '' : ` (en ${(f / r.info.fps).toFixed(1)} s)`)
    console.log(`\n${r.info.id} · ${(r.info.duracion / r.info.fps).toFixed(1)} s · ${r.revisados} cuadros revisados · ${r.pistas} pistas de audio (${((Date.now() - t0) / 1000).toFixed(0)} s)`)
    for (const p of r.problemas) console.log(`  ${icono[p.tipo]} ${p.tipo}: ${p.detalle}${p.tipo === 'sin-audio' ? '' : seg(p.frame)}`)
    const graves = r.problemas.filter((p) => p.tipo !== 'sin-audio').length
    console.log(graves ? `✗ ${graves} problema(s) que rompen o ensucian el render` : r.problemas.length ? '⚠ sin errores, pero revisá los huecos sin audio' : '✓ todo bien para renderizar')
    if (r.hoja) console.log(`  hoja de cuadros: ${r.hoja}`)
    if (graves) process.exitCode = 2
    return
  }

  if (cmd === 'render' || cmd === 'imagen') {
    if (!id) throw new Error('Falta el id de la composición.')
    const esImagen = cmd === 'imagen'
    const destino = salida || `out/${id}.${esImagen ? 'png' : 'mp4'}`
    const t0 = Date.now()
    const r = await renderizar({
      entrada: v.entrada,
      composicion: id,
      salida: destino,
      props: v.props ? JSON.parse(v.props) : undefined,
      codec: esImagen ? 'png' : (v.codec as Codec | undefined),
      frames: v.frames ? (v.frames.split('-').map(Number) as [number, number]) : undefined,
      frame: v.frame ? Number(v.frame) : undefined,
      concurrencia: v.concurrencia ? Number(v.concurrencia) : undefined,
      calidad: v.calidad ? Number(v.calidad) : undefined,
      escala: v.escala ? Number(v.escala) : undefined,
      alProgresar: (p) => {
        if (p.etapa === 'capturando') {
          if (process.stdout.isTTY) process.stdout.write(`\rCapturando ${barra(p.hechos, p.total)}`)
          else if (p.hechos === p.total || p.hechos % Math.max(1, Math.round(p.total / 10)) === 0) console.log(`Capturando ${barra(p.hechos, p.total)}`)
        }
        if (p.etapa === 'codificando') process.stdout.write('\nCodificando con ffmpeg…\n')
      },
    })
    console.log(`\n✓ ${r.salida}  (${((Date.now() - t0) / 1000).toFixed(1)} s)`)
    return
  }

  console.log(AYUDA)
  process.exitCode = 1
}

main().catch((e) => {
  console.error('\n✗ ' + (e?.message || e))
  process.exit(1)
})
