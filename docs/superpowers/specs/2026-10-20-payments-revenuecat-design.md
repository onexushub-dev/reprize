# Pagamentos com RevenueCat: grátis ilimitado, PRO e Passe Avulso

> Spec técnico da cobrança. As regras de cada plano (o que é grátis e o que é PRO) estão em `docs/modelo-de-negocio-e-pagamentos.md`, a fonte da verdade; este documento diz como o app as aplica.

## Objetivo

- **Grátis:** gravações e clipes ilimitados. Tudo funciona dentro do app; o plano limita a duração do clipe (15 s), a gravação em 4K, o que sai do app (HD, sem som, sem Modo Foco, com marca d'água), compilar e o gatilho Apple Watch.
- **PRO** (assinatura mensal ou anual): libera tudo, em todas as gravações enquanto estiver ativo.
- **Passe Avulso** (compra avulsa), oferecido como "Só para esta gravação": libera a exportação PRO de uma gravação grátis já feita.

**Princípio:** a experiência vem primeiro. Uma gravação em andamento nunca é interrompida nem perde um clipe por causa de pagamento. Nada de cobrança durante a gravação; o plano nunca impede de começar.

## Decisões técnicas

- **Só RevenueCat** sobre Apple IAP e Google Play Billing. Sem Stripe e sem pagamento fora da loja.
- **Sem backend e sem login.** Usuário anônimo (ID do RevenueCat). Login pode vir depois, como convite opcional após a compra (`Purchases.logIn()` junta o histórico anônimo).
- **Moeda e preço vêm sempre da loja.** O país da conta da Apple/Google decide a moeda; o app mostra só o texto de preço da loja/RevenueCat e nunca converte nem fixa símbolo. Nenhum valor nem símbolo de moeda em código ou catálogo. Os valores deste spec são os preços do Brasil e dos EUA.
- **Paywall do RevenueCat**, hospedado e montado no painel, exibido com `RevenueCatUI.presentPaywall()`. O app não chama `purchasePackage`.
- **O Passe é validado no aparelho** (resultado da compra + `nonSubscriptionTransactions`), sem servidor.

## Produtos e ofertas

| Produto | Tipo | Brasil | EUA | Observação |
|---|---|---|---|---|
| `pro_annual` | Assinatura anual, entitlement `pro` | R$ 119,90 (≈ R$ 9,99/mês) | $49.90 (≈ $4.16/mês) | Teste grátis de 7 dias, cobrança no oitavo dia; pré-selecionado no paywall |
| `pro_monthly` | Assinatura mensal, entitlement `pro` | R$ 14,90 | $6.90 | Teste grátis de 7 dias, cobrança no oitavo dia |
| `single_pass` | Consumível | R$ 4,90 | $2.49 | Paywall "Liberar esta gravação" |

**Economia do anual** (selo do paywall, calculado pelo RevenueCat com `{{ product.relative_discount }}` contra o mensal de cada país; nunca digitado):

| País | 12 mensalidades | Anual | Economia | Selo esperado |
|---|---|---|---|---|
| Brasil | R$ 178,80 | R$ 119,90 | 32,9% | ECONOMIZE 33% |
| EUA | $82.80 | $49.90 | 39,7% | ECONOMIZE 40% (ou 39%, conforme o arredondamento do RevenueCat) |

Nos outros países, o preço vem da equivalência automática da loja a partir do preço dos EUA (Apple) ou do preço-base (Google), e a economia acompanha. Conferir os países principais antes de publicar.

- **Oferta `default`:** pacotes Anual e Mensal. Abre pelos cadeados da preparação (duração acima de 15 s, 4K, Apple Watch), por compilar e por "Assinar o PRO" (painel de exportação e card PRO da tela da gravação).
- **Oferta `pass`:** só o `single_pass`. Abre por "Só para esta gravação" (painel de exportação e card PRO da tela da gravação) quando não há Passe guardado.
- Textos e visual do paywall: `docs/brand/paywall-reprize.md`.

## Plano de uma gravação

- `type Plan = 'free' | 'paid'`.
- **Início** (`startPlan({ proActive })`, pura): PRO ativo → `{ kind: 'pro' }`, gravação paga; senão → `{ kind: 'free' }`. Não existe bloqueio nem contador. O Passe nunca é gasto no início.
- **`Session.paid`** é decidido no início e gravado por `repo.startSession`. Se o PRO acabar depois, as gravações feitas com ele continuam pagas.
- **Na tela:** `usePlan()` (preparação e gravação) e `useViewPlan(session)` (gravação feita), em `src/share/entitlement.ts`. Com PRO ativo, toda gravação se comporta como paga na exportação enquanto ele durar; se o PRO acabar, as gravações grátis voltam ao grátis.
- **Captura** (`captureConfig(settings, plan)`, pura, ao abrir a câmera): grátis grava em Full HD (4K vira 1080p60), com som, e com corte e janela de no máximo 15 s; pago usa a qualidade (Full HD ou 4K), a duração (15, 30, 45 ou 60 s) e o som escolhidos, com janela de 60 s.
- **Exportação** (`exportOptions(plan, …)`, pura): grátis em HD (lado curto 720), sem som, sem Modo Foco, com a velocidade escolhida e com marca d'água; pago em Full HD (4K ou 2K num clipe gravado em 4K), com som, Modo Foco, velocidade e sem marca.
- **Gatilho pago:** `PAID_TRIGGERS = ['watch']`, `triggerAllowed(source, plan)`. A trava é sobre ligar o Apple Watch, nunca sobre um toque: um toque que chega durante a gravação sempre vira clipe.
- **Compilar:** `canCompile(plan)`; no grátis abre a oferta `default`.

## Passe Avulso: "Só para esta gravação"

- Usado **só quando o jogador escolhe**, numa gravação grátis já feita. Pontos de entrada: o painel antes de exportar e o card PRO da tela da gravação (que abre o mesmo painel, `useFreeExportGate().offer`). Todos chamam `unlockRecording(sessionId)` (`payments/unlock.ts`).
- **Com PRO ativo:** nada a gastar; a gravação já exporta como paga.
- **Com Passe guardado** (comprado e ainda não usado): pergunta "Usar o Passe nesta gravação?"; ao confirmar, `repo.upgradeSession` marca a gravação como paga, grava o `passTransactionId` e põe o Passe no livro-razão.
- **Sem Passe:** abre a oferta `pass`; depois da compra, o Passe é usado nessa gravação.
- **O que libera:** exportação em Full HD, som, Modo Foco e sem marca, e compilar os clipes dessa gravação. **O que não libera:** duração acima de 15 s e 4K, porque a gravação foi feita assim.

## Aviso antes de exportar (grátis)

- Antes de salvar ou enviar (um clipe ou em lote) numa gravação grátis, com plano de visão grátis.
- **Primeira exportação da gravação:** painel destacado (`FreeExportSheet`) com a lista completa do que o vídeo não terá (HD em vez de Full HD, sem som, sem Modo Foco, com marca d'água), os itens que o clipe usou em destaque e as ações Assinar o PRO · Só para esta gravação · Continuar no plano grátis · Cancelar.
- **Exportações seguintes da mesma gravação:** seguem direto, sem aviso.
- Uma exportação em lote conta como uma exportação daquela gravação. O registro de "painel já mostrado" fica na sessão (`Session.freeNoticeShown`).

## Arquitetura (`app/src/payments/`)

| Unidade | Função |
|---|---|
| `client.ts` | `PaymentsClient`: `configure`, `getSnapshot`, `onSnapshot`, `restore`, `showPaywall(offering)` (`default`, `pass` or `partner`), `partners`, `setPartner`, `redeemOfferCode` (see the partner codes spec of 2026-11-15). |
| `revenuecatClient.ts` | Implementação com `react-native-purchases` e `-ui`. Único arquivo que importa o SDK. O PRO é o entitlement `pro`; o Passe é `single_pass`. |
| `fakeClient.ts` | Cliente falso para Jest e desenvolvimento sem loja. |
| `snapshot.ts` | `customerInfo` → `Snapshot { proActive, passTransactions[{id, productId, purchasedAt}] }`. |
| `rules.ts` | Puras: `availableCredit`, `creditCount`, `startPlan`, `planOf`, `sessionPlan`, `detectPurchase`. |
| `limits.ts` | Puras: `FREE_MAX_SECONDS = 15`, `captureConfig`, `qualityAllowed`, `PAID_TRIGGERS`, `triggerAllowed`, `canCompile`. |
| `unlock.ts` | `unlockRecording(sessionId)`: PRO, Passe guardado ou compra do Passe. |
| `store.ts` | `payments`: snapshot, `nextPlan()`, `credits()`, `showPaywall()`, `restore()`. |
| `feedback.ts` | `openPaywall(t)`, `restorePurchases(t)`. |

## Dados

- `Session.paid: boolean` (gravado no início; `upgradeSession` muda para `true` ao usar o Passe). `Session.passTransactionId?` quando um Passe foi usado nela. `Session.freeNoticeShown?` depois do primeiro painel de exportação.
- MMKV `spentPasses` (livro-razão): só cresce; apagar uma gravação não devolve o Passe.
- Chaves públicas por variável de ambiente (`.env.local`), lidas em `app.config.js`: `appl_…`, `goog_…`, `test_…` (só debug). Nunca chave secreta.

## Invariantes do Passe (manter)

- O crédito disponível é o Passe mais antigo comprado e fora do livro-razão (`availableCredit`).
- **Compra pendente única:** uma compra que o snapshot ainda não explica ocupa o único lugar de pendência, e nenhum outro paywall vende enquanto ela não se explica.
- **Restauração nunca cria crédito:** Passes que aparecem por restauração vão para o livro-razão.
- Leitura do snapshot antes de decidir e antes de restaurar.

## Fluxo de compra

1. Pontos de entrada, sempre fora da gravação: cadeados da preparação, compilar, aviso de exportação, cartão do resumo, som do editor → `openPaywall(t, offering)`.
2. `purchased`: a store lê o snapshot novo; o PRO muda o plano; o Passe vira crédito e, se a compra veio de "Só para esta gravação", é usado nessa gravação.
3. `restored` / "Restaurar compras" (em "Minhas gravações"): volta o PRO; Passes restaurados nunca viram crédito.
4. O listener `onCustomerInfo` atualiza a tela; a preparação destrava e a câmera reabre com a configuração paga. Nada começa sozinho depois de uma compra.

## Erros e situações-limite

| Situação | Comportamento |
|---|---|
| Cancela ou fecha o paywall | Nada muda, sem alerta. |
| Compra falha | Aviso curto (`payments.paywallError`), nada muda. |
| Compra conclui mas o snapshot atrasa | Pendência única; o Passe é usado quando o snapshot o mostrar; nunca cobra duas vezes. |
| PRO vence entre a preparação e o início | O início decide grátis e reabre a câmera com a configuração grátis antes de criar a sessão. |
| PRO vence no meio da gravação | Nada muda nessa gravação (paga até "Encerrar"). A câmera nunca reabre durante a gravação. |
| Sem rede e sem snapshot | PRO e Passes desconhecidos: decide grátis (o SDK costuma ter cache). |
| Apagar uma gravação liberada com Passe | O Passe continua no livro-razão. |
| Reinstalação | PRO volta por "Restaurar compras"; Passes não voltam como crédito. |
| Toque do Apple Watch numa gravação grátis | Não liga o gatilho; um toque que chega durante a gravação vira clipe. |

## Testes

- **Jest:** `startPlan` (PRO e grátis), `availableCredit`, `sessionPlan`, `captureConfig` (grátis: Full HD, 15 s, com som; pago: o modo), `qualityAllowed`, `triggerAllowed` (só `watch` é pago), `canCompile`, `exportOptions` (grátis 720, sem som, sem Foco, com velocidade e marca; pago Full HD/4K), `unlockRecording` (PRO, Passe guardado, compra), aviso de exportação (painel só na primeira exportação da gravação, lote conta uma vez), store (restauração não cria crédito, pendência única), sessão (plano fixado no início, câmera reabre antes do início se o plano mudar, nunca durante).
- **Aparelho:** sandbox da Apple e license tester do Google.

## Critérios de aceite

1. Instalação nova: gravações ilimitadas sem paywall; clipes de até 15 s; captura em Full HD com som; no editor, som e Modo Foco funcionam com selo "PRO".
2. Primeira exportação de uma gravação grátis mostra o painel destacado; as seguintes seguem sem aviso. O vídeo sai em HD, sem som, sem Modo Foco, com marca e com a velocidade escolhida.
3. "Só para esta gravação" com Passe guardado libera a gravação; sem Passe, abre a oferta `pass` e libera depois da compra. O Passe nunca é gasto ao começar uma gravação.
4. Assinar o PRO (mensal ou anual): todas as gravações exportam como pagas; duração até 60 s, 4K e Apple Watch liberados; se o PRO acabar, a gravação em andamento não muda.
5. Cadeados da preparação e compilar abrem a oferta `default` (Anual pré-selecionado; Anual e Mensal com 7 dias grátis); comprar destrava sem começar nada.
6. "Restaurar compras" em instalação limpa devolve o PRO e não cria crédito.
7. `npx jest`, `npx tsc --noEmit`, `npx expo lint` e `swift test` (Core) passam.

## Passos fora do código

1. App Store Connect e Play Console: contratos de apps pagos, dados bancários e fiscais.
2. Produtos nas duas lojas conforme a tabela acima; teste grátis de 7 dias no `pro_annual` e no `pro_monthly` (Apple: oferta introdutória gratuita de 1 semana em cada um; Google: oferta de teste em cada plano base, "novos clientes"). Revisar os preços dos outros países.
3. RevenueCat: entitlement `pro` com `pro_monthly` e `pro_annual`; oferta `default` (Anual, Mensal) e oferta `pass` (`single_pass`); paywalls publicados em pt-BR e en.
4. Regras da Apple: conferir as diretrizes 3.1.1 e 3.1.2 e a apresentação do teste grátis (preço depois do teste, renovação automática, como cancelar) antes de enviar para revisão.
5. Chaves públicas em `app/.env.local`; build de desenvolvimento novo quando módulos nativos mudarem.

## Riscos

- **Crédito validado no aparelho:** aparelho adulterado pode forjar Passes. Aceito na v1. Passes não passam para outro aparelho.
- **Instalação nova recebendo Passes antigos sem restauração:** conferir no sandbox; se acontecer, marcar como usados os Passes do primeiro snapshot da instalação.
- **Grátis ilimitado converte menos:** medir a conversão por ponto de entrada depois de publicar; se for preciso limitar gravações, o limite vale só para novos usuários.
- O paywall hospedado tem o layout que o builder permite. Comissões das lojas e do RevenueCat reduzem a margem; não afetam o design.
