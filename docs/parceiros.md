# Parceiros: links, faixas de preço e comissão

> Rotina para criar e acompanhar parceiros (professores, donos de quadra, jogadores com audiência). Desenho e motivos: `docs/superpowers/specs/2026-11-15-partner-codes-design.md`. Regras de plano: `docs/modelo-de-negocio-e-pagamentos.md`.

## Como funciona

Cada parceiro tem **um código** (3 a 20 letras e números, ex.: `PROFJOAO`) que forma o link `https://reprizeapp.com/p/PROFJOAO` e também pode ser digitado no app. O código não pode terminar em `MENSAL`, porque esse final é reservado ao código mensal da Apple.

Cada parceiro fica em uma **faixa de preço**. A faixa define o desconto no **primeiro período** do PRO mensal e anual. Depois disso, a assinatura renova no preço normal. O teste grátis de 7 dias não se soma ao desconto.

| Faixa | Oferta no RevenueCat | Desconto | Anual, 1º ano | Mensal, 1º mês |
|---|---|---|---|---|
| P10 | `partner_p10` | 10% | R$ 107,90 | R$ 13,00 |
| P20 | `partner_p20` | 20% | R$ 95,90 | R$ 11,90 |
| P30 | `partner_p30` | 30% | R$ 83,90 | R$ 10,40 |

**No lançamento (1.1.0) só a P10 existe.** P20 e P30 são criadas quando um parceiro precisar, com o mesmo passo a passo.

A Apple só aceita preços da lista dela. Se não houver exatamente o valor, use o **valor imediatamente abaixo**, para o desconto real nunca ser menor que o anunciado no app (o mensal da P10 ficou em R$ 13,00 porque não existe R$ 13,40). Use o mesmo valor no Google Play.

**As ofertas valem só no Brasil.** A conversão automática da Apple não mantém o percentual nos outros países (nos EUA, R$ 107,90 viraria $17,99 contra $49,99). Para abrir outro país, defina o preço dele à mão na oferta.

- **Android:** o código segue do link da Play Store até o app (install referrer), e o paywall abre a oferta da faixa do parceiro.
- **iPhone:** a pessoa instala o app, abre o link de novo ou informa o código, escolhe anual ou mensal, e o app abre o resgate da Apple com o código preenchido.

**Nunca divulgue o link de resgate da Apple.** Uma compra feita antes de o app registrar o código fica sem parceiro e não entra na comissão.

## Configuração única (antes do primeiro parceiro)

Repita os três primeiros itens para cada faixa. Os exemplos usam P10, a faixa do lançamento.

- [x] **App Store Connect** (feito em 24/11/2026 para a P10): em `pro_annual` → Preços da assinatura → **+** → Criar códigos de oferta, oferta `P10_ANUAL` (pré-pagamento, 1 ano, R$ 107,90). Em `pro_monthly`, `P10_MENSAL` (pré-pagamento, 1 mês, R$ 13,00). Ambas para assinantes novos e expirados, só no Brasil, com renovação automática.
- [x] **Play Console** (feito em 25/11/2026 para a P10): na assinatura `pro_annual`, plano base `annual-p10` (anual, R$ 119,99, só Brasil) com a oferta `p10-primeiro-ano` (pagamento único de 1 ano, desconto percentual de 10% = R$ 107,99). Na `pro_monthly`, plano base `monthly-p10` (mensal, R$ 14,99, só Brasil) com a oferta `p10-primeiro-mes` (pagamento único de 1 mês, 10% = R$ 13,49). Elegibilidade "Determinado pelo desenvolvedor (no app)", sem data de fim. O Play arredonda preços em reais para ,99, por isso os valores diferem dos da Apple; o percentual é o mesmo.
- [x] **RevenueCat** (produtos e pacotes feitos em 25/11/2026; paywall ainda em rascunho): importar os produtos do Play (`pro_annual:annual-p10`, `pro_monthly:monthly-p10`) e ligá-los ao entitlement `pro`. Criar a oferta `partner_p10` com o paywall do PRO, a linha "Desconto por indicação" e os pacotes anual (iOS `pro_annual`, Android `annual-p10`) e mensal (iOS `pro_monthly`, Android `monthly-p10`). Metadados:
  ```json
  { "discountPercent": 10, "partners": {} }
  ```
  Numa compra de teste, conferir que o paywall do Android mostra o preço da faixa. Se o RevenueCat escolher outra opção do plano, ajustar conforme a página de ofertas do Google Play deles.
- [ ] **Site (reprize-lp):** publicar a branch `feat/partner-links`, com as variáveis `PUBLIC_APP_STORE_PROVIDER_TOKEN` (token do gerador de links de campanha do App Store Connect) e `PUBLIC_PLAY_STORE_URL`.
- [ ] **Links universais:** em `public/.well-known/assetlinks.json` do site, com `package_name` `app.reprize.mobile` e os SHA-256 da chave de assinatura do Play (Play Console → Integridade do app) e da chave de upload da EAS (`eas credentials -p android`). Formato: lista com um objeto `relation: ["delegate_permission/common.handle_all_urls"]` e `target: { namespace: "android_app", package_name, sha256_cert_fingerprints }`. O arquivo da Apple (`apple-app-site-association`) já está no site.
- [ ] **Notas para a revisão da Apple** (colar no envio da próxima versão): "The referral code field only records who referred the customer. On iOS, discounts are redeemed exclusively through Apple offer codes (StoreKit redemption)."

As três faixas usam 12 dos 50 planos e ofertas ativos do Play e 3 das 10 ofertas ativas da Apple em cada assinatura.

## Criar um parceiro (sem build)

1. **Escolha o código e a faixa.** Só letras e números, sem acento, fácil de falar. Confira que o código não existe em nenhuma faixa.
2. **RevenueCat:** Offerings → `partner_p10` → Metadata. Acrescente o parceiro e salve:
   ```json
   { "discountPercent": 10, "partners": { "PROFJOAO": { "name": "Prof. João" } } }
   ```
   O `name` aparece para quem recebeu o link. O app lê a lista na próxima abertura. Cada oferta aceita até 4.000 caracteres de metadados, cerca de 100 parceiros.
3. **App Store Connect:** crie dois **códigos personalizados**: `PROFJOAO` na oferta `P10_ANUAL` e `PROFJOAOMENSAL` na oferta `P10_MENSAL`. Limite de 500 usos (aumente quando precisar, até 25.000) e **sem data de fim**. Códigos personalizados só funcionam em produção. Para testar em sandbox, gere "Códigos de Sandbox" na mesma oferta e resgate em Ajustes → Desenvolvedor → Conta Sandbox.
4. **Mande ao parceiro** o link e um texto pronto, por exemplo:
   > Gravo meus lances de beach tennis com o Reprize. Com meu link você tem desconto no PRO: https://reprizeapp.com/p/PROFJOAO (ou use o código PROFJOAO dentro do app).
5. **Teste** abrindo o link em um iPhone e em um Android sem o app.

## Mudar, remover ou renovar

- **Mudar de faixa:** na Apple, desative os dois códigos atuais, porque um código precisa ser desativado antes de ser usado em outra oferta. Crie os mesmos códigos nas ofertas da nova faixa e **espere até poderem ser resgatados** (pode levar até 1 hora). Só então mova o parceiro para os metadados da nova faixa. Quem ainda não comprou passa a ver a nova faixa na próxima abertura. Quem já comprou não muda.
- **Mudar o preço de uma faixa:** crie uma faixa nova e mova os parceiros, para o percentual exibido continuar igual ao preço das lojas.
- **Remover:** tire o parceiro dos metadados e desative os códigos na Apple. Quem já foi atribuído continua atribuído, e ninguém novo entra.
- **Renovar:** se o código chegar perto do limite de usos, crie um novo lote **com o mesmo código** (os códigos são criados sem data de fim). Um código diferente não funciona, porque o app monta o código da Apple a partir do código do parceiro.

## Fechamento mensal da comissão

Conta como **assinante válido** quem, na data de fechamento, tem PRO pago e vigente, nunca tinha pago o PRO antes de aplicar o código do parceiro e não está em teste grátis, com reembolso, em carência ou com pagamento em atraso.

Regras decididas em 24/11/2026:
- **Carência e pagamento em atraso não contam.** O assinante volta a contar no mês em que a loja confirmar o pagamento.
- **Quem já foi assinante não conta**, mesmo que tenha cancelado e voltado com o código de um parceiro.
- **Conta qualquer plano PRO pago depois do código, com ou sem desconto.** Por exemplo, quem tocou em "Ver todos os planos" no iPhone e assinou no preço normal.

1. **Escolha uma data fixa (D)** e use a exportação **Transactions** do RevenueCat gerada depois dela.
2. **Filtre as transações:**
   - `is_sandbox = false`, `is_trial_period = false` e `refunded_at` vazio
   - `store` em `app_store` ou `play_store`, e `ownership_type = PURCHASED`
   - `product_identifier` nos produtos PRO (`pro_annual`, `pro_monthly` e os planos `annual-p*` e `monthly-p*`)
   - `start_time` até D, e `end_time` e `effective_end_time` depois de D (`effective_end_time` sozinho incluiria a carência)
3. **Fique com a transação mais recente de cada cliente** e leia `partner_code` e `partner_applied_at` em `custom_subscriber_attributes`.
4. **Ache a primeira cobrança da assinatura:** a transação mais antiga, fora de teste grátis, com o mesmo `original_store_transaction_id`.
5. **Exclua quem já pagou o PRO antes do código:** a primeira cobrança precisa ser igual ou posterior a `partner_applied_at`, e o cliente não pode ter **nenhuma** transação paga do PRO (de qualquer `original_store_transaction_id`) antes de `partner_applied_at`. No Google Play, quem assina de novo depois de cancelar recebe uma assinatura nova, então só o passo anterior não basta.
6. **Aplique a espera de 30 dias:** a primeira cobrança precisa ter pelo menos 30 dias em D. Renovações não reiniciam essa contagem.
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
