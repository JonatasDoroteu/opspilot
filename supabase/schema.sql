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
