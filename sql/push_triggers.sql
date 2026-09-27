-- いいね・おいしそう・レシピが知りたい（meal_reactions）と、そうだんの書き込み（chat_messages）が
-- 入るたびに、通知を送る Edge Function（notify）を呼ぶ。
-- 鍵は付けない（関数の「Verify JWT」は切ってある）。関数は届いた id でデータベースから読み直し、
-- 入って5分以内のものだけ送るので、勝手に呼ばれても本当の書き込みの通知しか出ない。
-- supabase_functions.http_request は、ダッシュボードの Integrations → Database Webhooks を入れると使える
create or replace trigger notify_reactions
  after insert on public.meal_reactions
  for each row execute function supabase_functions.http_request(
    'https://atvrunfaltnkbwhtpoue.supabase.co/functions/v1/notify', 'POST',
    '{"Content-type":"application/json"}', '{}', '5000');

create or replace trigger notify_chat_messages
  after insert on public.chat_messages
  for each row execute function supabase_functions.http_request(
    'https://atvrunfaltnkbwhtpoue.supabase.co/functions/v1/notify', 'POST',
    '{"Content-type":"application/json"}', '{}', '5000');
