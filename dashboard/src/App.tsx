import { useEffect, useMemo, useState } from 'react'
import { buscarIncidentes, buscarRunbook } from './api'
import { incidentesDemo, runbooksDemo } from './dadosDemo'
import { ListaIncidentes } from './components/ListaIncidentes'
import { PainelRunbook } from './components/PainelRunbook'
import type { Category, Incident, IncidentStatus, Runbook, Severity } from './types'
import './styles/App.scss'

type EstadoIncidentes =
  | { status: 'loading' }
  | { status: 'error'; mensagem: string }
  | { status: 'ok'; incidentes: Incident[] }

type EstadoRunbook =
  | { status: 'loading' }
  | { status: 'error'; mensagem: string }
  | { status: 'ok'; runbook: Runbook | null }

type ResultadoRunbook = {
  chave: string
  estado: Exclude<EstadoRunbook, { status: 'loading' }>
}

type OrigemDados = 'api' | 'demo'

const INCIDENTES_VAZIOS: Incident[] = []
const severidades: Severity[] = ['critical', 'high', 'medium', 'low']
const categorias: { value: Category | ''; label: string }[] = [
  { value: '', label: 'Todas as categorias' },
  { value: 'database', label: 'Banco de dados' },
  { value: 'deploy', label: 'Deploy' },
  { value: 'network', label: 'Rede' },
  { value: 'other', label: 'Outro' },
]
const statuses: { value: IncidentStatus | ''; label: string }[] = [
  { value: '', label: 'Todos os status' },
  { value: 'open', label: 'Aberto' },
  { value: 'resolved', label: 'Resolvido' },
]
const nomesSeveridade: Record<Severity, string> = {
  critical: 'Crítica',
  high: 'Alta',
  medium: 'Média',
  low: 'Baixa',
}

function App() {
  const [estado, setEstado] = useState<EstadoIncidentes>({ status: 'loading' })
  const [origem, setOrigem] = useState<OrigemDados>('api')
  const [severityFilter, setSeverityFilter] = useState<Severity | ''>('')
  const [statusFilter, setStatusFilter] = useState<IncidentStatus | ''>('')
  const [categoryFilter, setCategoryFilter] = useState<Category | ''>('')
  const [incidenteSelecionadoId, setIncidenteSelecionadoId] = useState<string | null>(null)
  const [resultadoRunbook, setResultadoRunbook] = useState<ResultadoRunbook | null>(null)
  const [tentativa, setTentativa] = useState(0)
  const [tentativaRunbook, setTentativaRunbook] = useState(0)

  useEffect(() => {
    let ativo = true

    async function carregar(): Promise<void> {
      setEstado({ status: 'loading' })
      setOrigem('api')
      try {
        const incidentes = await buscarIncidentes()
        if (ativo) {
          setEstado({ status: 'ok', incidentes })
          setIncidenteSelecionadoId(incidentes[0]?.id ?? null)
        }
      } catch (error: unknown) {
        if (ativo) {
          setEstado({
            status: 'error',
            mensagem: error instanceof Error ? error.message : 'Erro inesperado ao carregar incidentes.',
          })
        }
      }
    }

    void carregar()
    return () => {
      ativo = false
    }
  }, [tentativa])

  const incidentes = estado.status === 'ok' ? estado.incidentes : INCIDENTES_VAZIOS
  const incidentesOrdenados = useMemo(
    () => [...incidentes].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)),
    [incidentes],
  )
  const contagens = useMemo(
    () =>
      severidades.reduce<Record<Severity, number>>(
        (resultado, severity) => {
          resultado[severity] = incidentes.filter((incidente) => incidente.severity === severity).length
          return resultado
        },
        { critical: 0, high: 0, medium: 0, low: 0 },
      ),
    [incidentes],
  )
  const incidentesFiltrados = incidentesOrdenados.filter(
    (incidente) =>
      (!severityFilter || incidente.severity === severityFilter) &&
      (!statusFilter || incidente.status === statusFilter) &&
      (!categoryFilter || incidente.category === categoryFilter),
  )
  const incidenteSelecionado =
    incidentesFiltrados.find((incidente) => incidente.id === incidenteSelecionadoId) ??
    incidentesFiltrados[0] ??
    null
  const categoriaSelecionada = incidenteSelecionado?.category
  const chaveRunbook = categoriaSelecionada
    ? `${origem}:${categoriaSelecionada}:${tentativaRunbook}`
    : ''

  useEffect(() => {
    if (!categoriaSelecionada || origem !== 'api') return
    let ativo = true

    async function carregarRunbook(): Promise<void> {
      try {
        const runbook = await buscarRunbook(categoriaSelecionada)
        if (ativo) {
          setResultadoRunbook({
            chave: `${origem}:${categoriaSelecionada}:${tentativaRunbook}`,
            estado: { status: 'ok', runbook },
          })
        }
      } catch (error: unknown) {
        if (ativo) {
          setResultadoRunbook({
            chave: `${origem}:${categoriaSelecionada}:${tentativaRunbook}`,
            estado: {
              status: 'error',
              mensagem: error instanceof Error ? error.message : 'Erro inesperado ao carregar o runbook.',
            },
          })
        }
      }
    }

    void carregarRunbook()
    return () => {
      ativo = false
    }
  }, [categoriaSelecionada, origem, tentativaRunbook])

  let estadoRunbook: EstadoRunbook
  if (!incidenteSelecionado) {
    estadoRunbook = { status: 'ok', runbook: null }
  } else if (origem === 'demo') {
    const runbookDemo = runbooksDemo.find(
      (runbook) => runbook.category === incidenteSelecionado.category,
    )
    estadoRunbook = { status: 'ok', runbook: runbookDemo ?? null }
  } else if (resultadoRunbook?.chave !== chaveRunbook) {
    estadoRunbook = { status: 'loading' }
  } else {
    estadoRunbook = resultadoRunbook.estado
  }

  function usarDadosDemo(): void {
    setOrigem('demo')
    setEstado({ status: 'ok', incidentes: incidentesDemo })
    setIncidenteSelecionadoId(incidentesDemo[0]?.id ?? null)
    setSeverityFilter('')
    setStatusFilter('')
    setCategoryFilter('')
  }

  function limparFiltros(): void {
    setSeverityFilter('')
    setStatusFilter('')
    setCategoryFilter('')
  }

  function tentarNovamente(): void {
    setTentativa((valor) => valor + 1)
  }

  return (
    <main>
      <header className="topbar">
        <h1>OpsPilot · Painel de incidentes</h1>
        <span className={`source-badge${origem === 'api' ? ' is-api' : ''}`}>
          {origem === 'api' ? 'API real' : 'Dados de exemplo'}
        </span>
      </header>

      <section className="severity-summary" aria-label="Contagem por severidade">
        {severidades.map((severity) => (
          <button
            type="button"
            className={`severity-counter severity-${severity}`}
            key={severity}
            aria-pressed={severityFilter === severity}
            onClick={() => setSeverityFilter((atual) => (atual === severity ? '' : severity))}
          >
            <span className="counter-label">{nomesSeveridade[severity]}</span>
            <span className="counter-value">{String(contagens[severity]).padStart(2, '0')}</span>
          </button>
        ))}
      </section>

      {estado.status === 'ok' && (
        <>
          <section className="filters" aria-label="Filtros de incidentes">
            <div className="filter-field">
              <label htmlFor="filtro-status">Status</label>
              <select
                id="filtro-status"
                value={statusFilter}
                onChange={(event) => {
                  const selecionado = statuses.find((status) => status.value === event.target.value)
                  setStatusFilter(selecionado?.value ?? '')
                }}
              >
                {statuses.map((status) => (
                  <option key={status.value} value={status.value}>{status.label}</option>
                ))}
              </select>
            </div>
            <div className="filter-field">
              <label htmlFor="filtro-categoria">Categoria</label>
              <select
                id="filtro-categoria"
                value={categoryFilter}
                onChange={(event) => {
                  const selecionada = categorias.find(
                    (categoria) => categoria.value === event.target.value,
                  )
                  setCategoryFilter(selecionada?.value ?? '')
                }}
              >
                {categorias.map((categoria) => (
                  <option key={categoria.value} value={categoria.value}>{categoria.label}</option>
                ))}
              </select>
            </div>
            <button type="button" className="clear-button" onClick={limparFiltros}>
              Limpar filtros
            </button>
          </section>

          <div className="dashboard-grid">
            <ListaIncidentes
              incidentes={incidentesFiltrados}
              incidenteSelecionadoId={incidenteSelecionado?.id ?? null}
              onSelecionar={(incidente) => setIncidenteSelecionadoId(incidente.id)}
            />
            <PainelRunbook
              incidente={incidenteSelecionado}
              estado={estadoRunbook}
              onTentarNovamente={() => setTentativaRunbook((valor) => valor + 1)}
            />
          </div>
        </>
      )}

      {estado.status !== 'ok' && (
        <section
          className={`status-area${estado.status === 'error' ? ' status-error' : ''}`}
          role="status"
          aria-live="polite"
        >
          {estado.status === 'loading' ? (
            <p>Conectando à API. No plano gratuito do Render, a primeira carga pode levar cerca de 1 minuto.</p>
          ) : (
            <>
              <p>{estado.mensagem}</p>
              <div className="status-actions">
                <button type="button" className="clear-button" onClick={tentarNovamente}>
                  Tentar de novo
                </button>
                <button type="button" className="clear-button" onClick={usarDadosDemo}>
                  Usar dados de exemplo
                </button>
              </div>
            </>
          )}
        </section>
      )}
    </main>
  )
}

export default App
