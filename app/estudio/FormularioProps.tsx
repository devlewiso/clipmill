// Editor de props: formulario si la composición define `esquema`, si no JSON.
import type { CampoEsquema } from '../../src/nucleo/contexto'

export const FormularioProps = ({
  esquema,
  valores,
  cambiar,
  recursos,
}: {
  esquema: Record<string, CampoEsquema | undefined>
  valores: Record<string, any>
  cambiar: (clave: string, valor: any) => void
  recursos: string[]
}) => (
  <div className="formulario">
    {Object.entries(esquema).map(([clave, campo]) => {
      if (!campo) return null
      const v = valores[clave]
      const etiqueta = campo.etiqueta || clave
      let control
      switch (campo.tipo) {
        case 'textoLargo':
          control = <textarea rows={3} value={v ?? ''} onChange={(e) => cambiar(clave, e.target.value)} />
          break
        case 'numero':
          control = (
            <input type="number" min={campo.min} max={campo.max} step={campo.paso ?? 'any'} value={v ?? 0} onChange={(e) => cambiar(clave, Number(e.target.value))} />
          )
          break
        case 'color':
          control = (
            <div className="fila">
              <input type="color" value={/^#[\da-f]{6}$/i.test(v) ? v : '#000000'} onChange={(e) => cambiar(clave, e.target.value)} />
              <input value={v ?? ''} onChange={(e) => cambiar(clave, e.target.value)} />
            </div>
          )
          break
        case 'booleano':
          control = <input type="checkbox" checked={!!v} onChange={(e) => cambiar(clave, e.target.checked)} />
          break
        case 'opciones':
          control = (
            <select value={v ?? ''} onChange={(e) => cambiar(clave, e.target.value)}>
              {campo.opciones.map((o) => (
                <option key={o}>{o}</option>
              ))}
            </select>
          )
          break
        case 'imagen':
        case 'audio':
        case 'video': {
          const ext = { imagen: /\.(png|jpe?g|webp|gif|avif|svg)$/i, audio: /\.(mp3|wav|ogg|m4a|aac)$/i, video: /\.(mp4|webm|mov)$/i }[campo.tipo]
          control = (
            <select value={v ?? ''} onChange={(e) => cambiar(clave, e.target.value)}>
              <option value="">—</option>
              {recursos.filter((r) => ext.test(r)).map((r) => (
                <option key={r}>{r}</option>
              ))}
            </select>
          )
          break
        }
        default:
          control = <input value={v ?? ''} onChange={(e) => cambiar(clave, e.target.value)} />
      }
      return (
        <label key={clave} className={'campo' + (campo.tipo === 'booleano' ? ' campo-check' : '')}>
          <span>{etiqueta}</span>
          {control}
        </label>
      )
    })}
  </div>
)
