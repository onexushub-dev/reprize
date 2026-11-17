# Parceiros: links e códigos de indicação

> Rotina para criar e acompanhar parceiros (professores, donos de quadra, jogadores com audiência). Desenho e motivos: `docs/superpowers/specs/2026-11-15-partner-codes-design.md`. Regras de plano: `docs/modelo-de-negocio-e-pagamentos.md`.

## Como funciona

Cada parceiro tem **um código** (3 a 20 letras e números, ex.: `PROFJOAO`) que vira o link `https://reprizeapp.com/p/PROFJOAO` e o código digitável. Quem chega por ele ganha o **primeiro ano do PRO anual por R$ 83,90** (30% abaixo de R$ 119,90; US$ 34,99). O mensal não tem desconto e o teste grátis de 7 dias não se soma ao desconto.

- **Android:** o código vai sozinho do link da Play Store ao app (install referrer) e o paywall abre a oferta `partner`.
- **iPhone:** a pessoa toca em "Tenho um código de indicação" (ou abre o link com o app instalado) e "Ativar desconto" abre o resgate de código da Apple, com o código preenchido.

## Criar um parceiro (menos de 10 minutos, sem build)

1. **Escolha o código.** Só letras e números, sem acento, fácil de falar. Confira que não existe.
2. **RevenueCat:** Offerings → `default` → Metadata. Acrescente o parceiro no JSON e salve:
   ```json
   { "partners": { "PROFJOAO": { "name": "Prof. João" } } }
   ```
   O `name` aparece para a aluna ("indicação de Prof. João"). O app lê a lista na próxima abertura.
3. **App Store Connect:** Reprize Pro → `pro_annual` → Ofertas → `PARCEIROS` → crie um **código personalizado** igual ao do parceiro (`PROFJOAO`), com limite de resgates e validade (a Apple aceita no máximo 6 meses).
4. **Mande ao parceiro** o link e um texto pronto, por exemplo:
   > Gravo meus lances de beach tennis com o Reprize. Com meu link você ganha desconto no PRO: https://reprizeapp.com/p/PROFJOAO (ou use o código PROFJOAO dentro do app).
5. **Teste** abrindo o link em um iPhone e em um Android sem o app.

## Remover ou renovar

- **Remover:** tire o parceiro do JSON do RevenueCat. Quem já foi atribuído continua atribuído; ninguém novo entra.
- **Renovar:** os códigos da Apple expiram (máximo 6 meses). Anote a data e crie um novo código com o mesmo nome antes de vencer.

## Relatório mensal

| Pergunta | Onde |
|---|---|
| Aberturas do link de cada parceiro | Vercel → Web Analytics → páginas `/p/CODE` |
| Instalações no iPhone por parceiro | App Store Connect → App Analytics → Campanhas (precisa do token de provedor em `PUBLIC_APP_STORE_PROVIDER_TOKEN`) |
| Códigos aplicados, por origem | PostHog → evento `partner_code_applied`, por `code` e `source` |
| Da oferta à assinatura, por parceiro | PostHog → funil por `partner`: no Android `paywall_viewed` → `purchase_completed`; no iPhone `partner_offer_opened` (via `offer_code`) → `purchase_completed` (o resgate da Apple não passa pelo paywall) |
| Assinantes e receita por parceiro (renovações e reembolsos incluídos) | RevenueCat → Customers, filtro pelo atributo `partner_code`; exporte todo mês |
| Resgates por código no iPhone (conferência) | App Store Connect → oferta `PARCEIROS` |

Anote aqui, ao fazer a primeira vez, o caminho exato de cada painel e o que a Apple de fato mostra por código.

## Configuração única (antes do primeiro parceiro)

- [ ] **App Store Connect:** oferta `PARCEIROS` em `pro_annual`: pagar adiantado, 1 ano, R$ 83,90 (US$ 34,99; outros países no nível equivalente), elegível a assinantes novos e expirados. Anotar aqui os limites reais (resgates por código, validade).
- [ ] **Play Console:** na assinatura PRO, plano base `annual-parceiro` (anual, mesmo preço do anual) com uma oferta: fase única de pagamento, 1 ano, R$ 83,90, elegibilidade "definida pelo desenvolvedor".
- [ ] **RevenueCat:** importar o produto novo do Play e ligar ao entitlement `pro`; criar a oferta `partner` (pacote anual: iOS `pro_annual`, Android `annual-parceiro`; pacote mensal: o mensal de sempre) com o paywall do PRO e a linha "Desconto por indicação"; colocar `{ "partners": {} }` nos metadados da oferta `default`. Numa compra de teste, conferir que o paywall mostra R$ 83,90 no Android; se o RevenueCat escolher outra opção do plano, ajustar conforme a página de ofertas do Google Play deles.
- [ ] **Site (reprize-lp):** publicar a branch `feat/partner-links`; variável `PUBLIC_APP_STORE_PROVIDER_TOKEN` (token do gerador de links de campanha do App Store Connect) e `PUBLIC_PLAY_STORE_URL` quando o Android for publicado.
- [ ] **Links universais:** em `public/.well-known/assetlinks.json` do site, com `package_name` `app.reprize.mobile` e os SHA-256 da chave de assinatura do Play (Play Console → Integridade do app) e da chave de upload da EAS (`eas credentials -p android`). Formato: lista com um objeto `relation: ["delegate_permission/common.handle_all_urls"]` e `target: { namespace: "android_app", package_name, sha256_cert_fingerprints }`. O arquivo da Apple (`apple-app-site-association`) já está no site.
- [ ] **Notas para a revisão da Apple** (colar no envio da próxima versão): "The referral code field only records who referred the customer. On iOS, discounts are redeemed exclusively through Apple offer codes (StoreKit redemption)."

## Quando rever a decisão de construir

Com mais de uns 20 parceiros ativos, ou se a comissão virar contrato, avaliar uma ferramenta (Insert Affiliate, WinWinKit) que lê o atributo `partner_code` do RevenueCat e cuida do pagamento.
