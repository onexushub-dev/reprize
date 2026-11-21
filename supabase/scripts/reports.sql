-- Revisar links denunciados (docs/superpowers/specs/2026-11-16-recording-sharing-design.md §8.3).
-- No painel do Supabase: SQL Editor. Cole UM bloco por vez e clique em Run.
-- Um link denunciado já está fora do ar desde a denúncia.
--
-- Para ver o vídeo: painel da Cloudflare → R2 → o bucket → shares/<share_id>/ (cover.mp4, clips/<n>/video.mp4).
-- Os arquivos ficam lá até acabarem as 24 horas do link: revise dentro desse prazo.


-- BLOCO 1 · LISTAR: os links esperando revisão. Copie o share_id da linha que vai revisar.
select s.id as share_id, s.title, s.created_at as shared_at, s.expires_at,
       count(*) as reports,
       string_agg(r.category || coalesce(': ' || r.reason, ''), ' | ' order by r.created_at) as what,
       u.email as owner_email
from public.reports r
join public.shares s on s.id = r.share_id
left join auth.users u on u.id = s.owner
where r.state = 'open'
group by s.id, u.email
order by max(r.created_at) desc;


-- BLOCO 2 · MANTER: o conteúdo está ok e o link volta a funcionar (até acabarem as 24 horas dele).
-- Troque só o id entre aspas.
update public.reports set state = 'kept', reviewed_at = now()
where state = 'open' and share_id = 'COLE-AQUI-O-SHARE_ID';


-- BLOCO 3 · REMOVER: o link fica fora do ar de vez e os arquivos saem do R2 em até 10 minutos.
-- Troque só o id entre aspas.
with reviewed as (
  update public.reports set state = 'removed', reviewed_at = now()
  where state = 'open' and share_id = 'COLE-AQUI-O-SHARE_ID'
  returning share_id
)
update public.shares set expires_at = least(expires_at, now())
where id in (select share_id from reviewed);
