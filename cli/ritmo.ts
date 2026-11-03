// Ritmo de una canción para cortar y animar «al golpe»: beats, compases (el 1 de cada 4) y acentos (golpes fuertes).
// Sin dependencias: ffmpeg decodifica a mono 22 050 Hz y el análisis es propio —
//   1. Envolvente de ataques: flujo espectral (STFT 2048/512, magnitud log, solo lo que sube) menos su media local.
//   2. Tempo: autocorrelación de la envolvente entre 60 y 200 BPM, con preferencia suave por ~120 BPM.
//   3. Beats: programación dinámica (Ellis 2007): cada beat suma su ataque y se castiga alejarse del período.
//   4. Compases: de las 4 fases posibles, la que cae en los golpes de graves más fuertes (el bombo).
//   5. Acentos: los picos de ataque más fuertes (percentil 90), al menos medio beat entre sí.
import { spawn } from 'node:child_process'

export type Ritmo = { bpm: number; duracion: number; beats: number[]; compases: number[]; acentos: number[] }

const SR = 22050
const N = 2048
const HOP = 512
const FFMPEG = process.env.FOTOGRAMA_FFMPEG || 'ffmpeg'

const decodificar = (archivo: string) =>
  new Promise<Float32Array>((ok, mal) => {
    const p = spawn(FFMPEG, ['-v', 'error', '-i', archivo, '-ac', '1', '-ar', String(SR), '-f', 'f32le', '-'])
    const partes: Buffer[] = []
    let err = ''
    p.stdout.on('data', (d: Buffer) => partes.push(d))
    p.stderr.on('data', (d) => (err += d))
    p.on('error', (e) => mal(new Error('No se pudo ejecutar ffmpeg: ' + e.message)))
    p.on('close', (c) => {
      if (c !== 0) return mal(new Error('ffmpeg falló: ' + err.slice(-500)))
      const b = Buffer.concat(partes)
      ok(new Float32Array(b.buffer, b.byteOffset, Math.floor(b.length / 4)))
    })
  })

// FFT radix-2 en el lugar (re, im de largo potencia de 2).
const fft = (re: Float64Array, im: Float64Array) => {
  const n = re.length
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      ;[re[i], re[j]] = [re[j], re[i]]
      ;[im[i], im[j]] = [im[j], im[i]]
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len
    const wr = Math.cos(ang)
    const wi = Math.sin(ang)
    for (let i = 0; i < n; i += len) {
      let cr = 1
      let ci = 0
      for (let k = 0; k < len / 2; k++) {
        const a = i + k
        const b = a + len / 2
        const tr = re[b] * cr - im[b] * ci
        const ti = re[b] * ci + im[b] * cr
        re[b] = re[a] - tr
        im[b] = im[a] - ti
        re[a] += tr
        im[a] += ti
        const nr = cr * wr - ci * wi
        ci = cr * wi + ci * wr
        cr = nr
      }
    }
  }
}

// Envolventes de ataque (todo el espectro hasta ~8 kHz, y solo graves < 150 Hz para el bombo).
const envolventes = (x: Float32Array) => {
  const cuadros = Math.max(0, Math.floor((x.length - N) / HOP) + 1)
  const hann = Float64Array.from({ length: N }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N))
  const tope = Math.floor((8000 / SR) * N)
  const graves = Math.max(2, Math.floor((150 / SR) * N))
  const total = new Float64Array(cuadros)
  const bajo = new Float64Array(cuadros)
  let previo = new Float64Array(tope)
  const re = new Float64Array(N)
  const im = new Float64Array(N)
  for (let c = 0; c < cuadros; c++) {
    for (let i = 0; i < N; i++) ((re[i] = x[c * HOP + i] * hann[i]), (im[i] = 0))
    fft(re, im)
    const mag = new Float64Array(tope)
    let f = 0
    let fb = 0
    for (let k = 1; k < tope; k++) {
      mag[k] = Math.log1p(100 * Math.hypot(re[k], im[k]))
      const sube = Math.max(0, mag[k] - previo[k])
      f += sube
      if (k < graves) fb += sube
    }
    total[c] = f
    bajo[c] = fb
    previo = mag
  }
  // Se resta la media local (~1 s) para quedarse con los ataques, y se normaliza.
  const limpiar = (e: Float64Array) => {
    const v = 22
    const out = new Float64Array(e.length)
    let suma = 0
    for (let i = 0; i < e.length; i++) {
      suma += e[i] - (i - v >= 0 ? e[i - v] : 0)
      out[i] = Math.max(0, e[i] - suma / Math.min(i + 1, v))
    }
    const max = out.reduce((m, y) => Math.max(m, y), 1e-9)
    return out.map((y) => y / max)
  }
  return { ataque: limpiar(total), bombo: limpiar(bajo) }
}

const tempo = (o: Float64Array) => {
  const cps = SR / HOP // cuadros por segundo
  const min = Math.floor((60 / 200) * cps)
  const max = Math.ceil((60 / 60) * cps)
  let mejor = min
  let puntaje = -Infinity
  const ac = new Float64Array(max + 2)
  for (let lag = min; lag <= max + 1; lag++) {
    let s = 0
    for (let i = lag; i < o.length; i++) s += o[i] * o[i - lag]
    ac[lag] = s
  }
  for (let lag = min; lag <= max; lag++) {
    const bpm = (60 * cps) / lag
    const peso = Math.exp(-0.5 * (Math.log2(bpm / 120) / 0.9) ** 2) // preferencia suave por ~120
    // Se suma la armónica (el doble del período) para no confundir medio tempo con tempo.
    const s = (ac[lag] + 0.5 * (ac[2 * lag] ?? 0)) * peso
    if (s > puntaje) ((puntaje = s), (mejor = lag))
  }
  // Interpolación parabólica para un período fraccional más exacto.
  const [a, b, c] = [ac[mejor - 1], ac[mejor], ac[mejor + 1]]
  const d = a - 2 * b + c ? (0.5 * (a - c)) / (a - 2 * b + c) : 0
  return mejor + Math.max(-0.5, Math.min(0.5, d))
}

const seguirBeats = (o: Float64Array, periodo: number, apretado = 100) => {
  const n = o.length
  const puntaje = new Float64Array(n)
  const previo = new Int32Array(n).fill(-1)
  for (let t = 0; t < n; t++) {
    let mejor = 0
    let de = -1
    for (let tau = Math.max(0, Math.round(t - 2 * periodo)); tau <= t - Math.round(periodo / 2); tau++) {
      const s = puntaje[tau] - apretado * Math.log((t - tau) / periodo) ** 2
      if (de < 0 || s > mejor) ((mejor = s), (de = tau))
    }
    puntaje[t] = o[t] + (de >= 0 ? mejor : 0)
    previo[t] = de
  }
  // Se empieza por el mejor puntaje del último período y se recorre hacia atrás.
  let t = n - 1
  for (let i = Math.max(0, n - Math.round(periodo)); i < n; i++) if (puntaje[i] > puntaje[t]) t = i
  const beats: number[] = []
  for (; t >= 0; t = previo[t]) beats.push(t)
  return beats.reverse()
}

export const analizarRitmo = async (archivo: string): Promise<Ritmo> => {
  const x = await decodificar(archivo)
  if (x.length < N * 4) throw new Error('El audio es demasiado corto.')
  const { ataque, bombo } = envolventes(x)
  const periodo = tempo(ataque)
  const cps = SR / HOP
  // El ataque aparece cuando entra en la ventana; con la ventana Hann, ~0.73 N después del inicio del cuadro (medido con clics).
  const aSeg = (c: number) => +((c * HOP + 0.73 * N) / SR).toFixed(3)
  // Sin beats en el silencio del principio y del final (la programación dinámica los inventa para completar la cadena).
  const [primero, ultimo] = [ataque.findIndex((y) => y > 0.15), ataque.length - 1 - [...ataque].reverse().findIndex((y) => y > 0.15)]
  const beats = seguirBeats(ataque, periodo).filter((b) => b >= primero - periodo / 2 && b <= ultimo + periodo / 2)
  // Compases: la fase (0–3) cuyos beats caen en el bombo más fuerte.
  let fase = 0
  let fuerza = -1
  for (let f = 0; f < 4; f++) {
    let s = 0
    for (let i = f; i < beats.length; i += 4) s += bombo[beats[i]] + 0.3 * ataque[beats[i]]
    if (s > fuerza) ((fuerza = s), (fase = f))
  }
  // Acentos: picos locales fuertes de la envolvente, separados al menos medio beat.
  const orden = [...ataque].sort((a, b) => a - b)
  const umbral = orden[Math.floor(orden.length * 0.9)]
  const acentos: number[] = []
  for (let i = 1; i < ataque.length - 1; i++)
    if (ataque[i] >= umbral && ataque[i] >= ataque[i - 1] && ataque[i] > ataque[i + 1] && (!acentos.length || i - acentos.at(-1)! >= periodo / 2)) acentos.push(i)
  return {
    bpm: +((60 * cps) / periodo).toFixed(1),
    duracion: +(x.length / SR).toFixed(3),
    beats: beats.map(aSeg),
    compases: beats.filter((_, i) => i % 4 === fase).map(aSeg),
    acentos: acentos.map(aSeg),
  }
}
