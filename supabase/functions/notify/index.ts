// iPhoneへの通知を送る。Supabase の Database Webhooks から、
// meal_reactions と chat_messages に行が入るたびに呼ばれる。
// 秘密鍵などは Edge Function の Secrets（VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY）から読む。
// データベースを読む鍵（SUPABASE_SECRET_KEYS か、古い SUPABASE_SERVICE_ROLE_KEY）は
// Supabase が関数の中にだけ自動で入れてくれる。アプリやこのファイルには書かない
import webpush from 'npm:web-push@3.6.7';
import { createClient } from 'npm:@supabase/supabase-js@2';

function serverKey() {
  try {
    const keys = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}');
    const key = keys.default ?? Object.values(keys)[0];
    if (key) return key as string;
  } catch (_error) { /* 古い形のほうを使う */ }
  return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
}

const db = createClient(Deno.env.get('SUPABASE_URL')!, serverKey());

webpush.setVapidDetails(
  'https://test887655.github.io/gohan-log/',
  Deno.env.get('VAPID_PUBLIC_KEY')!,
  Deno.env.get('VAPID_PRIVATE_KEY')!,
);

const REACTION_TEXT: Record<string, string> = {
  like: 'がいいねしました',
  yummy: 'が「おいしそう」を押しました',
  recipe: 'がレシピを知りたがっています',
};

// 古い書き込みで何度も呼ばれても通知を連発しないよう、入ってすぐのものだけ送る
const FRESH_MS = 5 * 60 * 1000;

async function nameOf(userId: string) {
  const { data } = await db.from('profiles').select('display_name').eq('id', userId).maybeSingle();
  return data?.display_name ?? '相手';
}

// 呼び出しの中身は信用せず、id でデータベースから読み直す。
// 誰かが勝手に呼んでも、本当にあった書き込みの通知しか送れない
async function buildMessage(table: string, id: string) {
  if (table === 'meal_reactions') {
    const { data } = await db
      .from('meal_reactions')
      .select('kind, user_id, meal_id, created_at, meals(user_id, note)')
      .eq('id', id).maybeSingle();
    if (!data || !data.meals) return null;
    const owner = (data.meals as { user_id: string }).user_id;
    if (owner === data.user_id) return null;
    // オン→オフ→オンで同じ反応が入り直しても、通知は最初の1回だけにする
    const { error } = await db
      .from('push_sent').insert({ meal_id: data.meal_id, user_id: data.user_id, kind: data.kind });
    if (error) return null;
    const note = (data.meals as { note: string | null }).note;
    return {
      to: owner,
      createdAt: data.created_at,
      body: `${await nameOf(data.user_id)}さん${REACTION_TEXT[data.kind] ?? 'が反応しました'}${note ? `（${note}）` : ''}`,
    };
  }

  if (table === 'chat_messages') {
    const { data } = await db
      .from('chat_messages')
      .select('user_id, body, stamp, created_at, chats(user_id, partner_id, topic)')
      .eq('id', id).maybeSingle();
    if (!data || !data.chats) return null;
    const chat = data.chats as { user_id: string; partner_id: string; topic: string | null };
    const to = data.user_id === chat.user_id ? chat.partner_id : chat.user_id;
    const topic = chat.topic ? `「${chat.topic}」` : '';
    return {
      to,
      createdAt: data.created_at,
      body: `${await nameOf(data.user_id)}さんから${topic}のそうだん：${data.body ?? data.stamp ?? ''}`,
    };
  }
  if (table === 'gifts') {
    const { data } = await db
      .from('gifts').select('chosen_by, offered_by, name, created_at').eq('id', id).maybeSingle();
    if (!data || data.chosen_by === data.offered_by) return null;
    return {
      to: data.offered_by,
      createdAt: data.created_at,
      body: `${await nameOf(data.chosen_by)}さんがプレゼント「${data.name}」を選びました`,
    };
  }
  return null;
}

Deno.serve(async (req) => {
  const payload = await req.json().catch(() => null);
  const table = payload?.table;
  const id = payload?.record?.id;
  if (payload?.type !== 'INSERT' || !table || !id) return new Response('skip');

  const message = await buildMessage(table, id);
  if (!message || Date.now() - new Date(message.createdAt).getTime() > FRESH_MS) {
    return new Response('skip');
  }

  const { data: subs } = await db
    .from('push_subscriptions').select('endpoint, p256dh, auth').eq('user_id', message.to);

  const text = JSON.stringify({ title: 'ごはん記録', body: message.body });
  await Promise.all((subs ?? []).map(async (sub) => {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        text,
      );
    } catch (error) {
      // 通知を切った・アプリを消した端末は、もう届かないので宛先から外す
      const status = (error as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) {
        await db.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
      } else {
        console.error(status, error);
      }
    }
  }));

  return new Response('ok');
});
