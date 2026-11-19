# Modelo de negócio e pagamentos

> **Fonte da verdade** das regras de plano. Detalhes técnicos da cobrança: `docs/superpowers/specs/2026-10-20-payments-revenuecat-design.md`. Textos e visual do paywall: `docs/brand/paywall-reprize.md`.
>
> **Status:** implementado no app (branch `feat/freemium-pro-billing`); faltam a configuração do RevenueCat e das lojas e desligar o teste de campo antes de publicar ([Implementação](#implementação)). O [compartilhamento](#compartilhamento) está especificado e ainda não implementado.

## Resumo

Gravações **ilimitadas** no grátis. Dentro do app, todo jogador vê e usa tudo na qualidade gravada, com som, Modo Foco e velocidade. O plano muda só estas coisas:

1. a **duração do clipe** e a **gravação em 4K**, escolhidas antes de começar a gravação (grátis: 15 s e Full HD);
2. **o que sai do app** ao salvar ou enviar (grátis: HD, sem som, sem Modo Foco e com marca d'água);
3. **compilar clipes**;
4. o gatilho **Apple Watch**.
5. **compartilhar** gravações e clipes por link: só o PRO envia; quem recebe sempre assiste, e exportar o que recebeu depende do plano ([Compartilhamento](#compartilhamento)).

Antes de exportar no grátis, o jogador sempre vê o que o PRO coloca no vídeo (Full HD, som, Modo Foco, sem marca d'água): um painel destacado na primeira exportação de cada gravação; as seguintes seguem sem aviso. O painel mostra o próprio clipe como sai no grátis e no PRO. Nenhuma trava aparece de surpresa.

## Planos

| Recurso | Grátis | PRO |
|---|---|---|
| Gravações | **Ilimitadas** | Ilimitadas |
| Clipes por gravação | Ilimitados | Ilimitados |
| Qualidade da gravação | **Full HD** (4K com cadeado "PRO") | Full HD ou 4K, a que o jogador escolher |
| Áudio na gravação | Gravado | Gravado |
| Duração do clipe | **15 s** (as outras opções com cadeado "PRO") | 15, 30, 45 ou 60 s, a que o jogador escolher |
| Prévia e editor no app | Tudo funciona: som, Modo Foco, velocidade, zoom, girar, cortar | Igual |
| Exportação (salvar, enviar, em lote) | **HD** (720×1280; 1280×720 deitado), **sem som**, **sem Modo Foco**, **com marca d'água discreta**; a velocidade escolhida vai no vídeo | Full HD (4K ou 2K num clipe gravado em 4K), som, Modo Foco, velocidade, sem marca |
| Compilar clipes | Bloqueado (abre o paywall) | Liberado |
| Compartilhar gravação ou clipe por link | Bloqueado (cadeado "PRO", abre o paywall) | Liberado |
| Gravação recebida: assistir no app | Tudo, na qualidade gravada, com som e Modo Foco | Igual |
| Gravação recebida: salvar e enviar | **1 gravação de cortesia no total** (não renova): Full HD, som, Modo Foco, **com marca d'água**; depois delas, bloqueado (abre o paywall) | Full HD (4K ou 2K num clipe gravado em 4K), som, Modo Foco, sem marca |
| Gravação recebida: compilar | Bloqueado (abre o paywall) | Liberado |
| Gatilhos | Tela, voz, gesto, controle Bluetooth, celular controle | Todos, **incluindo o Apple Watch** |

Livres nos dois planos, inclusive no vídeo exportado: velocidade (câmera lenta e acelerada), zoom, girar, cortar, salvar e enviar (um clipe ou em lote). Vale para as gravações próprias; as recebidas seguem [Compartilhamento](#compartilhamento).

**Nome do gatilho:** o gatilho do relógio se chama **Apple Watch** em todos os textos do iPhone.

**Termos:** **gravação** é a sessão, do "Começar gravação" ao "Encerrar"; **clipe** é o vídeo salvo (duração do clipe, editor, exportar, compilar clipes); **lance** é a jogada e entra na copy de emoção, como "melhores lances" e "salvar o lance".

### Duração e janela de gravação

- O jogador escolhe a duração do clipe na preparação: **15, 30, 45 ou 60 s** (padrão 15 s; no grátis só 15 s).
- Durante a gravação, o app guarda só uma janela recente na memória e apaga o resto na hora: **60 s no PRO, 15 s no grátis**.
- Cada clipe salvo guarda no arquivo **a duração escolhida mais 2 s de margem** (`KEEP_MARGIN_MS`, em `session/cut.ts`), para o editor ter folga no começo. O corte nunca volta antes do fim do clipe anterior e tem no mínimo 3 s.

## Transparência das travas

O jogador vê o que é PRO antes de exportar, em quatro lugares:

- **Preparação:** a duração acima de 15 s, a qualidade 4K e o Apple Watch têm cadeado e selo "PRO"; tocar abre o paywall. Nada começa sozinho depois de uma compra.
- **Editor (gravação grátis):** Som e Modo Foco funcionam, com selo "PRO" e a dica "O som toca aqui no app, mas só vai no clipe salvo ou enviado com o PRO" (o mesmo para o Modo Foco). A prévia mostra a marca d'água.
- **Card PRO na tela de uma gravação grátis:** curto ("Seus clipes com qualidade PRO" · "Full HD, som, Modo Foco e sem marca d'água." · Liberar). Tocar abre o mesmo painel do aviso de exportação, com o título "Libere a qualidade PRO nesta gravação": **Assinar o PRO** abre o paywall `default` (mensal e anual) e **Só para esta gravação** abre o Passe (oferta `pass`, ou o Passe guardado). Sem "Continuar no plano grátis", porque nada está sendo exportado; fecha pelo X. Aparece sempre que o jogador toca, mesmo depois do aviso de exportação. "Minhas gravações" não tem card PRO.
- **Aviso antes de exportar** (salvar ou enviar, um clipe ou em lote), contado **por gravação**:
  - **Painel destacado na primeira exportação de cada gravação:** título único conforme o botão tocado (Salvar: "Salve seus clipes com qualidade PRO"; Enviar: "Envie seus clipes com qualidade PRO"). Logo abaixo, um selo diz o que o clipe tem e o vídeo grátis deixa de fora: "Seu clipe tem som", "Seu clipe tem Modo Foco" ou "Seu clipe tem som e Modo Foco" ("Seus clipes têm…" no lote); sem selo quando o clipe não tem nenhum dos dois. Em seguida, **duas prévias do próprio clipe**, lado a lado:
    - **GRÁTIS:** a mesma imagem (sem escurecer), selo HD, som cortado e marca d'água; lista "Sem som", "Sem Modo Foco", "HD", "Com marca d'água".
    - **PRO:** borda âmbar, selo Full HD, som e o quadro do Modo Foco quando o clipe usa; lista "Com som", "Com Modo Foco", "Full HD", "Sem marca d'água".
    - O que o clipe usa vem primeiro nas duas listas e, no grátis, em laranja com "X" (cor de aviso; o vermelho é só de "gravando"). "Sem Modo Foco" fica sempre assim, mesmo quando o clipe não usa o Modo Foco, porque o grátis nunca o leva.
    - Ações: **Assinar o PRO** (botão principal, Âmbar com coroa e a linha "Todas as gravações · mensal ou anual"; planos e teste ficam no paywall) · **Só para esta gravação** (só contorno, discreto), com a linha "Pagamento único · todos os clipes inclusos" (o Passe; abre "Só para esta gravação") · **Continuar no plano grátis** (link) · **X** para cancelar.
  - **Exportações seguintes da mesma gravação:** seguem direto, sem nenhum aviso.
  - Exemplo: 5 gravações numa manhã de basquete. O primeiro clipe exportado de cada uma das 5 mostra o painel destacado; do segundo clipe em diante, nenhuma mostra aviso. Uma exportação em lote conta como uma exportação daquela gravação.

Compilar no grátis abre o paywall direto.

## Compartilhamento

Detalhes técnicos: `docs/superpowers/specs/2026-11-16-recording-sharing-design.md`. Só no iPhone; o Android entra depois que o app estiver publicado na Google Play.

### Envio

- **Só o PRO** cria link de uma gravação ou de um clipe. No grátis, o botão Compartilhar tem cadeado e selo "PRO" e abre o paywall.
- **Só de gravação encerrada.** Durante uma gravação o app não cria link nem envia arquivos; se uma gravação nova começa com envios pendentes, eles pausam e continuam quando ela termina.
- O link é `www.reprizeapp.com/v/<código>`, o mesmo formato para gravação e para clipe, mostrado também como QR code. Quem tem o link pode abrir.
- Vai o arquivo original de cada clipe, com os dados de edição e de foco. Nada é exportado de novo no aparelho de quem envia.
- **O link vale 24 horas** a partir da criação. Depois disso ele para de funcionar e os vídeos são apagados da nuvem. Quem gravou pode compartilhar de novo, o que gera outro link.
- No primeiro compartilhamento, a pessoa aceita um **termo de responsabilidade** (ciente de que responde pelo conteúdo e de que o Reprize não controla o que foi gravado). Sem o aceite, o link não é criado.
- Quem gravou pode desligar o link antes do prazo e ver quem entrou.

### Recebimento

- A página do link, na web, mostra só o clipe de capa como prévia (HD, sem som, com marca d'água). O resto abre no app.
- No app, **assistir é livre em qualquer plano**, na qualidade gravada, com som, Modo Foco e os ajustes de quem enviou. Abrir a gravação dentro das 24 horas baixa os vídeos para o aparelho; eles ficam dentro do app, fora da galeria.
- Toda gravação recebida leva o marcador "Compartilhada por <nome>".
- **PRO que recebe:** tudo liberado, como numa gravação própria.
- **Grátis que recebe:** **1 gravação de cortesia**, no total, sem renovação (eram 3 até 18/11/2026). A cortesia é gasta no primeiro Salvar ou Enviar de uma gravação, depois de uma confirmação, e libera todos os clipes daquela gravação: Full HD, som, Modo Foco, **com marca d'água**. Depois de usada, Salvar e Enviar de outra gravação recebida abrem o paywall. Compilar é sempre do PRO.
- O contador de cortesias fica no servidor, ligado à conta; por isso exportar uma gravação recebida exige conta.
- O **Passe Avulso não se aplica** a gravações recebidas.
- Quem recebe edita a própria cópia; nada volta para quem enviou. Quem recebe não cria link da gravação dos outros.

### Captura de tela

Nas gravações recebidas, em qualquer plano, o vídeo não aparece em print nem em gravação de tela: no lugar dele, uma tela escura com a mensagem "Este lance não pode ser capturado. Para guardar, toque em Salvar." Nas gravações próprias nada muda.

## Como se paga

- **PRO** (assinatura, entitlement `pro`): `pro_monthly` **R$ 14,90/mês** e `pro_annual` **R$ 119,90/ano** (≈ R$ 9,99/mês, 33% abaixo de 12 mensalidades). Nos EUA: **$6.90/mês** e **$49.90/ano** (≈ $4.16/mês, 40% abaixo de 12 mensalidades). **Teste grátis de 7 dias no anual e no mensal; a loja cobra no oitavo dia.**
- **Passe Avulso** (consumível, `single_pass`, **R$ 4,90**; **$2.49** nos EUA), oferecido como **"Só para esta gravação"**:
  - é usado **só quando o jogador escolhe**, numa gravação grátis já feita; nunca é gasto sozinho ao começar uma gravação;
  - libera nessa gravação a exportação em Full HD, com som, com Modo Foco, sem marca, e compilar os clipes dela;
  - não libera duração acima de 15 s nem 4K, porque a gravação foi feita em 15 s e Full HD;
  - não se aplica a gravações recebidas: nelas valem as cortesias ou o PRO;
  - um Passe comprado e ainda não usado fica guardado para a próxima vez que o jogador escolher liberar uma gravação.
- **Paywall** (RevenueCat): a oferta `default` tem só Anual (pré-selecionado, com preço mensal equivalente e selo de economia calculado pelo painel) e Mensal. O Passe fica numa oferta própria (`pass`), aberta por "Só para esta gravação", com o mesmo visual. Textos e prompts do painel: `docs/brand/paywall-reprize.md`.
- Preço e moeda vêm sempre da loja; nenhum valor no código.

## Como o app decide

- **Ao começar uma gravação** (`startPlan`): PRO ativo → gravação paga; senão → gravação grátis. O plano nunca impede de começar.
- O plano da gravação fica **fixado no início** (`Session.paid`). Com PRO ativo, todas as gravações exportam como pagas enquanto ele durar (`useViewPlan`); uma gravação grátis liberada com o Passe passa a ser paga.
- Nada de cobrança durante a gravação.
- **Gravação recebida** (`Session.received`): com PRO ativo, exporta como paga. Sem PRO, exporta como paga e com marca d'água se tiver cortesia aplicada; sem cortesia, Salvar, Enviar e Compilar ficam bloqueados. O Passe não se aplica.

## Depois de publicar

Tudo é teste até a publicação. Depois de publicar, os números (conversão por ponto de venda, uso do aviso de exportação, compras de Passe) decidem os ajustes. Se for preciso limitar o grátis, o limite de gravações vale só para quem instalar a partir dali; quem já usa fica como está.

## Implementação

- [x] `payments/rules.ts` e `payments/types.ts`: `startPlan` só com PRO → grátis; sair o teto mensal (`FREE_RECORDINGS_PER_MONTH`, `monthKey`, `freeLeft`), o kind `blocked` e o kind `credit` (o Passe não é mais gasto no início).
- [x] `data/repo.ts` e `payments/store.ts`: sair o contador `freeCount` e a reconferência do mês.
- [x] `session/useReplaySession.ts`, `app/setup.tsx` e `session/RemoteStartListener.tsx`: sair o início bloqueado, a linha "Restam N gravações grátis" e a linha "Seu Passe Avulso será usado nesta gravação".
- [x] Apple Watch e celular controle: sem aviso de limite mensal (não havia `startAllowed` no código).
- [x] `payments/limits.ts`: `captureConfig` e `qualityAllowed` continuam (grátis em Full HD, 4K só no pago, 15 s); `PAID_TRIGGERS = ['watch']`. Conferir os cadeados "PRO" do 4K e das durações acima de 15 s na preparação.
- [x] Exportação grátis em HD: 720 incluído em `share/exportSize.ts` (`ShortSide`, `FREE_SIDE`, estimativa de tamanho); o grátis não oferece escolha de tamanho em `app/clip/[id].tsx`.
- [x] `share/exportOptions.ts`: grátis em 720, com a velocidade escolhida (sai o `speed = 1` do grátis), sem som, sem Modo Foco, com marca; pago em Full HD ou 4K/2K; `freeLosses` inclui a resolução e tira a velocidade.
- [x] `components/FreeExportSheet.tsx` e `components/useFreeExportGate.tsx`: painel destacado na primeira exportação de cada gravação; as seguintes, sem aviso; o mesmo no salvar e enviar em lote; ação "Só para esta gravação".
- [x] Guardar por gravação que o painel já apareceu (`Session.freeNoticeShown`, em `data/schema.ts` e `data/repo.ts`).
- [x] `payments/unlock.ts`: Passe guardado ou compra pela oferta `pass`; o Passe comprado nesse fluxo é usado na gravação.
- [x] Editor: selo "PRO" em Som e Modo Foco numa gravação grátis; Velocidade sem selo.
- [x] Marca d'água discreta no grátis (redesenho em `share/ShareOverlay.tsx`).
- [x] Textos pt-BR e en (`src/i18n/locales/*.ts`, `locales/*.json`): conferir a regra de termos (clipe = vídeo salvo; lance = jogada e copy, como "melhores lances"); "Relógio" → "Apple Watch"; sair os textos de teto mensal e de Passe no início; revisar `summary.freeNote`, `games.proMessage`, `unlock.message`, `clip.focusPro`, `clip.speedFree` (sai), `clip.soundFree`, `freeExport.*`, `setup.watchProOnly`, `setup.proOnly`.
- [x] Testes: `rules`, `store`, `snapshot`, `unlock`, `setup`, `session`, `useFreeExportGate`, `exportOptions`.
- [ ] RevenueCat e lojas: oferta `default` com Anual (pré-selecionado) e Mensal; oferta `pass` com o `single_pass`; teste de 7 dias no `pro_annual` e no `pro_monthly`; paywall e descrições conforme `docs/brand/paywall-reprize.md`.
- [ ] `FIELD_TEST_UNLOCK_ALL` em `false` antes de publicar.
- [x] Rodar `npx jest`, `npx tsc --noEmit` e `npx expo lint` em `app/`.
- [ ] Compartilhamento (spec `2026-11-16-recording-sharing-design.md`): `canShare` em `payments/limits.ts` e cadeado "PRO" no botão Compartilhar da gravação e do clipe.
- [ ] Gravação recebida: `Session.received`, exportação conforme PRO ou cortesia, bloqueio de Salvar, Enviar e Compilar sem cortesia, contador de cortesias no servidor e painel "Usar cortesia" / "Assinar o PRO".
- [ ] Termo de responsabilidade no primeiro compartilhamento e proteção contra print e gravação de tela nas gravações recebidas.
- [ ] Alinhar `docs/brand/paywall-reprize.md` (item "Compartilhar gravações" na grade do PRO), o spec de pagamentos e a seção de monetização de `docs/superpowers/specs/2026-10-17-lance-design.md`.

## Onde fica cada regra

| Regra | Onde fica |
|---|---|
| Decisão do início (PRO → grátis) | `payments/rules.ts` (`startPlan`) |
| 15 s no grátis (`FREE_MAX_SECONDS`) e Full HD no grátis, aplicados na captura | `payments/limits.ts` (`captureConfig`, `qualityAllowed`) e preparação em `app/setup.tsx` |
| Durações oferecidas e janela de gravação | `data/schema.ts` (`CLIP_SECONDS_OPTIONS`, `BUFFER_SECONDS`) e `modes/registry.ts` |
| Margem de 2 s por clipe salvo | `session/cut.ts` (`KEEP_MARGIN_MS`, `keepMsFor`) |
| Gatilho pago (`PAID_TRIGGERS = ['watch']`) | `payments/limits.ts` (`triggerAllowed`), usado em `app/setup.tsx` e `session/SessionContext.tsx` |
| Resolução, som, Modo Foco e marca d'água na exportação | `share/exportOptions.ts` e `share/exportSize.ts`; a marca é desenhada por `share/ShareOverlay.tsx` |
| Aviso antes de exportar no grátis | `components/FreeExportSheet.tsx` + `components/useFreeExportGate.tsx`, chamados por `app/clip/[id].tsx` e pelas ações em lote em `app/session/[id].tsx` |
| Compilar pago | `share/useBatchActions.ts` (`compile`) e `canCompile` em `payments/limits.ts` |
| Liberar recursos PRO numa gravação (Passe) | `payments/unlock.ts` |
| Plano na tela | `usePlan` e `useViewPlan`, em `share/entitlement.ts` |
| Compartilhar só no PRO (a implementar) | `payments/limits.ts` (`canShare`) |
| Exportação de gravação recebida e cortesias (a implementar) | `share/exportOptions.ts` e `components/useFreeExportGate.tsx`; contador de cortesias no servidor |

## Ao mudar uma regra

1. Altere a constante ou função no arquivo da tabela acima.
2. Rode `npx jest`, `npx tsc --noEmit` e `npx expo lint` em `app/`.
3. Revise os textos nos dois idiomas.
4. Atualize este documento, a ficha do paywall, o spec de pagamentos e a seção de monetização de `docs/superpowers/specs/2026-10-17-lance-design.md`.
