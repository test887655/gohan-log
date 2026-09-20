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

// ガチャを出す人（表示名で決める）。ほかの人の画面には出さない
const GACHA_USERS = ['eri', 'hana', 'mihoko'];
// 出るポイントと、その出やすさ（重み）。合計で割った割合で当たる
// face は止まったときに出る絵。回しているあいだもこの並びを順に見せるので、
// ルーレットが当たりのところで止まったように見える
const GACHA_PRIZES = [
  { points: 1, weight: 35, face: '🍬' },
  { points: 3, weight: 30, face: '🍪' },
  { points: 5, weight: 25, face: '🍰' },
  { points: 10, weight: 9, face: '👑' },
  { points: 100, weight: 1, face: '💎' }, // 大当たり。100回に1回くらい
];

const $ = (id) => document.getElementById(id);

const pointButton = $('point-button');
const pointTotal = $('point-total');
// ボタンのidは絵の id（#sparkle）と別にする。同じだと use の参照先がボタンになってしまう
const sparkle = $('sparkle-button');
const toast = $('point-toast');

const panel = $('gift-panel');
const giftPoints = $('gift-points');
const giftPartnerPicker = $('gift-partner-picker');
const partnerTitle = $('partner-gift-title');
const myTitle = $('my-gift-title');
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

const gachaOpen = $('gacha-open');
const gachaPanel = $('gacha-panel');
const gachaPoints = $('gacha-points');
const gachaLegend = $('gacha-legend');
const gachaBox = $('gacha');
const gachaDraw = $('gacha-draw');
const gachaResult = $('gacha-result');
const gachaGift = $('gacha-box');
const gachaBurst = $('gacha-burst');
const gachaNote = $('gacha-note');
const gachaText = $('gacha-result-text');

const news = $('gift-news');
const newsText = $('gift-news-text');

let me = null;
let partner = null; // { id, name }
let giftPartnerIds = []; // 組んでいる相手みんな（プレゼントの画面で切り替えるため）
let pickPartner = null; // 相手を変えるとき app.js に知らせる
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

export async function loadPoints(user, displayNames, partnerId, partnerIds = [], onPick = null) {
  me = user;
  names = displayNames;
  giftPartnerIds = partnerIds;
  pickPartner = onPick;
  renderGiftPartners();
  setGiftPartner(partnerId);

  pointButton.hidden = false;

  await refreshTotal();
  await refreshSparkle();
  await checkMealBonus();
  await showNews();
}

// 共有する相手を切り替えたとき（eri だけ）に呼ばれる。
// 用意するもの・もらえるものの両方が、選んだ相手のぶんに変わる
export function setGiftPartner(partnerId) {
  partner = partnerId ? { id: partnerId, name: names.get(partnerId) ?? '相手' } : null;
  for (const button of giftPartnerPicker.querySelectorAll('.partner-option')) {
    button.setAttribute('aria-pressed', String(button.dataset.partner === partnerId));
  }
  partnerTitle.textContent = partner ? `${partner.name} さんからもらえるもの` : 'もらえるもの';
  myTitle.textContent = partner ? `${partner.name} さんに用意するもの` : '自分が用意するもの';
  if (me && !panel.hidden) loadGiftItems();
}

export function clearPoints() {
  me = null;
  partner = null;
  giftPartnerIds = [];
  giftPartnerPicker.replaceChildren();
  giftPartnerPicker.hidden = true;
  pending = null;
  claimedToday = new Set();
  total = 0;
  pointButton.hidden = true;
  sparkle.hidden = true;
  panel.hidden = true;
  gachaPanel.hidden = true;
  gachaOpen.hidden = true;
  news.hidden = true;
  lockScroll();
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
  gachaPoints.textContent = String(value);
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
  showGacha();
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

// 相手が2人以上いる人だけ。ヘッダーの切り替えはポップアップの後ろに隠れて押せないので、
// 「もらえるもの／用意するもの」を誰のぶんにするかは、この画面の中で選ぶ
function renderGiftPartners() {
  giftPartnerPicker.replaceChildren();
  giftPartnerPicker.hidden = giftPartnerIds.length < 2;
  if (giftPartnerPicker.hidden) return;

  const label = document.createElement('span');
  label.className = 'partner-label';
  label.textContent = '相手';
  giftPartnerPicker.append(label);

  for (const id of giftPartnerIds) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'theme-option partner-option';
    button.dataset.partner = id;
    button.setAttribute('aria-pressed', String(id === partner?.id));
    button.textContent = names.get(id) ?? '相手';
    button.addEventListener('click', () => pickPartner?.(id));
    giftPartnerPicker.append(button);
  }
}

pointButton.addEventListener('click', openPanel);
$('gift-close').addEventListener('click', () => { panel.hidden = true; lockScroll(); });

// ポップアップを開いているあいだは、後ろのごはん記録が動かないようにする。
// iOSでは body に overflow: hidden を付けるだけでは止まらないので、
// 位置ごと固定して、閉じたときに元の高さへ戻す
let scrollBeforeLock = 0;

function lockScroll() {
  const open = !panel.hidden || !gachaPanel.hidden || !news.hidden;
  const locked = document.body.classList.contains('modal-open');
  if (open === locked) return;

  if (open) {
    scrollBeforeLock = window.scrollY;
    document.body.style.top = `-${scrollBeforeLock}px`;
    document.body.classList.add('modal-open');
  } else {
    document.body.classList.remove('modal-open');
    document.body.style.top = '';
    window.scrollTo(0, scrollBeforeLock);
  }
}

async function openPanel() {
  panel.hidden = false;
  lockScroll();
  closeGiftForm();
  await loadGiftItems();
}

// ---------- ガチャ ----------

gachaOpen.addEventListener('click', () => {
  gachaPanel.hidden = false;
  gachaOpen.setAttribute('aria-pressed', 'true');
  showGacha();
  lockScroll();
});

$('gacha-close').addEventListener('click', () => {
  gachaPanel.hidden = true;
  gachaOpen.setAttribute('aria-pressed', 'false');
  lockScroll();
});

// 出るものの一覧。当たりの表から作るので、中身を変えるのは GACHA_PRIZES だけでよい
function showLegend() {
  if (gachaLegend.children.length) return;
  for (const prize of GACHA_PRIZES) {
    const row = document.createElement('li');
    const face = document.createElement('span');
    face.className = 'face';
    face.textContent = prize.face;
    row.append(face, String(prize.points));
    row.setAttribute('aria-label', `${prize.points} ポイント`);
    gachaLegend.appendChild(row);
  }
}

// 今日もう引いたかは、ポイントの記録（slot が 'gacha' の行）で分かる。
// 同じ日に2回入らないよう、表でも (user_id, claim_day, slot) が一意になっている
function showGacha() {
  const canPlay = GACHA_USERS.includes(names.get(me?.id) ?? '');
  gachaOpen.hidden = !canPlay;
  if (!canPlay) {
    gachaPanel.hidden = true;
    return;
  }
  showLegend();

  const done = claimedToday.has('gacha');
  gachaDraw.disabled = done;
  gachaDraw.textContent = done ? 'おしまい' : '🎁 今日のガチャを引く';
  gachaText.textContent = done ? 'また明日♪' : '';
  gachaResult.classList.toggle('done', done);
  resetGachaEffect();
}

// 演出を最初の状態に戻す（閉じて開き直したときに残らないように）
function resetGachaEffect() {
  gachaGift.textContent = '🎁';
  gachaGift.className = 'gacha-box';
  gachaBurst.textContent = '';
  gachaNote.classList.remove('show');
  gachaBox.classList.remove('jackpot');
  gachaResult.classList.remove('win', 'jackpot');
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

// 箱からキラキラをはじけさせる。当たりが大きいほど数も距離も増やす
function burst(big) {
  const colors = ['#ffd45e', '#ff9ec0', '#7ec8e3', '#9be38f', '#ffb066'];
  const count = big ? 30 : 14;
  gachaBurst.textContent = '';
  for (let i = 0; i < count; i += 1) {
    const spark = document.createElement('span');
    spark.className = 'spark';
    const angle = (Math.PI * 2 * i) / count + Math.random() * 0.4;
    const distance = (big ? 82 : 58) + Math.random() * (big ? 48 : 28);
    spark.style.setProperty('--x', `${Math.round(Math.cos(angle) * distance)}px`);
    spark.style.setProperty('--y', `${Math.round(Math.sin(angle) * distance)}px`);
    spark.style.animationDuration = `${(big ? 900 : 650) + Math.round(Math.random() * 350)}ms`;
    if (big && i % 4 === 0) {
      // 大当たりのときだけ、粒にまじってクラッカーも飛ばす
      spark.classList.add('emoji');
      spark.textContent = i % 8 === 0 ? '🎉' : '✨';
    } else {
      spark.style.background = colors[i % colors.length];
      if (big) spark.classList.add('big');
    }
    gachaBurst.appendChild(spark);
  }
  setTimeout(() => { gachaBurst.textContent = ''; }, big ? 1800 : 1300);
}

function drawPrize() {
  const totalWeight = GACHA_PRIZES.reduce((sum, prize) => sum + prize.weight, 0);
  let hit = Math.random() * totalWeight;
  for (const prize of GACHA_PRIZES) {
    hit -= prize.weight;
    if (hit < 0) return prize;
  }
  return GACHA_PRIZES[0];
}

gachaDraw.addEventListener('click', async () => {
  gachaDraw.disabled = true;
  resetGachaEffect();
  gachaResult.classList.remove('done');
  gachaText.textContent = 'なにが出るかな…';
  gachaResult.classList.add('done');

  // 当たりの絵をぐるぐる回す。すぐ結果が返っても、この間だけは必ず回す
  const faces = GACHA_PRIZES.map((prize) => prize.face);
  let step = 0;
  gachaGift.classList.add('spin');
  const spin = setInterval(() => {
    step += 1;
    gachaGift.textContent = faces[step % faces.length];
  }, 110);
  const startedAt = Date.now();

  const day = currentSlot().day;
  const prize = drawPrize();
  const gained = prize.points;
  const { error } = await supabase.from('points').insert({
    kind: 'gacha', amount: gained, claim_day: day, slot: 'gacha',
  });

  // 一瞬で終わると引いた気がしないので、1秒は回す
  await sleep(Math.max(0, 1000 - (Date.now() - startedAt)));
  clearInterval(spin);
  gachaGift.classList.remove('spin');
  gachaGift.textContent = '🎁';

  // 23505 は、その日のぶんをもう引いてあるとき（別の端末で引いた場合など）
  if (error && error.code === '23505') {
    claimedToday.add('gacha');
    await refreshTotal();
    gachaDraw.disabled = true;
    gachaDraw.textContent = 'おしまい';
    gachaText.textContent = '今日のぶんは、もう引いてあります。';
    gachaResult.classList.add('done');
    return;
  }

  if (error) {
    console.error(error);
    gachaText.textContent = '引けませんでした。開き直してから試してください。';
    gachaResult.classList.add('done');
    gachaDraw.disabled = false;
    return;
  }

  claimedToday.add('gacha');
  setTotal(total + gained);

  // だんだん遅くしてから当たりの絵で止める → キラキラ → 数字、の順に見せる
  const big = gained >= 100;
  for (const wait of [150, 210, 290, 380]) {
    step += 1;
    gachaGift.textContent = faces[step % faces.length];
    await sleep(wait);
  }
  gachaGift.textContent = prize.face;
  gachaGift.classList.add('pop');
  burst(big);
  if (big) gachaBox.classList.add('jackpot');
  await sleep(260);
  // ここで初めて「なにが出るかな…」と入れ替える
  gachaResult.classList.remove('done');
  if (big) {
    // 1行に収まらず変なところで折り返すので、大当たりは2行に分けて出す
    gachaText.textContent = '';
    gachaText.append(
      `${prize.face} 大当たり！`, document.createElement('br'), `${gained} ポイント`,
    );
  } else {
    gachaText.textContent = `${prize.face} ＋${gained} ポイント`;
  }
  gachaResult.classList.add(big ? 'jackpot' : 'win');
  // 当たりを見せてから、その日のぶんが終わったことを伝える
  gachaDraw.textContent = 'おしまい';
  gachaNote.classList.add('show');
});

async function loadGiftItems() {
  const { data, error } = await supabase
    .from('gift_items').select('*').order('cost', { ascending: true });

  if (error) {
    console.error(error);
    return;
  }

  // プレゼントは相手ごとに用意する（partner_id が「誰に向けたものか」）。
  // 相手のぶんは RLS で自分向けのものしか届かない
  const mine = data.filter((item) => item.user_id === me.id && item.partner_id === partner?.id);
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
  // 自分が用意したものと見分けられるよう、相手のぶんには色を付ける
  row.classList.add('theirs');

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
      if (!partner) throw new Error('あげる相手がまだいません。');
      const { error } = await supabase
        .from('gift_items').insert({ ...values, partner_id: partner.id });
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
  lockScroll();
}

$('gift-news-close').addEventListener('click', async () => {
  news.hidden = true;
  lockScroll();
  if (unseen.length === 0) return;

  const ids = unseen.map((row) => row.id);
  unseen = [];
  const { error } = await supabase
    .from('gifts').update({ seen_at: new Date().toISOString() }).in('id', ids).select();
  if (error) console.error(error);
});
