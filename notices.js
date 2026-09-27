// お知らせ。自分の投稿に付いた「いいね」「おいしそう」「レシピが知りたい」と、
// 相手からのそうだんの書き込みを、新しい順に1つの一覧で見せる。
// お知らせ用の表は作らず、meal_reactions と chat_messages から組み立てる。
// 覚えるのは「最後にお知らせを開いた時刻」（notice_seen）だけで、これより新しいものに丸を付ける
import { supabase } from './supabase.js';

// 一度に出す数。文字だけなので軽いが、際限なく増やさない
const NOTICE_PAGE = 20;

const REACTION_TEXT = {
  like: 'がいいねしました',
  yummy: 'が「おいしそう」を押しました',
  recipe: 'がレシピを知りたがっています',
};
const REACTION_FACE = { like: '❤️', yummy: '😋', recipe: '📖' };

const $ = (id) => document.getElementById(id);

const list = $('notice-list');
const empty = $('notice-empty');
const status = $('notice-status');
const dot = $('notice-dot');

const timeFormatter = new Intl.DateTimeFormat('ja-JP', {
  month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
});

let me = null;

// ---------- 読み込み ----------

// openMeal(meal) はその投稿の週へ、openChat(partnerId) はそうだんの画面へ移る（app.js が渡す）
export async function loadNotices(userId, names, { openMeal, openChat }) {
  me = userId;
  status.textContent = '読み込み中…';
  empty.hidden = false;

  const seenAt = await readSeen();
  let items;
  try {
    items = await fetchNotices();
  } catch (error) {
    console.error(error);
    list.replaceChildren();
    status.textContent = '読み込めませんでした。通信を確認してもう一度開いてください。';
    return;
  }

  list.replaceChildren(...items.map((item) => renderNotice(item, names, seenAt, { openMeal, openChat })));
  if (items.length === 0) status.textContent = 'まだお知らせはありません。';
  else empty.hidden = true;

  // 開いたら読んだことにして、丸を消す
  await markSeen();
}

async function fetchNotices() {
  // 自分の投稿に、相手が押したもの。meals!inner で「自分の投稿」だけに絞る
  const reactions = supabase
    .from('meal_reactions')
    .select('id, kind, user_id, created_at, meals!inner(id, user_id, eaten_at, note)')
    .eq('meals.user_id', me)
    .neq('user_id', me)
    .order('created_at', { ascending: false })
    .limit(NOTICE_PAGE);

  // 相手からのそうだんの書き込み。読めるのが自分の関わるそうだんだけなのは RLS で決まっている
  const messages = supabase
    .from('chat_messages')
    .select('id, user_id, body, stamp, created_at, chats(topic)')
    .neq('user_id', me)
    .order('created_at', { ascending: false })
    .limit(NOTICE_PAGE);

  const [r, m] = await Promise.all([reactions, messages]);
  if (r.error) throw r.error;
  if (m.error) throw m.error;

  const items = [
    ...r.data.map((row) => ({ type: 'reaction', ...row })),
    ...m.data.map((row) => ({ type: 'chat', ...row })),
  ];
  items.sort((a, b) => b.created_at.localeCompare(a.created_at));
  return items.slice(0, NOTICE_PAGE);
}

export function clearNotices() {
  list.replaceChildren();
  dot.hidden = true;
}

// ---------- 一覧の組み立て ----------

function renderNotice(item, names, seenAt, { openMeal, openChat }) {
  const row = document.createElement('li');
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'notice';
  // まだ見ていないものは色を付けて分かるようにする
  if (item.created_at > seenAt) button.classList.add('new');

  const face = document.createElement('span');
  face.className = 'notice-face';
  face.setAttribute('aria-hidden', 'true');

  const text = document.createElement('span');
  text.className = 'notice-text';
  const who = `${names.get(item.user_id) ?? '相手'}さん`;

  const detail = document.createElement('span');
  detail.className = 'notice-detail';

  if (item.type === 'reaction') {
    face.textContent = REACTION_FACE[item.kind] ?? '❤️';
    text.textContent = `${who}${REACTION_TEXT[item.kind] ?? 'が反応しました'}`;
    detail.textContent = item.meals.note || '写真の記録';
    button.addEventListener('click', () => openMeal(item.meals));
  } else {
    face.textContent = '💬';
    const topic = item.chats?.topic;
    text.textContent = topic ? `${who}から「${topic}」のそうだん` : `${who}からそうだん`;
    detail.textContent = item.body ?? item.stamp ?? '';
    button.addEventListener('click', () => openChat(item.user_id));
  }

  const when = document.createElement('span');
  when.className = 'notice-when';
  when.textContent = timeFormatter.format(new Date(item.created_at));

  const body = document.createElement('span');
  body.className = 'notice-body';
  body.append(text, detail, when);

  button.append(face, body);
  row.append(button);
  return row;
}

// ---------- お知らせの丸 ----------

async function readSeen() {
  const { data, error } = await supabase
    .from('notice_seen').select('seen_at').eq('user_id', me).maybeSingle();
  if (error) console.error(error);
  return data?.seen_at ?? '1970-01-01T00:00:00Z';
}

// 最後に開いたあとに、相手からのお知らせが1つでもあればベルに丸を出す
export async function refreshNoticeDot(userId) {
  me = userId;
  const seenAt = await readSeen();

  const [r, m] = await Promise.all([
    supabase
      .from('meal_reactions')
      .select('id, meals!inner(user_id)', { count: 'exact', head: true })
      .eq('meals.user_id', me)
      .neq('user_id', me)
      .gt('created_at', seenAt),
    supabase
      .from('chat_messages')
      .select('id', { count: 'exact', head: true })
      .neq('user_id', me)
      .gt('created_at', seenAt),
  ]);
  if (r.error) console.error(r.error);
  if (m.error) console.error(m.error);
  dot.hidden = (r.count ?? 0) + (m.count ?? 0) === 0;
}

async function markSeen() {
  const { error } = await supabase
    .from('notice_seen')
    .upsert({ user_id: me, seen_at: new Date().toISOString() }, { onConflict: 'user_id' });
  if (error) {
    console.error(error);
    return;
  }
  dot.hidden = true;
}
