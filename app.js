import { supabase } from './supabase.js';
import { shrinkImage } from './image.js';
import { loadIngredients, clearIngredients } from './ingredients.js';
import { loadPlaces, clearPlaces, loadPlaceOptions } from './places.js';
import { loadChats, clearChats, refreshChatDot, openAskForm } from './chat.js';
import { loadPoints, clearPoints, setHomeScreen, checkMealBonus, setGiftPartner, setOtherPanel } from './points.js';

const BUCKET = 'meal-photos';
const MEAL_LABELS = { breakfast: '朝', lunch: '昼', dinner: '夜', snack: '間食' };
const SIGNED_URL_SECONDS = 60 * 60;

// 自分の投稿に自分で付ける印。うまくできた記録をあとから見返すため。
// 相手には見えない置き方にせず、ボタンを出すのは本人のカードだけにする
const FAVORITE = {
  kind: 'favorite',
  label: 'お気に入り',
  path: 'M12 2.4l2.9 6 6.6.9-4.8 4.7 1.1 6.6L12 17.5l-5.8 3.1 1.1-6.6L2.5 9.3l6.6-.9z',
};

// 相手の投稿に押せるボタン。自分の投稿には出さず、押してもらった分だけ文字で出す
const REACTIONS = [
  {
    kind: 'like',
    label: 'いいね',
    told: 'がいいね',
    path: 'M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3'
      + 'c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5'
      + 'c0 3.78-3.4 6.86-8.55 11.54L12 21.35z',
  },
  {
    kind: 'yummy',
    label: 'おいしそう',
    told: 'が「おいしそう」',
    // にこにこ顔。点のような目は、線の端を丸くして短い線で描く
    path: 'M21 12a9 9 0 11-18 0 9 9 0 0118 0'
      + ' M9 10h.01 M15 10h.01'
      + ' M8.4 14.4c.9 1.2 2.1 1.9 3.6 1.9s2.7-.7 3.6-1.9',
  },
  {
    kind: 'recipe',
    label: 'レシピが知りたい',
    told: 'がレシピを知りたがっています',
    path: 'M12 7c-1.7-1.4-3.9-2-6-2-1 0-2 .15-3 .45v12.1c1-.3 2-.45 3-.45'
      + ' 2.1 0 4.3.6 6 2 1.7-1.4 3.9-2 6-2 1 0 2 .15 3 .45V5.45c-1-.3-2-.45-3-.45'
      + ' -2.1 0-4.3.6-6 2zm0 0v12',
  },
];

const $ = (id) => document.getElementById(id);

const loginScreen = $('screen-login');
const appScreen = $('screen-app');
const loginForm = $('login-form');
const loginButton = $('login-button');
const loginError = $('login-error');
const passwordInput = $('password');

const openFormButton = $('open-form-button');
const mealForm = $('meal-form');
const mealFormTitle = $('meal-form-title');
const photoInput = $('photo');
const photoPreview = $('photo-preview');
const photoHint = $('photo-hint');
const eatenAtInput = $('eaten-at');
const placeInput = $('place');
const noteInput = $('note');
const diaryInput = $('diary');
const saveButton = $('save-button');
const formError = $('form-error');
const timeline = $('timeline');
const timelineStatus = $('timeline-status');
const timelineEmpty = $('timeline-empty');
const favoriteList = $('favorite-list');
const favoriteStatus = $('favorite-status');
const favoriteEmpty = $('favorite-empty');
const favoriteMore = $('favorite-more');
const albumGrid = $('album-grid');
const albumStatus = $('album-status');
const albumEmpty = $('album-empty');
const albumMore = $('album-more');
const weekRange = $('week-range');
const prevWeekButton = $('prev-week');
const nextWeekButton = $('next-week');
const thisWeekButton = $('this-week');

let currentUser = null;
let displayNames = new Map();
// 共有する相手。hana ともう一人は eri だけ、eri は2人いるので切り替えて使う
let partnerIds = [];
let activePartner = null;
let editingMeal = null;
// 表示中の週の月曜0時。1週間ぶんだけ読み込むことで、通信量を抑える
let weekStart = startOfWeek(new Date());

// ---------- 表示用のヘルパー ----------

const dateFormatter = new Intl.DateTimeFormat('ja-JP', {
  month: 'numeric', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit',
});

function toInputValue(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
    + `T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// ---------- 週の計算 ----------

// その日が属する週の月曜0時を返す。日曜は前の月曜に寄せる
function startOfWeek(date) {
  const monday = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const shift = (monday.getDay() + 6) % 7; // 月=0 … 日=6
  monday.setDate(monday.getDate() - shift);
  return monday;
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function formatDot(date) {
  return `${date.getFullYear()}.${date.getMonth() + 1}.${date.getDate()}`;
}

function showError(element, message) {
  element.textContent = message;
  element.hidden = false;
}

function showStatus(message) {
  timelineStatus.textContent = message;
  timelineEmpty.hidden = false;
}

// ---------- ごはん / 食材の切り替え ----------

const ingredientToggle = $('ingredient-toggle');
const chatToggle = $('chat-open');
const loadedViews = new Set();
let activeView = 'meals';

// 冷蔵庫は食材リストを開くだけ。戻るのはお茶碗のほうの役目
ingredientToggle.addEventListener('click', () => showView('ingredients'));

// タイトルがごはんの画面へ戻るボタン。どの画面からでも押せる
$('home-button').addEventListener('click', () => showView('meals'));

// ★を付けた記録だけの画面。戻るのは食材リストと同じお茶碗
$('favorite-open').addEventListener('click', () => showView('favorites'));

// 写真だけを並べるアルバム
$('album-open').addEventListener('click', () => showView('album'));

// 外食したお店。2人で共有して見られる
$('place-open').addEventListener('click', () => showView('places'));

// そうだん。食材リストの吹き出しから開く。
// 食材リストへはヘッダーの冷蔵庫、ごはんへは見出しのお茶碗で戻る
chatToggle.addEventListener('click', () => showView('chat'));

// 食材の行の吹き出しを押したとき。その食材のことを聞く形で開く
document.addEventListener('ask-ingredient', (event) => {
  showView('chat');
  openAskForm(event.detail);
});

function showView(view) {
  activeView = view;
  updatePartnerPicker();
  ingredientToggle.setAttribute('aria-pressed', String(view === 'ingredients'));
  // 開いている画面のアイコンに色を付ける（冷蔵庫と吹き出しで同じ見た目）
  chatToggle.setAttribute('aria-pressed', String(view === 'chat'));
  // キラキラはごはんの画面にだけ出す
  setHomeScreen(view === 'meals');
  $('view-meals').hidden = view !== 'meals';
  $('view-ingredients').hidden = view !== 'ingredients';
  $('view-favorites').hidden = view !== 'favorites';
  $('view-album').hidden = view !== 'album';
  $('view-places').hidden = view !== 'places';
  $('view-chat').hidden = view !== 'chat';

  // 一度読んだ画面は読み直さない。切り替えるたびに通信するのはもったいない。
  // ただし、そうだんだけは開くたびに読み直す。
  // 新しい返事に気づけないと意味がないうえ、文字だけなので軽い
  if (currentUser && (view === 'chat' || !loadedViews.has(view))) reloadActiveView();
}

async function reloadActiveView() {
  loadedViews.add(activeView);
  if (activeView === 'meals') await loadTimeline();
  else if (activeView === 'favorites') await loadFavorites();
  else if (activeView === 'album') await loadAlbum();
  else if (activeView === 'places') await loadPlaces(currentUser.id, displayNames, sharedIds());
  else if (activeView === 'chat') await loadChats(currentUser.id, displayNames, activePartner);
  else await loadIngredients();
}

// ---------- 共有する相手 ----------

const partnerPicker = $('partner-picker');

// 同じ輪にいる人たちは、ごはん記録をまとめて並べる。
// partners は自分の行しか読めず「誰と誰が組んでいるか」は分からないので、ここに表示名で持つ。
// 人を足すときは、その人が入る輪にも名前を足すこと
const CIRCLES = [
  ['eri', 'hana', 'mihoko'],
  ['eri', 'minami'],
];

// 自分と、いま選んでいる相手。同じ輪にほかの人がいれば、その人のぶんも一緒に出す
// （eri が hana を選ぶと、mihoko のぶんも同じタイムラインに並ぶ）。
// タイムライン・アルバム・お店・いいねは、ここで返す人のぶんだけ読む
function sharedIds() {
  if (!activePartner) return [currentUser.id];

  const myName = displayNames.get(currentUser.id);
  const partnerName = displayNames.get(activePartner);
  const circle = CIRCLES.find((names) => names.includes(myName) && names.includes(partnerName));
  if (!circle) return [currentUser.id, activePartner];

  // 名前が輪に入っていても、実際に組んでいない人のぶんは読めないので混ぜない
  const others = partnerIds.filter((id) => circle.includes(displayNames.get(id)));
  return [currentUser.id, ...new Set([activePartner, ...others])];
}

async function loadPartners() {
  const { data, error } = await supabase.from('partners').select('partner_id');
  if (error) console.error(error);
  partnerIds = (data ?? []).map((row) => row.partner_id);

  // 前に選んでいた相手を覚えておく。端末ごと・ログインした人ごとに持つ
  let saved = null;
  try {
    saved = localStorage.getItem(`partner:${currentUser.id}`);
  } catch (error) { /* 使えなくても、いちばん人数の多い輪になるだけ */ }
  activePartner = partnerIds.includes(saved) ? saved : biggestCirclePartner();

  renderPartnerPicker();
}

// 何も選んでいないときは、いちばん人数の多い輪の相手にする。
// eri が開いたとき、切り替えなしで3人ぶん（eri・hana・mihoko）が出るようにするため
function biggestCirclePartner() {
  const myName = displayNames.get(currentUser.id);
  let best = null;
  let bestSize = 0;

  for (const id of partnerIds) {
    const name = displayNames.get(id);
    const circle = CIRCLES.find((names) => names.includes(myName) && names.includes(name));
    const size = circle ? circle.length : 2;
    if (size > bestSize) {
      best = id;
      bestSize = size;
    }
  }
  return best;
}

// どの輪の人かを返す。同じ輪の相手しかいない人（hana・mihoko）は、
// 切り替えてもごはん記録の中身が変わらない
function circleOf(partnerId) {
  const myName = displayNames.get(currentUser?.id);
  const name = displayNames.get(partnerId);
  return CIRCLES.findIndex((names) => names.includes(myName) && names.includes(name));
}

// ごはんの画面に切り替えを出すのは、輪が2つ以上ある人（eri）だけ。
// hana・mihoko は切り替えても同じ3人ぶんなので、ホームには出さない。
// そうだんは宛先が変わるので、その画面ではみんなに出す
function updatePartnerPicker() {
  const manyCircles = new Set(partnerIds.map(circleOf)).size > 1;
  partnerPicker.hidden = partnerIds.length < 2 || (!manyCircles && activeView !== 'chat');
}

// 相手が2人以上いる人だけ、切り替えボタンを作る
function renderPartnerPicker() {
  partnerPicker.replaceChildren();
  updatePartnerPicker();
  if (partnerIds.length < 2) return;

  const label = document.createElement('span');
  label.className = 'partner-label';
  label.textContent = '共有する相手';
  partnerPicker.append(label);

  for (const id of partnerIds) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'theme-option partner-option';
    button.dataset.partner = id;
    button.setAttribute('aria-pressed', String(id === activePartner));
    button.textContent = displayNames.get(id) ?? '相手';

    // その相手からの新しい書き込みがあると、ここにも赤い丸が付く
    const dot = document.createElement('span');
    dot.className = 'dot';
    dot.hidden = true;
    button.append(dot);

    button.addEventListener('click', () => setPartner(id));
    partnerPicker.append(button);
  }
}

function setPartner(id) {
  if (id === activePartner) return;
  activePartner = id;
  try {
    localStorage.setItem(`partner:${currentUser.id}`, id);
  } catch (error) { /* 保存できなくても、その場の切り替えは効く */ }

  for (const button of partnerPicker.querySelectorAll('.partner-option')) {
    button.setAttribute('aria-pressed', String(button.dataset.partner === id));
  }
  setGiftPartner(id);

  // 相手が変わると中身が変わるので、読んだ画面の記憶を捨てて読み直す
  loadedViews.clear();
  reloadActiveView();
}

// ---------- 見た目の切り替え ----------

const themeOptions = [...document.querySelectorAll('.theme-option')];
const themeToggle = $('theme-toggle');
const themePicker = $('theme-picker');

// ふだんは畳んでおく。押すと4つの見た目が出る
themeToggle.addEventListener('click', () => {
  themePicker.hidden = !themePicker.hidden;
  themeToggle.setAttribute('aria-expanded', String(!themePicker.hidden));
});
const themeColor = document.querySelector('meta[name="theme-color"]');
const THEME_COLORS = { simple: '#e07a3f', adult: '#b2727f', cute: '#f0a8bd', aquarium: '#8cc4e0', zoo: '#c9a77e', dark: '#1a1a1c' };

for (const option of themeOptions) {
  option.addEventListener('click', () => setTheme(option.dataset.theme));
}

function setTheme(theme) {
  // simple は既定の見た目。data-theme を付けない状態がそれにあたる
  if (theme === 'simple') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;

  for (const option of themeOptions) {
    option.setAttribute('aria-pressed', String(option.dataset.theme === theme));
  }
  themeColor.setAttribute('content', THEME_COLORS[theme]);

  try {
    localStorage.setItem('theme', theme);
  } catch (error) { /* 保存できなくても、その場の切り替えは効く */ }
}

// 読み込み時点の見た目（head の script が当てたもの）にボタンを合わせる
setTheme(THEME_COLORS[document.documentElement.dataset.theme] ? document.documentElement.dataset.theme : 'simple');

// ホーム画面に追加して使えるようにする（PWA）
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch((error) => console.error(error));
}

// ---------- ログイン ----------

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  loginError.hidden = true;
  loginButton.disabled = true;
  loginButton.textContent = 'ログイン中…';

  const { error } = await supabase.auth.signInWithPassword({
    email: $('email').value.trim(),
    password: passwordInput.value,
  });

  loginButton.disabled = false;
  loginButton.textContent = 'ログイン';

  if (error) {
    showError(loginError, 'ログインできませんでした。メールアドレスとパスワードを確認してください。');
    console.error(error);
  }
});

// 絵だけのボタンなので、うっかり押したときのために一度たずねる
$('logout-button').addEventListener('click', () => {
  if (!confirm('ログアウトしますか？ 次に開くときは、メールアドレスとパスワードが必要です。')) return;
  supabase.auth.signOut();
});

// ---------- パスワードを変える ----------
// ログイン中の人が、自分のパスワードだけを変えられる。
// Supabaseのダッシュボードやメールのリンクを使わずに済むようにするためのもの
const passwordPanel = $('password-panel');
const passwordForm = $('password-form');
const passwordNew = $('password-new');
const passwordAgain = $('password-again');
const passwordError = $('password-error');
const passwordDone = $('password-done');
const passwordSave = $('password-save');

function openPasswordPanel() {
  passwordForm.reset();
  passwordError.hidden = true;
  passwordDone.hidden = true;
  passwordSave.disabled = false;
  passwordSave.textContent = '保存';
  passwordPanel.hidden = false;
  setOtherPanel(true);
  passwordNew.focus();
}

function closePasswordPanel() {
  passwordPanel.hidden = true;
  // 入力はそのままにしない。閉じたら消す
  passwordForm.reset();
  setOtherPanel(false);
}

$('password-open').addEventListener('click', openPasswordPanel);
$('password-close').addEventListener('click', closePasswordPanel);
$('password-cancel').addEventListener('click', closePasswordPanel);

passwordForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  passwordError.hidden = true;
  passwordDone.hidden = true;

  const next = passwordNew.value;
  if (next.length < 6) {
    showError(passwordError, 'パスワードは6文字以上にしてください。');
    return;
  }
  if (next !== passwordAgain.value) {
    showError(passwordError, '2つの欄が同じになっていません。もう一度入れてください。');
    return;
  }

  passwordSave.disabled = true;
  passwordSave.textContent = '保存中…';
  const { error } = await supabase.auth.updateUser({ password: next });
  passwordSave.disabled = false;
  passwordSave.textContent = '保存';

  if (error) {
    console.error(error);
    showError(passwordError, '変えられませんでした。少し時間をおいて、もう一度お試しください。');
    return;
  }

  passwordForm.reset();
  passwordDone.hidden = false;
});

// ---------- 下に引っぱって更新 ----------
// ホーム画面から開いたアプリには、ブラウザの「引っぱって更新」が無い。
// 開き直さなくても新しい記録（とアプリの新しい版）が届くよう、自前で用意する。
// 更新はページごと読み直す。見ていた画面は覚えておいて、読み直したあとに戻す

// これだけ引っぱったら、離したときに更新する（px）。70では軽すぎて、うっかり更新しやすかった
const PULL_READY = 110;
const pullBox = $('pull-refresh');
const pullText = $('pull-text');
let pullStart = null;
let pullDistance = 0;

// 書きかけの入力や開いているポップアップがあるときは更新しない。読み直すと消えてしまう
function pullBlocked() {
  if (appScreen.hidden) return true;
  if ([...document.querySelectorAll('.overlay')].some((el) => !el.hidden)) return true;
  return [...document.querySelectorAll('input, textarea')].some((el) => {
    if (el.offsetParent === null) return false; // 隠れている欄は見ない
    if (el.type === 'file') return el.files.length > 0;
    if (el.type === 'radio' || el.type === 'checkbox') return el.checked !== el.defaultChecked;
    return el.value !== el.defaultValue;
  });
}

function hidePull() {
  pullBox.classList.remove('pulling', 'ready');
  pullBox.style.transform = '';
}

window.addEventListener('touchstart', (event) => {
  pullStart = null;
  if (window.scrollY > 0 || event.touches.length !== 1 || pullBlocked()) return;
  pullStart = event.touches[0].clientY;
  pullDistance = 0;
}, { passive: true });

window.addEventListener('touchmove', (event) => {
  if (pullStart === null) return;
  pullDistance = event.touches[0].clientY - pullStart;
  // 上へ戻した、または途中からふつうのスクロールになったときは案内を引っこめる
  if (pullDistance <= 0 || window.scrollY > 0) {
    hidePull();
    return;
  }
  const ready = pullDistance >= PULL_READY;
  pullBox.classList.add('pulling');
  pullBox.classList.toggle('ready', ready);
  pullText.textContent = ready ? '離すと更新' : '引っぱって更新';
  // 指の動きの半分より少なめに下ろす。引っぱる手ごたえが出る
  pullBox.style.transform = `translate(-50%, ${Math.min(pullDistance / 2.2, 50) - 40}px)`;
}, { passive: true });

window.addEventListener('touchend', () => {
  if (pullStart === null) return;
  pullStart = null;
  if (pullDistance < PULL_READY) {
    hidePull();
    return;
  }
  pullText.textContent = '更新中…';
  try {
    sessionStorage.setItem('pull-view', activeView);
  } catch (error) { /* 覚えられなくても、ごはんの画面で開くだけ */ }
  location.reload();
});

window.addEventListener('touchcancel', () => {
  pullStart = null;
  hidePull();
});

// 引っぱって更新したあとは、見ていた画面に戻す
try {
  const view = sessionStorage.getItem('pull-view');
  sessionStorage.removeItem('pull-view');
  if (['meals', 'ingredients', 'favorites', 'album', 'places', 'chat'].includes(view)) showView(view);
} catch (error) { /* 使えないときは、ごはんの画面のまま */ }

supabase.auth.onAuthStateChange((_event, session) => {
  // コールバック内で直接awaitすると固まることがあるため、処理を外に出す
  setTimeout(() => handleSession(session), 0);
});

// 画面に戻ってきたら、切れかけのログインと期限つき写真URLを作り直す。
// これがないと、開きっぱなしのまま1時間経ったときに
// 「写真が出ない」「削除や編集が黙って失敗する」が起きる。
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && currentUser) refreshSession();
});

async function refreshSession() {
  const { data } = await supabase.auth.getSession();
  await handleSession(data.session);
}

async function handleSession(session) {
  if (!session) {
    currentUser = null;
    appScreen.hidden = true;
    loginScreen.hidden = false;
    passwordInput.value = '';
    timeline.replaceChildren();
    clearIngredients();
    clearPlaces();
    clearChats();
    clearPoints();
    loadedViews.clear();
    partnerIds = [];
    activePartner = null;
    partnerPicker.hidden = true;
    return;
  }

  currentUser = session.user;
  loginScreen.hidden = true;
  appScreen.hidden = false;

  const { data, error } = await supabase.from('profiles').select('id, display_name');
  if (error) console.error(error);
  displayNames = new Map((data ?? []).map((row) => [row.id, row.display_name]));

  const myName = displayNames.get(currentUser.id) ?? currentUser.email;
  $('greeting').textContent = `${myName} さんとして記録中`;

  await loadPartners();

  // ポイントや吹き出しの丸でつまずいても、ごはん記録は必ず出す。
  // ここで止まると、投稿も日付も出ない真っ白な画面になってしまう
  try {
    await loadPoints(currentUser, displayNames, activePartner, partnerIds, setPartner);
  } catch (error) { console.error(error); }

  // 相手からの新しい書き込みがあれば、冷蔵庫に小さな丸を出す
  try {
    await refreshChatDot(currentUser.id, partnerIds);
  } catch (error) { console.error(error); }

  // 開いている画面だけ読み直す。裏の画面まで毎回読むと通信が増える
  await reloadActiveView();
}

// ---------- 投稿フォーム ----------

openFormButton.addEventListener('click', () => openForm(null));
$('cancel-button').addEventListener('click', closeForm);

function openForm(meal) {
  editingMeal = meal;
  mealForm.reset();
  // 登録したお店から選べるようにする。名前だけなので通信はごく軽い
  loadPlaceOptions(sharedIds());
  formError.hidden = true;
  photoPreview.hidden = true;
  photoHint.hidden = true;

  if (meal) {
    mealFormTitle.textContent = '記録を編集';
    photoHint.textContent = meal.photo_path
      ? '写真を選ばなければ、今の写真のままになります。'
      : '写真なしの記録です。ここで追加できます。';
    photoHint.hidden = false;
    mealForm.querySelector('input[value="' + meal.meal_type + '"]').checked = true;
    eatenAtInput.value = toInputValue(new Date(meal.eaten_at));
    placeInput.value = meal.place ?? '';
    noteInput.value = meal.note ?? '';
    diaryInput.value = meal.diary ?? '';
  } else {
    mealFormTitle.textContent = '食事を記録';
    photoHint.textContent = '写真なしでも記録できます。';
    photoHint.hidden = false;
    eatenAtInput.value = toInputValue(new Date());
  }

  mealForm.hidden = false;
  openFormButton.hidden = true;
  mealForm.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function closeForm() {
  editingMeal = null;
  mealForm.hidden = true;
  openFormButton.hidden = false;
  photoPreview.hidden = true;
}

photoInput.addEventListener('change', () => {
  const file = photoInput.files[0];
  if (!file) {
    photoPreview.hidden = true;
    return;
  }
  photoPreview.src = URL.createObjectURL(file);
  photoPreview.hidden = false;
});

mealForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  formError.hidden = true;
  saveButton.disabled = true;
  saveButton.textContent = '保存中…';

  try {
    const file = photoInput.files[0];
    let photoPath = editingMeal?.photo_path ?? null;

    if (file) {
      const blob = await shrinkImage(file);
      const path = `${currentUser.id}/${crypto.randomUUID()}.jpg`;
      const { error } = await supabase.storage
        .from(BUCKET)
        .upload(path, blob, { contentType: 'image/jpeg' });
      if (error) throw error;
      photoPath = path;
    }

    const values = {
      photo_path: photoPath,
      place: placeInput.value.trim() || null,
      note: noteInput.value.trim() || null,
      diary: diaryInput.value.trim() || null,
      eaten_at: new Date(eatenAtInput.value).toISOString(),
      meal_type: mealForm.elements.meal_type.value,
    };

    if (editingMeal) {
      const oldPath = editingMeal.photo_path;
      // .select() を付けて、実際に何件更新されたかを確認する。
      // RLSは権限がない場合もログインが切れている場合もエラーを返さず0件を返すため、
      // これがないと失敗に気づけない。
      const { data, error } = await supabase.from('meals').update(values).eq('id', editingMeal.id).select();
      if (error) throw error;
      if (data.length === 0) throw new Error('ログインの有効期限が切れている可能性があります。ログインし直してください。');
      // 写真を差し替えたときは、古い写真を消して容量を節約する
      if (file && oldPath && oldPath !== photoPath) {
        await supabase.storage.from(BUCKET).remove([oldPath]);
      }
    } else {
      const { error } = await supabase.from('meals').insert(values);
      if (error) throw error;
    }

    closeForm();
    // 別の週の日付で保存したときは、その記録が見える週に移動する
    weekStart = startOfWeek(new Date(values.eaten_at));
    await loadTimeline();
    // その日の朝・昼・夜がそろったらボーナス
    await checkMealBonus(new Date(values.eaten_at));
  } catch (error) {
    console.error(error);
    showError(formError, `保存できませんでした：${error.message ?? error}`);
  } finally {
    saveButton.disabled = false;
    saveButton.textContent = '保存';
  }
});

// ---------- 週の切り替え ----------

prevWeekButton.addEventListener('click', () => showWeek(addDays(weekStart, -7)));
nextWeekButton.addEventListener('click', () => showWeek(addDays(weekStart, 7)));
thisWeekButton.addEventListener('click', () => showWeek(startOfWeek(new Date())));

function showWeek(start) {
  weekStart = start;
  loadTimeline();
}

function updateWeekLabel() {
  const end = addDays(weekStart, 6);
  weekRange.textContent = `${formatDot(weekStart)} 〜 ${formatDot(end)}`;

  // 未来の週には進めない
  const thisWeek = startOfWeek(new Date());
  const isThisWeek = weekStart.getTime() === thisWeek.getTime();
  nextWeekButton.disabled = isThisWeek;
  thisWeekButton.hidden = isThisWeek;
}

// ---------- タイムライン ----------

async function loadTimeline() {
  updateWeekLabel();
  showStatus('読み込み中…');

  // 期限が切れていればここでトークンが更新される
  await supabase.auth.getSession();

  const weekEnd = addDays(weekStart, 7);
  const { data: meals, error } = await supabase
    .from('meals')
    .select('*')
    .in('user_id', sharedIds())
    .gte('eaten_at', weekStart.toISOString())
    .lt('eaten_at', weekEnd.toISOString())
    .order('eaten_at', { ascending: false });

  if (error) {
    console.error(error);
    showStatus('読み込めませんでした。');
    return;
  }

  if (meals.length === 0) {
    timeline.replaceChildren();
    showStatus('この週の記録はまだありません。');
    return;
  }

  const urls = await signedUrlsFor(meals.map((meal) => meal.photo_path).filter(Boolean));
  await loadReactions(meals.map((meal) => meal.id));

  timelineEmpty.hidden = true;
  timeline.replaceChildren(...meals.map((meal) => renderMeal(meal, urls.get(meal.photo_path))));
}

// 非公開バケットなので、表示には期限つきのURLを発行する。
// 発行するたびにURLが変わり、ブラウザが写真を毎回ダウンロードし直してしまうので、
// 一度作ったURLは期限が来るまで使い回す。週を行き来しても通信が増えない。
const signedUrlCache = new Map(); // photo_path -> { url, expiresAt }

async function signedUrlsFor(paths) {
  const now = Date.now();
  const missing = paths.filter((path) => {
    const hit = signedUrlCache.get(path);
    return !hit || hit.expiresAt <= now;
  });

  if (missing.length > 0) {
    const { data: signed, error } = await supabase.storage
      .from(BUCKET)
      .createSignedUrls(missing, SIGNED_URL_SECONDS);
    if (error) console.error(error);
    // 期限ぎりぎりのURLを掴まないよう、5分早めに切れる扱いにする
    const expiresAt = now + (SIGNED_URL_SECONDS - 300) * 1000;
    for (const item of signed ?? []) {
      if (item.signedUrl) signedUrlCache.set(item.path, { url: item.signedUrl, expiresAt });
    }
  }

  return new Map(paths.map((path) => [path, signedUrlCache.get(path)?.url]));
}

// ---------- アルバム ----------

// 写真は1枚ずつ通信するので、一度に並べる数は控えめにする
const ALBUM_PAGE = 18;
let albumCount = 0;

albumMore.addEventListener('click', () => loadAlbum(true));

async function loadAlbum(more = false) {
  if (!more) {
    albumCount = 0;
    albumGrid.replaceChildren();
  }
  albumMore.hidden = true;
  albumStatus.textContent = '読み込み中…';
  albumEmpty.hidden = false;

  // 期限が切れていればここでトークンが更新される
  await supabase.auth.getSession();

  // 写真のある記録だけ。2人ぶんが新しい順に並ぶ
  const { data: meals, error } = await supabase
    .from('meals')
    .select('id, user_id, photo_path, note, eaten_at')
    .in('user_id', sharedIds())
    .not('photo_path', 'is', null)
    .order('eaten_at', { ascending: false })
    .range(albumCount, albumCount + ALBUM_PAGE - 1);

  if (error) {
    console.error(error);
    albumStatus.textContent = '読み込めませんでした。';
    return;
  }

  if (meals.length === 0 && albumCount === 0) {
    albumStatus.textContent = 'まだ写真つきの記録はありません。';
    return;
  }

  const urls = await signedUrlsFor(meals.map((meal) => meal.photo_path));
  albumGrid.append(...meals.map((meal) => renderTile(meal, urls.get(meal.photo_path))));

  albumCount += meals.length;
  albumEmpty.hidden = true;
  albumMore.hidden = meals.length < ALBUM_PAGE;
}

function renderTile(meal, photoUrl) {
  const when = new Date(meal.eaten_at);
  const tile = document.createElement('button');
  tile.type = 'button';
  tile.className = 'album-tile';
  tile.title = `${displayNames.get(meal.user_id) ?? '不明'}・${dateFormatter.format(when)}`;

  const image = document.createElement('img');
  image.loading = 'lazy';
  image.alt = meal.note || tile.title;
  if (photoUrl) image.src = photoUrl;
  tile.append(image);

  // 押すと、その日の週のタイムラインへ移る
  tile.addEventListener('click', () => {
    weekStart = startOfWeek(when);
    showView('meals');
    loadTimeline();
  });
  return tile;
}

// ---------- お気に入り ----------

// 一度に読む量。写真の通信を増やしすぎないよう、少しずつ足していく
const FAVORITE_PAGE = 12;
let favoriteCount = 0;

favoriteMore.addEventListener('click', () => loadFavorites(true));

async function loadFavorites(more = false) {
  if (!more) {
    favoriteCount = 0;
    favoriteList.replaceChildren();
  }
  favoriteMore.hidden = true;
  favoriteStatus.textContent = '読み込み中…';
  favoriteEmpty.hidden = false;

  // 期限が切れていればここでトークンが更新される
  await supabase.auth.getSession();

  const { data: meals, error } = await supabase
    .from('meals')
    .select('*')
    .eq('user_id', currentUser.id)
    .eq('favorite', true)
    .order('eaten_at', { ascending: false })
    .range(favoriteCount, favoriteCount + FAVORITE_PAGE - 1);

  if (error) {
    console.error(error);
    favoriteStatus.textContent = '読み込めませんでした。';
    return;
  }

  if (meals.length === 0 && favoriteCount === 0) {
    favoriteStatus.textContent = 'まだ★を付けた記録はありません。';
    return;
  }

  const urls = await signedUrlsFor(meals.map((meal) => meal.photo_path).filter(Boolean));
  await loadReactions(meals.map((meal) => meal.id));
  favoriteList.append(...meals.map((meal) => renderMeal(meal, urls.get(meal.photo_path))));

  favoriteCount += meals.length;
  favoriteEmpty.hidden = true;
  // ちょうど読み切ったときも、次があるか分からないのでボタンは出しておく
  favoriteMore.hidden = meals.length < FAVORITE_PAGE;
}

// ---------- いいね / レシピが知りたい ----------

let reactions = new Map(); // meal_id -> [{ user_id, kind }]

async function loadReactions(mealIds) {
  if (mealIds.length === 0) {
    reactions = new Map();
    return;
  }

  const { data, error } = await supabase
    .from('meal_reactions')
    .select('meal_id, user_id, kind')
    .in('meal_id', mealIds);

  if (error) {
    console.error(error);
    reactions = new Map();
    return;
  }

  // 開き直したときなどは読み込みが2回重なることがある。
  // 共有の入れ物に直接足すと、2回分が混ざって「hana・hana さんがいいね」になるので、
  // 手元でまとめてから丸ごと入れ替える
  const next = new Map();
  for (const row of data) {
    if (!next.has(row.meal_id)) next.set(row.meal_id, []);
    next.get(row.meal_id).push(row);
  }
  reactions = next;
}

function makeIcon(type) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('reaction-icon');
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', type.path);
  svg.append(path);
  return svg;
}

function renderReactions(meal) {
  const box = document.createElement('div');
  box.className = 'reactions';
  const rows = reactions.get(meal.id) ?? [];
  const isMine = meal.user_id === currentUser.id;

  for (const type of REACTIONS) {
    const pressed = rows.filter((row) => row.kind === type.kind);

    if (isMine) {
      // 自分の投稿にはボタンを出さない。押してくれた人の名前だけ見せる
      const names = pressed
        .filter((row) => row.user_id !== currentUser.id)
        .map((row) => displayNames.get(row.user_id) ?? '不明');
      if (names.length === 0) continue;

      const note = document.createElement('p');
      note.className = 'reaction-note';
      note.dataset.kind = type.kind;
      note.append(makeIcon(type), document.createTextNode(`${names.join('・')} さん${type.told}`));
      box.append(note);
      continue;
    }

    const on = pressed.some((row) => row.user_id === currentUser.id);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'reaction';
    button.dataset.kind = type.kind;
    button.append(makeIcon(type), document.createTextNode(type.label));
    setReactionState(button, on);
    button.addEventListener('click', () => toggleReaction(meal, type.kind, button));
    box.append(button);
  }

  return box.childElementCount > 0 ? box : null;
}

function setReactionState(button, on) {
  button.classList.toggle('on', on);
  button.setAttribute('aria-pressed', String(on));
}

async function toggleReaction(meal, kind, button) {
  const on = button.classList.contains('on');
  button.disabled = true;

  try {
    if (on) {
      // 編集・削除と同じ理由で .select() を付け、0件なら失敗として扱う
      const { data, error } = await supabase
        .from('meal_reactions')
        .delete()
        .eq('meal_id', meal.id)
        .eq('user_id', currentUser.id)
        .eq('kind', kind)
        .select();
      if (error) throw error;
      if (data.length === 0) throw new Error('ログインの有効期限が切れているかもしれません。');
    } else {
      // user_id はSupabase側でログイン中の本人が入る
      const { error } = await supabase.from('meal_reactions').insert({ meal_id: meal.id, kind });
      // 23505 は「すでに押してある」。取り消しではないので成功扱いでよい
      if (error && error.code !== '23505') throw error;
    }
    setReactionState(button, !on);
  } catch (error) {
    console.error(error);
    alert(`うまくいきませんでした：${error.message ?? error}`);
    await refreshSession();
  } finally {
    button.disabled = false;
  }
}

// ---------- カードの組み立て ----------

function renderMeal(meal, photoUrl) {
  const card = document.createElement('article');
  card.className = 'card';

  if (meal.photo_path) {
    const image = document.createElement('img');
    image.className = 'photo';
    image.loading = 'lazy';
    image.alt = meal.note || '食事の写真';
    if (photoUrl) image.src = photoUrl;
    card.append(image);
  } else {
    card.classList.add('no-photo');
  }

  const meta = document.createElement('p');
  meta.className = 'meta';
  meta.textContent = `${displayNames.get(meal.user_id) ?? '不明'}・`
    + `${MEAL_LABELS[meal.meal_type]}・${dateFormatter.format(new Date(meal.eaten_at))}`;
  card.append(meta);

  // 外食したときのお店。入れていない記録には出さない
  if (meal.place) {
    const place = document.createElement('p');
    place.className = 'place-text';
    const pin = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    pin.setAttribute('aria-hidden', 'true');
    pin.classList.add('pin-icon');
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttribute('href', '#pin');
    pin.append(use);
    place.append(pin, document.createTextNode(meal.place));
    card.append(place);
  }

  if (meal.note) {
    const note = document.createElement('p');
    note.className = 'note-text';
    note.textContent = meal.note;
    card.append(note);
  }

  // 日記。ごはんのメモとは別の、その日の気分やできごと。書いたときだけ出す
  if (meal.diary) {
    const diary = document.createElement('p');
    diary.className = 'diary-text';
    diary.textContent = meal.diary;
    card.append(diary);
  }

  const reactionBox = renderReactions(meal);
  if (reactionBox) card.append(reactionBox);

  if (meal.user_id === currentUser.id) {
    const actions = document.createElement('div');
    actions.className = 'row';

    const favoriteButton = document.createElement('button');
    favoriteButton.type = 'button';
    favoriteButton.className = 'reaction';
    favoriteButton.dataset.kind = 'favorite';
    favoriteButton.append(makeIcon(FAVORITE), document.createTextNode(FAVORITE.label));
    setReactionState(favoriteButton, meal.favorite === true);
    favoriteButton.addEventListener('click', () => toggleFavorite(meal, favoriteButton));

    const editButton = document.createElement('button');
    editButton.className = 'link';
    editButton.textContent = '編集';
    editButton.addEventListener('click', () => openForm(meal));

    const deleteButton = document.createElement('button');
    deleteButton.className = 'link danger';
    deleteButton.textContent = '削除';
    deleteButton.addEventListener('click', () => deleteMeal(meal));

    actions.append(favoriteButton, editButton, deleteButton);
    card.append(actions);
  }

  return card;
}

// 自分の記録に★を付け外しする
async function toggleFavorite(meal, button) {
  const on = !button.classList.contains('on');
  button.disabled = true;
  try {
    // 編集・削除と同じ理由で .select() を付け、0件なら失敗として扱う
    const { data, error } = await supabase
      .from('meals')
      .update({ favorite: on })
      .eq('id', meal.id)
      .select();
    if (error) throw error;
    if (data.length === 0) throw new Error('ログインの有効期限が切れているかもしれません。');
    meal.favorite = on;
    setReactionState(button, on);
    // お気に入りの画面で外したら、その場から消す
    if (!on && activeView === 'favorites') {
      button.closest('.card')?.remove();
      favoriteCount = Math.max(0, favoriteCount - 1);
      if (favoriteList.childElementCount === 0) {
        favoriteStatus.textContent = 'まだ★を付けた記録はありません。';
        favoriteEmpty.hidden = false;
      }
    }
  } catch (error) {
    console.error(error);
    alert(`うまくいきませんでした：${error.message ?? error}`);
    await refreshSession();
  } finally {
    button.disabled = false;
  }
}

async function deleteMeal(meal) {
  if (!confirm('この記録を削除しますか？')) return;

  // 更新と同じ理由で .select() を付け、0件だったら失敗として扱う
  const { data, error } = await supabase.from('meals').delete().eq('id', meal.id).select();

  if (error) {
    console.error(error);
    alert(`削除できませんでした：${error.message}`);
    return;
  }

  if (data.length === 0) {
    alert('削除できませんでした。ログインの有効期限が切れている可能性があります。もう一度お試しください。');
    await refreshSession();
    return;
  }

  if (meal.photo_path) {
    await supabase.storage.from(BUCKET).remove([meal.photo_path]);
  }
  await loadTimeline();
}
