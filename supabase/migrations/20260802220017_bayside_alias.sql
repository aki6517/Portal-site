-- CoRich表記「ベイサイドライブホール BY ACTIVE HAKATA」を名寄せできるようaliasを追加
update public.venues set aliases = (
  select array(select distinct unnest(aliases || array[
    'ベイサイドライブホール BY ACTIVE HAKATA',
    'ベイサイドライブホールBY ACTIVE HAKATA'
  ]))
) where name = 'ベイサイドライブホール';
