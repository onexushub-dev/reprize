-- Números do compartilhamento que só o servidor sabe (docs/superpowers/specs/2026-11-16-recording-sharing-design.md §9).
-- O resto (criar, enviar, receber, baixar, cortesia, compra) vem do PostHog. No SQL Editor: um bloco por vez.


-- BLOCO 1 · POR DIA (últimos 30): links criados, abertos por alguém, vencidos sem ninguém abrir, denunciados.
select date_trunc('day', s.created_at)::date as dia,
       count(*) as links,
       count(*) filter (where exists (select 1 from public.share_members m where m.share_id = s.id)) as abertos,
       count(*) filter (where s.expires_at <= now()
                        and not exists (select 1 from public.share_members m where m.share_id = s.id)) as vencidos_sem_abrir,
       count(*) filter (where exists (select 1 from public.reports r where r.share_id = s.id)) as denunciados
from public.shares s
where s.created_at > now() - interval '30 days'
group by 1
order by 1 desc;


-- BLOCO 2 · ALCANCE: quantos celulares abre cada link, em média, e quantos usaram a cortesia.
select count(distinct s.id) as links,
       round(count(m.id)::numeric / nullif(count(distinct s.id), 0), 1) as celulares_por_link,
       count(m.id) filter (where m.account is not null) as com_conta,
       count(m.id) filter (where m.courtesy_applied) as cortesias_usadas
from public.shares s
left join public.share_members m on m.share_id = s.id
where s.created_at > now() - interval '30 days';


-- BLOCO 3 · ARMAZENAMENTO: o que está no R2 agora (links dentro das 24 horas), em GB.
select count(distinct s.id) as links_no_ar,
       round(coalesce(sum(c.bytes), 0) / 1e9, 2) as gb_clipes
from public.shares s
join public.share_clips c on c.share_id = s.id
where s.files_deleted_at is null;
