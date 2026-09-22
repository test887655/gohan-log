-- ポイントの不正対策（2026-09-22）
-- アプリ（ブラウザ）から送られてくる amount を信用せず、データベース側で検査する。
-- 開発ツールで好きな数を入れられないようにするため。
-- 実行は Supabase ダッシュボードの SQL Editor から（ファイルごと貼って Run）。

-- ---------- 日付まわり（アプリと同じ数えかた） ----------

-- 今の日本時刻
create or replace function public.gohan_now()
returns timestamp
language sql stable
as $$ select (now() at time zone 'Asia/Tokyo') $$;

-- 1日は朝5時に変わる。その時刻が「どの日」のぶんかを返す
create or replace function public.gohan_day(t timestamp)
returns date
language sql immutable
as $$ select (t - interval '5 hours')::date $$;

-- 朝 5:00〜11:59 / 昼 12:00〜16:59 / 夜 17:00〜翌4:59
create or replace function public.gohan_slot(t timestamp)
returns text
language sql immutable
as $$
  select case
    when extract(hour from t) between 5 and 11 then 'morning'
    when extract(hour from t) between 12 and 16 then 'noon'
    else 'night'
  end
$$;

-- points.js の scramble と同じ計算（32ビットの掛け算と xor）
create or replace function public.gohan_scramble(n bigint)
returns bigint
language plpgsql immutable
as $$
declare
  m constant numeric := 4294967296; -- 2^32
  x numeric := n;
begin
  x := mod(x * 2654435761, m);           -- 0x9e3779b1
  x := (x::bigint # (x::bigint >> 16))::numeric;
  x := mod(x * 2246822507, m);           -- 0x85ebca6b
  x := (x::bigint # (x::bigint >> 13))::numeric;
  x := mod(x * 3266489909, m);           -- 0xc2b2ae35
  x := (x::bigint # (x::bigint >> 16))::numeric;
  return x::bigint;
end
$$;

-- 星（13ポイント）が出る時間帯。points.js の bonusSlot と同じ。
-- 3日ごとの日だけ。それ以外の日は null
create or replace function public.gohan_star_slot(day date)
returns text
language plpgsql immutable
as $$
declare
  n bigint := day - date '1970-01-01';
  block bigint;
  idx bigint := 0;
  k bigint;
  slots constant text[] := array['morning', 'noon', 'night'];
begin
  if n % 3 <> 0 then return null; end if;
  block := n / 3;
  for k in 6899..block loop
    idx := idx + 1 + (public.gohan_scramble(k) % 2);
  end loop;
  return slots[(idx % 3) + 1];
end
$$;

-- ---------- 見張り（points への insert を検査する） ----------

create or replace function public.points_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  t timestamp := public.gohan_now();
  today date := public.gohan_day(t);
  slot_now text := public.gohan_slot(t);
  meal_start timestamp;
  kinds int;
begin
  -- 本人のぶんしか入れられない（既定値 auth.uid() を書き換えられないように）
  if new.user_id is distinct from auth.uid() then
    raise exception 'points: other user' using errcode = '42501';
  end if;

  if new.kind in ('sparkle', 'star') then
    -- キラキラは「今」の時間帯だけ。過去や未来のぶんは入れられない
    if new.claim_day is distinct from today or new.slot is distinct from slot_now then
      raise exception 'points: not the current slot' using errcode = 'P0001';
    end if;
    if new.kind = 'sparkle' then
      if new.amount <> 3 then raise exception 'points: sparkle is 3' using errcode = 'P0001'; end if;
      -- 星の時間帯にキラキラとして取るのは損なだけなので、そのまま通す
    else
      if new.amount <> 13 then raise exception 'points: star is 13' using errcode = 'P0001'; end if;
      if public.gohan_star_slot(today) is distinct from slot_now then
        raise exception 'points: not a star slot' using errcode = 'P0001';
      end if;
    end if;

  elsif new.kind = 'meals' then
    if new.amount <> 10 or new.slot is distinct from 'meals' then
      raise exception 'points: meals bonus is 10' using errcode = 'P0001';
    end if;
    -- 今日と昨日のぶんだけ
    if new.claim_day not in (today, today - 1) then
      raise exception 'points: meals bonus only for today or yesterday' using errcode = 'P0001';
    end if;
    -- その日（朝5時〜翌朝5時）に、写真つきで「食べ物」の朝・昼・夜がそろっているか
    meal_start := new.claim_day::timestamp + interval '5 hours';
    select count(distinct meal_type) into kinds
      from public.meals
     where user_id = auth.uid()
       and photo_path is not null
       and category @> array['food']
       and meal_type in ('breakfast', 'lunch', 'dinner')
       and (eaten_at at time zone 'Asia/Tokyo') >= meal_start
       and (eaten_at at time zone 'Asia/Tokyo') < meal_start + interval '1 day';
    if kinds < 3 then
      raise exception 'points: three meals not recorded' using errcode = 'P0001';
    end if;

  elsif new.kind in ('gacha', 'gift') then
    -- ガチャとプレゼントは下の関数からしか入れられない
    if current_setting('gohan.inside', true) is distinct from 'yes' then
      raise exception 'points: use the function' using errcode = '42501';
    end if;

  else
    raise exception 'points: unknown kind' using errcode = 'P0001';
  end if;

  return new;
end
$$;

drop trigger if exists points_guard on public.points;
create trigger points_guard
  before insert on public.points
  for each row execute function public.points_guard();

-- ---------- ガチャ：当たりはデータベースが決める ----------
-- 戻り値は当たったポイント。1日1回は今までどおり一意制約（23505）で守る

create or replace function public.draw_gacha()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  r double precision := random() * 100;
  prize integer;
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  -- 1（35%）3（30%）5（25%）10（9%）100（1%）。points.js の GACHA_PRIZES と同じ
  prize := case
    when r < 35 then 1
    when r < 65 then 3
    when r < 90 then 5
    when r < 99 then 10
    else 100
  end;

  perform set_config('gohan.inside', 'yes', true);
  insert into public.points (user_id, kind, amount, claim_day, slot)
  values (auth.uid(), 'gacha', prize, public.gohan_day(public.gohan_now()), 'gacha');
  perform set_config('gohan.inside', '', true);

  return prize;
end
$$;

-- ---------- プレゼント：引くポイントは並べてある cost から取る ----------
-- 引くのと「選びました」の知らせを1つのまとまりで行う（片方だけ残らない）

create or replace function public.choose_gift(item_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  item public.gift_items%rowtype;
  mine integer;
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  select * into item from public.gift_items where id = item_id;
  if not found or item.partner_id <> auth.uid() then
    raise exception 'gift: not for you' using errcode = '42501';
  end if;

  select coalesce(sum(amount), 0) into mine from public.points where user_id = auth.uid();
  if mine < item.cost then
    raise exception 'gift: not enough points' using errcode = 'P0001';
  end if;

  perform set_config('gohan.inside', 'yes', true);
  insert into public.points (user_id, kind, amount) values (auth.uid(), 'gift', -item.cost);
  perform set_config('gohan.inside', '', true);

  insert into public.gifts (chosen_by, offered_by, name, cost)
  values (auth.uid(), item.user_id, item.name, item.cost);
end
$$;

revoke all on function public.draw_gacha() from public, anon;
revoke all on function public.choose_gift(uuid) from public, anon;
grant execute on function public.draw_gacha() to authenticated;
grant execute on function public.choose_gift(uuid) to authenticated;
