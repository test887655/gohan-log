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
const quantityChips = $('quantity-chips');
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

  if (days < 0) return { text: `${date} ${-days}日すぎ`, soon: true };
  if (days === 0) return { text: `${date} 今日まで`, soon: true };
  if (days <= SOON_DAYS) return { text: `${date} あと${days}日`, soon: true };
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
  for (const timer of pendingSaves.values()) clearTimeout(timer);
  pendingSaves.clear();
  list.replaceChildren();
  closeForm();
}

function showStatus(message) {
  listStatus.textContent = message;
  listEmpty.hidden = false;
}

// ---------- 一覧の組み立て ----------

// 一覧では全体を見渡せることを優先して、1品目1行に収める。
// 詳しい編集は名前を押してフォームを開く
function renderIngredient(item) {
  const row = document.createElement('div');
  row.className = 'ingredient';

  const main = document.createElement('button');
  main.type = 'button';
  main.className = 'ingredient-main';
  main.addEventListener('click', () => openForm(item));

  const line = document.createElement('span');
  line.className = 'ingredient-line';

  const name = document.createElement('span');
  name.className = 'ingredient-name';
  name.textContent = item.name;

  const amount = document.createElement('span');
  amount.className = 'ingredient-amount';
  amount.textContent = amountText(item);

  line.append(name, amount);

  const meta = document.createElement('span');
  meta.className = 'ingredient-meta';
  meta.append(STORAGE_LABELS[item.storage] ?? item.storage);

  if (item.expires_on) {
    const { text, soon } = expiryLabel(item.expires_on);
    const expiry = document.createElement('span');
    expiry.className = soon ? 'expiry soon' : 'expiry';
    expiry.textContent = text;
    meta.append('・', expiry);
    if (soon) row.classList.add('soon');
  }

  main.append(line, meta);
  row.append(main);

  // 数で書かれているものは、フォームを開かずにその場で増減できる
  if (countOf(item) !== null) {
    const stepper = document.createElement('div');
    stepper.className = 'stepper';

    const minus = stepButton('−', '減らす');
    const plus = stepButton('＋', '増やす');
    minus.disabled = countOf(item) <= 0;

    minus.addEventListener('click', () => stepQuantity(item, -1, amount, minus));
    plus.addEventListener('click', () => stepQuantity(item, 1, amount, minus));

    stepper.append(minus, plus);
    row.append(stepper);
  }

  // 使い切ったものは、その場で消せるようにする
  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'trash-button';
  remove.setAttribute('aria-label', `${item.name}を消す`);
  remove.innerHTML = '<svg class="trash-icon" aria-hidden="true"><use href="#trash"/></svg>';
  remove.addEventListener('click', () => deleteIngredient(item));
  row.append(remove);

  return row;
}

function stepButton(sign, label) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'step';
  button.textContent = sign;
  button.setAttribute('aria-label', label);
  return button;
}

// 数量だけ、単位だけでも書けるようにする。
// 数量は「半分」のような書き方も残せるよう、文字のまま出す
function amountText(item) {
  const quantity = item.quantity ?? '';
  const unit = item.unit ?? '';
  return `${quantity}${quantity && unit ? ' ' : ''}${unit}`;
}

// 「半分」のように数で書かれていないものは、− ＋ で増減できない
function countOf(item) {
  const number = Number(item.quantity);
  return item.quantity !== null && item.quantity.trim() !== '' && Number.isFinite(number) ? number : null;
}

// ---------- その場での数量の増減 ----------

// 連打されても通信は最後の1回で済むよう、少し待ってからまとめて送る
const pendingSaves = new Map(); // id -> タイマー

function stepQuantity(item, delta, amountEl, minusButton) {
  const next = Math.max(0, Math.round((countOf(item) + delta) * 10) / 10);

  item.quantity = String(next);
  amountEl.textContent = amountText(item);
  minusButton.disabled = next <= 0;

  clearTimeout(pendingSaves.get(item.id));
  pendingSaves.set(item.id, setTimeout(() => saveQuantity(item), 500));
}

async function saveQuantity(item) {
  pendingSaves.delete(item.id);

  // RLSに止められたときはエラーではなく0件が返る。件数で成否を見る
  const { data, error } = await supabase
    .from('ingredients').update({ quantity: item.quantity }).eq('id', item.id).select();

  if (error || data.length === 0) {
    console.error(error);
    alert('数を変えられませんでした。開き直してから試してください。');
    await loadIngredients();
  }
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

// 11以上や「半分」などは「任意」を選んで自分で書く
quantityChips.addEventListener('change', () => {
  const custom = quantityChips.querySelector('input[name="quantity"]:checked').value === 'custom';
  quantityInput.hidden = !custom;
  if (custom) quantityInput.focus();
  else quantityInput.value = '';
});

function selectQuantity(quantity) {
  const text = quantity ?? '';
  const preset = quantityChips.querySelector(`input[name="quantity"][value="${CSS.escape(text)}"]`);
  // ボタンにある数（なし・1〜10）ならそれを押した形にする。それ以外は「任意」
  const onPreset = text === '' || (preset && text !== 'custom');

  quantityChips.querySelector(
    onPreset ? `input[name="quantity"][value="${CSS.escape(text)}"]` : 'input[name="quantity"][value="custom"]'
  ).checked = true;

  quantityInput.value = onPreset ? '' : text;
  quantityInput.hidden = onPreset;
}

function openForm(item) {
  editing = item;
  formError.hidden = true;
  formTitle.textContent = item ? '食材を編集' : '食材を追加';

  nameInput.value = item?.name ?? '';
  selectQuantity(item?.quantity ?? '');
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
  quantityInput.hidden = true;
  form.hidden = true;
  openButton.hidden = false;
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  formError.hidden = true;
  saveButton.disabled = true;
  saveButton.textContent = '保存中…';

  const chosen = form.querySelector('input[name="quantity"]:checked').value;
  const quantity = chosen === 'custom' ? quantityInput.value.trim() : chosen;
  const unit = form.querySelector('input[name="unit"]:checked').value;
  const values = {
    name: nameInput.value.trim(),
    quantity: quantity === '' ? null : quantity,
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
  // 消したものを編集中だったら、開いたままにしない
  if (editing?.id === item.id) closeForm();
  await loadIngredients();
}
