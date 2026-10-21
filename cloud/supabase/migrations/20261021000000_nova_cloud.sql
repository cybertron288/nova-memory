-- Nova Cloud usage ledger (docs/nova-cloud-design.md, "Data model").
-- Holds no captured text, memories or loops: only who used how many tokens.
-- Every table has row-level security on and no policies, so only the proxy's
-- service-role key can read or write it.

create table plans (
  name text primary key,
  daily_token_cap bigint not null check (daily_token_cap > 0)
);

insert into plans (name, daily_token_cap) values ('new', 100000), ('free', 1000000);

-- A stored plan of 'free' reads as 'new' for the account's first 7 days, so
-- nothing has to move accounts between plans on a schedule.
create table accounts (
  user_id uuid primary key references auth.users (id) on delete cascade,
  plan text not null default 'free' references plans (name),
  created_at timestamptz not null default now()
);

create table devices (
  device_hash text primary key,
  first_seen timestamptz not null default now(),
  blocked boolean not null default false
);

create table account_devices (
  user_id uuid not null references accounts (user_id) on delete cascade,
  device_hash text not null references devices (device_hash) on delete cascade,
  linked_at timestamptz not null default now(),
  primary key (user_id, device_hash)
);

-- subject is 'd:<device hash>' or 'u:<user id>'. Each request adds to both,
-- and the cap applies to each. reserved holds the worst case of requests in
-- flight, so concurrent requests cannot all pass a cap each saw unspent.
create table usage_daily (
  subject text not null,
  day date not null,
  tokens_in bigint not null default 0,
  tokens_out bigint not null default 0,
  reserved bigint not null default 0 check (reserved >= 0),
  primary key (subject, day)
);

create table spend_monthly (
  month text primary key,
  cost_micros bigint not null default 0
);

create table ip_daily (
  ip_hash text not null,
  day date not null,
  signups integer not null default 0,
  requests integer not null default 0,
  primary key (ip_hash, day)
);

alter table plans enable row level security;
alter table accounts enable row level security;
alter table devices enable row level security;
alter table account_devices enable row level security;
alter table usage_daily enable row level security;
alter table spend_monthly enable row level security;
alter table ip_daily enable row level security;

-- Everything one request needs to be allowed or refused, in one round trip.
-- Creates the account on its first request, unless its IP has already created
-- p_signup_limit accounts today, and links the device unless the account has
-- linked 3 devices in the last 30 days.
create function allowance(
  p_user uuid, p_device text, p_ip text, p_day date, p_month text, p_signup_limit integer
) returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_account accounts;
  v_created boolean := false;
  v_linked boolean;
  v_blocked boolean;
  v_plan text;
  v_cap bigint;
begin
  -- A token stays valid for up to an hour after its user is deleted.
  if not exists (select 1 from auth.users where id = p_user) then
    return jsonb_build_object(
      'plan', 'new', 'cap', 0, 'device_used_today', 0, 'account_used_today', 0,
      'month_cost_micros', 0, 'device_linked', false, 'device_blocked', false,
      'signup_refused', false, 'unknown_user', true, 'ip_requests_today', 0);
  end if;

  -- Locked so two requests from one account cannot both pass the device-link
  -- count below.
  select * into v_account from accounts where user_id = p_user for update;

  if not found then
    insert into ip_daily (ip_hash, day) values (p_ip, p_day) on conflict do nothing;
    -- Lock the IP's row so two sign-ups from one network cannot both pass.
    if (select signups from ip_daily where ip_hash = p_ip and day = p_day for update) >= p_signup_limit then
      return jsonb_build_object(
        'plan', 'new', 'cap', 0, 'device_used_today', 0, 'account_used_today', 0,
        'month_cost_micros', 0, 'device_linked', false, 'device_blocked', false,
        'signup_refused', true, 'unknown_user', false, 'ip_requests_today', 0);
    end if;
    insert into accounts (user_id) values (p_user) on conflict do nothing returning * into v_account;
    v_created := v_account.user_id is not null;
    if v_created then
      update ip_daily set signups = signups + 1 where ip_hash = p_ip and day = p_day;
    else
      -- A concurrent first request created it.
      select * into v_account from accounts where user_id = p_user;
    end if;
  end if;

  insert into devices (device_hash) values (p_device) on conflict do nothing;
  select blocked into v_blocked from devices where device_hash = p_device;

  perform 1 from account_devices where user_id = p_user and device_hash = p_device;
  if found then
    v_linked := true;
  elsif (select count(*) from account_devices
          where user_id = p_user and linked_at > now() - interval '30 days') >= 3 then
    v_linked := false;
  else
    insert into account_devices (user_id, device_hash) values (p_user, p_device) on conflict do nothing;
    v_linked := true;
  end if;

  v_plan := case
    when v_account.plan = 'free' and v_account.created_at > now() - interval '7 days' then 'new'
    else v_account.plan
  end;
  select daily_token_cap into v_cap from plans where name = v_plan;

  return jsonb_build_object(
    'plan', v_plan,
    'cap', v_cap,
    'device_used_today', coalesce((select tokens_in + tokens_out + reserved from usage_daily
                                    where subject = 'd:' || p_device and day = p_day), 0),
    'account_used_today', coalesce((select tokens_in + tokens_out + reserved from usage_daily
                                     where subject = 'u:' || p_user::text and day = p_day), 0),
    'month_cost_micros', coalesce((select cost_micros from spend_monthly where month = p_month), 0),
    'device_linked', v_linked,
    'device_blocked', v_blocked,
    'signup_refused', false,
    'unknown_user', false,
    'ip_requests_today', coalesce((select requests from ip_daily where ip_hash = p_ip and day = p_day), 0));
end;
$$;

-- Holds p_tokens against both subjects, or neither. Rows are locked in a fixed
-- order so two requests cannot deadlock.
create function reserve_tokens(
  p_user uuid, p_device text, p_day date, p_tokens bigint, p_cap bigint
) returns boolean
language plpgsql
set search_path = public
as $$
begin
  insert into usage_daily (subject, day) values ('d:' || p_device, p_day), ('u:' || p_user::text, p_day)
  on conflict do nothing;
  perform 1 from usage_daily
    where day = p_day and subject in ('d:' || p_device, 'u:' || p_user::text)
    order by subject for update;
  if exists (select 1 from usage_daily
              where day = p_day and subject in ('d:' || p_device, 'u:' || p_user::text)
                and tokens_in + tokens_out + reserved + p_tokens > p_cap) then
    return false;
  end if;
  update usage_daily set reserved = reserved + p_tokens
    where day = p_day and subject in ('d:' || p_device, 'u:' || p_user::text);
  return true;
end;
$$;

create function release_tokens(p_user uuid, p_device text, p_day date, p_tokens bigint) returns void
language sql
set search_path = public
as $$
  update usage_daily set reserved = greatest(0, reserved - p_tokens)
    where day = p_day and subject in ('d:' || p_device, 'u:' || p_user::text);
$$;

create function consume_tokens(
  p_user uuid, p_device text, p_ip text, p_day date, p_month text,
  p_in integer, p_out integer, p_cost_micros bigint, p_reserved bigint
) returns void
language sql
set search_path = public
as $$
  insert into usage_daily (subject, day, tokens_in, tokens_out)
  values ('d:' || p_device, p_day, p_in, p_out), ('u:' || p_user::text, p_day, p_in, p_out)
  on conflict (subject, day) do update set
    tokens_in = usage_daily.tokens_in + excluded.tokens_in,
    tokens_out = usage_daily.tokens_out + excluded.tokens_out,
    reserved = greatest(0, usage_daily.reserved - p_reserved);

  insert into spend_monthly (month, cost_micros) values (p_month, p_cost_micros)
  on conflict (month) do update set cost_micros = spend_monthly.cost_micros + excluded.cost_micros;

  insert into ip_daily (ip_hash, day, requests) values (p_ip, p_day, 1)
  on conflict (ip_hash, day) do update set requests = ip_daily.requests + 1;
$$;

revoke all on function allowance(uuid, text, text, date, text, integer) from public, anon, authenticated;
revoke all on function reserve_tokens(uuid, text, date, bigint, bigint) from public, anon, authenticated;
revoke all on function release_tokens(uuid, text, date, bigint) from public, anon, authenticated;
revoke all on function consume_tokens(uuid, text, text, date, text, integer, integer, bigint, bigint) from public, anon, authenticated;
grant execute on function allowance(uuid, text, text, date, text, integer) to service_role;
grant execute on function reserve_tokens(uuid, text, date, bigint, bigint) to service_role;
grant execute on function release_tokens(uuid, text, date, bigint) to service_role;
grant execute on function consume_tokens(uuid, text, text, date, text, integer, integer, bigint, bigint) to service_role;
