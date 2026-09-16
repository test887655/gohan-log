import { supabase } from './supabase.js';
import { shrinkImage } from './image.js';
import { loadIngredients, clearIngredients } from './ingredients.js';
import { loadPoints, clearPoints, setHomeScreen } from './points.js';

const BUCKET = 'meal-photos';
const MEAL_LABELS = { breakfast: '朝', lunch: '昼', dinner: '夜', snack: '間食' };
const SIGNED_URL_SECONDS = 60 * 60;

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
const noteInput = $('note');
const saveButton = $('save-button');
const formError = $('form-error');
const timeline = $('timeline');
const timelineStatus = $('timeline-status');
const timelineEmpty = $('timeline-empty');
const weekRange = $('week-range');
const prevWeekButton = $('prev-week');
const nextWeekButton = $('next-week');
const thisWeekButton = $('this-week');

let currentUser = null;
let displayNames = new Map();
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
const loadedViews = new Set();
let activeView = 'meals';

// にんじんは食材リストを開くだけ。戻るのはお茶碗のほうの役目
ingredientToggle.addEventListener('click', () => showView('ingredients'));

$('back-to-meals').addEventListener('click', () => showView('meals'));

function showView(view) {
  activeView = view;
  ingredientToggle.setAttribute('aria-pressed', String(view === 'ingredients'));
  // キラキラはごはんの画面にだけ出す
  setHomeScreen(view === 'meals');
  $('view-meals').hidden = view !== 'meals';
  $('view-ingredients').hidden = view !== 'ingredients';

  // 一度読んだ画面は読み直さない。切り替えるたびに通信するのはもったいない
  if (currentUser && !loadedViews.has(view)) reloadActiveView();
}

async function reloadActiveView() {
  loadedViews.add(activeView);
  if (activeView === 'meals') await loadTimeline();
  else await loadIngredients();
}

// ---------- 見た目の切り替え ----------

const themeOptions = [...document.querySelectorAll('.theme-option')];
const themeColor = document.querySelector('meta[name="theme-color"]');
const THEME_COLORS = { simple: '#e07a3f', adult: '#b2727f', cute: '#f0a8bd', dark: '#1a1a1c' };

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

$('logout-button').addEventListener('click', () => supabase.auth.signOut());

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
    clearPoints();
    loadedViews.clear();
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

  await loadPoints(currentUser, displayNames);

  // 開いている画面だけ読み直す。裏の画面まで毎回読むと通信が増える
  await reloadActiveView();
}

// ---------- 投稿フォーム ----------

openFormButton.addEventListener('click', () => openForm(null));
$('cancel-button').addEventListener('click', closeForm);

function openForm(meal) {
  editingMeal = meal;
  mealForm.reset();
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
    noteInput.value = meal.note ?? '';
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
      note: noteInput.value.trim() || null,
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

// ---------- いいね / レシピが知りたい ----------

let reactions = new Map(); // meal_id -> [{ user_id, kind }]

async function loadReactions(mealIds) {
  reactions = new Map();
  if (mealIds.length === 0) return;

  const { data, error } = await supabase
    .from('meal_reactions')
    .select('meal_id, user_id, kind')
    .in('meal_id', mealIds);

  if (error) {
    console.error(error);
    return;
  }

  for (const row of data) {
    if (!reactions.has(row.meal_id)) reactions.set(row.meal_id, []);
    reactions.get(row.meal_id).push(row);
  }
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

  if (meal.note) {
    const note = document.createElement('p');
    note.className = 'note-text';
    note.textContent = meal.note;
    card.append(note);
  }

  const reactionBox = renderReactions(meal);
  if (reactionBox) card.append(reactionBox);

  if (meal.user_id === currentUser.id) {
    const actions = document.createElement('div');
    actions.className = 'row';

    const editButton = document.createElement('button');
    editButton.className = 'link';
    editButton.textContent = '編集';
    editButton.addEventListener('click', () => openForm(meal));

    const deleteButton = document.createElement('button');
    deleteButton.className = 'link danger';
    deleteButton.textContent = '削除';
    deleteButton.addEventListener('click', () => deleteMeal(meal));

    actions.append(editButton, deleteButton);
    card.append(actions);
  }

  return card;
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
