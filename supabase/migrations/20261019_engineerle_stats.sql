-- Engineerle daily statistics.
-- One row per device per day. The browser never touches the table: it can only call the two functions below.

create table if not exists public.engineerle_results (
  day        int         not null check (day between 1 and 100000),
  device     uuid        not null,
  ids        text[]      not null,
  points     int[]       not null,
  guesses    int[]       not null,
  seconds    int[]       not null,
  total      int         not null check (total between 0 and 500),
  created_at timestamptz not null default now(),
  primary key (day, device)
);

alter table public.engineerle_results enable row level security;
-- no policies on purpose: with row level security on and nothing allowed, anon and authenticated see and change nothing directly
revoke all on table public.engineerle_results from anon, authenticated;

create or replace function public.engineerle_submit(
  p_day int, p_device uuid, p_ids text[], p_points int[], p_guesses int[], p_seconds int[], p_total int
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  i int;
begin
  if p_day is null or p_day < 1 or p_day > 100000 then raise exception 'invalid day' using errcode = '22023'; end if;
  if p_device is null then raise exception 'invalid device' using errcode = '22023'; end if;
  if p_ids is null or p_points is null or p_guesses is null or p_seconds is null or p_total is null then raise exception 'missing field' using errcode = '22023'; end if;
  if coalesce(array_length(p_ids, 1), 0) <> 5 or coalesce(array_length(p_points, 1), 0) <> 5
     or coalesce(array_length(p_guesses, 1), 0) <> 5 or coalesce(array_length(p_seconds, 1), 0) <> 5 then
    raise exception 'arrays must have 5 entries' using errcode = '22023';
  end if;
  for i in 1..5 loop
    if p_ids[i] is null or p_ids[i] !~ '^[a-z]{2,20}$' then raise exception 'invalid puzzle id' using errcode = '22023'; end if;
    if p_points[i] is null or p_points[i] < 0 or p_points[i] > 100 then raise exception 'points out of range' using errcode = '22023'; end if;
    if p_guesses[i] is null or p_guesses[i] < 0 or p_guesses[i] > 3 then raise exception 'guesses out of range' using errcode = '22023'; end if;
    if p_seconds[i] is null or p_seconds[i] < 0 or p_seconds[i] > 86400 then raise exception 'seconds out of range' using errcode = '22023'; end if;
  end loop;
  if (select count(distinct x) from unnest(p_ids) as x) <> 5 then raise exception 'puzzles must be different' using errcode = '22023'; end if;
  if p_total < 0 or p_total > 500 or p_total <> (select sum(x) from unnest(p_points) as x) then raise exception 'total out of range' using errcode = '22023'; end if;

  insert into public.engineerle_results (day, device, ids, points, guesses, seconds, total)
  values (p_day, p_device, p_ids, p_points, p_guesses, p_seconds, p_total)
  on conflict (day, device) do nothing;
end;
$$;

create or replace function public.engineerle_day_stats(p_day int)
returns json
language sql
stable
security definer
set search_path = ''
as $$
  select json_build_object(
    'n',    (select count(*) from public.engineerle_results where day = p_day),
    'mean', coalesce((select avg(total)::float8 from public.engineerle_results where day = p_day), 0),
    'buckets', (
      select json_agg(coalesce(c.n, 0) order by g.b)
      from generate_series(0, 19) as g(b)
      left join (
        select least(total / 25, 19) as b, count(*) as n
        from public.engineerle_results where day = p_day group by 1
      ) c on c.b = g.b
    ),
    'perPuzzle', coalesce((
      select json_object_agg(q.id, json_build_object('n', q.n, 'mean', q.mean))
      from (
        select u.id, count(*) as n, avg(u.p)::float8 as mean
        from public.engineerle_results r, unnest(r.ids, r.points) as u(id, p)
        where r.day = p_day
        group by u.id
      ) q
    ), '{}'::json)
  );
$$;

revoke all on function public.engineerle_submit(int, uuid, text[], int[], int[], int[], int) from public;
revoke all on function public.engineerle_day_stats(int) from public;
grant execute on function public.engineerle_submit(int, uuid, text[], int[], int[], int[], int) to anon, authenticated;
grant execute on function public.engineerle_day_stats(int) to anon, authenticated;
