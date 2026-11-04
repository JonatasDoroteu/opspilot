import { useEffect, useMemo, useRef, useState } from 'react'
import { buscarIncidentes, buscarRunbook } from './api'
import { incidentesDemo, runbooksDemo } from './dadosDemo'
import { ListaIncidentes } from './components/ListaIncidentes'
import { PainelRunbook } from './components/PainelRunbook'
import { formatarDataRelativa } from './dataRelativa'
import { filtrarIncidentes } from './filtrarIncidentes'
import { ordenarIncidentes } from './ordenarIncidentes'
import type { OrdenacaoIncidentes } from './ordenarIncidentes'
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
const ordenacoes: { value: OrdenacaoIncidentes; label: string }[] = [
  { value: 'recentes', label: 'Mais recentes' },
  { value: 'antigos', label: 'Mais antigos' },
  { value: 'severidade', label: 'Severidade (crítica primeiro)' },
]
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

function parametrosIniciais(): URLSearchParams {
  return new URLSearchParams(window.location.search)
}

function isOrdenacao(value: string | null): value is OrdenacaoIncidentes {
  return ordenacoes.some((ordenacao) => ordenacao.value === value)
}

function lerOrdenacaoInicial(): OrdenacaoIncidentes {
  const value = parametrosIniciais().get('sort')
  return isOrdenacao(value) ? value : 'recentes'
}

function lerStatusInicial(): IncidentStatus | '' {
  const value = parametrosIniciais().get('status')
  return statuses.find((status) => status.value === value)?.value ?? ''
}

function lerCategoriaInicial(): Category | '' {
  const value = parametrosIniciais().get('category')
  return categorias.find((categoria) => categoria.value === value)?.value ?? ''
}

function lerSeveridadeInicial(): Severity | '' {
  const value = parametrosIniciais().get('severity')
  return severidades.find((severity) => severity === value) ?? ''
}

function App() {
  const [estado, setEstado] = useState<EstadoIncidentes>({ status: 'loading' })
  const [apiDemorando, setApiDemorando] = useState(false)
  const [origem, setOrigem] = useState<OrigemDados>('api')
  const [severityFilter, setSeverityFilter] = useState<Severity | ''>(lerSeveridadeInicial)
  const [statusFilter, setStatusFilter] = useState<IncidentStatus | ''>(lerStatusInicial)
  const [categoryFilter, setCategoryFilter] = useState<Category | ''>(lerCategoriaInicial)
  const [searchFilter, setSearchFilter] = useState(() => parametrosIniciais().get('q') ?? '')
  const [ordenacao, setOrdenacao] = useState<OrdenacaoIncidentes>(lerOrdenacaoInicial)
  const [incidenteSelecionadoId, setIncidenteSelecionadoId] = useState<string | null>(
    () => parametrosIniciais().get('incident') || null,
  )
  const [selecaoVazia, setSelecaoVazia] = useState(
    () => parametrosIniciais().has('incident') && parametrosIniciais().get('incident') === '',
  )
  const [resultadoRunbook, setResultadoRunbook] = useState<ResultadoRunbook | null>(null)
  const [tentativa, setTentativa] = useState(0)
  const [tentativaRunbook, setTentativaRunbook] = useState(0)
  const [atualizadoEm, setAtualizadoEm] = useState<string | null>(null)
  const [agora, setAgora] = useState(() => new Date())
  const campoBuscaRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let ativo = true
    const controller = new AbortController()

    async function carregar(): Promise<void> {
      setApiDemorando(false)
      setEstado({ status: 'loading' })
      setOrigem('api')
      try {
        const incidentes = await buscarIncidentes(controller.signal)
        if (ativo) {
          setEstado({ status: 'ok', incidentes })
          setAtualizadoEm(new Date().toISOString())
          setIncidenteSelecionadoId((idAtual) =>
            idAtual && incidentes.some((incidente) => incidente.id === idAtual) ? idAtual : null,
          )
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
      controller.abort()
    }
  }, [tentativa])

  useEffect(() => {
    const interval = window.setInterval(() => setAgora(new Date()), 30_000)
    return () => window.clearInterval(interval)
  }, [])

  useEffect(() => {
    if (estado.status !== 'loading') return

    const timeout = window.setTimeout(() => setApiDemorando(true), 5_000)
    return () => window.clearTimeout(timeout)
  }, [estado.status, tentativa])

  const incidentes = estado.status === 'ok' ? estado.incidentes : INCIDENTES_VAZIOS
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
  const incidentesFiltrados = useMemo(
    () =>
      ordenarIncidentes(
        filtrarIncidentes(incidentes, {
          severity: severityFilter,
          status: statusFilter,
          category: categoryFilter,
          search: searchFilter,
        }),
        ordenacao,
      ),
    [incidentes, severityFilter, statusFilter, categoryFilter, searchFilter, ordenacao],
  )
  const incidenteSelecionado = selecaoVazia
    ? null
    : incidentesFiltrados.find((incidente) => incidente.id === incidenteSelecionadoId) ??
      incidentesFiltrados[0] ??
      null
  const categoriaSelecionada = incidenteSelecionado?.category
  const chaveRunbook = categoriaSelecionada
    ? `${origem}:${categoriaSelecionada}:${tentativaRunbook}`
    : ''

  useEffect(() => {
    if (categoriaSelecionada === undefined || origem !== 'api') return
    const category = categoriaSelecionada
    let ativo = true

    async function carregarRunbook(): Promise<void> {
      try {
        const runbook = await buscarRunbook(category)
        if (ativo) {
          setResultadoRunbook({
            chave: `${origem}:${category}:${tentativaRunbook}`,
            estado: { status: 'ok', runbook },
          })
        }
      } catch (error: unknown) {
        if (ativo) {
          setResultadoRunbook({
            chave: `${origem}:${category}:${tentativaRunbook}`,
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

  useEffect(() => {
    if (estado.status !== 'ok') return

    const params = new URLSearchParams()
    if (searchFilter) params.set('q', searchFilter)
    if (statusFilter) params.set('status', statusFilter)
    if (categoryFilter) params.set('category', categoryFilter)
    if (severityFilter) params.set('severity', severityFilter)
    if (ordenacao !== 'recentes') params.set('sort', ordenacao)
    if (selecaoVazia) {
      params.set('incident', '')
    } else if (incidenteSelecionadoId) {
      const idVisivel = incidentesFiltrados.some(
        (incidente) => incidente.id === incidenteSelecionadoId,
      )
        ? incidenteSelecionadoId
        : incidenteSelecionado?.id
      if (idVisivel) params.set('incident', idVisivel)
    }

    const query = params.toString()
    const url = `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`
    window.history.replaceState(null, '', url)
  }, [
    searchFilter,
    statusFilter,
    categoryFilter,
    severityFilter,
    ordenacao,
    incidenteSelecionadoId,
    incidenteSelecionado,
    incidentesFiltrados,
    selecaoVazia,
    estado.status,
  ])

  useEffect(() => {
    function lidarComTeclado(event: KeyboardEvent): void {
      const alvo = event.target
      const campoEditavel =
        alvo instanceof HTMLInputElement ||
        alvo instanceof HTMLTextAreaElement ||
        alvo instanceof HTMLSelectElement ||
        (alvo instanceof HTMLElement && alvo.isContentEditable)

      if (event.key === '/' && !campoEditavel) {
        event.preventDefault()
        campoBuscaRef.current?.focus()
        return
      }

      if (campoEditavel) return

      if (event.key === 'Escape') {
        setIncidenteSelecionadoId(null)
        setSelecaoVazia(true)
        return
      }

      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
      if (incidentesFiltrados.length === 0) return

      event.preventDefault()
      const indiceAtual = incidentesFiltrados.findIndex(
        (incidente) => incidente.id === incidenteSelecionado?.id,
      )
      const proximoIndice =
        indiceAtual < 0
          ? event.key === 'ArrowDown'
            ? 0
            : incidentesFiltrados.length - 1
          : Math.min(
              Math.max(indiceAtual + (event.key === 'ArrowDown' ? 1 : -1), 0),
              incidentesFiltrados.length - 1,
            )
      setIncidenteSelecionadoId(incidentesFiltrados[proximoIndice].id)
      setSelecaoVazia(false)
    }

    window.addEventListener('keydown', lidarComTeclado)
    return () => window.removeEventListener('keydown', lidarComTeclado)
  }, [incidentesFiltrados, incidenteSelecionado])

  useEffect(() => {
    if (!incidenteSelecionado || selecaoVazia) return
    const itemSelecionado = document.querySelector('.incident-row[aria-pressed="true"]')
    if (!itemSelecionado || typeof itemSelecionado.scrollIntoView !== 'function') return
    itemSelecionado.scrollIntoView({
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
      block: 'nearest',
    })
  }, [incidenteSelecionado, incidentesFiltrados, selecaoVazia])

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
    setSelecaoVazia(false)
    setSeverityFilter('')
    setStatusFilter('')
    setCategoryFilter('')
    setSearchFilter('')
    setOrdenacao('recentes')
    setAtualizadoEm(new Date().toISOString())
  }

  function limparFiltros(): void {
    setSeverityFilter('')
    setStatusFilter('')
    setCategoryFilter('')
    setSearchFilter('')
    setOrdenacao('recentes')
    setIncidenteSelecionadoId(null)
    setSelecaoVazia(false)
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.hash}`)
  }

  function tentarNovamente(): void {
    setTentativa((valor) => valor + 1)
  }

  return (
    <main>
      <header className="topbar">
        <div className="topbar-main">
          <h1>OpsPilot · Painel de incidentes</h1>
          <button
            type="button"
            className="refresh-button"
            onClick={tentarNovamente}
            disabled={estado.status === 'loading'}
          >
            Atualizar
          </button>
          {atualizadoEm && (
            <span className="updated-at">Atualizado {formatarDataRelativa(atualizadoEm, agora)}</span>
          )}
        </div>
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
            onClick={() => {
              setSeverityFilter((atual) => (atual === severity ? '' : severity))
              setSelecaoVazia(false)
            }}
          >
            <span className="counter-label">{nomesSeveridade[severity]}</span>
            <span className="counter-value">{String(contagens[severity]).padStart(2, '0')}</span>
          </button>
        ))}
      </section>

      {estado.status === 'ok' && (
        <>
          <section className="filters" aria-label="Filtros de incidentes">
            <div className="filter-field filter-field--search">
              <label htmlFor="filtro-busca">Buscar</label>
              <input
                id="filtro-busca"
                ref={campoBuscaRef}
                type="search"
                placeholder="Buscar por título"
                value={searchFilter}
                onChange={(event) => setSearchFilter(event.target.value)}
              />
            </div>
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
            <div className="filter-field">
              <label htmlFor="ordenar-incidentes">Ordenar por</label>
              <select
                id="ordenar-incidentes"
                value={ordenacao}
                onChange={(event) => {
                  const selecionada = ordenacoes.find(
                    (opcao) => opcao.value === event.target.value,
                  )
                  if (selecionada) setOrdenacao(selecionada.value)
                }}
              >
                {ordenacoes.map((opcao) => (
                  <option key={opcao.value} value={opcao.value}>{opcao.label}</option>
                ))}
              </select>
            </div>
            <button type="button" className="clear-button" onClick={limparFiltros}>
              Limpar filtros
            </button>
          </section>
          <p className="keyboard-hint">Atalhos: / buscar, ↑↓ navegar</p>

          <div className="dashboard-grid">
            <ListaIncidentes
              incidentes={incidentesFiltrados}
              incidenteSelecionadoId={incidenteSelecionado?.id ?? null}
              onSelecionar={(incidente) => {
                setIncidenteSelecionadoId(incidente.id)
                setSelecaoVazia(false)
              }}
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
          role={estado.status === 'error' ? 'alert' : 'status'}
          aria-live={estado.status === 'error' ? 'assertive' : 'polite'}
        >
          {estado.status === 'loading' ? (
            <p>
              {apiDemorando
                ? 'A API gratuita pode estar acordando, isso leva até 1 minuto.'
                : 'Conectando à API.'}
            </p>
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
      {estado.status === 'loading' && (
        <div className="dashboard-grid loading-grid" aria-hidden="true">
          <section className="incident-panel skeleton-panel">
            <div className="panel-heading">
              <span className="skeleton-line skeleton-heading" />
            </div>
            <div className="skeleton-list">
              {Array.from({ length: 4 }, (_, index) => (
                <div className="skeleton-incident" key={index}>
                  <span className="skeleton-line skeleton-title" />
                  <span className="skeleton-line skeleton-meta" />
                </div>
              ))}
            </div>
          </section>
          <aside className="runbook-panel skeleton-panel">
            <div className="panel-heading">
              <span className="skeleton-line skeleton-heading" />
            </div>
            <div className="skeleton-runbook">
              <span className="skeleton-line skeleton-title" />
              <span className="skeleton-line skeleton-meta" />
            </div>
          </aside>
        </div>
      )}
    </main>
  )
}

export default App
