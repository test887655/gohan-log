-- 反応に「えらこ」（erako）を足す。kind の check 制約を作り直す
do $$
declare c text;
begin
  for c in select conname from pg_constraint
    where conrelid = 'public.meal_reactions'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) like '%kind%'
  loop
    execute format('alter table public.meal_reactions drop constraint %I', c);
  end loop;
end $$;

alter table public.meal_reactions
  add constraint meal_reactions_kind_check
  check (kind in ('like', 'yummy', 'recipe', 'erako'));

select pg_get_constraintdef(oid) from pg_constraint
  where conrelid = 'public.meal_reactions'::regclass and contype = 'c';
