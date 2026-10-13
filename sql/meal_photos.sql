-- 1回の記録に写真を5枚まで載せる。
-- 2枚以上のときだけ photo_paths に全部（並べた順）を入れる。1枚目は今まで通り photo_path にも入れるので、
-- アルバムやポイントの判定（photo_path is not null）はそのまま動く
alter table public.meals add column if not exists photo_paths text[];

alter table public.meals drop constraint if exists meals_photo_paths_length;
alter table public.meals add constraint meals_photo_paths_length
  check (photo_paths is null or cardinality(photo_paths) between 2 and 5);
