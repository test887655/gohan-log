-- gacha_jackpot_on.sql を元に戻す。ふつうの確率のガチャに戻す

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
