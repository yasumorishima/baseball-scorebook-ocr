-- =============================================================================
-- 0001_init: 草野球スコアブック PWA 初期スキーマ
--
-- docs/architecture.md §8.3 (schema) / §9.1 (broadcast) / §10 (auth/RLS)
--
-- 設計原則:
-- - イベントソーシング（append-only）。game_events に correction_of で訂正
-- - UNIQUE (game_id, seq) + id UUID v7 で冪等送信
-- - RLS: auth.uid() は (select auth.uid()) で wrap、to authenticated 明示、
--   join テーブル参照は SECURITY DEFINER 関数に外出し
-- - 招待コードは nanoid 8 字、rate limit 10 分 5 回、redeem_invitation() で
--   1 トランザクション実行
-- =============================================================================

-- ------------------------------ schema ---------------------------------------

create extension if not exists pgcrypto;

create type team_role as enum ('owner', 'admin', 'scorer', 'viewer');
create type event_source as enum ('manual', 'ocr');
create type event_type as enum (
  'plate_appearance',
  'substitution',
  'correction',
  'inning_end',
  'game_end'
);
create type game_status as enum ('in_progress', 'finished', 'suspended');

create table teams (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete restrict,
  name text not null check (length(name) between 1 and 64),
  created_at timestamptz not null default now()
);

create index idx_teams_owner on teams(owner_user_id);

create table team_members (
  team_id uuid not null references teams(id) on delete cascade,
  -- on delete restrict: auth.users 削除時に team_members は先に消えてほしくない。
  -- games.created_by / game_events.author_user_id が restrict なので auth.users
  -- の削除は実質ブロックされるが、履歴整合性を明示するためここも restrict。
  user_id uuid not null references auth.users(id) on delete restrict,
  role team_role not null default 'scorer',
  joined_at timestamptz not null default now(),
  primary key (team_id, user_id)
);

create index idx_team_members_user on team_members(user_id);
create index idx_team_members_team on team_members(team_id);

create table players (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams(id) on delete cascade,
  display_name text not null check (length(display_name) between 1 and 32),
  uniform_number int check (uniform_number is null or uniform_number between 0 and 999),
  position int check (position is null or position between 1 and 9),
  created_at timestamptz not null default now()
);

create index idx_players_team on players(team_id);

create table games (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams(id) on delete cascade,
  date date not null,
  opponent text not null check (length(opponent) between 1 and 64),
  status game_status not null default 'in_progress',
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_games_team on games(team_id);
create index idx_games_date on games(date desc);

create table game_events (
  id uuid primary key,
  game_id uuid not null references games(id) on delete cascade,
  seq integer not null check (seq >= 0),
  ts timestamptz not null default now(),
  type event_type not null,
  correction_of uuid references game_events(id) on delete set null,
  payload jsonb not null,
  author_user_id uuid not null references auth.users(id) on delete restrict,
  source event_source not null,
  ocr_metadata jsonb,
  unique (game_id, seq)
);

create index idx_game_events_game on game_events(game_id);
create index idx_game_events_author on game_events(author_user_id);

-- 招待コード（§10.2-§10.3）
create table invitations (
  code text primary key check (length(code) = 8),
  team_id uuid not null references teams(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete restrict,
  role team_role not null default 'scorer',
  expires_at timestamptz not null,
  max_uses int not null default 1 check (max_uses >= 1),
  use_count int not null default 0 check (use_count >= 0),
  created_at timestamptz not null default now()
);

create index idx_invitations_team on invitations(team_id);

create table invitation_attempts (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  code text not null,
  success boolean not null,
  ts timestamptz not null default now()
);

create index idx_invitation_attempts_user_ts
  on invitation_attempts(user_id, ts desc);

-- ------------------------- SECURITY DEFINER ----------------------------------

-- RLS join の性能対策（§10.4）。team_members 経由の所属判定はこの関数で。
create or replace function current_user_team_ids()
returns uuid[]
language sql
security definer
stable
set search_path = public
as $$
  select coalesce(array_agg(team_id), array[]::uuid[])
  from team_members
  where user_id = (select auth.uid());
$$;

grant execute on function current_user_team_ids() to authenticated;

-- チーム内のロール取得（§10.1 権限判定）
create or replace function current_user_team_role(p_team_id uuid)
returns team_role
language sql
security definer
stable
set search_path = public
as $$
  select role from team_members
  where team_id = p_team_id and user_id = (select auth.uid());
$$;

grant execute on function current_user_team_role(uuid) to authenticated;

-- ゲームがカレントユーザーの所属チームか（game_events RLS で使用）
create or replace function current_user_can_access_game(p_game_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from games g
    where g.id = p_game_id
      and g.team_id = any(current_user_team_ids())
  );
$$;

grant execute on function current_user_can_access_game(uuid) to authenticated;

-- ゲームへの書き込み権限（scorer 以上）。game_events RLS の
-- with check をシンプルに保つため。
create or replace function current_user_can_write_game(p_game_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from games g
    where g.id = p_game_id
      and current_user_team_role(g.team_id) in ('owner','admin','scorer')
  );
$$;

grant execute on function current_user_can_write_game(uuid) to authenticated;

-- ---------------------- 招待コード redeem（§10.3）------------------------

create or replace function redeem_invitation(p_code text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team_id uuid;
  v_role team_role;
  v_failure_count int;
  v_user_id uuid := (select auth.uid());
begin
  if v_user_id is null then
    raise exception 'unauthenticated' using errcode = 'P0001';
  end if;

  select count(*) into v_failure_count
  from invitation_attempts
  where user_id = v_user_id
    and ts > now() - interval '10 minutes'
    and success = false;

  if v_failure_count >= 5 then
    raise exception 'too_many_attempts' using errcode = 'P0002';
  end if;

  select team_id, role into v_team_id, v_role
  from invitations
  where code = p_code
    and expires_at > now()
    and use_count < max_uses
  for update;

  if v_team_id is null then
    insert into invitation_attempts(user_id, code, success)
      values (v_user_id, p_code, false);
    raise exception 'invalid_code' using errcode = 'P0003';
  end if;

  insert into team_members(team_id, user_id, role)
    values (v_team_id, v_user_id, v_role)
    on conflict (team_id, user_id) do nothing;

  update invitations
    set use_count = use_count + 1
    where code = p_code;

  insert into invitation_attempts(user_id, code, success)
    values (v_user_id, p_code, true);

  return v_team_id;
end;
$$;

grant execute on function redeem_invitation(text) to authenticated;

-- -------------------- 最後の owner 退出阻止（§10.6）--------------------

create or replace function prevent_last_owner_leaving()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_remaining_owners int;
begin
  if (old.role = 'owner'::team_role)
     and (tg_op = 'DELETE'
          or (tg_op = 'UPDATE' and new.role <> 'owner'::team_role))
  then
    -- 同一チーム内の並列 owner 抜けをシリアライズする advisory lock。
    -- hashtext で uuid → int8 に圧縮。team_id ごとに competing tx は
    -- 直列化され、同時抜けで count=1 を両方が見て両方抜ける race を防ぐ。
    perform pg_advisory_xact_lock(hashtext(old.team_id::text));

    select count(*) into v_remaining_owners
    from team_members
    where team_id = old.team_id
      and role = 'owner'::team_role
      and user_id <> old.user_id;

    if v_remaining_owners = 0 then
      raise exception 'last_owner_cannot_leave' using errcode = 'P0004';
    end if;
  end if;

  if tg_op = 'DELETE' then return old; else return new; end if;
end;
$$;

-- DELETE と「role 変更を伴う UPDATE」で 2 本に分けることで、role 以外の
-- 列更新（joined_at など）では空振りさせる。when 句内で tg_op は参照
-- できないため、UPDATE 側は old.role vs new.role の比較のみで絞る。
create trigger trg_prevent_last_owner_leaving_delete
  before delete on team_members
  for each row execute function prevent_last_owner_leaving();

create trigger trg_prevent_last_owner_leaving_update
  before update on team_members
  for each row
  when (old.role is distinct from new.role)
  execute function prevent_last_owner_leaving();

-- ----------------------- Realtime Broadcast（§9.1）-----------------------
-- Supabase Realtime の Broadcast 機能を、row insert 時のトリガから
-- `realtime.send(payload, event, topic, private)` で発火。topic は
-- `game:<game_id>` 単位なので client 側は gameId ごとに購読できる。

create or replace function broadcast_game_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform realtime.send(
    jsonb_build_object('record', row_to_json(new)),
    'INSERT',
    'game:' || new.game_id::text,
    false
  );
  return new;
end;
$$;

create trigger trg_broadcast_game_event
  after insert on game_events
  for each row execute function broadcast_game_event();

-- ---------------------------- RLS policies ----------------------------------

alter table teams enable row level security;
alter table team_members enable row level security;
alter table players enable row level security;
alter table games enable row level security;
alter table game_events enable row level security;
alter table invitations enable row level security;
alter table invitation_attempts enable row level security;

-- teams
create policy teams_select on teams
  for select to authenticated
  using (id = any(current_user_team_ids()));

create policy teams_insert on teams
  for insert to authenticated
  with check (owner_user_id = (select auth.uid()));

create policy teams_update on teams
  for update to authenticated
  using (id = any(current_user_team_ids())
         and current_user_team_role(id) in ('owner','admin'))
  with check (id = any(current_user_team_ids())
              and current_user_team_role(id) = 'owner');

create policy teams_delete on teams
  for delete to authenticated
  using (current_user_team_role(id) = 'owner');

-- team_members
create policy team_members_select on team_members
  for select to authenticated
  using (team_id = any(current_user_team_ids()));

create policy team_members_insert on team_members
  for insert to authenticated
  with check (team_id = any(current_user_team_ids())
              and current_user_team_role(team_id) in ('owner','admin'));

create policy team_members_update on team_members
  for update to authenticated
  using (current_user_team_role(team_id) in ('owner','admin'))
  with check (current_user_team_role(team_id) in ('owner','admin'));

create policy team_members_delete on team_members
  for delete to authenticated
  using (current_user_team_role(team_id) in ('owner','admin')
         or user_id = (select auth.uid()));

-- players
create policy players_select on players
  for select to authenticated
  using (team_id = any(current_user_team_ids()));

create policy players_write on players
  for all to authenticated
  using (team_id = any(current_user_team_ids())
         and current_user_team_role(team_id) in ('owner','admin','scorer'))
  with check (team_id = any(current_user_team_ids())
              and current_user_team_role(team_id) in ('owner','admin','scorer'));

-- games
create policy games_select on games
  for select to authenticated
  using (team_id = any(current_user_team_ids()));

create policy games_write on games
  for all to authenticated
  using (team_id = any(current_user_team_ids())
         and current_user_team_role(team_id) in ('owner','admin','scorer'))
  with check (team_id = any(current_user_team_ids())
              and current_user_team_role(team_id) in ('owner','admin','scorer'));

-- game_events
create policy game_events_select on game_events
  for select to authenticated
  using (current_user_can_access_game(game_id));

create policy game_events_insert on game_events
  for insert to authenticated
  with check (current_user_can_write_game(game_id)
              and author_user_id = (select auth.uid()));

-- append-only: update/delete は禁止。RLS で policy を与えないので default
-- deny となるが、defense-in-depth として明示的に revoke もしておく。
revoke update, delete on game_events from authenticated;

-- invitations: 招待コードは SELECT 禁止（§10.3、列挙攻撃防止）、
-- redeem は redeem_invitation() 経由のみ。owner/admin のみ作成可。
create policy invitations_insert on invitations
  for insert to authenticated
  with check (current_user_team_role(team_id) in ('owner','admin')
              and created_by = (select auth.uid()));

create policy invitations_select_own on invitations
  for select to authenticated
  using (current_user_team_role(team_id) in ('owner','admin'));

create policy invitations_delete_own on invitations
  for delete to authenticated
  using (current_user_team_role(team_id) in ('owner','admin'));

-- invitation_attempts: 自分の試行のみ閲覧、insert は redeem_invitation() が
-- SECURITY DEFINER でバイパス。
create policy invitation_attempts_select_own on invitation_attempts
  for select to authenticated
  using (user_id = (select auth.uid()));

-- ---------------------- updated_at 自動更新 ------------------------

create or replace function touch_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger trg_games_touch_updated_at
  before update on games
  for each row execute function touch_updated_at();
