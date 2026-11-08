-- Родовое древо: схема базы.
-- Таблицы закрыты для anon/authenticated; сайт работает только через функции ниже.
-- Файл можно применять повторно.

create schema if not exists drevo_private;
revoke all on schema drevo_private from public;

create table if not exists public.trees (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  root_id     uuid,
  owner_hash  text not null unique,
  edit_hash   text not null unique,
  view_hash   text not null unique,
  version     bigint not null default 0,
  is_example  boolean not null default false,
  created_at  timestamptz not null default now()
);

create table if not exists public.people (
  id          uuid primary key,
  tree_id     uuid not null references public.trees(id) on delete cascade,
  parent_id   uuid references public.people(id),
  pos         int not null default 0,
  name        text not null,
  spouse      text not null default '',
  deleted_by  bigint,
  updated_by  text not null default '',
  updated_at  timestamptz not null default now()
);
create index if not exists people_tree on public.people(tree_id);
create index if not exists people_parent on public.people(parent_id);

create table if not exists public.marriages (
  id          uuid primary key,
  tree_id     uuid not null references public.trees(id) on delete cascade,
  a_id        uuid not null references public.people(id),
  b_id        uuid not null references public.people(id),
  deleted_by  bigint
);
create index if not exists marriages_tree on public.marriages(tree_id);

create table if not exists public.saves (
  id            bigserial primary key,
  tree_id       uuid not null references public.trees(id) on delete cascade,
  author        text not null,
  created_at    timestamptz not null default now(),
  reverts_save  bigint,
  reverts_edit  bigint
);
create index if not exists saves_tree on public.saves(tree_id, id);

create table if not exists public.edits (
  id       bigserial primary key,
  save_id  bigint not null references public.saves(id) on delete cascade,
  op       jsonb not null,
  before   jsonb,
  after    jsonb,
  people   uuid[] not null default '{}',
  reverted_by bigint
);
create index if not exists edits_save on public.edits(save_id);

create table if not exists public.tree_creations (
  ip  text not null,
  at  timestamptz not null default now()
);
create index if not exists tree_creations_at on public.tree_creations(at);

alter table public.trees enable row level security;
alter table public.people enable row level security;
alter table public.marriages enable row level security;
alter table public.saves enable row level security;
alter table public.edits enable row level security;
alter table public.tree_creations enable row level security;
revoke all on all tables in schema public from anon, authenticated, public;
revoke all on all sequences in schema public from anon, authenticated, public;

-- ── Внутренние помощники (не видны через API) ─────────────────────────

create or replace function drevo_private.hash(p_token text) returns text
language sql immutable as $$ select encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex') $$;

-- Роль по токену: owner | edit | view. Неизвестный токен — tree_not_found.
create or replace function drevo_private.role(p_token text, out tree_id uuid, out role text)
language plpgsql stable as $$
declare h text := drevo_private.hash(p_token);
begin
  select t.id, case when t.owner_hash = h then 'owner' when t.edit_hash = h then 'edit' else 'view' end
    into tree_id, role
    from public.trees t
   where t.owner_hash = h or t.edit_hash = h or t.view_hash = h;
  if tree_id is null then raise exception 'tree_not_found'; end if;
end $$;

-- Имя: обрезать края, 1..100 символов, в одну строку. Иначе bad_name.
create or replace function drevo_private.clean_name(p text) returns text
language plpgsql immutable as $$
declare s text := btrim(coalesce(p, ''), E' \t');
begin
  if s = '' or length(s) > 100 or s ~ E'[\\r\\n]' then raise exception 'bad_name'; end if;
  return s;
end $$;

-- Подпись о супруге: может быть пустой, иначе те же правила, что у имени.
create or replace function drevo_private.clean_spouse(p text) returns text
language plpgsql immutable as $$
declare s text := btrim(coalesce(p, ''), E' \t');
begin
  if s = '' then return ''; end if;
  return drevo_private.clean_name(s);
end $$;

create or replace function drevo_private.client_ip() returns text
language sql stable as $$
  select coalesce(nullif(btrim(split_part(
    (nullif(current_setting('request.headers', true), '')::json ->> 'x-forwarded-for'), ',', 1)), ''), 'local')
$$;

-- ── Публичные функции ────────────────────────────────────────────────

create or replace function public.ping() returns int
language sql security definer set search_path = public as $$ select 1 $$;

create or replace function public.create_tree(p_title text, p_root_name text,
  p_owner_hash text, p_edit_hash text, p_view_hash text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_ip text := drevo_private.client_ip();
  v_name text := drevo_private.clean_name(p_root_name);
  v_title text := btrim(coalesce(p_title, ''));
  v_tree uuid;
  v_root uuid := gen_random_uuid();
begin
  if (select count(*) from tree_creations where ip = v_ip and at > now() - interval '1 hour') >= 5
     or (select count(*) from tree_creations where at > now() - interval '1 day') >= 300 then
    raise exception 'too_many_trees';
  end if;
  if p_owner_hash !~ '^[0-9a-f]{64}$' or p_edit_hash !~ '^[0-9a-f]{64}$' or p_view_hash !~ '^[0-9a-f]{64}$'
     or p_owner_hash in (p_edit_hash, p_view_hash) or p_edit_hash = p_view_hash then
    raise exception 'bad_token';
  end if;
  if v_title = '' then v_title := 'Род ' || v_name; end if;
  v_title := left(v_title, 120);

  insert into tree_creations(ip) values (v_ip);
  delete from tree_creations where at < now() - interval '2 days';
  insert into trees(title, owner_hash, edit_hash, view_hash) values (v_title, p_owner_hash, p_edit_hash, p_view_hash)
    returning id into v_tree;
  insert into people(id, tree_id, name) values (v_root, v_tree, v_name);
  update trees set root_id = v_root where id = v_tree;
  return jsonb_build_object('tree_id', v_tree, 'root_id', v_root);
end $$;

create or replace function public.open_tree(p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r record; t trees;
begin
  select * into r from drevo_private.role(p_token);
  select * into t from trees where id = r.tree_id;
  return jsonb_build_object(
    'tree_id', t.id, 'title', t.title, 'role', r.role, 'root_id', t.root_id,
    'version', t.version, 'is_example', t.is_example,
    'people', coalesce((select jsonb_agg(jsonb_build_object(
        'id', p.id, 'parent_id', p.parent_id, 'pos', p.pos, 'name', p.name, 'spouse', p.spouse,
        'updated_by', p.updated_by, 'updated_at', p.updated_at) order by p.pos)
      from people p where p.tree_id = t.id and p.deleted_by is null), '[]'::jsonb),
    'marriages', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'a_id', m.a_id, 'b_id', m.b_id))
      from marriages m where m.tree_id = t.id and m.deleted_by is null), '[]'::jsonb));
end $$;

create or replace function public.tree_version(p_token text) returns bigint
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  select * into r from drevo_private.role(p_token);
  return (select version from trees where id = r.tree_id);
end $$;

-- По умолчанию Postgres даёт EXECUTE всем; открываем только нужное.
revoke execute on all functions in schema public from public, anon, authenticated;
revoke execute on all functions in schema drevo_private from public, anon, authenticated;
grant execute on function public.ping() to anon, authenticated;
grant execute on function public.create_tree(text, text, text, text, text) to anon, authenticated;
grant execute on function public.open_tree(text) to anon, authenticated;
grant execute on function public.tree_version(text) to anon, authenticated;
