# Parceiros: links, faixas de preço e comissão

> Rotina para criar e acompanhar parceiros (professores, donos de quadra, jogadores com audiência). Desenho e motivos: `docs/superpowers/specs/2026-11-15-partner-codes-design.md`. Regras de plano: `docs/modelo-de-negocio-e-pagamentos.md`.

## Como funciona

Cada parceiro tem **um código** (3 a 20 letras e números, ex.: `PROFJOAO`) que forma o link `https://reprizeapp.com/p/PROFJOAO` e também pode ser digitado no app.

Cada parceiro fica em uma **faixa de preço**. A faixa é um par de produtos com **preço fixo menor** no PRO anual e mensal: o desconto vale **em todos os pagamentos**, enquanto a assinatura durar. Os produtos da faixa têm o mesmo teste grátis de 7 dias do PRO normal (uma vez por pessoa em cada loja).

| Faixa | Oferta no RevenueCat | Desconto | Anual | Mensal | Apple | Google Play |
|---|---|---|---|---|---|---|
| P5 | `partner_p5` | 5% | R$ 113,90 | R$ 14,00 | `pro_annual_p5`, `pro_monthly_p5` | `pro_annual:annual-p5`, `pro_monthly:monthly-p5` |
| P10 | `partner_p10` | 10% | R$ 107,90 | R$ 13,00 | `pro_annual_p10`, `pro_monthly_p10` | `pro_annual:annual-p10`, `pro_monthly:monthly-p10` |

Preço normal nas duas lojas: R$ 119,90/ano e R$ 14,90/mês (o Play foi igualado à Apple em 25/11/2026).

**Preços iguais nas duas lojas.** A Apple só aceita preços da lista dela, então o valor da faixa sai da lista da Apple e é repetido no Play. Quando não existe o valor exato, use o **valor imediatamente abaixo**, para o desconto real nunca ser menor que o anunciado. O anual sai exato (R$ 1,00 de passo, terminando em ,90); o mensal só tem ,00, ,50, ,90 e ,99, por isso o mensal da P10 dá 12,8% e o da P5 dá 6,0%.

**As faixas valem só no Brasil.** Os produtos estão disponíveis só no Brasil nas duas lojas.

- **Android:** o código segue do link da Play Store até o app (install referrer).
- **iPhone:** a pessoa instala o app e abre o link de novo ou digita o código em Ajustes → Plano.
- **Nas duas lojas,** o PRO passa a abrir o paywall da faixa do parceiro, com o preço com desconto e a compra dentro do app. Por isso toda compra com desconto fica com o parceiro.

## Configuração (feita em 25/11/2026 para P5 e P10)

- [x] **App Store Connect:** no grupo "Reprize Pro", as assinaturas `pro_annual_p10`, `pro_monthly_p10`, `pro_annual_p5`, `pro_monthly_p5`: só Brasil, nome na loja igual ao PRO normal ("Reprize Pro Anual" / "Reprize Pro Mensal", pt-BR e en-US), teste grátis de 1 semana no Brasil, captura e nota para a revisão. **Vão para revisão junto com a versão 1.1.0.**
- [x] **Play Console:** planos base `annual-p5`/`annual-p10` em `pro_annual` e `monthly-p5`/`monthly-p10` em `pro_monthly`, só Brasil, cada um com a oferta `trial-7d` (aquisição de novos clientes, 7 dias grátis). As ofertas antigas `p10-primeiro-ano` e `p10-primeiro-mes` foram desativadas.
- [x] **RevenueCat:** os 8 produtos ligados ao entitlement `pro`; ofertas `partner_p5` e `partner_p10` com os pacotes anual e mensal das duas lojas; paywalls "Assinatura Parceiros P5" e "Assinatura Parceiros" publicados com o subtítulo "Desconto por indicação: X% em todos os pagamentos.". Metadados: `{ "discountPercent": 5, "partners": {} }` e `{ "discountPercent": 10, "partners": { ... } }`.
- [ ] **Site (reprize-lp):** publicar o PR #30, com as variáveis `PUBLIC_APP_STORE_PROVIDER_TOKEN` e `PUBLIC_PLAY_STORE_URL`.
- [x] **Links universais:** `apple-app-site-association` e `assetlinks.json` no PR #30 do site.
- [ ] **Notas para a revisão da Apple** (colar no envio da 1.1.0): "Referral price tiers (pro_annual_p5, pro_monthly_p5, pro_annual_p10, pro_monthly_p10) are offered only inside the app, after the customer enters a partner's referral code in Settings › Plan. They unlock the same Pro features at a lower price."

As ofertas por código antigas da Apple (`P10_ANUAL`, `P10_MENSAL`) foram desativadas em 25/11/2026 (não podem ser reativadas). O app 1.1.0 não usa códigos de oferta da Apple.

## Criar um parceiro (sem build e sem revisão)

1. **Escolha o código e a faixa.** Só letras e números, sem acento, fácil de falar. Confira que o código não existe em nenhuma faixa.
2. **RevenueCat:** Offerings → `partner_p10` (ou `partner_p5`) → Metadata. Acrescente o parceiro e salve:
   ```json
   { "discountPercent": 10, "partners": { "PROFJOAO": { "name": "Prof. João" } } }
   ```
   O `name` aparece para quem recebeu o link. O app lê a lista na próxima abertura. Cada oferta aceita até 4.000 caracteres de metadados, cerca de 100 parceiros.
3. **Mande ao parceiro** o link e um texto pronto, por exemplo:
   > Gravo meus lances de beach tennis com o Reprize. Com meu link você tem desconto no PRO: https://reprizeapp.com/p/PROFJOAO (ou use o código PROFJOAO dentro do app).
4. **Teste** abrindo o link em um iPhone e em um Android sem o app.

## Mudar, remover ou criar faixa

- **Mudar de faixa:** mova o parceiro de uma oferta para a outra nos metadados. Quem ainda não comprou passa a ver a nova faixa na próxima abertura. Quem já comprou não muda.
- **Remover:** tire o parceiro dos metadados. Quem já foi atribuído continua atribuído, e ninguém novo entra.
- **Nova faixa (ex.: P20):** sem build. Crie as duas assinaturas na Apple (mesmo grupo, só Brasil, teste de 1 semana, captura e nota) e envie para revisão sozinhas; crie os dois planos base no Play com a oferta `trial-7d`; no RevenueCat, importe/crie os produtos, ligue ao `pro`, duplique uma oferta `partner_p*` com o paywall e ajuste pacotes, subtítulo e `discountPercent`.
- **Mudar o preço normal do PRO:** os preços das faixas são fixos. Ajuste cada faixa à mão nas duas lojas para manter o percentual.

## Fechamento mensal da comissão

Conta como **assinante válido** quem, na data de fechamento, tem PRO pago e vigente, nunca tinha pago o PRO antes de aplicar o código do parceiro e não está em teste grátis, com reembolso, em carência ou com pagamento em atraso.

Regras decididas em 24/11/2026:
- **Carência e pagamento em atraso não contam.** O assinante volta a contar no mês em que a loja confirmar o pagamento.
- **Quem já foi assinante não conta**, mesmo que tenha cancelado e voltado com o código de um parceiro.
- **Conta qualquer plano PRO pago depois do código, com ou sem desconto.**

1. **Escolha uma data fixa (D)** e use a exportação **Transactions** do RevenueCat gerada depois dela.
2. **Filtre as transações:**
   - `is_sandbox = false`, `is_trial_period = false` e `refunded_at` vazio
   - `store` em `app_store` ou `play_store`, e `ownership_type = PURCHASED`
   - `product_identifier` nos produtos PRO (`pro_annual`, `pro_monthly`, `pro_annual_p*`, `pro_monthly_p*` e os planos `annual-p*` e `monthly-p*`)
   - `start_time` até D, e `end_time` e `effective_end_time` depois de D (`effective_end_time` sozinho incluiria a carência)
3. **Fique com a transação mais recente de cada cliente** e leia `partner_code` e `partner_applied_at` em `custom_subscriber_attributes`.
4. **Ache a primeira cobrança da assinatura:** a transação mais antiga, fora de teste grátis, com o mesmo `original_store_transaction_id`.
5. **Exclua quem já pagou o PRO antes do código:** a primeira cobrança precisa ser igual ou posterior a `partner_applied_at`, e o cliente não pode ter **nenhuma** transação paga do PRO (de qualquer `original_store_transaction_id`) antes de `partner_applied_at`. No Google Play, quem assina de novo depois de cancelar recebe uma assinatura nova, então só o passo anterior não basta.
6. **Aplique a espera de 30 dias:** a primeira cobrança precisa ter pelo menos 30 dias em D. Renovações não reiniciam essa contagem.
7. **Exclua autoindicações**, como a assinatura do próprio parceiro.
8. **Agrupe por parceiro e por plano.**
9. **Guarde a planilha do mês**, com a data e o valor pago a cada parceiro.

Para acompanhar ao longo do mês, crie uma **Audience** no RevenueCat por parceiro: `partner_code` igual ao código, status `Active`, produto mais recente nos produtos PRO e `Currently trialing` falso. Na primeira vez, confira o total com "Export all".

## Outros relatórios

| Pergunta | Onde |
|---|---|
| Aberturas do link de cada parceiro | Vercel → Web Analytics → páginas `/p/CODE` |
| Instalações no iPhone por parceiro | App Store Connect → App Analytics → Campanhas (precisa de `PUBLIC_APP_STORE_PROVIDER_TOKEN`) |
| Códigos aplicados, por origem | PostHog → evento `partner_code_applied`, por `code` e `source` |
| Da oferta à assinatura, por parceiro | PostHog → funil por `partner`: `partner_offer_opened` → `paywall_viewed` → `purchase_completed`, nas duas lojas |

Anote aqui, ao fazer a primeira vez, o caminho exato de cada painel e o que a Apple de fato mostra por código.

## Quando rever a decisão de construir

Quando o fechamento manual pesar, ou se a comissão virar contrato, avaliar uma ferramenta (Insert Affiliate, WinWinKit) que lê o atributo `partner_code` do RevenueCat e cuida do pagamento.
