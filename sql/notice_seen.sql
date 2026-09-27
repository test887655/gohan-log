-- お知らせ（ベル）の赤い丸のための表。最後にお知らせを開いた時刻を、1人1行で持つ。
-- これより新しい「自分の投稿への反応」や「相手からのそうだんの書き込み」があれば丸を出す
create table if not exists public.notice_seen (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  seen_at timestamptz not null default now()
);

alter table public.notice_seen enable row level security;

create policy "notice_seen: own select" on public.notice_seen
  for select using (user_id = auth.uid());
create policy "notice_seen: own insert" on public.notice_seen
  for insert with check (user_id = auth.uid());
create policy "notice_seen: own update" on public.notice_seen
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
