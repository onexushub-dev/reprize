# VoiceBench — roteiro do teste

O VoiceBench compara, no mesmo microfone do iPhone, o gatilho de voz de hoje (**Atual**, o ditado da Apple) e o
detector novo de "salvar" (**Novo**, o mesmo código que vai para o Reprize). O resultado decide se o detector novo entra
no app (fase 2 do plano `docs/superpowers/plans/2026-11-24-voice-keyword-detector.md`).

**Critério para levar ao app (Victor, 2026-11-25):** **até 5 m, todo "salvar" é ouvido** (homens e mulheres, sem vento
forte); **até 10 m, a maioria**; **alarme falso é o que não pode acontecer** (jogo, conversa e palavras parecidas), então
na dúvida o modelo fica mais rígido. Mais de 10 m não é preciso.

## Antes de sair de casa

- [ ] iPhone com o VoiceBench instalado (Xcode → ⌘R) e bateria acima de 80%.
- [ ] Trena ou passos contados para 3, 5 e 10 m.
- [ ] Suporte para o celular na mesma posição em que ele fica no jogo (atrás da linha de fundo, deitado, ~1 m de altura).
- [ ] Pelo menos 2 mulheres adultas além do Victor.

## 1. Acerto — por pessoa, por distância

Num dia calmo (sem vento forte), com o celular no suporte:

1. Em **Acerto**, escolha a distância e escreva **quem fala** (o app não inicia sem o nome).
2. **Iniciar.** A pessoa vai até a marca.
3. Ela diz **"salvar" 6 vezes**: as 3 primeiras em voz normal e as 3 últimas mais forte, como no jogo.
   **Espere uns 3 s entre uma e outra** (o Atual ignora um segundo "salvar" que vem antes de 2 s).
4. Ninguém mais fala "salvar" durante a sessão. **Parar.**

Uma sessão por pessoa e distância: 3 m, 5 m e 10 m. São 3 sessões por pessoa, ~1 min cada. Anote se estava ventando.

Os contadores mostram na hora: **Atual** (laranja) e **Novo** (azul), cada um com seu som.

## 2. Ruído — jogo normal

1. Em **Ruído**, **Iniciar** com o celular no lugar de sempre e jogue normalmente, **sem ninguém falar "salvar"**.
2. **Parar** depois de **pelo menos 15 min** (quanto mais, melhor: música, torcida e quadras vizinhas contam).

Cada número que subir aqui é um alarme falso.

## 2b. Parecidas — palavras parecidas com "salvar" (~5 min por pessoa, pode ser em casa)

Mede se o motor confunde "salvar" com palavras parecidas (o Novo v1 dispara com "salvando", "salvamento" e
"salva-me", visto no crossfit em 2026-11-25).

1. Em **Parecidas**, escolha **3 m** e escreva **quem fala**. **Iniciar.**
2. A pessoa lê a lista que aparece na tela, **cada palavra 3 vezes**, ~2 s entre elas, **nunca "salvar"**:
   salvando · salvamento · salva-me · salvador · salvação · salva-vidas · salvei · salvou · salvo · salve · salva ·
   salto · saltar · sacar · salada · pular · cavar · gritar · treinar · jogar · chutar · passar · marcar · parar ·
   ganhar · selar · salgar · sentar · cansar · lançar · tocar · falar · amar · levantar · olhar
   (os verbos em "-ar" entraram depois do teste de campo de 2026-11-25, em que a rc1 disparou com eles).
3. **Parar.**

Todo disparo aqui é confusão. Faça com cada pessoa (Victor e as mulheres): essas gravações também viram exemplos de
"não é salvar" para treinar a próxima versão do modelo (salvar-v2), e o relatório mostra uma tabela à parte, fora da
conta de alarmes do jogo.

## 3. Consumo — um motor por vez

Mede bateria, aquecimento e processador de cada opção. Rode as três na mesma tarde e no mesmo lugar:

| Ordem | Motor | Duração |
|---|---|---|
| 1 | Só microfone (referência) | 10 min |
| 2 | Só atual | 10 min |
| 3 | Só novo | 10 min |

- **Sem cabo nenhum** (nem no Mac): abra o VoiceBench **pela tela inicial**, não pelo Xcode. Ligado no cabo o iPhone
  segura a bateria e a medida não vale (o app avisa e o relatório marca "plugged in").
- **Não bloqueie a tela nem troque de app** durante a rodada: o iOS pausa o app no fundo (o app anota se acontecer).
- Celular **frio** no começo de cada rodada (descanse ~15 min entre elas, à sombra).
- Comece cada rodada com bateria parecida (de preferência entre 50% e 90%).
- Feche os outros apps. O VoiceBench fixa o brilho em 50% e não deixa a tela apagar.
- A rodada **para sozinha** em 10:00.

## 4. Depois

1. No VoiceBench, **Exportar todas (AirDrop)** → Mac. Vem um `.zip` com o `.json` e o `.m4a` de cada sessão.
2. Coloque o `.zip` em `docs/voice-lab/bench/` (pode deixar os de testes anteriores; cada sessão conta uma vez).
3. No Mac, na raiz do projeto:

   ```
   python3 docs/voice-lab/lab/tools/voice_bench.py results docs/voice-lab/bench --md docs/voice-lab/bench/results.md
   ```

   Sai a tabela de acerto por pessoa e distância, os alarmes falsos por hora e o consumo de cada motor.

## Anotações que ajudam

- Vento, música alta, quadra ao lado: anote junto com o horário.
- Se algo estranho acontecer numa sessão (alguém falou "salvar" sem querer, o celular caiu), anote o horário: o áudio
  dela fica no `.m4a` e dá para conferir.
