// 外食したお店。2人で共有して見られる。
// 直せる・消せるのは書いた本人だけ（RLSでそうしてある）
import { supabase } from './supabase.js';

const $ = (id) => document.getElementById(id);

const openButton = $('open-place-button');
const form = $('place-form');
const formTitle = $('place-form-title');
const nameInput = $('place-name');
const noteInput = $('place-note');
const saveButton = $('place-save');
const formError = $('place-error');
const list = $('place-list');
const listEmpty = $('place-empty');
const listStatus = $('place-status');
// 食事の記録の「お店の名前」で、打ち直さずに選べるようにするための候補
const options = $('place-options');

let editing = null;
let me = null;
let names = new Map(); // user_id -> 表示名
// 自分と、いま共有している相手。この2人ぶんのお店だけを出す
let shared = [];
// 候補をどの組み合わせで読んだか。相手を切り替えたら読み直す
let optionsKey = null;

// ---------- 読み込み ----------

export async function loadPlaces(userId, displayNames, sharedIds) {
  me = userId;
  names = displayNames;
  shared = sharedIds;

  const { data, error } = await supabase
    .from('places')
    .select('*')
    .in('user_id', shared)
    .order('name', { ascending: true });

  if (error) {
    console.error(error);
    list.replaceChildren();
    showStatus('読み込めませんでした。通信を確認してもう一度開いてください。');
    return;
  }

  list.replaceChildren(...data.map(renderPlace));
  fillOptions(data, shared.join());

  if (data.length === 0) showStatus('まだお店がありません。上の「＋ お店を追加」から登録できます。');
  else listEmpty.hidden = true;
}

// 食事の記録フォームを開いたときに呼ぶ。名前だけなので通信はごく軽い。
// 一度読んだら覚えておき、開くたびには読みに行かない
export async function loadPlaceOptions(sharedIds) {
  const key = sharedIds.join();
  if (optionsKey === key) return;

  const { data, error } = await supabase
    .from('places')
    .select('name')
    .in('user_id', sharedIds)
    .order('name', { ascending: true });

  if (error) {
    console.error(error);
    return;
  }
  fillOptions(data, key);
}

function fillOptions(rows, key) {
  // 2人が同じお店を書いていることもあるので、名前は重ならないようにする
  const unique = [...new Set(rows.map((row) => row.name))];
  options.replaceChildren(...unique.map((name) => {
    const option = document.createElement('option');
    option.value = name;
    return option;
  }));
  optionsKey = key;
}

export function clearPlaces() {
  list.replaceChildren();
  options.replaceChildren();
  optionsKey = null;
  closeForm();
}

function showStatus(message) {
  listStatus.textContent = message;
  listEmpty.hidden = false;
}

// ---------- 一覧の組み立て ----------

function renderPlace(place) {
  const mine = place.user_id === me;

  const row = document.createElement('div');
  row.className = 'place-row';

  // 自分が書いたものは押すと編集が開く。相手のものは読むだけ
  const main = document.createElement(mine ? 'button' : 'div');
  main.className = 'place-main';
  if (mine) {
    main.type = 'button';
    main.addEventListener('click', () => openForm(place));
  }

  const line = document.createElement('span');
  line.className = 'place-row-line';

  const name = document.createElement('span');
  name.className = 'place-row-name';
  name.textContent = place.name;

  const who = document.createElement('span');
  who.className = 'place-row-who';
  who.textContent = names.get(place.user_id) ?? '';

  line.append(name, who);
  main.append(line);

  if (place.note) {
    const note = document.createElement('span');
    note.className = 'place-row-note';
    note.textContent = place.note;
    main.append(note);
  }

  row.append(main);

  if (mine) {
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'trash-button';
    remove.setAttribute('aria-label', `${place.name}を消す`);
    remove.innerHTML = '<svg class="trash-icon" aria-hidden="true"><use href="#trash"/></svg>';
    remove.addEventListener('click', () => deletePlace(place));
    row.append(remove);
  }

  return row;
}

// ---------- 追加・編集フォーム ----------

openButton.addEventListener('click', () => openForm(null));
$('place-cancel').addEventListener('click', closeForm);

function openForm(place) {
  editing = place;
  formError.hidden = true;
  formTitle.textContent = place ? 'お店を編集' : 'お店を追加';

  nameInput.value = place?.name ?? '';
  noteInput.value = place?.note ?? '';

  form.hidden = false;
  openButton.hidden = true;
  nameInput.focus();
}

function closeForm() {
  editing = null;
  form.reset();
  form.hidden = true;
  openButton.hidden = false;
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  formError.hidden = true;
  saveButton.disabled = true;
  saveButton.textContent = '保存中…';

  const values = {
    name: nameInput.value.trim(),
    note: noteInput.value.trim() || null,
  };

  try {
    if (editing) {
      // RLSに止められたときはエラーではなく0件が返る。件数で成否を見る
      const { data, error } = await supabase
        .from('places').update(values).eq('id', editing.id).select();
      if (error) throw error;
      if (data.length === 0) throw new Error('ログインの有効期限が切れているかもしれません。');
    } else {
      const { error } = await supabase.from('places').insert(values);
      if (error) throw error;
    }

    closeForm();
    await loadPlaces(me, names, shared);
  } catch (error) {
    console.error(error);
    formError.textContent = `保存できませんでした：${error.message ?? error}`;
    formError.hidden = false;
  } finally {
    saveButton.disabled = false;
    saveButton.textContent = '保存';
  }
});

async function deletePlace(place) {
  if (!confirm(`「${place.name}」を消しますか？`)) return;

  const { data, error } = await supabase
    .from('places').delete().eq('id', place.id).select();

  if (error || data.length === 0) {
    console.error(error);
    alert('消せませんでした。もう一度開き直してから試してください。');
    return;
  }
  // 消したものを編集中だったら、開いたままにしない
  if (editing?.id === place.id) closeForm();
  await loadPlaces(me, names, shared);
}
