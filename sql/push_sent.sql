-- 通知を一度送った反応を覚えておく表。いいねを オン→オフ→オン すると行が作り直されるので、
-- これがないと同じいいねの通知が2回届く。(meal_id, user_id, kind) が一意で、二度目は送らない。
-- 書くのも読むのも Edge Function（notify）だけ。ポリシーを作らないので、アプリからは触れない
create table if not exists public.push_sent (
  meal_id uuid not null references public.meals (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null,
  created_at timestamptz not null default now(),
  primary key (meal_id, user_id, kind)
);

alter table public.push_sent enable row level security;
