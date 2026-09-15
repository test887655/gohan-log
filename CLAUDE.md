# 食事・レシピ・食材管理アプリ 設計メモ

## 目的
自分と姉の2人だけで使う非公開アプリ。ストア公開はしない。
- 毎食の写真を送り合っている今の習慣を、アプリ上の共有タイムラインに置き換える
- レシピを作った時の写真ごと保存する
- 家の食材を管理して食品ロスを減らす

## 前提・制約
- 利用端末：iPhone（2人とも）。Macは持っていない
- 形式：PWA（Webアプリ）。SafariでURLを開き「ホーム画面に追加」して使う
- 開発環境：Windows/PC + Claude Code
- ホスティング：GitHub Pages
- データ保存：Supabase（無料枠）。Auth・Database・Storage を使う
- ユーザーは2アカウントのみ。新規登録は受け付けない（Supabase側でサインアップを無効化）
- 写真はSupabase Storageに保存。アップロード前にクライアント側で縮小（長辺1200px程度）して容量を抑える
- 技術スタックはシンプルに。ビルド不要か最小限（例：素のHTML/JS、またはVite + 軽量フレームワーク）。GitHub Pagesで動くこと

## 共有ルール（重要）
| 機能 | 共有 |
|---|---|
| 食事ログ | 2人で共有（両方の投稿が同じタイムラインに並ぶ） |
| 食材リスト | 各自のみ |
| レシピ帳 | 各自のみ |
| 買い物リスト | 各自のみ |

SupabaseのRow Level Securityで実装する：
- meals：認証済みユーザー全員が閲覧可、作成・編集・削除は本人のみ
- ingredients / recipes / shopping_items：本人のみ閲覧・作成・編集・削除

## 機能
### 1. 食事ログ（最優先）
- 写真（必須）＋一言メモ＋日時＋朝/昼/夜/間食の区分
- 2人分が時系列で並ぶタイムライン。誰の投稿かわかる表示
- 自分の投稿は編集・削除可

### 2. 食材リスト
- 食材名・数量・単位・賞味期限・保存場所（冷蔵/冷凍/常温）
- 賞味期限が近い順に並ぶ。期限が3日以内は目立たせる
- 使い切ったら削除、または数量を減らす

### 3. レシピ帳
- タイトル・材料（名前＋分量）・手順・メモ・写真（複数可）
- 「作った」記録：作った日と写真を追加できる

### 4. 連動・買い物リスト
- レシピを開くと、食材リストと照合して「足りない材料」を表示
- 足りない材料を買い物リストに一括追加
- 食材リストから「今ある食材で作れるレシピ」を表示
- 材料名の表記ゆれ対策：最初は登録済みの食材名からの選択式にする。自由入力は後回し

## 作る順番
1. プロジェクト雛形 + Supabase接続 + ログイン（2アカウント）
2. 食事ログ（この時点で姉と使い始める）
3. 食材リスト
4. レシピ帳
5. 連動・買い物リスト

## データモデル案
- profiles (id, display_name)
- meals (id, user_id, photo_path, note, eaten_at, meal_type, created_at)
- ingredients (id, user_id, name, quantity, unit, expires_on, storage, created_at)
- recipes (id, user_id, title, steps, note, created_at)
- recipe_ingredients (id, recipe_id, name, quantity, unit)
- recipe_photos (id, recipe_id, photo_path, cooked_on)
- shopping_items (id, user_id, name, quantity, unit, done, created_at)

## 進め方の希望
- 開発者は初心者寄り。Supabaseの設定など自分で行う作業は、手順を1つずつ具体的に示すこと
- 一気に全部作らず、段階ごとに動作確認しながら進める
- 最初のタスク：ステップ1（雛形・Supabase接続・ログイン）から始める。まずSupabaseで何を設定すればよいか教えてほしい
