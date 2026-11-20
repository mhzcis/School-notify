-- Additive only: school_notify schema.
create unique index if not exists students_owner_national_id_key on school_notify.students (owner, national_id);
alter table school_notify.templates add column if not exists category text not null default 'general';
alter table school_notify.campaigns add column if not exists meta jsonb not null default '{}'::jsonb;
alter table school_notify.messages add column if not exists meta jsonb not null default '{}'::jsonb;
create index if not exists messages_campaign_id_idx on school_notify.messages (campaign_id);
create index if not exists messages_student_id_idx on school_notify.messages (student_id);
