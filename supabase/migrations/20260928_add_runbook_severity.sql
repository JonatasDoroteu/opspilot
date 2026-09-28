alter table runbooks
    add column if not exists severity text not null default 'medium';