# LANCE — Design (v1)

> Nome provisório. Data: 2026-10-17. Status: aguardando revisão.
> Mockups: https://claude.ai/artifact/2Cj7DeSydAkeWGADELpFKw

## 1. Objetivo

Levar para o celular do praticante o sistema de "replay" que algumas quadras oferecem com câmera fixa e botão físico. O celular, preso na grade ou na areia, grava o jogo inteiro, mas guarda só os clipes que o jogador escolher. O clipe vai para a galeria ou para qualquer app pela folha de compartilhar em dois toques.

- **Público inicial:** praticantes de esportes de areia (beach tennis, futevôlei, vôlei de praia). O app funciona em qualquer esporte de quadra (opção "Outro").
- **Princípios:** sem cadastro, abre direto na câmera, "dois toques até compartilhar", app leve e rápido.

## 2. Decisões tomadas

| Tema | Decisão |
|---|---|
| Plataforma | React Native + Expo (New Architecture, Hermes), iOS e Android |
| Gatilhos v1 | Botão na tela, controle Bluetooth, gesto corporal (braços em X), smartwatch (Apple Watch + Wear OS) |
| Buffer | Janela móvel de 60 s no PRO e 15 s no grátis. O que sai da janela é apagado na hora. Só os clipes salvos ficam no celular; cada um guarda a duração escolhida mais 2 s de margem |
| Duração do clipe | Escolhida na preparação: 15, 30, 45 ou 60 s (padrão 15 s; no grátis só 15 s). Ajustável depois no editor |
| Dados | Só no celular, sem login. Modelo preparado para login futuro |
| Receita | Regras em `docs/modelo-de-negocio-e-pagamentos.md`. Grátis: gravações ilimitadas, tudo funciona no app; clipe de 15 s, gravação em Full HD e exportação em HD, sem som, sem Modo Foco e com marca d'água; compilar e Apple Watch só no PRO. PRO (R$14,90/mês ou R$119,90/ano) libera tudo; o Passe Avulso (R$4,90) libera os recursos PRO na exportação de uma gravação já feita. Kit físico de fixação opcional, vendido fora do app |
| Câmera | Módulo nativo próprio `ReplayCamera` (Expo Modules), sem VisionCamera |

## 3. Experiência do usuário

Fluxo: **Boas-vindas → Posicionar câmera → Gravando → Clipe salvo (repete) → Fim de jogo → Editor → Salvar/Compartilhar.** O paywall só aparece fora da gravação: quando o jogador toca numa opção paga travada na preparação (duração acima de 15 s, 4K, Apple Watch), em compilar, ou no aviso antes de salvar ou enviar no grátis.

### 3.1 Boas-vindas (só na primeira vez)
- Promessa: "Grave o jogo. Guarde só os melhores lances."
- Os 3 passos: prender o celular → fazer o gatilho → postar.
- Aviso de privacidade e memória: "Só os clipes que você salvar ficam no seu celular. O resto é apagado automaticamente."
- Um botão: "Permitir câmera e começar". Sem cadastro.

### 3.2 Posicionar câmera
- Preview em tela cheia com o contorno da quadra como guia e o nível do horizonte.
- Seletor de lente 0.5x / 1x. Padrão: 1x ao abrir o app, mesmo com ultra-wide (2026-11-05); a escolha de 0.5x vale até o app ser fechado.
- Dica: "Atrás da linha de fundo, na altura do ombro".
- Esporte: Beach tennis, Futevôlei, Vôlei de praia, Outro.
- Status dos gatilhos: Tela (sempre ativa), Gesto X (ativo/inativo), Controle (conectado/não), Apple Watch (pareado/"Toque para parear").
- Seção "Clipe": duração (15, 30, 45 ou 60 s), qualidade (Full HD / 4K) e som do clipe; no plano grátis as durações acima de 15 s e o 4K têm cadeado e selo "PRO" (seção 3.5).
- Botão "Começar gravação". Bloqueado só se houver menos de ~500 MB livres; o plano nunca impede de começar.

### 3.3 Gravando
- A tela escurece para economizar bateria, mas a gravação continua.
- Topo: indicador REC, tempo de jogo, temperatura.
- Centro: contador de clipes. Tocar em qualquer lugar salva o clipe.
- Barra "Últimos N s prontos · o resto é apagado" (N = a janela da gravação: 60 s no PRO, 15 s no grátis).
- Indicadores dos gatilhos remotos.
- "Segure para encerrar o jogo" (toque longo, para evitar encerrar por engano).
- Calor: em `serious` por 2 min (ou já quente ao abrir a câmera) o app passa para 1080p/30; em `critical`, para 720p/30 na hora. Só para quando o próprio iOS desliga a câmera. Mostra o aviso "Celular quente… tire a capinha e deixe na sombra".

### 3.4 Clipe salvo (feedback de ~2s)
- Borda e flash na cor de destaque, som curto, vibração no relógio.
- "Clipe #N salvo · via <origem> · últimos N s" (a duração escolhida).
- Botão "Desfazer".

### 3.5 Plano grátis e paywall
Regras completas em `docs/modelo-de-negocio-e-pagamentos.md` (fonte da verdade).
- Grátis: **gravações ilimitadas**, clipes ilimitados. A captura é em Full HD e grava o som; dentro do app tudo funciona (som, Modo Foco, velocidade, zoom, giro, corte). Limites: clipe de 15 s (escolhido antes de começar) e, ao salvar ou enviar, vídeo em HD (720p), sem som, sem Modo Foco e com marca d'água (a velocidade escolhida vai no vídeo). Compilar, 4K e o gatilho Apple Watch são do PRO.
- PRO (Mensal R$ 14,90 ou Anual R$ 119,90; nos EUA $6.90 ou $49.90; 7 dias grátis nos dois planos e cobrança no oitavo dia): durações de 15 a 60 s, gravação em 4K, exportação em Full HD ou 4K com som, Modo Foco e velocidade, sem marca; compilar; Apple Watch.
- Passe Avulso (R$ 4,90; $2.49 nos EUA), oferecido como "Só para esta gravação": usado só quando o jogador escolhe, numa gravação grátis já feita; libera nela a exportação PRO (Full HD, som, Modo Foco, sem marca) e compilar. Nunca é gasto ao começar uma gravação. O plano de cada gravação é fixado no início.
- O paywall abre pelos cadeados da preparação (comprar destrava a opção; nada começa sozinho), por compilar e pelo aviso antes de exportar no grátis: painel destacado na primeira exportação de cada gravação, comparando o clipe no grátis e no PRO; as seguintes seguem sem aviso. Nenhum paywall durante a gravação; a gravação nunca para por causa do plano.
- Pagamento pela App Store / Google Play. Detalhes técnicos em `2026-10-20-payments-revenuecat-design.md`.

### 3.6 Relógio (watchOS e Wear OS)
- Uma tela só: tempo + número de clipes e um botão grande "Salvar clipe".
- O Apple Watch como gatilho é do PRO. No grátis o botão dá lugar a "Disponível no PRO" e o resto continua (tempo, contagem, Começar/Parar). No iPhone o gatilho se chama "Apple Watch".
- Vibração quando o clipe é confirmado.

### 3.7 Fim de jogo
- Resumo: tempo gravado, número de clipes, espaço realmente usado, e a mensagem "o restante do jogo já foi apagado".
- Grade de clipes (miniatura, duração, horário, origem do gatilho).
- Botões "Novo jogo" e "Postar um clipe".

### 3.8 Editor do clipe
- Preview com play.
- Linha do tempo do clipe salvo (a duração escolhida mais 2 s de margem), com a janela de corte ajustável.
- Ferramentas: Corte, Velocidade (inclui câmera lenta, todos os planos), Som (todos os planos no app; na gravação grátis o som não vai no vídeo salvo, selo "PRO"), Zoom e giro.
- Botões "Salvar na galeria" e "Compartilhar".

### 3.9 Exportar e compartilhar (revisado em 2026-10-23: o Story saiu)
- Prévia do quadro vertical 9:16 exportado, com faixas e, no grátis, a marca d'água. O quadro 9:16 fica até o Marcus decidir (pergunta em aberto, seção 12).
- Grátis: HD 720p, sem som, sem Modo Foco, com marca, até 15 s; antes de salvar ou enviar, um aviso lista essas perdas (na 1ª exportação da gravação; as seguintes seguem sem aviso). Pago: Full HD ou 4K, sem marca.
- "Salvar na galeria" e "Compartilhar" (folha de compartilhar do sistema). Sem templates e sem "Postar no Story".

### 3.10 Gesto
- Braços cruzados em X acima da cabeça, mantidos por ~1s. É um gesto deliberado, para não confundir com comemoração.
- Funciona para qualquer pessoa enquadrada.

### 3.11 Identidade visual (proposta dos mockups)
- Fundo escuro (Ink #0B0B09), texto Paper (#F3EDE1).
- Destaque lima "bola de tênis" (#D6F23F); vermelho/laranja para REC e alertas.
- Títulos em Barlow Condensed (estilo placar), texto em Manrope.
- Alvos de toque ≥44px e alto contraste para uso sob sol forte.

## 4. Arquitetura

```
┌──────────── JS (Expo Router + React) ─────────────┐
│ Telas · estado do jogo · paywall · editor · share │
└──────────────▲───────────────────┬────────────────┘
          eventos                   comandos
┌──────────────┴───────────────────▼────────────────┐
│ ReplayCamera (Expo Module nativo, Swift/Kotlin)   │
│ • Captura + preview + lente                       │
│ • Codificador → pedaços de 2s → anel de 30 (60s)  │
│ • Detector de gesto X (Apple Vision / ML Kit)     │
│ • Controle Bluetooth (tecla de volume)            │
│ • Ponte com o relógio (WatchConnectivity / Wear   │
│   Data Layer)                                     │
│ • Temperatura → reduz qualidade                   │
│ • Exportação (AVFoundation / Media3 Transformer)  │
└───────────────────────────────────────────────────┘
Apps de relógio: watchOS (SwiftUI, via expo-apple-targets) · Wear OS (Compose)
```

### 4.1 Stack
- Expo (SDK mais recente), New Architecture, Hermes, Expo Router.
- Reanimated (feedback e editor de corte), MMKV (metadados), RevenueCat (compras).
- Folha de compartilhar do sistema (`expo-sharing`) e galeria (`expo-media-library`). Sem integração com o Instagram.
- Analytics de eventos anônimos (ferramenta a definir no plano).
- EAS Build / EAS Update.

### 4.2 Interface do `ReplayCamera` (JS ↔ nativo)
- **Comandos:**
  - `startSession({ lens, zoom, maxQuality, bufferSeconds, audio })` (`audio: false` = clipe sem trilha de áudio; o microfone continua para a voz)
  - `stopSession()`
  - `saveClip({ source, at })` → `{ clipPath, durationMs }`
  - `exportClip({ clipPath, startMs, endMs, speed, muted, crop, rotation, width, height, overlayPngPath })` → `{ path }` (a camada PNG traz faixas e marca)
  - `setGestureEnabled(bool)`
- **Eventos:**
  - `onTrigger({ source, at })`: vindo de gesto, controle ou relógio
  - `onThermalChange({ level, degraded })`
  - `onInterrupted()` / `onResumed()`
  - `onError({ code })`

### 4.3 Buffer
- Gravação contínua em pedaços de ~2s (MP4 fragmentado) numa pasta temporária. É mantido um anel de 30 pedaços (60s).
- O pedaço que sai da janela é apagado imediatamente. O espaço em uso fica fixo em ~75 MB (1080p60).
- Salvar um clipe = juntar os pedaços da janela atual num MP4, sem recodificar.
- Encerrar o jogo, ou abrir o app depois de ele ter fechado inesperadamente, limpa a pasta temporária.

### 4.4 Barramento de gatilhos
- Toda origem (tela, gesto, controle, relógio) chama `salvarLance(origem, momento)`.
- Trava de 3s entre salvamentos, para que dois gatilhos quase juntos não salvem o clipe em dobro.

### 4.5 Exportação
- Recodifica aplicando corte, velocidade, zoom, giro, resolução e a camada com a marca.
- O plano da gravação, fixado no início, limita a duração na captura (grátis: buffer e corte de até 15 s) e a exportação (grátis: 720p, sem som, sem Modo Foco, com marca). A captura grava o som nos dois planos; a qualidade é Full HD no grátis e a escolhida (Full HD ou 4K) no pago.

## 5. Dados (no celular)

```
UsuárioAnônimo { id: uuid, criadoEm, revenueCatId }
Sessão         { id: uuid, esporte, início, fim, pago, passeTransaçãoId?, avisoGrátisMostrado? }
Clipe          { id: uuid, sessãoId, criadoEm, origem: tela|gesto|controle|relógio,
                 arquivo, corte: { início, fim } }
Pagamentos     { passesUsados: [transaçãoId] }
Preferências   { lente, duraçãoPadrão: 15, gestoAtivo, relógioPareado }
```

- Os IDs são UUIDs gerados no aparelho, para facilitar o login futuro. O RevenueCat junta o histórico anônimo com a conta quando ela existir.
- Os vídeos ficam na pasta do app. A galeria recebe sempre uma cópia exportada.

## 6. Monetização

A fonte da verdade é `docs/modelo-de-negocio-e-pagamentos.md`; esta tabela é o resumo.

| Regra | Grátis | PRO (R$ 14,90/mês ou R$ 119,90/ano; $6.90 ou $49.90 nos EUA) |
|---|---|---|
| Gravações | Ilimitadas | Ilimitadas |
| Clipes por gravação | Ilimitados | Ilimitados |
| Captura | Full HD, com som | Full HD ou 4K, com som |
| Duração do clipe | 15 s | 15, 30, 45 ou 60 s |
| No app (som, Modo Foco, velocidade, edição) | Tudo | Tudo |
| Exportação | HD 720p, sem som, sem Modo Foco, com marca d'água; velocidade liberada | Full HD/4K, som, Modo Foco, velocidade, sem marca |
| Compilar clipes | Não | Sim |
| Gatilhos | Tela, gesto, voz, controle Bluetooth, celular controle | + Apple Watch |

- **Passe Avulso (R$ 4,90; $2.49 nos EUA), "Só para esta gravação":** usado só quando o jogador escolhe, numa gravação grátis já feita. Libera nela a exportação PRO (Full HD, som, Modo Foco, sem marca) e compilar; não libera duração acima de 15 s nem 4K. Nunca é gasto ao começar uma gravação. Um Passe usado nunca volta a ser crédito, mesmo apagando a gravação.
- O plano de cada gravação (`pago`) é fixado no início e não muda depois; com PRO ativo, todas as gravações exportam como pagas.
- Antes de exportar no grátis, um painel destacado (só na 1ª exportação de cada gravação) mostra o que o vídeo não terá e oferece o PRO ou "Só para esta gravação".
- Anual: R$ 119,90 ≈ R$ 9,99/mês, 33% abaixo de 12 mensalidades (nos EUA, $49.90 ≈ $4.16/mês, 40% abaixo), pré-selecionado no paywall. Anual e Mensal têm teste grátis de 7 dias; a loja cobra no oitavo dia. O Passe não fica no paywall principal. Preços e moeda vêm sempre da loja.
- Conteúdo digital é vendido só pelas compras da loja (Apple/Google). O kit físico é vendido fora do app (link externo, Pix).
- O acordo Apple–CADE (dez/2025) permite link para pagamento externo no Brasil, mas exige login e backend; fora da v1.

## 7. Erros e situações-limite

| Situação | Comportamento |
|---|---|
| Ligação / app em segundo plano | A gravação pausa, os clipes salvos são mantidos e o buffer recomeça ao voltar |
| Superaquecimento | Reduz para 720p/30 e avisa. Em nível crítico, encerra com segurança e mantém os clipes |
| Pouco espaço | Bloqueia "Começar jogo" abaixo de ~500 MB e avisa durante o jogo |
| Permissão negada | A tela explica o motivo e leva aos ajustes |
| Relógio/controle desconectado | O indicador fica cinza e os outros gatilhos continuam funcionando |
| App fechado inesperadamente | Limpa a pasta temporária ao abrir e mantém os clipes já salvos |

## 8. Testes

- **JS (unitários):** trava de gatilhos, regras do Passe e do PRO, plano fixado no início, limites do plano grátis na captura e na exportação, aviso antes de exportar (só na 1ª exportação de cada gravação), estado da sessão.
- **Nativo:** testes do anel de pedaços (descarte e junção), em aparelho real.
- **Campo:** sessões de 2h ao sol, num iPhone e num Android intermediário.

## 9. Etapas

- **Etapa 0, spike (~1 semana):** buffer de 60s + gesto X por 2h ao sol em 2 aparelhos. Critério para seguir: sem queda da gravação, gesto com poucos falsos positivos, aquecimento sob controle.
- **Etapa 1, MVP:** tudo das seções 3 a 8.
- **Fora da v1:**
  - login, nuvem, compartilhar com parceiros e convite de amigos;
  - multi-ângulo, resumo automático do jogo, ranking "Lance da Semana";
  - arenas (B2B) e patrocínio na exportação;
  - loja do kit dentro do app.

### Ordem de entrega (atualizada em 2026-10-18)

Decisão do Marcus: entregar todas as funcionalidades antes de cobrar.

1. Plano 1: motor de câmera (feito)
2. Plano 2: telas, gatilhos e armazenamento (feito)
3. Plano 3: editor, Story (removido em 2026-10-23), nome do jogo e "Meus jogos"
4. Plano 4: modos de uso baseados em predefinições. "Esporte" vira "Modo", agrupado em **Quadra** (beach tennis, futevôlei, vôlei de praia, outro) e **Academia** (musculação, crossfit, funcional, outro). Cada modo é uma entrada de um único registro de predefinições, que o resto do app só lê:
   - guia de posicionamento desenhado sobre a câmera (quadra em perspectiva, silhueta de pessoa, nenhum) e a dica em texto;
   - lente padrão (0.5x quadra, 1x academia);
   - gatilhos ligados por padrão (academia: voz, controle e tela; gesto "braços para cima" desligado, pois exercícios acima da cabeça o disparariam);
   - buffer e corte padrão (quadra 60s / 30s; academia 2 min / 60s);
   - ~~templates e textos do Story~~ (removido em 2026-10-23: o Story saiu do app).
   Ajustes que o usuário fizer ficam salvos por modo. Novos modos (skate, corrida, dança, família) = nova entrada no registro.
5. Plano 5: apps de relógio
6. Android no aparelho e teste de campo
7. Último: pagamento e assinatura (seção 6). `usePlan()` e `session.paid` decidem o que é pago (spec de pagamentos).

## 10. Métricas de sucesso (metas iniciais são hipóteses)

| Métrica | Meta |
|---|---|
| % de jogos com ≥1 clipe salvo | > 70% |
| Clipes postados / salvos | > 30% |
| Uso por gatilho | descobrir |
| Conversão do paywall (por ponto de entrada) | > 5% |
| Volta em 30 dias | > 25% |

## 11. Lançamento

- 2–3 arenas de beach tennis da região como piloto.
- Kit de presente para os primeiros jogadores, em troca de feedback e de Stories marcando o app.

## 12. Questões em aberto

- Nome definitivo do app.
- Ferramenta de analytics.
- Fornecedor e design do kit físico (clipe para alambrado + haste para areia, com quebra-sol).
- Quadro da exportação: manter o 9:16 com faixas (padrão atual) ou mudar.
