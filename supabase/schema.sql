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
  version       bigint not null,
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

-- ── Сохранение черновика ─────────────────────────────────────────────

create or replace function drevo_private.uuid_of(p jsonb, k text) returns uuid
language plpgsql immutable as $$
begin
  if p ->> k is null then raise exception 'bad_op'; end if;
  return (p ->> k)::uuid;
exception when invalid_text_representation then
  raise exception 'bad_op';
end $$;

-- Живой человек этого древа или bad_op.
create or replace function drevo_private.alive(p_tree uuid, p_id uuid) returns people
language plpgsql stable as $$
declare r people;
begin
  select * into r from people where id = p_id and tree_id = p_tree and deleted_by is null;
  if r.id is null then raise exception 'bad_op'; end if;
  return r;
end $$;

create or replace function drevo_private.person_json(p people) returns jsonb
language sql immutable as $$
  select jsonb_build_object('id', p.id, 'parent_id', p.parent_id, 'pos', p.pos, 'name', p.name, 'spouse', p.spouse)
$$;

-- Люди, которых правка меняет напрямую (для поиска конфликтов) и на которых она опирается.
create or replace function drevo_private.op_targets(p_op jsonb, out changed uuid[], out needed uuid[])
language plpgsql immutable as $$
begin
  changed := '{}'; needed := '{}';
  case p_op ->> 'type'
    when 'add_child' then needed := array[drevo_private.uuid_of(p_op, 'parent_id')];
    when 'add_parent' then changed := array[drevo_private.uuid_of(p_op, 'child_id')];
    when 'update' then changed := array[drevo_private.uuid_of(p_op, 'person_id')];
    when 'move' then changed := array[drevo_private.uuid_of(p_op, 'person_id')];
                     needed := array[drevo_private.uuid_of(p_op, 'parent_id')];
    when 'delete' then changed := array[drevo_private.uuid_of(p_op, 'person_id')];
    when 'marry' then changed := array[drevo_private.uuid_of(p_op, 'a_id'), drevo_private.uuid_of(p_op, 'b_id')];
    else null;
  end case;
end $$;

create or replace function drevo_private.next_pos(p_parent uuid) returns int
language sql stable as $$ select coalesce(max(pos) + 1, 0) from people where parent_id = p_parent $$;

-- Применяет одну правку, пишет её в журнал. Возвращает id записи журнала.
create or replace function drevo_private.apply_op(p_tree uuid, p_save bigint, p_author text, p_op jsonb) returns bigint
language plpgsql as $$
declare
  v_edit bigint;
  v_type text := p_op ->> 'type';
  v_id uuid; v_p people; v_q people; v_m marriages;
  v_root uuid; v_ids uuid[]; v_before jsonb; v_after jsonb;
  v_name text; v_spouse text;
begin
  insert into edits(save_id, op) values (p_save, p_op) returning id into v_edit;
  select root_id into v_root from trees where id = p_tree;

  if v_type = 'add_child' then
    v_id := drevo_private.uuid_of(p_op, 'id');
    if exists (select 1 from people where id = v_id) then raise exception 'bad_op'; end if;
    v_p := drevo_private.alive(p_tree, drevo_private.uuid_of(p_op, 'parent_id'));
    insert into people(id, tree_id, parent_id, pos, name, spouse, updated_by)
      values (v_id, p_tree, v_p.id, drevo_private.next_pos(v_p.id),
              drevo_private.clean_name(p_op ->> 'name'), drevo_private.clean_spouse(p_op ->> 'spouse'), p_author)
      returning * into v_q;
    v_after := drevo_private.person_json(v_q); v_ids := array[v_id];

  elsif v_type = 'add_parent' then
    v_id := drevo_private.uuid_of(p_op, 'id');
    if exists (select 1 from people where id = v_id) then raise exception 'bad_op'; end if;
    v_p := drevo_private.alive(p_tree, drevo_private.uuid_of(p_op, 'child_id'));
    if v_p.id <> v_root then raise exception 'not_root'; end if;
    insert into people(id, tree_id, parent_id, pos, name, spouse, updated_by)
      values (v_id, p_tree, null, 0, drevo_private.clean_name(p_op ->> 'name'),
              drevo_private.clean_spouse(p_op ->> 'spouse'), p_author)
      returning * into v_q;
    update people set parent_id = v_id, pos = 0, updated_by = p_author, updated_at = now() where id = v_p.id;
    update trees set root_id = v_id where id = p_tree;
    v_before := jsonb_build_object('root_id', v_root, 'child', drevo_private.person_json(v_p));
    v_after := jsonb_build_object('root_id', v_id, 'person', drevo_private.person_json(v_q));
    v_ids := array[v_id, v_p.id];

  elsif v_type = 'update' then
    v_p := drevo_private.alive(p_tree, drevo_private.uuid_of(p_op, 'person_id'));
    if not (p_op ? 'name' or p_op ? 'spouse') then raise exception 'bad_op'; end if;
    v_name := case when p_op ? 'name' then drevo_private.clean_name(p_op ->> 'name') else v_p.name end;
    v_spouse := case when p_op ? 'spouse' then drevo_private.clean_spouse(p_op ->> 'spouse') else v_p.spouse end;
    update people set name = v_name, spouse = v_spouse, updated_by = p_author, updated_at = now()
     where id = v_p.id returning * into v_q;
    v_before := drevo_private.person_json(v_p); v_after := drevo_private.person_json(v_q); v_ids := array[v_p.id];

  elsif v_type = 'move' then
    v_p := drevo_private.alive(p_tree, drevo_private.uuid_of(p_op, 'person_id'));
    if v_p.id = v_root then raise exception 'root_protected'; end if;
    v_q := drevo_private.alive(p_tree, drevo_private.uuid_of(p_op, 'parent_id'));
    if exists (
      with recursive sub(id) as (select v_p.id union all select c.id from people c join sub on c.parent_id = sub.id)
      select 1 from sub where id = v_q.id) then raise exception 'cycle'; end if;
    update people set parent_id = v_q.id, pos = drevo_private.next_pos(v_q.id), updated_by = p_author, updated_at = now()
     where id = v_p.id returning * into v_q;
    v_before := drevo_private.person_json(v_p); v_after := drevo_private.person_json(v_q); v_ids := array[v_p.id];

  elsif v_type = 'delete' then
    v_p := drevo_private.alive(p_tree, drevo_private.uuid_of(p_op, 'person_id'));
    if v_p.id = v_root then raise exception 'root_protected'; end if;
    with recursive sub(id) as (
      select v_p.id
      union all
      select c.id from people c join sub on c.parent_id = sub.id where c.deleted_by is null)
    select array_agg(id) into v_ids from sub;
    update people set deleted_by = v_edit, updated_by = p_author, updated_at = now() where id = any(v_ids);
    v_before := jsonb_build_object('name', v_p.name);
    v_after := jsonb_build_object('count', cardinality(v_ids));

  elsif v_type = 'marry' then
    v_id := drevo_private.uuid_of(p_op, 'id');
    if exists (select 1 from marriages where id = v_id) then raise exception 'bad_op'; end if;
    v_p := drevo_private.alive(p_tree, drevo_private.uuid_of(p_op, 'a_id'));
    v_q := drevo_private.alive(p_tree, drevo_private.uuid_of(p_op, 'b_id'));
    if v_p.id = v_q.id or exists (select 1 from marriages where tree_id = p_tree and deleted_by is null
         and ((a_id = v_p.id and b_id = v_q.id) or (a_id = v_q.id and b_id = v_p.id))) then
      raise exception 'bad_op';
    end if;
    insert into marriages(id, tree_id, a_id, b_id) values (v_id, p_tree, v_p.id, v_q.id);
    v_after := jsonb_build_object('id', v_id, 'a_id', v_p.id, 'b_id', v_q.id, 'a', v_p.name, 'b', v_q.name);
    v_ids := array[v_p.id, v_q.id];

  elsif v_type = 'unmarry' then
    select * into v_m from marriages where id = drevo_private.uuid_of(p_op, 'marriage_id')
       and tree_id = p_tree and deleted_by is null;
    if v_m.id is null then raise exception 'bad_op'; end if;
    update marriages set deleted_by = v_edit where id = v_m.id;
    v_before := jsonb_build_object('id', v_m.id, 'a_id', v_m.a_id, 'b_id', v_m.b_id,
      'a', (select name from people where id = v_m.a_id), 'b', (select name from people where id = v_m.b_id));
    v_ids := array[v_m.a_id, v_m.b_id];

  else
    raise exception 'bad_op';
  end if;

  update edits set before = v_before, after = v_after, people = coalesce(v_ids, '{}') where id = v_edit;
  return v_edit;
end $$;

create or replace function public.save_changes(p_token text, p_author text, p_base_version bigint,
  p_ops jsonb, p_force boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r record; v_author text; v_save bigint; v_version bigint; v_op jsonb;
  v_new uuid[] := '{}'; v_changed uuid[] := '{}'; v_needed uuid[] := '{}'; t record;
  v_conflicts jsonb;
begin
  select * into r from drevo_private.role(p_token);
  if r.role not in ('owner', 'edit') then raise exception 'forbidden'; end if;
  v_author := drevo_private.clean_name(p_author);
  if jsonb_typeof(p_ops) <> 'array' or jsonb_array_length(p_ops) = 0 or jsonb_array_length(p_ops) > 5000 then
    raise exception 'bad_op';
  end if;
  perform 1 from trees where id = r.tree_id for update;

  -- Кого черновик трогает (кроме людей, которых он сам создаёт).
  for v_op in select * from jsonb_array_elements(p_ops) loop
    if v_op ->> 'type' in ('add_child', 'add_parent', 'marry') then
      v_new := v_new || drevo_private.uuid_of(v_op, 'id');
    end if;
    select * into t from drevo_private.op_targets(v_op);
    v_changed := v_changed || t.changed;
    v_needed := v_needed || t.needed;
  end loop;

  if not p_force then
    with ids as (
      select distinct id from unnest(v_changed || v_needed) id where id <> all(v_new)
    ), deleted as (
      select p.id, p.name, s.author as by, s.created_at as at, 'deleted' as reason
        from ids join people p on p.id = ids.id and p.tree_id = r.tree_id and p.deleted_by is not null
        join edits e on e.id = p.deleted_by join saves s on s.id = e.save_id
       where s.version > p_base_version
    ), changed as (
      select distinct on (p.id) p.id, p.name, s.author as by, s.created_at as at, 'changed' as reason
        from unnest(v_changed) cid
        join people p on p.id = cid and p.tree_id = r.tree_id and p.deleted_by is null
        join edits e on p.id = any(e.people)
        join saves s on s.id = e.save_id and s.tree_id = r.tree_id and s.version > p_base_version
       where cid <> all(v_new)
       order by p.id, s.id desc
    )
    select jsonb_agg(jsonb_build_object('person_id', id, 'name', name, 'by', by, 'at', at, 'reason', reason))
      into v_conflicts
      from (select * from deleted union all select * from changed) c;
    if v_conflicts is not null then
      return jsonb_build_object('ok', false, 'conflicts', v_conflicts);
    end if;
  end if;

  update trees set version = version + 1 where id = r.tree_id returning version into v_version;
  insert into saves(tree_id, author, version) values (r.tree_id, v_author, v_version) returning id into v_save;
  for v_op in select * from jsonb_array_elements(p_ops) loop
    perform drevo_private.apply_op(r.tree_id, v_save, v_author, v_op);
  end loop;
  return jsonb_build_object('ok', true, 'save_id', v_save, 'version', v_version);
end $$;

-- ── История и откат ──────────────────────────────────────────────────

-- Отменяет одну запись журнала, пишет отмену как новую запись в p_save.
create or replace function drevo_private.undo_edit(p_tree uuid, p_save bigint, p_author text, p_edit edits) returns void
language plpgsql as $$
declare
  v_edit bigint; v_type text := p_edit.op ->> 'type'; v_ids uuid[]; v_id uuid; v_old jsonb;
begin
  insert into edits(save_id, op, people)
    values (p_save, jsonb_build_object('type', 'revert', 'of', p_edit.id, 'kind', v_type), p_edit.people)
    returning id into v_edit;

  if v_type = 'add_child' then
    v_id := (p_edit.after ->> 'id')::uuid;
    with recursive sub(id) as (
      select id from people where id = v_id and deleted_by is null
      union all
      select c.id from people c join sub on c.parent_id = sub.id where c.deleted_by is null)
    select array_agg(id) into v_ids from sub;
    update people set deleted_by = v_edit, updated_by = p_author, updated_at = now() where id = any(v_ids);

  elsif v_type = 'add_parent' then
    v_old := p_edit.before -> 'child';
    update people set parent_id = null, pos = (v_old ->> 'pos')::int, updated_by = p_author, updated_at = now()
     where id = (v_old ->> 'id')::uuid;
    update trees set root_id = (p_edit.before ->> 'root_id')::uuid where id = p_tree;
    update people set deleted_by = v_edit, updated_by = p_author, updated_at = now()
     where id = (p_edit.after -> 'person' ->> 'id')::uuid and deleted_by is null;

  elsif v_type = 'update' then
    update people set
      name = case when p_edit.op ? 'name' then p_edit.before ->> 'name' else name end,
      spouse = case when p_edit.op ? 'spouse' then p_edit.before ->> 'spouse' else spouse end,
      updated_by = p_author, updated_at = now()
     where id = (p_edit.before ->> 'id')::uuid;

  elsif v_type = 'move' then
    v_id := (p_edit.before ->> 'parent_id')::uuid;
    if not exists (select 1 from people where id = v_id and deleted_by is null) then
      raise exception 'cannot_revert';
    end if;
    update people set parent_id = v_id, pos = (p_edit.before ->> 'pos')::int, updated_by = p_author, updated_at = now()
     where id = (p_edit.before ->> 'id')::uuid;

  elsif v_type = 'delete' then
    update people set deleted_by = null, updated_by = p_author, updated_at = now() where deleted_by = p_edit.id;

  elsif v_type = 'marry' then
    update marriages set deleted_by = v_edit where id = (p_edit.after ->> 'id')::uuid and deleted_by is null;

  elsif v_type = 'unmarry' then
    update marriages set deleted_by = null where id = (p_edit.before ->> 'id')::uuid;

  else
    raise exception 'bad_op';
  end if;

  update edits set reverted_by = p_save where id = p_edit.id;
end $$;

create or replace function public.revert(p_token text, p_author text, p_save_id bigint, p_edit_id bigint default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r record; v_author text; v_orig saves; v_save bigint; v_version bigint; e edits;
  v_people uuid[]; v_warn jsonb; v_count int := 0;
begin
  select * into r from drevo_private.role(p_token);
  if r.role <> 'owner' then raise exception 'forbidden'; end if;
  v_author := drevo_private.clean_name(p_author);
  perform 1 from trees where id = r.tree_id for update;
  select * into v_orig from saves where id = p_save_id and tree_id = r.tree_id;
  if v_orig.id is null or v_orig.reverts_save is not null then raise exception 'bad_op'; end if;
  if p_edit_id is not null and not exists (select 1 from edits where id = p_edit_id and save_id = p_save_id) then
    raise exception 'bad_op';
  end if;

  select array_agg(distinct pid) into v_people
    from edits, unnest(edits.people) pid
   where save_id = p_save_id and reverted_by is null and (p_edit_id is null or id = p_edit_id);

  select jsonb_agg(w) into v_warn from (
    select distinct on (p.id) jsonb_build_object('person_id', p.id, 'name', p.name, 'by', s.author, 'at', s.created_at) w
      from unnest(v_people) pid
      join people p on p.id = pid
      join edits x on pid = any(x.people)
      join saves s on s.id = x.save_id and s.tree_id = r.tree_id and s.id > p_save_id
     order by p.id, s.id desc) q;

  update trees set version = version + 1 where id = r.tree_id returning version into v_version;
  insert into saves(tree_id, author, version, reverts_save, reverts_edit)
    values (r.tree_id, v_author, v_version, p_save_id, p_edit_id) returning id into v_save;

  for e in select * from edits where save_id = p_save_id and reverted_by is null
             and (p_edit_id is null or id = p_edit_id) order by id desc loop
    perform drevo_private.undo_edit(r.tree_id, v_save, v_author, e);
    v_count := v_count + 1;
  end loop;
  if v_count = 0 then raise exception 'already_reverted'; end if;

  return jsonb_build_object('ok', true, 'save_id', v_save, 'version', v_version,
                            'warnings', coalesce(v_warn, '[]'::jsonb));
end $$;

create or replace function public.get_history(p_token text, p_limit int default 50, p_before bigint default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  select * into r from drevo_private.role(p_token);
  if r.role not in ('owner', 'edit') then raise exception 'forbidden'; end if;
  return coalesce((
    select jsonb_agg(x order by (x ->> 'save_id')::bigint desc) from (
      select jsonb_build_object(
        'save_id', s.id, 'author', s.author, 'at', s.created_at,
        'reverts_save', s.reverts_save, 'reverts_edit', s.reverts_edit,
        'reverted_by', (select case when bool_and(e.reverted_by is not null) then max(e.reverted_by) end
                          from edits e where e.save_id = s.id),
        'edits', (select jsonb_agg(jsonb_build_object('edit_id', e.id, 'op', e.op, 'before', e.before,
                    'after', e.after, 'reverted_by', e.reverted_by) order by e.id)
                    from edits e where e.save_id = s.id)) x
        from saves s
       where s.tree_id = r.tree_id and (p_before is null or s.id < p_before)
       order by s.id desc
       limit least(greatest(coalesce(p_limit, 50), 1), 200)) q), '[]'::jsonb);
end $$;

create or replace function public.deleted_items(p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  select * into r from drevo_private.role(p_token);
  if r.role <> 'owner' then raise exception 'forbidden'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('edit_id', e.id, 'save_id', s.id, 'person_id', e.op ->> 'person_id',
             'name', e.before ->> 'name', 'count', (e.after ->> 'count')::int, 'by', s.author, 'at', s.created_at)
             order by e.id desc)
      from edits e join saves s on s.id = e.save_id
     where s.tree_id = r.tree_id and e.op ->> 'type' = 'delete' and e.reverted_by is null), '[]'::jsonb);
end $$;

-- По умолчанию Postgres даёт EXECUTE всем; открываем только нужное.
revoke execute on all functions in schema public from public, anon, authenticated;
revoke execute on all functions in schema drevo_private from public, anon, authenticated;
grant execute on function public.ping() to anon, authenticated;
grant execute on function public.create_tree(text, text, text, text, text) to anon, authenticated;
grant execute on function public.open_tree(text) to anon, authenticated;
grant execute on function public.tree_version(text) to anon, authenticated;
grant execute on function public.save_changes(text, text, bigint, jsonb, boolean) to anon, authenticated;
grant execute on function public.revert(text, text, bigint, bigint) to anon, authenticated;
grant execute on function public.get_history(text, int, bigint) to anon, authenticated;
grant execute on function public.deleted_items(text) to anon, authenticated;
