-- 今日だけのお楽しみ。eri・hana・mihoko がもう一度ガチャを引けるようにして、必ず100ポイント出す。
-- 3人が引き終わったら、必ず gacha_jackpot_off.sql を流して元のガチャに戻すこと。

-- 1. 今日ぶんのガチャの記録を消す（消すと「まだ引いていない」状態になる）
delete from public.points
where kind = 'gacha'
  and claim_day = public.gohan_day(public.gohan_now())
  and user_id in (
    select id from public.profiles where display_name in ('eri', 'hana', 'mihoko')
  );

-- 2. 当たりを100ポイント固定にする
create or replace function public.draw_gacha()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  prize integer := 100;  -- 今日だけの大当たり固定
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  perform set_config('gohan.inside', 'yes', true);
  insert into public.points (user_id, kind, amount, claim_day, slot)
  values (auth.uid(), 'gacha', prize, public.gohan_day(public.gohan_now()), 'gacha');
  perform set_config('gohan.inside', '', true);

  return prize;
end
$$;
