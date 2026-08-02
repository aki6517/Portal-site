-- 会場マスタの調整（2026-08-02 西山くんフィードバック）
--  1. 甘棠館Show劇場: 唐人町商店街の会場のため「福岡市その他」ではなく
--     中心部グループ「福岡市・天神博多」に移動
--  2. 福岡市科学館（サイエンスホール・六本松）を追加。公式サイトに公演一覧は
--     無いため自動収集の直接ソースにはできないが、FPAP経由・scout・手動登録の
--     公演を番組表の施設行として受けられるようにする

update public.venues
set area = '福岡市・天神博多', sort_order = 65
where name = '甘棠館Show劇場';

insert into public.venues (name, city, area, sort_order, aliases, address, capacity, url)
select '福岡市科学館', '福岡市', '福岡市その他', 85,
       array['福岡市科学館 サイエンスホール', '福岡市科学館サイエンスホール', 'サイエンスホール', '福岡市科学館6階サイエンスホール'],
       '福岡市中央区六本松4-2-1', 300, 'https://www.fukuokacity-kagakukan.jp/'
where not exists (select 1 from public.venues where name = '福岡市科学館');
