// 食材リスト。自分の分だけが見える（RLSで本人限定にしてある）
import { supabase } from './supabase.js';

const STORAGE_LABELS = { fridge: '冷蔵', freezer: '冷凍', pantry: '常温' };

// 期限がこの日数以内なら目立たせる
const SOON_DAYS = 3;

const $ = (id) => document.getElementById(id);

const openButton = $('open-ingredient-button');
const form = $('ingredient-form');
const formTitle = $('ingredient-form-title');
const nameInput = $('ingredient-name');
const quantityInput = $('ingredient-quantity');
const unitChips = $('unit-chips');
const expiresInput = $('ingredient-expires');
const saveButton = $('ingredient-save');
const formError = $('ingredient-error');
const list = $('ingredient-list');
const listEmpty = $('ingredient-empty');
const listStatus = $('ingredient-status');

let editing = null;

const dayFormatter = new Intl.DateTimeFormat('ja-JP', { month: 'numeric', day: 'numeric', weekday: 'short' });

// ---------- 期限の見かた ----------

// 日付だけで数えたいので、時刻を落としてから引き算する
function daysUntil(dateText) {
  const [year, month, day] = dateText.split('-').map(Number);
  const target = new Date(year, month - 1, day);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((target - today) / 86400000);
}

function expiryLabel(dateText) {
  const days = daysUntil(dateText);
  const [year, month, day] = dateText.split('-').map(Number);
  const date = dayFormatter.format(new Date(year, month - 1, day));

  if (days < 0) return { text: `${date}（${-days}日すぎ）`, soon: true };
  if (days === 0) return { text: `${date}（今日まで）`, soon: true };
  if (days <= SOON_DAYS) return { text: `${date}（あと${days}日）`, soon: true };
  return { text: `${date}まで`, soon: false };
}

// ---------- 読み込み ----------

export async function loadIngredients() {
  // 期限が近い順。期限なしは後ろにまとめる
  const { data, error } = await supabase
    .from('ingredients')
    .select('*')
    .order('expires_on', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: true });

  if (error) {
    console.error(error);
    list.replaceChildren();
    showStatus('読み込めませんでした。通信を確認してもう一度開いてください。');
    return;
  }

  list.replaceChildren(...data.map(renderIngredient));

  if (data.length === 0) showStatus('まだ食材がありません。上の「＋ 食材を追加」から登録できます。');
  else listEmpty.hidden = true;
}

export function clearIngredients() {
  list.replaceChildren();
  closeForm();
}

function showStatus(message) {
  listStatus.textContent = message;
  listEmpty.hidden = false;
}

// ---------- カードの組み立て ----------

function renderIngredient(item) {
  const card = document.createElement('article');
  card.className = 'card ingredient';

  const head = document.createElement('p');
  head.className = 'ingredient-head';

  const name = document.createElement('span');
  name.className = 'ingredient-name';
  name.textContent = item.name;
  head.append(name);

  const amount = amountText(item);
  if (amount) {
    const span = document.createElement('span');
    span.className = 'ingredient-amount';
    span.textContent = amount;
    head.append(span);
  }
  card.append(head);

  const meta = document.createElement('p');
  meta.className = 'meta';

  const place = document.createElement('span');
  place.className = 'badge';
  place.textContent = STORAGE_LABELS[item.storage] ?? item.storage;
  meta.append(place);

  if (item.expires_on) {
    const { text, soon } = expiryLabel(item.expires_on);
    const expiry = document.createElement('span');
    expiry.className = soon ? 'expiry soon' : 'expiry';
    expiry.textContent = text;
    meta.append(expiry);
    if (soon) card.classList.add('soon');
  }
  card.append(meta);

  const row = document.createElement('div');
  row.className = 'row';

  const edit = document.createElement('button');
  edit.type = 'button';
  edit.className = 'link';
  edit.textContent = '編集';
  edit.addEventListener('click', () => openForm(item));

  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'link danger';
  remove.textContent = '削除';
  remove.addEventListener('click', () => deleteIngredient(item));

  row.append(edit, remove);
  card.append(row);
  return card;
}

// 数量だけ、単位だけでも書けるようにする
function amountText(item) {
  const quantity = item.quantity === null ? '' : String(Number(item.quantity));
  const unit = item.unit ?? '';
  return `${quantity}${quantity && unit ? ' ' : ''}${unit}`;
}

// ---------- 追加・編集フォーム ----------

openButton.addEventListener('click', () => openForm(null));
$('ingredient-cancel').addEventListener('click', closeForm);

// 一覧にない単位で登録されたものを編集するときは、その単位のボタンを足して選ぶ
function selectUnit(unit) {
  // 前に足したぶんは毎回片付ける
  for (const extra of unitChips.querySelectorAll('[data-added]')) extra.remove();

  let chip = unitChips.querySelector(`input[name="unit"][value="${CSS.escape(unit)}"]`);

  if (!chip) {
    const label = document.createElement('label');
    label.className = 'chip';
    label.dataset.added = '';
    chip = document.createElement('input');
    chip.type = 'radio';
    chip.name = 'unit';
    chip.value = unit;
    chip.setAttribute('aria-label', unit);
    label.append(chip, ` ${unit}`);
    unitChips.append(label);
  }
  chip.checked = true;
}

function openForm(item) {
  editing = item;
  formError.hidden = true;
  formTitle.textContent = item ? '食材を編集' : '食材を追加';

  nameInput.value = item?.name ?? '';
  quantityInput.value = item?.quantity ?? '';
  expiresInput.value = item?.expires_on ?? '';
  selectUnit(item?.unit ?? '');
  const storage = item?.storage ?? 'fridge';
  form.querySelector(`input[name="storage"][value="${storage}"]`).checked = true;

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

  const quantity = quantityInput.value.trim();
  const unit = form.querySelector('input[name="unit"]:checked').value;
  const values = {
    name: nameInput.value.trim(),
    quantity: quantity === '' ? null : Number(quantity),
    unit: unit === '' ? null : unit,
    expires_on: expiresInput.value || null,
    storage: form.querySelector('input[name="storage"]:checked').value,
  };

  try {
    if (editing) {
      // RLSに止められたときはエラーではなく0件が返る。件数で成否を見る
      const { data, error } = await supabase
        .from('ingredients').update(values).eq('id', editing.id).select();
      if (error) throw error;
      if (data.length === 0) throw new Error('ログインの有効期限が切れているかもしれません。');
    } else {
      const { error } = await supabase.from('ingredients').insert(values);
      if (error) throw error;
    }

    closeForm();
    await loadIngredients();
  } catch (error) {
    console.error(error);
    formError.textContent = `保存できませんでした：${error.message ?? error}`;
    formError.hidden = false;
  } finally {
    saveButton.disabled = false;
    saveButton.textContent = '保存';
  }
});

async function deleteIngredient(item) {
  if (!confirm(`「${item.name}」を消しますか？`)) return;

  const { data, error } = await supabase
    .from('ingredients').delete().eq('id', item.id).select();

  if (error || data.length === 0) {
    console.error(error);
    alert('消せませんでした。もう一度開き直してから試してください。');
    return;
  }
  await loadIngredients();
}
