// そうだん。食材から「これ何作ろう？」と相手に聞ける。
// やりとりは2人で共有（RLSで、書けるのは本人・読めるのは2人とも）
import { supabase } from './supabase.js';

// 返事に使うスタンプ。文字で入れておけば、絵を用意しなくても出る
const STAMPS = ['👍', '🙏', '😋', '🍳', '💡', '🤔'];

// 一度に読むそうだんの数。文字だけなので軽いが、際限なく増やさない
const CHAT_PAGE = 20;

const $ = (id) => document.getElementById(id);

const askButton = $('chat-ask-button');
const askForm = $('chat-ask-form');
const askTitle = $('chat-ask-title');
const askDefault = $('chat-ask-default');
const askLabel = $('chat-ask-label');
const askNote = $('chat-ask-note');
const askSave = $('chat-ask-save');
const askError = $('chat-ask-error');
const list = $('chat-list');
const listEmpty = $('chat-empty');
const listStatus = $('chat-status');
const chatDot = $('chat-dot');
const fridgeDot = $('fridge-dot');

let me = null;
let names = new Map(); // user_id -> 表示名
// 食材から開いたときの食材名。「＋」から開いたときは null
let askTopic = null;

const timeFormatter = new Intl.DateTimeFormat('ja-JP', {
  month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
});

// 食材から聞くときの決まり文句
function defaultAsk(topic) {
  return `${topic}料理教えて！`;
}

// ---------- 読み込み ----------

export async function loadChats(userId, displayNames) {
  me = userId;
  names = displayNames;

  const { data: chats, error } = await supabase
    .from('chats')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(CHAT_PAGE);

  if (error) {
    console.error(error);
    list.replaceChildren();
    showStatus('読み込めませんでした。通信を確認してもう一度開いてください。');
    return;
  }

  let messages = [];
  if (chats.length > 0) {
    const { data, error: messageError } = await supabase
      .from('chat_messages')
      .select('*')
      .in('chat_id', chats.map((chat) => chat.id))
      .order('created_at', { ascending: true });

    if (messageError) console.error(messageError);
    messages = data ?? [];
  }

  const byChat = new Map();
  for (const message of messages) {
    if (!byChat.has(message.chat_id)) byChat.set(message.chat_id, []);
    byChat.get(message.chat_id).push(message);
  }

  list.replaceChildren(...chats.map((chat) => renderChat(chat, byChat.get(chat.id) ?? [])));

  if (chats.length === 0) showStatus('まだそうだんはありません。食材リストの吹き出しから聞けます。');
  else listEmpty.hidden = true;

  // 開いたら読んだことにして、お知らせの丸を消す
  await markSeen();
}

export function clearChats() {
  list.replaceChildren();
  closeAskForm();
  setDot(false);
}

function showStatus(message) {
  listStatus.textContent = message;
  listEmpty.hidden = false;
}

// ---------- お知らせの丸 ----------

// 相手からの新しい書き込みがあれば、冷蔵庫と吹き出しに小さな丸を出す
export async function refreshChatDot(userId) {
  me = userId;

  const { data: seen, error: seenError } = await supabase
    .from('chat_seen').select('seen_at').eq('user_id', userId).maybeSingle();
  if (seenError) console.error(seenError);

  const since = seen?.seen_at ?? '1970-01-01T00:00:00Z';

  const { count, error } = await supabase
    .from('chat_messages')
    .select('id', { count: 'exact', head: true })
    .neq('user_id', userId)
    .gt('created_at', since);

  if (error) {
    console.error(error);
    return;
  }
  setDot((count ?? 0) > 0);
}

function setDot(on) {
  chatDot.hidden = !on;
  fridgeDot.hidden = !on;
}

async function markSeen() {
  const { error } = await supabase
    .from('chat_seen')
    .upsert({ user_id: me, seen_at: new Date().toISOString() }, { onConflict: 'user_id' });

  if (error) console.error(error);
  else setDot(false);
}

// ---------- 一覧の組み立て ----------

function renderChat(chat, messages) {
  const box = document.createElement('article');
  box.className = 'chat';

  const head = document.createElement('div');
  head.className = 'chat-head';

  const topic = document.createElement('h3');
  topic.className = 'chat-topic';
  topic.textContent = chat.topic ?? 'そうだん';

  const when = document.createElement('span');
  when.className = 'chat-when';
  when.textContent = timeFormatter.format(new Date(chat.created_at));

  head.append(topic, when);
  box.append(head);

  for (const message of messages) box.append(renderMessage(message));

  box.append(renderReply(chat));
  return box;
}

function renderMessage(message) {
  const line = document.createElement('div');
  line.className = message.user_id === me ? 'bubble mine' : 'bubble theirs';

  const who = document.createElement('span');
  who.className = 'bubble-who';
  who.textContent = names.get(message.user_id) ?? '';
  line.append(who);

  if (message.body) {
    const body = document.createElement('p');
    body.className = 'bubble-body';
    body.textContent = message.body;
    line.append(body);
  }

  if (message.stamp) {
    const stamp = document.createElement('p');
    stamp.className = 'bubble-stamp';
    stamp.textContent = message.stamp;
    line.append(stamp);
  }

  return line;
}

// 返事はその場で書ける。スタンプは押すとすぐ送る
function renderReply(chat) {
  const form = document.createElement('form');
  form.className = 'chat-reply';

  const input = document.createElement('input');
  input.type = 'text';
  input.maxLength = 200;
  input.placeholder = '返事を書く';
  input.setAttribute('aria-label', '返事');

  const send = document.createElement('button');
  send.type = 'submit';
  send.className = 'primary';
  send.textContent = '送る';

  const row = document.createElement('div');
  row.className = 'chat-reply-row';
  row.append(input, send);

  const stamps = document.createElement('div');
  stamps.className = 'stamps';
  for (const mark of STAMPS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'stamp';
    button.textContent = mark;
    button.setAttribute('aria-label', `${mark} を送る`);
    button.addEventListener('click', () => sendMessage(chat.id, { stamp: mark }, button));
    stamps.append(button);
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const body = input.value.trim();
    if (!body) return;
    sendMessage(chat.id, { body }, send);
  });

  // 自分が始めたそうだんは、まとめて消せる。返事も一緒に消える
  if (chat.user_id === me) {
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'trash-button';
    remove.setAttribute('aria-label', 'このそうだんを消す');
    remove.innerHTML = '<svg class="trash-icon" aria-hidden="true"><use href="#trash"/></svg>';
    remove.addEventListener('click', () => deleteChat(chat));
    stamps.append(remove);
  }

  form.append(row, stamps);
  return form;
}

async function deleteChat(chat) {
  const label = chat.topic ? `「${chat.topic}」のそうだん` : 'このそうだん';
  if (!confirm(`${label}を消しますか？ 返事も一緒に消えます。`)) return;

  // RLSに止められたときはエラーではなく0件が返る。件数で成否を見る
  const { data, error } = await supabase.from('chats').delete().eq('id', chat.id).select();

  if (error || data.length === 0) {
    console.error(error);
    alert('消せませんでした。もう一度開き直してから試してください。');
    return;
  }
  await loadChats(me, names);
}

// 返事とスタンプの共通処理。二度押しにならないよう、送るあいだは止めておく
async function sendMessage(chatId, values, button) {
  button.disabled = true;

  const { error } = await supabase.from('chat_messages').insert({ chat_id: chatId, ...values });

  button.disabled = false;

  if (error) {
    console.error(error);
    alert('送れませんでした。通信を確かめて、もう一度試してください。');
    return;
  }
  await loadChats(me, names);
}

// ---------- 聞く ----------

askButton.addEventListener('click', () => openAskForm(null));
$('chat-ask-cancel').addEventListener('click', closeAskForm);

// 食材リストの吹き出しから呼ばれる。決まり文句が入った状態で開く
export function openAskForm(topic) {
  askTopic = topic;
  askError.hidden = true;
  askNote.value = '';

  if (topic) {
    askTitle.textContent = `${topic}のこと`;
    askDefault.textContent = defaultAsk(topic);
    askDefault.hidden = false;
    askLabel.textContent = '足したいこと（任意）';
    askNote.placeholder = 'あと1玉ある、など';
    askNote.required = false;
  } else {
    askTitle.textContent = '聞きたいこと';
    askDefault.hidden = true;
    askLabel.textContent = '聞きたいこと';
    askNote.placeholder = '今日の献立どうしよう？ など';
    askNote.required = true;
  }

  askForm.hidden = false;
  askButton.hidden = true;
  askNote.focus();
}

function closeAskForm() {
  askTopic = null;
  askForm.reset();
  askForm.hidden = true;
  askButton.hidden = false;
}

askForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  askError.hidden = true;

  const extra = askNote.value.trim();
  // 食材から聞くときは決まり文句。足したいことがあれば続けて書く
  const body = askTopic
    ? (extra ? `${defaultAsk(askTopic)}\n${extra}` : defaultAsk(askTopic))
    : extra;

  if (!body) {
    askError.textContent = '聞きたいことを書いてください。';
    askError.hidden = false;
    return;
  }

  askSave.disabled = true;
  askSave.textContent = '送信中…';

  try {
    const { data, error } = await supabase
      .from('chats').insert({ topic: askTopic }).select().single();
    if (error) throw error;

    const { error: messageError } = await supabase
      .from('chat_messages').insert({ chat_id: data.id, body });
    if (messageError) throw messageError;

    closeAskForm();
    await loadChats(me, names);
  } catch (error) {
    console.error(error);
    askError.textContent = `送れませんでした：${error.message ?? error}`;
    askError.hidden = false;
  } finally {
    askSave.disabled = false;
    askSave.textContent = '送る';
  }
});
