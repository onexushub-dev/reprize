# Backlog técnico

Itens adiados nas revisões finais. Nada aqui bloqueia o uso, mas vale resolver antes do piloto.

## Plano 1 — ReplayCamera
- Capacidade do buffer por número de segmentos; preferir descarte por tempo.
- iOS: start/stopRunning na mesma fila das amostras.
- Android: qualquer pausa da activity (bloqueio de tela, diálogos) zera o buffer.
- Android: ultra-wide acessível só por zoom < 1 em câmera lógica não é usada.
- Android: prévia esticada (TextureView sem transformação).
- Remover o evento de diagnóstico `onGestureDebug` e a rota `/spike` antes da loja.

## Plano 2 — telas e gatilhos
- Erros nativos que não são de calor aparecem todos como "erro na câmera" (LOW_STORAGE no meio do jogo deveria dizer pouco espaço).
- Toque duplo em "Desfazer" pode descontar dois clipes; toque duplo em "Começar jogo" pode iniciar duas vezes.
- Voltar (Android) na tela de erro ou durante o encerramento pergunta de novo se quer encerrar.
- `onError` fora da gravação marca a sessão como encerrada na tela de posicionar.
- Ícones de gatilho na gravação aparecem ativos mesmo com o gesto desligado.
- CAMERA_PERMISSION na tela de posicionar não tem botão "Abrir Ajustes".
- `SavedOverlay` sem `accessibilityViewIsModal`.
- Miniatura: player vaza se a geração nunca terminar; cache guarda clipes apagados.
- Loop do player para se a mídia for mais curta que `durationMs`.
- Repositório: `endSession` com id desconhecido, JSON corrompido, dependência de `this`.
- Promessas sem tratamento (onboarding, háptico).
- Debounce do barramento atravessa jogos.
- Android: abrir a câmera antes da superfície da prévia estar pronta pode deixar a prévia preta — verificar no aparelho.

## Gesto, voz e avisos (revisão de 2026-10-18)
- Miniatura usa sempre o quadro do primeiro corte; depois de editar o corte ela não acompanha (aceitável).
- Voz: ~1–2s de fala se perdem a cada reinício de 50s; um comando bem na virada pode passar.
- ~~Gesto: com muita gente no quadro, os 4 maiores são analisados; jogadores do lado de lá podem ficar de fora.~~ Resolvido no gesto v2 (2026-10-28, PR #17): revezamento entre todos, quem levanta os braços primeiro.
- Android: a ultra-wide geralmente não tem flash e não há alternativa (sem piscada na 0.5x).
- Android: `applyTorch` reconstrói a requisição de captura à mão; compartilhar um único construtor com `open()`.
- iOS: a troca de saída para o alto-falante a cada som pode mudar o microfone usado quando há fone Bluetooth.
- Bloco "Voz" não detecta permissão de fala revogada nos Ajustes.

## Editor, Story e Meus jogos (revisão de 2026-10-18)
- Erros de salvar na galeria/compartilhar (depois de exportar) aparecem como "Não foi possível preparar o vídeo".
- Alças do corte se sobrepõem no mínimo de 3s; a do fim fica por cima e a do início é difícil de pegar.
- `renameSession` com id desconhecido lança erro (a interface já evita).
- Android: overlay some em silêncio se o PNG não decodificar; sem redimensionar em proporções fracionárias; `durationMs` pode vir indefinido do Transformer.
- Android: FileProvider genérico pode conflitar com outra biblioteca no futuro (usar uma subclasse própria).
- iOS: corte que começa depois do fim real da mídia vira erro genérico.
- Jogos não encerrados aparecem em "Meus jogos" com 0 min gravados.

## Plano 4 (modos de uso) — minors adiados
- Template do Story é global: escolher Treino num Story de academia faz o próximo Story de quadra voltar para Placar (guardar por grupo de modo).
- Trocar Quadra ↔ Academia sempre cai no primeiro modo do grupo (lembrar o último modo de cada grupo).
- Dois modos com o rótulo "Outro" (quadra e academia) — diferenciar nas listas e no Story.
- `TEMPLATES` (só quadra) em `story/templates.ts` não é mais usado — remover.
- Android `ReplayEngine.kt`: `ring`/`windowSeconds` trocados na thread do engine e lidos no `saveExecutor` sem `@Volatile`.
- Story de academia pode ter até 120 s: confirmar no aparelho se o Instagram aceita ou divide.
- Clipes de academia ficam com ~90 MB (120 s inteiros) e o espaço livre só é checado no início do jogo.

## Plano 5 (Apple Watch) — adiados
- Web: `ReplayCameraModule.web.ts` não tem `watchSync`; o `SessionProvider` quebra no web (antes só a tela de preparação). Só importa se o web virar alvo.
- Acessibilidade do relógio: o alvo de toque em tela cheia anuncia só "Salvar" no VoiceOver.
- Medir no aparelho: calor do iPhone e quadros descartados com a câmera do relógio ligada por 5 min (o `CIImage` segura um buffer de captura enquanto codifica o JPEG).
- Build: `@bacons/apple-targets` 5.0.0 exige CocoaPods ≥ 1.17 (máquinas de build/EAS também); `deploymentTarget` 11.0 deixa de fora Series 4/5.
- Rodar o app do relógio pelo Xcode reinstala o app do iPhone em Debug: colocar a configuração Run do esquema "LANCE Watch" em Release.
- Quando o iPhone mata o app com o relógio em alcance, um toque no relógio ainda tenta abrir o app em segundo plano (a mensagem pode chegar antes do módulo estar pronto); hoje a tela do relógio vira "Sem conexão" em até 12 s.
- Câmera ocupada por outro app (ligação de vídeo no Meet/FaceTime): o iOS devolve -11800 e a tela só diz "A gravação parou: erro na câmera". Mostrar "A câmera está em uso por outro app. Encerre a ligação e tente de novo." quando o erro vier logo ao abrir.

## Editor unificado (zoom e velocidades)
- Android: a exportação ignora `crop` (zoom da prévia não vai para o arquivo). Fazer com `Crop` do Media3 na etapa do Android.
- Android: a exportação também ignora `rotation` (botão Girar do editor). Usar `ScaleAndRotateTransformation` do Media3.

## Modo Foco (2026-10-23)
- Medir no iPhone XR: tempo de análise e de exportação (meta: clipe de 30 s analisado em até ~30 s).
- Exportar um clipe horizontal com Modo Foco e conferir a marca d'água no canto em todos os quadros.
- Checklist de campo da spec (§8): contra-ataque, jogada parada, público perto da quadra, jogo inteiro com calor e bateria.
- Story a partir de clipe horizontal com o enquadramento vertical (decisão própria: muda o "nunca cortar a quadra").
- Bola por esporte (Create ML ou modelo Apache 2.0; nunca Ultralytics/AGPL no app).
- (revisão) Espelhar o zoom manual nos valores animados em `onChange`, não em `useEffect` (1 quadro de atraso na pinça e possível piscada do quadro inteiro ao assumir o enquadramento).
- (revisão) `focusQueue.ensure` deve pôr o clipe aberto na frente da fila (hoje espera atrás do acúmulo de um jogo quente).
- (revisão) Testar o filtro de pessoas paradas diretamente (o teste da arquibancada distingue 0,46 de 0,50 só).
- (revisão) Segurar para ver o original: limpar o timer ao desmontar e soltar o `peek` se o acompanhamento mudar durante o toque.
- (revisão) Vídeo quadrado: analisador usa largura >= altura, editor usa largura > altura.
- (revisão) Teste do layout do overlay (retrato e paisagem) prometido na spec §4.5.

## Tela do clipe: assistir + editar (revisão de 2026-10-23)
- Cancelar sem mudança não deveria regravar nem voltar o vídeo ao início do corte; também sincronizar o Modo Foco com o corte restaurado quando pausado.
- Se o início útil do clipe (`findContentStart`) chegar depois de abrir o modo edição, o Cancelar regrava o corte antigo: ajustar o instantâneo ao novo início.
- Tocar no selo do Modo Foco deveria contar como "última ferramenta usada".
- Altura fixa para o painel das ferramentas (hoje o vídeo muda de tamanho ao trocar de ferramenta).
- Trocar de modo remonta o vídeo: a entrada suave do Modo Foco se repete e pode piscar no Android. Conferir no aparelho.
- Barra de progresso: a bolinha deveria seguir o dedo enquanto arrasta, e falta acessibilidade (ajustável no VoiceOver/TalkBack).
- Alvos de toque abaixo de 44 pt: play da barra (40), selo do Modo Foco (36), botões redondos (42).
- Acessibilidade: selo "preparando" sem estado ocupado; barra de ferramentas sem papel de lista de abas; título EDITAR sem papel de cabeçalho.
- Segurar para 2x com o vídeo pausado mostra o selo 2x mas não toca (o Reels toca enquanto segura).
- Se o clipe sumir no modo edição, o primeiro "voltar" do Android é engolido.

## Feature futura: sugestão de corte e melhores momentos (protótipo de 2026-10-27)
- Ideia: achar sozinho o lance dentro de um clipe "puro" e sugerir o corte no editor (a pessoa aceita ou ajusta); com os cortes, "Compilar" junta todos os clipes no estado atual num vídeo só.
- Protótipo fora do app em `docs/highlights/` (só local, ignorado pelo git): scripts em Python, `relatorio.html` e os vídeos em `out/`. Como rodar: `docs/highlights/LEIAME.md`.
- Regra testada: movimento só dos jogadores na quadra (quem passa perto da câmera é ignorado) + sons secos de batida, a cada 100 ms; o trecho de atividade mais perto do gatilho vira o corte (6–15 s, termina no gatilho).
- Resultado com os 7 clipes da gravação de 26/10 (beach tennis): coincidência média de 73% com a referência marcada a olho, 5 de 7 acima de 88%.
- Pendências antes do app: testar com basquete e outros ângulos de câmera; gatilho falso do gesto (saque com braços para cima) gera clipe sem lance no fim.
- No app (2026-10-27, só iOS): a análise do Modo Foco grava o movimento da quadra (`CourtMotion.swift`) e `src/cutSuggestion/` aplica o corte sugerido quando o clipe ainda está com o corte original. Chave: `CUT_SUGGESTION_ENABLED`. Para remover: a pasta `src/cutSuggestion/`, `CourtMotion.swift` (+ testes), o `motion` em `FocusAnalyzer.swift`, `analyzed` na fila do Modo Foco, `cutSuggestion` no schema/repo e o bloco da sugestão em `app/clip/[id].tsx`.
- Ainda não feito: "Compilar melhores momentos" automático; Android.
- **Removido do app em 2026-11-01**: o corte sugerido não acertava os melhores momentos com segurança e atrapalhava rever e editar o clipe. Saíram `src/cutSuggestion/`, `CourtMotion.swift` (+ testes), o `motion` do arquivo do Modo Foco, o `analyzed` da fila, `cutSuggestion` do schema/repo e o bloco do editor. Na abertura do app, `repo.forgetCutSuggestions()` devolve ao corte original os clipes que a sugestão tinha cortado. O protótipo em `docs/highlights/` continua como referência se a ideia voltar.

## Depois dos testes do gesto: retestar o Modo Foco com a busca em partes do quadro
- Fazer quando os testes de campo do gesto terminarem (`docs/superpowers/spikes/gesture-distance/`).
- O teste de 2026-10-27 mostrou que o Vision devolve as caixas da `regionOfInterest` relativas ao quadro inteiro, não à região. O `docs/focus-refs/tools/vision-probe.swift` convertia como se fossem da região (linha do `fx`/`fy` em `detect`), então os números "tiled" do Modo Foco (23 pessoas/quadro, quase todas fantasmas) estão errados e a ideia pode ter sido descartada por causa do bug.
- O `FocusAnalyzer` hoje só usa o quadro inteiro, que perde jogadores com menos de ~10% da altura da imagem (fundo da quadra).
- Feito em 2026-10-28 (sem mexer no app): `vision-probe.swift` corrigido; `tools/tiles-probe.sh` (Mac, Vision) e `tools/tiles-compare.sh` (FocusPath com o mesmo ajuste V13, só trocando as pessoas de entrada) geram `renders/tiles/<nome>-lado-a-lado.mp4` (ATUAL | COM PARTES DO QUADRO). `focus_variant.py` ganhou `--boxes full|tiled`.
- Resultado em 12 vídeos (7 de beach tennis e 3 de basquete gravados pelo app, 2 do YouTube com câmera parada: `yt-basket-04`, `yt-bt-06`):
  - Ganha muito onde o detector atual perde os jogadores: basquete vertical 23% → 63% dos quadros com alguém, lateral 32% → 66%; o enquadramento deixa de ficar parado no zoom máximo e passa a acompanhar o lance.
  - Fica igual quando os jogadores já aparecem grandes (`yt-basket-04`: zoom mediano 1,17x → 1,18x).
  - Abre demais quando há gente fora do jogo: banco/arquibancada no basquete contra a luz (1,7 → 5,5 pessoas/quadro, zoom some) e pessoas ao fundo do galpão em `yt-bt-06` (zoom mediano 1,37x → 1,15x). No beach tennis do app passa a pegar os 4 jogadores (≈1,5 → 3,5 pessoas/quadro) e abre o enquadramento.
- Próximo passo (depois dos testes do gesto): antes de calcular o enquadramento, ignorar quem está parado ou fora da área de jogo (hoje o V13 só descarta quem é bem menor que os maiores da cena e quem fica parado — conferir por que o banco e o fundo passam); refazer a comparação com `tools/tiles-compare.sh` nos mesmos 12 vídeos. Se ficar bom, levar as partes do quadro para o `FocusAnalyzer` (por exemplo a cada poucos quadros, mantendo as pessoas entre um e outro, como `PersonTracks` no gesto) e conferir o custo de tempo da análise.

## Gesto v2 — pendências (2026-10-28)
- Medir num iPhone mais antigo (ex.: XR/11): no 16 Pro Max cada amostra leva ~55–60 ms; num aparelho mais lento o ritmo cai e o gesto fica mais lento ou falha de longe. Usar a `/spike` (relatório mostra ms por amostra e amostras/s).
- Teste longo de calor: 1 h de jogo real com gesto ligado, pela `/spike` (relatório mostra o tempo em cada nível). Se chegar a critical: avisar no serious, reduzir gesto/Modo Foco antes de cortar a gravação ou começar em 30 fps.
- Android: o gesto ainda é o v1 (ML Kit, uma pessoa, quadro de 640x360) — sem partes do quadro, acompanhamento por pessoa nem FireGate.
- A `/spike` ganhou o teste do gesto (`src/diag/gestureTest.ts`): sai junto com a rota antes da loja (item do Plano 1).

## Modo Foco — zoom e variante "lance" (2026-10-28)
- No app (v15, `rules: v15-acao-zoom110`): `FocusTuning.action.zoomIn = 1.1`, 10% a mais de zoom sobre o v14 "ação" (o limite sobe de 1,5x para 1,65x). Teste de zoom uniforme em 3 vídeos (`tools/zoom-compare.sh`, `renders/zoom/`): +10% manteve quem está em ação sempre no quadro (parados cortados 3–7% do tempo); +20% já corta jogadores 12–14% do tempo; +30% a +50%, um terço a dois terços. Subir só o limite (1,65x–2x) não muda quase nada: quem define o zoom é a distância entre os jogadores.
- Adiado (retomar junto com a detecção de bola): variante "lance" em `focus_variant.py` (`--set lance=1 --set maxZoom=2 --set lanceTop=2 --set lanceMinWeight=1.5 --set widthHoldMs=0`): fecha nos 2 jogadores mais rápidos com 0,8 s de antecipação. Zoom típico 1,5–1,8x, jogadores em ação cortados ≤5%, mas os parados saem do quadro 24–48% do tempo e a câmera se move 2–5x mais. Comparar com `tools/variant-compare.sh <vídeo> lance ...`. Ideias para depois: peso extra para o golpe (pose: pulso rápido acima do ombro), som da batida, escolher por esporte (lance no basquete/futebol, atual no beach tennis/vôlei).

## Métricas de uso anônimas (PostHog, 2026-10-28)
Antes de lançar com a chave:
- No projeto do PostHog, desligar a captura de IP (Settings > Project > General > IP data capture configuration). Na nuvem dos EUA ela vem ligada; o app já desliga o GeoIP, mas o IP da requisição só deixa de ser guardado com essa opção.
- Criar o projeto no PostHog Cloud dos EUA (us.posthog.com; o app é usado no Brasil e nos EUA) e colocar a chave pública em `REPRIZE_POSTHOG_KEY` (`app/.env.local` e no EAS). Sem a chave o app não envia nada.
- Gerar um novo dev client: o SDK (`posthog-react-native`, `expo-application`) é nativo.
- Passar pelo app com a chave e conferir em Live Events: cada evento uma vez, só com as propriedades do spec, nenhum perfil de pessoa criado, nenhum IP.
- Política de privacidade: uma linha sobre métricas anônimas de uso e um e-mail para quem quiser se opor (LGPD, legítimo interesse): o app ainda não tem onde desligar.
- Sem tela de configurações, o switch "Métricas de uso anônimas" saiu do app (2026-11-02). O núcleo continua com `analytics.setEnabled()` / `isEnabled()`: quando houver a tela, é só pôr o switch nela. No Data safety do Google Play, declarar a coleta como obrigatória enquanto não houver o switch.
- Etiqueta de privacidade da App Store: dados de uso não vinculados ao usuário; sem pedido de rastreamento (ATT).
- Montar os painéis: retenção, funil do onboarding (etapa 1 até concluir, paywall, compra) e uso das features pelo `session_summary`.

Adiado:
- `paywall_viewed` com origem `onboarding` não existe ainda: nenhuma tela das stories abre o paywall.
- Exportação em lote conta no `session_summary`, mas não gera `export_completed` por clipe (e por isso não diz o plano: só a exportação de um clipe traz `plan`).

## Seguir a Bola (spec 2026-11-09)
- **Antes da loja — créditos CC BY 4.0**: o detector de bola (`ball_tiny_gym`) foi treinado com dados públicos que exigem atribuição. Colocar na tela de créditos/licenças do app: "basketball_detection (cvsense, Roboflow Universe), CC BY 4.0" (detalhes no README do lab, testes 28 e 33).
  - Beach tennis (`ball_tiny_btpl`, testes 45–48), também CC BY 4.0: "Beach Tennis (beach-tennis-analysis, Roboflow Universe, universe.roboflow.com/beach-tennis-analysis/beach-tennis)" e "Beach Tennis (beach-tennis-ball, Roboflow Universe, universe.roboflow.com/beach-tennis-ball/beach-tennis-mg42r)".
- Esporte da gravação: detectado sozinho (teste 43, classificador de cenas da Apple). Conferir no teste de campo, pela tela Diagnóstico, que nenhuma gravação de basquete ficou com "EM BREVE"; se ficar, ajustar o limite (0,4) em `focus/sportCheck.ts`.
