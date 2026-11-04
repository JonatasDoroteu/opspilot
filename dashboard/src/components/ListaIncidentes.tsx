import type { Incident, Severity } from '../types'
import { formatarDataRelativa } from '../dataRelativa'

interface ListaIncidentesProps {
  incidentes: Incident[]
  incidenteSelecionadoId: string | null
  onSelecionar: (incidente: Incident) => void
}

const nomesSeveridade: Record<Severity, string> = {
  critical: 'Crítica',
  high: 'Alta',
  medium: 'Média',
  low: 'Baixa',
}

const nomesCategoria: Record<Incident['category'], string> = {
  database: 'Banco de dados',
  deploy: 'Deploy',
  network: 'Rede',
  other: 'Outro',
}

function formatarDataCompleta(data: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(data))
}

export function ListaIncidentes({
  incidentes,
  incidenteSelecionadoId,
  onSelecionar,
}: ListaIncidentesProps) {
  return (
    <section className="incident-panel" aria-labelledby="incidentes-heading">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Registro</p>
          <h2 id="incidentes-heading">Incidentes</h2>
        </div>
        <span className="panel-count">{String(incidentes.length).padStart(2, '0')}</span>
      </div>

      {incidentes.length === 0 ? (
        <p className="empty-state">Nenhum incidente corresponde aos filtros.</p>
      ) : (
        <ul className="incident-list">
          {incidentes.map((incidente) => (
            <li key={incidente.id}>
              <button
                type="button"
                className={`incident-row severity-${incidente.severity}${incidenteSelecionadoId === incidente.id ? ' is-selected' : ''}`}
                onClick={() => onSelecionar(incidente)}
                aria-pressed={incidenteSelecionadoId === incidente.id}
              >
                <span className="incident-row-main">
                  <span className="incident-title">{incidente.title}</span>
                  <span className="incident-meta">
                    <span
                      className={`severity-label severity-badge severity-${incidente.severity}`}
                    >
                      {nomesSeveridade[incidente.severity]}
                    </span>
                    <span>{nomesCategoria[incidente.category]}</span>
                    <span
                      className={`incident-status ${
                        incidente.status === 'open'
                          ? 'incident-status--open'
                          : incidente.status === 'resolved'
                            ? 'incident-status--resolved'
                            : 'incident-status--unknown'
                      }`}
                    >
                      {incidente.status === 'open'
                        ? 'Aberto'
                        : incidente.status === 'resolved'
                          ? 'Resolvido'
                          : 'Desconhecido'}
                    </span>
                  </span>
                </span>
                <span className="incident-row-side">
                  <span className="incident-id">{incidente.id.slice(0, 8)}</span>
                  <time
                    className="incident-date"
                    dateTime={incidente.created_at}
                    title={formatarDataCompleta(incidente.created_at)}
                  >
                    {formatarDataRelativa(incidente.created_at, new Date())}
                  </time>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
