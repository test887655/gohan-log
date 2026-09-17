// キラキラを押してポイントを貯め、相手が用意したプレゼントと交換する。
// 用意するのは贈る側、選ぶのは受け取る側。選んだ人のポイントが減る。
import { supabase } from './supabase.js';

const SPARKLE_POINTS = 3;
const STAR_BONUS = 10;
// 何日に一度、星（ボーナス）が出るか
const BONUS_EVERY = 3;
// 朝・昼・夜の3食がそろった日のボーナス
const MEALS_BONUS = 10;
const THREE_MEALS = ['breakfast', 'lunch', 'dinner'];
// キラキラの slot。'meals' はここに入れない（星の判定に混ぜないため）
const SPARKLE_SLOTS = ['morning', 'noon', 'night'];

const $ = (id) => document.getElementById(id);

const pointButton = $('point-button');
const pointTotal = $('point-total');
// ボタンのidは絵の id（#sparkle）と別にする。同じだと use の参照先がボタンになってしまう
const sparkle = $('sparkle-button');
const toast = $('point-toast');

const panel = $('gift-panel');
const giftPoints = $('gift-points');
const partnerTitle = $('partner-gift-title');
const partnerList = $('partner-gifts');
const partnerEmpty = $('partner-gifts-empty');
const myList = $('my-gifts');
const myEmpty = $('my-gifts-empty');
const openGiftForm = $('open-gift-form');
const giftForm = $('gift-form');
const giftFormTitle = $('gift-form-title');
const giftName = $('gift-name');
const giftCost = $('gift-cost');
const giftSave = $('gift-save');
const giftError = $('gift-error');

const news = $('gift-news');
const newsText = $('gift-news-text');

let me = null;
let partner = null; // { id, name }
let names = new Map(); // user_id -> 表示名
let total = 0;
let pending = null; // まだ取っていないキラキラ { day, slot, bonus }
let claimedToday = new Set(); // 今日もう受け取った slot
let editingGift = null;
let onHomeScreen = true;

// ---------- 時間帯の区切り ----------

function dayText(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// 朝5:00〜11:59／昼12:00〜16:59／夜17:00〜翌4:59。
// 夜は日付をまたぐので、0:00〜4:59は前の日の夜として数える（1日が朝5時に変わる）
function currentSlot(now = new Date()) {
  const hour = now.getHours();
  if (hour >= 5 && hour < 12) return { day: dayText(now), slot: 'morning' };
  if (hour >= 12 && hour < 17) return { day: dayText(now), slot: 'noon' };

  const base = new Date(now);
  if (hour < 5) base.setDate(base.getDate() - 1);
  return { day: dayText(base), slot: 'night' };
}

// 3日に一度の星の日。2人とも同じ日になるよう、日付そのものから決める
function isBonusDay(day) {
  const [year, month, date] = day.split('-').map(Number);
  return Math.floor(Date.UTC(year, month - 1, date) / 86400000) % BONUS_EVERY === 0;
}

// ---------- 読み込み ----------

export async function loadPoints(user, displayNames, partnerId) {
  me = user;
  names = displayNames;
  setGiftPartner(partnerId);

  pointButton.hidden = false;

  await refreshTotal();
  await refreshSparkle();
  await checkMealBonus();
  await showNews();
}

// 共有する相手を切り替えたとき（eri だけ）に呼ばれる。
// 自分が用意したものは相手2人とも見えるので、変わるのは「もらえるもの」の側だけ
export function setGiftPartner(partnerId) {
  partner = partnerId ? { id: partnerId, name: names.get(partnerId) ?? '相手' } : null;
  partnerTitle.textContent = partner ? `${partner.name} さんからもらえるもの` : 'もらえるもの';
  if (me && !panel.hidden) loadGiftItems();
}

export function clearPoints() {
  me = null;
  partner = null;
  pending = null;
  claimedToday = new Set();
  total = 0;
  pointButton.hidden = true;
  sparkle.hidden = true;
  panel.hidden = true;
  news.hidden = true;
}

// 食材リストを開いているあいだはキラキラを出さない
export function setHomeScreen(isHome) {
  onHomeScreen = isHome;
  showSparkle();
}

async function refreshTotal() {
  const { data, error } = await supabase.rpc('my_points');
  if (error) {
    console.error(error);
    return;
  }
  setTotal(data ?? 0);
}

function setTotal(value) {
  total = value;
  pointTotal.textContent = String(value);
  giftPoints.textContent = String(value);
}

// ---------- キラキラ ----------

async function refreshSparkle() {
  const now = currentSlot();

  const { data, error } = await supabase
    .from('points').select('slot').eq('claim_day', now.day);

  if (error) {
    console.error(error);
    return;
  }

  claimedToday = new Set(data.map((row) => row.slot));
  // 3食そろったボーナスは数に入れない。入れると星が出なくなってしまう
  const sparkles = SPARKLE_SLOTS.filter((slot) => claimedToday.has(slot));

  pending = claimedToday.has(now.slot)
    ? null
    // 星の日は、その日の最初のひとつを星にする
    : { ...now, bonus: isBonusDay(now.day) && sparkles.length === 0 };

  showSparkle();
}

function showSparkle() {
  if (!pending || !onHomeScreen) {
    sparkle.hidden = true;
    return;
  }

  sparkle.firstElementChild.firstElementChild
    .setAttribute('href', pending.bonus ? '#star' : '#sparkle');
  // 出る場所は毎回変える。ヘッダーと画面のふちは避ける
  sparkle.style.top = `${22 + Math.random() * 52}%`;
  sparkle.style.left = `${8 + Math.random() * 68}%`;
  sparkle.hidden = false;
}

sparkle.addEventListener('click', async () => {
  if (!pending) return;

  const claim = pending;
  const gained = SPARKLE_POINTS + (claim.bonus ? STAR_BONUS : 0);
  pending = null;
  sparkle.hidden = true;

  const { error } = await supabase.from('points').insert({
    kind: claim.bonus ? 'star' : 'sparkle',
    amount: gained,
    claim_day: claim.day,
    slot: claim.slot,
  });

  // 23505 はその時間帯をもう取ってあるとき（別の端末で押した場合など）
  if (error && error.code === '23505') {
    await refreshTotal();
    return;
  }

  if (error) {
    console.error(error);
    alert('ポイントを入れられませんでした。開き直してから試してください。');
    pending = claim;
    showSparkle();
    return;
  }

  claimedToday.add(claim.slot);
  setTotal(total + gained);
  showToast(claim.bonus ? `＋${gained} ポイント（ボーナス）` : `＋${gained} ポイント`);
});

let toastTimer = null;

function showToast(message) {
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.hidden = true; }, 2000);
}

// ---------- 朝・昼・夜がそろった日のボーナス ----------

// キラキラと同じ数えかた（1日は朝5時に変わる）で、その食事がどの日のものかを出す。
// 夜ごはんを深夜に記録しても、その日のぶんとして数えられる
function mealDay(when) {
  const base = new Date(when);
  if (base.getHours() < 5) base.setDate(base.getDate() - 1);
  return dayText(base);
}

// 朝・昼・夜の3つがそろったら、その日1回だけ10ポイント。
// 記録したときと、開いたとき（相手の端末…ではなく自分の別の端末で記録した場合）に見に行く
export async function checkMealBonus(when = new Date()) {
  if (!me) return;

  const day = mealDay(when);
  const today = day === currentSlot().day;
  // 今日のぶんはもう分かっているので、受け取り済みなら数えに行かない
  if (today && claimedToday.has('meals')) return;

  const start = new Date(`${day}T05:00:00`);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);

  // タイムラインは2人分が並ぶので、自分の記録だけを数える
  const { data, error } = await supabase
    .from('meals').select('meal_type')
    .eq('user_id', me.id)
    .gte('eaten_at', start.toISOString())
    .lt('eaten_at', end.toISOString());

  if (error) {
    console.error(error);
    return;
  }

  const kinds = new Set(data.map((row) => row.meal_type));
  // 間食は数に入れない。朝・昼・夜がそろって初めてボーナス
  if (!THREE_MEALS.every((kind) => kinds.has(kind))) return;

  const { error: insertError } = await supabase.from('points').insert({
    kind: 'meals',
    amount: MEALS_BONUS,
    claim_day: day,
    slot: 'meals',
  });

  // 23505 はもう受け取っているとき（別の端末で記録した場合など）。黙って終わる
  if (insertError) {
    if (insertError.code !== '23505') console.error(insertError);
    return;
  }

  if (today) claimedToday.add('meals');
  setTotal(total + MEALS_BONUS);
  showToast(`＋${MEALS_BONUS} ポイント（3食そろった）`);
}

// ---------- プレゼント ----------

pointButton.addEventListener('click', openPanel);
$('gift-close').addEventListener('click', () => { panel.hidden = true; });

async function openPanel() {
  panel.hidden = false;
  closeGiftForm();
  await loadGiftItems();
}

async function loadGiftItems() {
  const { data, error } = await supabase
    .from('gift_items').select('*').order('cost', { ascending: true });

  if (error) {
    console.error(error);
    return;
  }

  const mine = data.filter((item) => item.user_id === me.id);
  const theirs = data.filter((item) => item.user_id === partner?.id);

  myList.replaceChildren(...mine.map(renderMyGift));
  myEmpty.hidden = mine.length > 0;

  partnerList.replaceChildren(...theirs.map(renderPartnerGift));
  partnerEmpty.hidden = theirs.length > 0;
}

function giftRow(item) {
  const row = document.createElement('div');
  row.className = 'gift-item';

  const text = document.createElement('span');
  text.className = 'gift-text';

  const name = document.createElement('span');
  name.className = 'gift-name';
  name.textContent = item.name;

  const cost = document.createElement('span');
  cost.className = 'gift-cost';
  cost.textContent = `${item.cost} ポイント`;

  text.append(name, cost);
  row.append(text);
  return row;
}

// 相手が用意したもの。ポイントが足りていれば選べる
function renderPartnerGift(item) {
  const row = giftRow(item);

  const choose = document.createElement('button');
  choose.type = 'button';
  choose.className = 'primary small';
  choose.textContent = '選ぶ';
  choose.disabled = total < item.cost;
  choose.addEventListener('click', () => chooseGift(item, choose));

  row.append(choose);
  return row;
}

// 自分が用意したもの。名前を押すと直せる
function renderMyGift(item) {
  const row = giftRow(item);
  row.firstElementChild.classList.add('tappable');
  row.firstElementChild.addEventListener('click', () => openGiftFormFor(item));

  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'trash-button';
  remove.setAttribute('aria-label', `${item.name}を消す`);
  remove.innerHTML = '<svg class="trash-icon" aria-hidden="true"><use href="#trash"/></svg>';
  remove.addEventListener('click', () => removeGift(item));

  row.append(remove);
  return row;
}

async function chooseGift(item, button) {
  if (total < item.cost) return;
  if (!confirm(`「${item.name}」を ${item.cost} ポイントで選びますか？`)) return;

  button.disabled = true;

  // 先にポイントを引く。引けなかったら選ばない
  const { error: pointError } = await supabase
    .from('points').insert({ kind: 'gift', amount: -item.cost });

  if (pointError) {
    console.error(pointError);
    alert('うまくいきませんでした。開き直してから試してください。');
    button.disabled = false;
    return;
  }

  const { error } = await supabase.from('gifts').insert({
    offered_by: item.user_id,
    name: item.name,
    cost: item.cost,
  });

  if (error) {
    console.error(error);
    // 知らせが届かなかったので、引いたぶんを戻す
    await supabase.from('points').insert({ kind: 'gift', amount: item.cost });
    alert('うまくいきませんでした。開き直してから試してください。');
    button.disabled = false;
    return;
  }

  setTotal(total - item.cost);
  alert(`「${item.name}」を選びました。${partner?.name ?? '相手'} さんに伝わります。`);
  await loadGiftItems();
}

async function removeGift(item) {
  if (!confirm(`「${item.name}」を消しますか？`)) return;

  // RLSに止められたときはエラーではなく0件が返る。件数で成否を見る
  const { data, error } = await supabase
    .from('gift_items').delete().eq('id', item.id).select();

  if (error || data.length === 0) {
    console.error(error);
    alert('消せませんでした。開き直してから試してください。');
    return;
  }

  if (editingGift?.id === item.id) closeGiftForm();
  await loadGiftItems();
}

openGiftForm.addEventListener('click', () => openGiftFormFor(null));
$('gift-cancel').addEventListener('click', closeGiftForm);

function openGiftFormFor(item) {
  editingGift = item;
  giftError.hidden = true;
  giftFormTitle.textContent = item ? 'プレゼントを直す' : 'プレゼントを作る';
  giftName.value = item?.name ?? '';
  giftCost.value = item?.cost ?? '';
  giftForm.hidden = false;
  openGiftForm.hidden = true;
  giftName.focus();
}

function closeGiftForm() {
  editingGift = null;
  giftForm.reset();
  giftForm.hidden = true;
  openGiftForm.hidden = false;
}

giftForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  giftError.hidden = true;
  giftSave.disabled = true;
  giftSave.textContent = '保存中…';

  const values = { name: giftName.value.trim(), cost: Number(giftCost.value) };

  try {
    if (editingGift) {
      const { data, error } = await supabase
        .from('gift_items').update(values).eq('id', editingGift.id).select();
      if (error) throw error;
      if (data.length === 0) throw new Error('ログインの有効期限が切れているかもしれません。');
    } else {
      const { error } = await supabase.from('gift_items').insert(values);
      if (error) throw error;
    }

    closeGiftForm();
    await loadGiftItems();
  } catch (error) {
    console.error(error);
    giftError.textContent = `保存できませんでした：${error.message ?? error}`;
    giftError.hidden = false;
  } finally {
    giftSave.disabled = false;
    giftSave.textContent = '保存';
  }
});

// ---------- 相手が選んだときのお知らせ ----------

let unseen = [];

async function showNews() {
  const { data, error } = await supabase
    .from('gifts').select('*')
    .eq('offered_by', me.id)
    .is('seen_at', null)
    .order('created_at', { ascending: true });

  if (error || data.length === 0) {
    if (error) console.error(error);
    return;
  }

  unseen = data;
  // 相手が2人いると、選んだ人がそれぞれ違うことがある。人ごとにまとめて書く
  const byPerson = new Map();
  for (const row of data) {
    const name = names.get(row.chosen_by) ?? '相手';
    if (!byPerson.has(name)) byPerson.set(name, []);
    byPerson.get(name).push(`「${row.name}」`);
  }
  newsText.textContent = [...byPerson]
    .map(([name, items]) => `${name} さんが ${items.join('')} を選びました`)
    .join('\n');
  news.hidden = false;
}

$('gift-news-close').addEventListener('click', async () => {
  news.hidden = true;
  if (unseen.length === 0) return;

  const ids = unseen.map((row) => row.id);
  unseen = [];
  const { error } = await supabase
    .from('gifts').update({ seen_at: new Date().toISOString() }).in('id', ids).select();
  if (error) console.error(error);
});
