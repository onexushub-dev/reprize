# Parceiros: links, faixas de preço e comissão

> Rotina para criar e acompanhar parceiros (professores, donos de quadra, jogadores com audiência). Desenho e motivos: `docs/superpowers/specs/2026-11-15-partner-codes-design.md`. Regras de plano: `docs/modelo-de-negocio-e-pagamentos.md`.

## Como funciona

Cada parceiro tem **um código** (3 a 20 letras e números, ex.: `PROFJOAO`) que forma o link `https://reprizeapp.com/p/PROFJOAO` e também pode ser digitado no app. O código não pode terminar em `MENSAL`, porque esse final é reservado ao código mensal da Apple.

Cada parceiro fica em uma **faixa de preço**. A faixa define o desconto no **primeiro período** do PRO mensal e anual. Depois disso, a assinatura renova no preço normal. O teste grátis de 7 dias não se soma ao desconto.

| Faixa | Oferta no RevenueCat | Desconto | Anual, 1º ano | Mensal, 1º mês |
|---|---|---|---|---|
| P10 | `partner_p10` | 10% | R$ 107,90 | R$ 13,40 |
| P20 | `partner_p20` | 20% | R$ 95,90 | R$ 11,90 |
| P30 | `partner_p30` | 30% | R$ 83,90 | R$ 10,40 |

Se a loja não tiver exatamente esse preço, use o **valor imediatamente abaixo**, para o desconto real nunca ser menor que o anunciado no app. Em outros países, aplique o mesmo critério sobre o preço local.

- **Android:** o código segue do link da Play Store até o app (install referrer), e o paywall abre a oferta da faixa do parceiro.
- **iPhone:** a pessoa instala o app, abre o link de novo ou informa o código, escolhe anual ou mensal, e o app abre o resgate da Apple com o código preenchido.

**Nunca divulgue o link de resgate da Apple.** Uma compra feita antes de o app registrar o código fica sem parceiro e não entra na comissão.

## Configuração única (antes do primeiro parceiro)

Repita os três primeiros itens para cada faixa. Os exemplos usam P20.

- [ ] **App Store Connect:** em `pro_annual`, oferta `P20_ANUAL` (pagar adiantado, 1 ano). Em `pro_monthly`, oferta `P20_MENSAL` (pagar adiantado, 1 mês). Ambas para assinantes novos e expirados.
- [ ] **Play Console:** na assinatura PRO, planos base `annual-p20` e `monthly-p20`, no preço normal, cada um com uma oferta de fase única para o primeiro período e elegibilidade "definida pelo desenvolvedor".
- [ ] **RevenueCat:** importar os produtos do Play e ligá-los ao entitlement `pro`. Criar a oferta `partner_p20` com o paywall do PRO, a linha "Desconto por indicação" e os pacotes anual (iOS `pro_annual`, Android `annual-p20`) e mensal (iOS `pro_monthly`, Android `monthly-p20`). Metadados:
  ```json
  { "discountPercent": 20, "partners": {} }
  ```
  Numa compra de teste, conferir que o paywall do Android mostra o preço da faixa. Se o RevenueCat escolher outra opção do plano, ajustar conforme a página de ofertas do Google Play deles.
- [ ] **Site (reprize-lp):** publicar a branch `feat/partner-links`, com as variáveis `PUBLIC_APP_STORE_PROVIDER_TOKEN` (token do gerador de links de campanha do App Store Connect) e `PUBLIC_PLAY_STORE_URL`.
- [ ] **Links universais:** em `public/.well-known/assetlinks.json` do site, com `package_name` `app.reprize.mobile` e os SHA-256 da chave de assinatura do Play (Play Console → Integridade do app) e da chave de upload da EAS (`eas credentials -p android`). Formato: lista com um objeto `relation: ["delegate_permission/common.handle_all_urls"]` e `target: { namespace: "android_app", package_name, sha256_cert_fingerprints }`. O arquivo da Apple (`apple-app-site-association`) já está no site.
- [ ] **Notas para a revisão da Apple** (colar no envio da próxima versão): "The referral code field only records who referred the customer. On iOS, discounts are redeemed exclusively through Apple offer codes (StoreKit redemption)."

As três faixas usam 12 dos 50 planos e ofertas ativos do Play e 3 das 10 ofertas ativas da Apple em cada assinatura.

## Criar um parceiro (sem build)

1. **Escolha o código e a faixa.** Só letras e números, sem acento, fácil de falar. Confira que o código não existe em nenhuma faixa.
2. **RevenueCat:** Offerings → `partner_p20` → Metadata. Acrescente o parceiro e salve:
   ```json
   { "discountPercent": 20, "partners": { "PROFJOAO": { "name": "Prof. João" } } }
   ```
   O `name` aparece para quem recebeu o link. O app lê a lista na próxima abertura. Cada oferta aceita até 4.000 caracteres de metadados, cerca de 100 parceiros.
3. **App Store Connect:** crie dois **códigos personalizados**: `PROFJOAO` na oferta `P20_ANUAL` e `PROFJOAOMENSAL` na oferta `P20_MENSAL`. Anote a validade, se a Apple exigir uma.
4. **Mande ao parceiro** o link e um texto pronto, por exemplo:
   > Gravo meus lances de beach tennis com o Reprize. Com meu link você tem desconto no PRO: https://reprizeapp.com/p/PROFJOAO (ou use o código PROFJOAO dentro do app).
5. **Teste** abrindo o link em um iPhone e em um Android sem o app.

## Mudar, remover ou renovar

- **Mudar de faixa:** na Apple, desative os dois códigos atuais, porque um código precisa ser desativado antes de ser usado em outra oferta. Crie os mesmos códigos nas ofertas da nova faixa e **espere até poderem ser resgatados** (pode levar até 1 hora). Só então mova o parceiro para os metadados da nova faixa. Quem ainda não comprou passa a ver a nova faixa na próxima abertura. Quem já comprou não muda.
- **Mudar o preço de uma faixa:** crie uma faixa nova e mova os parceiros, para o percentual exibido continuar igual ao preço das lojas.
- **Remover:** tire o parceiro dos metadados e desative os códigos na Apple. Quem já foi atribuído continua atribuído, e ninguém novo entra.
- **Renovar:** se a Apple exigir validade (no máximo 6 meses) ou o lote chegar perto do limite de 25.000 resgates, crie um novo lote **com o mesmo código**. Um código diferente não funciona, porque o app monta o código da Apple a partir do código do parceiro.

## Fechamento mensal da comissão

Conta como **assinante válido** quem, na data de fechamento, tem PRO pago e vigente, fez a primeira assinatura paga depois de aplicar o código do parceiro e não está em teste grátis, com reembolso, em carência ou com pagamento em atraso.

1. **Escolha uma data fixa (D)** e use a exportação **Transactions** do RevenueCat gerada depois dela.
2. **Filtre as transações:**
   - `is_sandbox = false`, `is_trial_period = false` e `refunded_at` vazio
   - `store` em `app_store` ou `play_store`, e `ownership_type = PURCHASED`
   - `product_identifier` nos produtos PRO (`pro_annual`, `pro_monthly` e os planos `annual-p*` e `monthly-p*`)
   - `start_time` até D, e `end_time` e `effective_end_time` depois de D (`effective_end_time` sozinho incluiria a carência)
3. **Fique com a transação mais recente de cada cliente** e leia `partner_code` e `partner_applied_at` em `custom_subscriber_attributes`.
4. **Ache a primeira cobrança da assinatura:** a transação mais antiga, fora de teste grátis, com o mesmo `original_store_transaction_id`.
5. **Exclua quem já pagava antes do código:** a primeira cobrança precisa ser igual ou posterior a `partner_applied_at`.
6. **Aplique a carência de 30 dias:** a primeira cobrança precisa ter pelo menos 30 dias em D. Renovações não reiniciam essa contagem.
7. **Exclua autoindicações**, como a assinatura do próprio parceiro.
8. **Agrupe por parceiro e por plano.**
9. **Confira o iPhone:** compare os resgates do relatório Subscription Offer Redemption da Apple com as compras atribuídas. Uma diferença indica resgates feitos fora do app.
10. **Guarde a planilha do mês**, com a data e o valor pago a cada parceiro.

Para acompanhar ao longo do mês, crie uma **Audience** no RevenueCat por parceiro: `partner_code` igual ao código, status `Active`, produto mais recente nos produtos PRO e `Currently trialing` falso. Na primeira vez, confira o total com "Export all".

## Outros relatórios

| Pergunta | Onde |
|---|---|
| Aberturas do link de cada parceiro | Vercel → Web Analytics → páginas `/p/CODE` |
| Instalações no iPhone por parceiro | App Store Connect → App Analytics → Campanhas (precisa de `PUBLIC_APP_STORE_PROVIDER_TOKEN`) |
| Códigos aplicados, por origem | PostHog → evento `partner_code_applied`, por `code` e `source` |
| Da oferta à assinatura, por parceiro | PostHog → funil por `partner`: no Android `paywall_viewed` → `purchase_completed`; no iPhone `partner_offer_opened` (via `offer_code`) → `purchase_completed` (o resgate da Apple não passa pelo paywall) |

Anote aqui, ao fazer a primeira vez, o caminho exato de cada painel e o que a Apple de fato mostra por código.

## Quando rever a decisão de construir

Quando o fechamento manual pesar, ou se a comissão virar contrato, avaliar uma ferramenta (Insert Affiliate, WinWinKit) que lê o atributo `partner_code` do RevenueCat e cuida do pagamento.
