create table if not exists incidents (
    id uuid primary key default gen_random_uuid(),
    title text not null,
    severity text not null default 'medium',
    status text not null default 'open',
    source text not null default 'manual',
    created_at timestamptz not null default now(),
    resolved_at timestamptz
);

alter table incidents enable row level security;

create policy "service role full access"
on incidents for all
using (true)
with check (true);
alter table incidents add column if not exists category text not null default 'other';

create table if not exists runbooks (
    id uuid primary key default gen_random_uuid(),
    category text not null unique,
    title text not null,
    steps text not null,
    severity text not null default 'medium',
    created_at timestamptz not null default now()
);

alter table runbooks
    add column if not exists severity text not null default 'medium';

alter table runbooks enable row level security;

create policy "service role full access runbooks"
on runbooks for all
using (true)
with check (true);

insert into runbooks (category, title, steps, severity) values
('database', 'Banco travado / lento', E'1. Checar conexões ativas: SELECT * FROM pg_stat_activity;\n2. Identificar queries longas (>30s) e considerar cancelar (pg_cancel_backend).\n3. Verificar locks: SELECT * FROM pg_locks WHERE granted = false.\n4. Se for connection pool exaurido, reiniciar o pooler (pgbouncer/supabase pooler).\n5. Escalar pro DBA se não resolver em 15 min.', 'high'),
('deploy', 'Deploy quebrou produção', E'1. Rollback imediato pro deploy anterior (Render: rollback pelo dashboard).\n2. Checar logs do serviço com erro.\n3. Confirmar health check voltou a 200.\n4. Abrir incidente pro time revisar o que quebrou antes do próximo deploy.', 'critical'),
('network', 'Serviço fora do ar / timeout', E'1. Checar status da infra (status page do Render).\n2. Testar health check manualmente (curl).\n3. Checar se é DNS, certificado ou serviço caído mesmo.\n4. Se for provedor terceiro, checar status page dele.', 'high')
on conflict (category) do nothing;