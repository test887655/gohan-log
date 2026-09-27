-- iPhoneへの通知の宛先。1台（endpoint）につき1行。今その端末でログインしている人の user_id を持つ。
-- 通知を送る Edge Function（supabase/functions/notify）は、ここから相手の端末を探す
create table if not exists public.push_subscriptions (
  endpoint text primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);

alter table public.push_subscriptions enable row level security;

create policy "push_subscriptions: own select" on public.push_subscriptions
  for select using (user_id = auth.uid());
create policy "push_subscriptions: own insert" on public.push_subscriptions
  for insert with check (user_id = auth.uid());
create policy "push_subscriptions: own update" on public.push_subscriptions
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "push_subscriptions: own delete" on public.push_subscriptions
  for delete using (user_id = auth.uid());
