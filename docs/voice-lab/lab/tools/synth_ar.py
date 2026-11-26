"""Piper pt_BR synthesis of verbs ending in -ar (and a few short phrases) as hard negatives for salvar-v2-rc3.
Every 4th entry is held out for testing. Output: /home/claude/ds/ar/{train,test}__<text>__<voice>__<k>.wav"""
import wave, random, os
from piper import PiperVoice, SynthesisConfig
VERBS = """pular cavar gritar amar treinar telar jogar chutar passar marcar tocar falar olhar parar ganhar acabar
levantar voltar começar cansar lançar rolar salgar selar calçar cobrar travar chamar tirar puxar empurrar tentar andar
nadar dançar cantar brincar lutar ajudar estudar trabalhar entrar sentar jantar almoçar descansar respirar suar girar
virar driblar cruzar cabecear finalizar arremessar sacar bloquear cortar atacar recuar avançar fechar esperar escutar
mostrar gravar filmar apagar ligar desligar errar acertar mirar segurar soltar largar pegar buscar levar deixar ficar
mudar trocar comprar pagar usar gastar guardar somar contar notar votar atirar arrastar escalar saltar agachar alongar
esticar dobrar mergulhar remar pedalar patinar surfar lavar secar limpar arrumar ensaiar sonhar chorar rezar morar
casar beijar abraçar viajar voar pousar apitar empatar classificar eliminar tabelar sambar saldar sanar sarar sondar
sobrar sujar sugar salivar salpicar saltitar sangrar saquear sabotar salientar selecionar sinalizar sentar segurar
desviar balançar levar aguentar suportar celebrar comemorar festejar gritar""".split()
PHRASES = ["vamos treinar", "vou pular", "tem que gritar", "bora jogar", "pode passar", "precisa parar", "vai chutar",
           "quero jogar", "deixa passar", "vamos parar", "bora treinar", "tenta marcar", "vou sacar", "pode cavar",
           "vamos jantar", "volta a jogar", "temos que ganhar", "vamos lutar", "pode gravar", "pode filmar"]
items = list(dict.fromkeys(VERBS)) + PHRASES
D = '/mnt/user-data/uploads/Lance/docs/voice-lab/datasets/piper'
voices = {v: PiperVoice.load(f'{D}/pt_BR-{v}.onnx') for v in ('cadu-medium', 'jeff-medium', 'faber-medium', 'edresson-low')}
rnd = random.Random(5); n = 0
for i, text in enumerate(items):
    split = 'test' if i % 4 == 3 else 'train'
    for vname, voice in voices.items():
        for k in range(3):
            cfg = SynthesisConfig(length_scale=rnd.uniform(0.8, 1.25), noise_scale=rnd.uniform(0.4, 0.9), noise_w_scale=rnd.uniform(0.5, 1.0))
            with wave.open(f"/home/claude/ds/ar/{split}__{text.replace(' ', '_')}__{vname}__{k}.wav", 'wb') as w:
                voice.synthesize_wav(text, w, syn_config=cfg)
            n += 1
print('items', len(items), 'clips', n)
