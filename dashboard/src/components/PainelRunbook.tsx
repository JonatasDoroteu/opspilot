import type { Incident, Runbook, Severity } from '../types'

interface PainelRunbookProps {
  incidente: Incident | null
  estado: { status: 'loading' } | { status: 'error'; mensagem: string } | { status: 'ok'; runbook: Runbook | null }
  onTentarNovamente: () => void
}

const nomesSeveridade: Record<Severity, string> = {
  critical: 'Crítica',
  high: 'Alta',
  medium: 'Média',
  low: 'Baixa',
}

function separarPassos(passos: string): string[] {
  return passos
    .split(/\r?\n/)
    .map((passo) => passo.replace(/^\s*\d+[.)]\s*/, '').trim())
    .filter((passo) => passo.length > 0)
}

export function PainelRunbook({
  incidente,
  estado,
  onTentarNovamente,
}: PainelRunbookProps) {
  return (
    <aside className="runbook-panel" aria-labelledby="runbook-heading">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Procedimento</p>
          <h2 id="runbook-heading">Runbook</h2>
        </div>
        {incidente && (
          <span className={`severity-badge severity-${incidente.severity}`}>
            {nomesSeveridade[incidente.severity]}
          </span>
        )}
      </div>

      {!incidente ? (
        <p className="empty-state">Selecione um incidente para consultar o procedimento.</p>
      ) : estado.status === 'loading' ? (
        <p className="runbook-message" role="status">Carregando runbook…</p>
      ) : estado.status === 'error' ? (
        <div className="runbook-message runbook-error" role="status">
          <p>{estado.mensagem}</p>
          <button type="button" className="text-button" onClick={onTentarNovamente}>
            Tentar novamente
          </button>
        </div>
      ) : estado.runbook === null ? (
        <p className="empty-state">Sem runbook cadastrado para esta categoria.</p>
      ) : (
        <div className="runbook-content">
          <p className="runbook-incident">{incidente.title}</p>
          <h3>{estado.runbook.title}</h3>
          <div className="runbook-detail">
            <span className="eyebrow">Severidade do runbook</span>
            <span className={`severity-label severity-text-${estado.runbook.severity}`}>
              {nomesSeveridade[estado.runbook.severity]}
            </span>
          </div>
          <ol className="runbook-steps">
            {separarPassos(estado.runbook.steps).map((passo, index) => (
              <li key={`${index}-${passo}`}>{passo}</li>
            ))}
          </ol>
        </div>
      )}
    </aside>
  )
}
