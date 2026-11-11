# Ilha VR Games

`/vrgames` é uma aula introdutória em Three.js/WebXR, acessível pelo menu e pelo cartão da página `/games`. No computador, o mouse posiciona a raquete e os botões de mira direcionam a devolução. No Quest, o botão “Entrar em VR” solicita a sessão imersiva, o controle da mão escolhida vira a raquete, A inicia/pausa, B volta ao passeio, X abre o menu e Y segurado centraliza o treino. O gatilho inicia/interage, mas não pausa durante uma rebatida. O passeio usa WASD/setas e arrasto para olhar no computador, botões na tela no celular e analógico esquerdo para andar/direito para girar em passos de 30° no Quest. Os destinos no alto da tela e o menu X em VR oferecem deslocamento imediato. O botão lateral de segurar não teleporta mais o jogador. Durante a aula, a locomoção artificial fica desativada.

A aula apresenta posição de espera, três devoluções após um quique, três acertos em alvos alternados e treino livre. A física usa bolas lentas, contato ampliado e retorno assistido; não é um simulador técnico. Realidade mista aparece apenas quando o navegador informa suporte, sem reconhecimento ou colisão com o ambiente real. Sessões VR/MR e desempenho no headset precisam de validação física em um Quest 3.

## Referências do clube

O cenário foi reconciliado com as nove fotos originais fornecidas para o Legado (drone, quadras, pickleball e Ilha Bar), as fotos da entrada pela rua e o plano corrigido pelo proprietário. A documentação anterior está em `docs/ilha-games-club32.md` e `docs/ilha-games-map-fidelity-stage1.md`. As imagens serviram de referência; não fazem parte dos arquivos publicados por esta entrega.

- Duas quadras de saibro alaranjado lado a lado, separação baixa, refletores com quatro lâmpadas e guarda-sol azul entre as quadras.
- Arquibancadas na lateral oeste, casa clara com base azul, bar compacto ao noroeste com balcão de madeira, raquetes penduradas, geladeira azul e deck.
- Quadras de areia ao norte, pickleball azul/turquesa ao sul, palmeiras, estacionamento, acesso lateral por muro baixo e placa; sem portal em arco.
- Canal estreito na lateral leste e na curva sul, com cidade e morros ao fundo. Escala e volumes são aproximações para o protótipo, sem levantamento arquitetônico.

As vistas Entrada, Quadras e Ilha Bar permitem conferir os principais pontos antes da aula. O cenário usa geometria simples, textura procedural e instâncias para compartilhar desenhos repetidos.

## Entrega e validação

Biblioteca Three.js 0.180.0 vendorizada com licença MIT em `vrgames/vendor`. Não há CDN, fonte externa, novo serviço ou dados pessoais necessários para executar a aula. HTML usa caminhos absolutos para funcionar em `/vrgames` sem barra final. O build inclui a rota pelo manifesto e versiona todos os imports, inclusive os módulos da biblioteca, para não misturar versões no cache do app.

`pnpm run verify` cobre as verificações do repositório e os testes de trajetória, quique, rede, limites, colisão rápida da raquete e reposicionamento XR. O teste visual deve percorrer Games → VR Games → vistas do clube → aula → alvos → treino livre/pausa, além do acesso em tela estreita. Nenhuma alteração de banco, Edge Function ou configuração de autenticação faz parte desta entrega.

## Passeio e atividades

O botão “Explorar o clube a pé” abre o passeio. A proximidade de cada estação libera a interação por E, botão na tela ou gatilho da mão escolhida. O personagem desliza junto às barreiras e respeita portões, paredes, redes, árvores, móveis e a margem do canal. O giro em VR mantém a cabeça no mesmo ponto do mundo, inclusive quando o usuário está fora da origem física da sala.

- Tênis: mantém a aula guiada completa com Renato.
- Beach tennis: minijogo de três alvos alternados, com devolução no ar. A bola tocar a areia encerra aquela tentativa.
- Pickleball: minijogo de recepção após um quique, em quadra curta e com raquete sólida. Não simula uma partida completa nem toda a regra dos dois quiques da abertura de um ponto.
- Bar: água de coco, suco de laranja e limonada virtuais, com copo na mão e ação de tomar. Não existe pedido real, pagamento, gravação no bar ou integração de dados.

Os novos módulos `club.js`, `navigation.js` e `club-sports.js` separam interação, navegação e física dos minijogos. As colisões e os feeds possuem testes de trajetória, passagem pelo portão, bloqueio de paredes, normalização diagonal, zona morta dos controles e giro ao redor da cabeça. Os arquivos continuam incluídos e versionados no manifesto/build.

A atualização visual adiciona céu com nuvens suaves, materiais com textura e relevo, copa com mais geometria, folhas de palmeira, garrafas na geladeira, detalhes no revestimento do bar e sombras estáticas de maior definição. A iluminação do cenário é estática para evitar recalcular o mapa de sombras a cada quadro. O teste real de controles e desempenho no Quest 3 continua necessário.

## Raquetes

`racket.js` constrói os modelos compartilhados pelo jogador, controles e decoração do bar. O modelo de tênis tem aro oval de seção fina, garganta aberta, 16 cordas verticais e 19 horizontais em geometria 3D, ilhoses, proteção no topo, cabo octogonal e costura helicoidal do overgrip. O acabamento usa grafite, verde e identidade Ilha; não reproduz uma marca comercial. Beach tennis tem face perfurada e pickleball tem face sólida com bordas arredondadas. Materiais e geometrias são reutilizados entre cópias; cordas e ilhoses usam instâncias. O centro de contato acompanha cada cabeça: 0,40 m no tênis, 0,25 m no beach e 0,205 m no pickleball. A assistência de colisão continua igual.


## Quest: comandos, pegada e rastreamento

O modelo local aponta o cabo em +Y. A montagem agora alinha esse eixo ao −Z do gripSpace, que acompanha o objeto segurado, antes de aplicar a rotação da pegada. Tênis inicia com a opção semi-western, espelhada para canhotos; beach e pickleball ficam em continental. O alinhamento é um ponto de partida ajustável, não uma avaliação de técnica. A validação física de conforto e encaixe continua necessária no Quest 3.

- Analógico esquerdo: passeio. Direito: giro de 30°, ou bebida no bar.
- A: interação, iniciar, pausar e continuar. B: voltar ao clube ou fechar o menu.
- X: menu 3D com mão, esporte, pegada, inclinação, giro da face, deslocamento do cabo, destinos e som. Analógico esquerdo seleciona; direito ajusta. A/gatilho confirma. Ajustes são limitados e guardados por esporte em localStorage, sem envio ao servidor.
- Y por 0,8 s: centralizar. Só dispara uma vez até soltar.
- Gatilho: interação e início/continuação. Durante a troca de bolas, não pausa a atividade.
- O botão lateral de segurar não muda mais a posição nem abandona o exercício. Menu e botão Meta permanecem reservados ao sistema.

Somente gripSpace válido, não inferido, de um controle tracked-pointer pode renderizar/rebater. Perda de tracking e saída de foco pausam o treino e descartam o histórico de colisão; controles de mãos sem Touch não são tratados como raquetes. Retomar requer A. O menu pausa as atividades e os analógicos precisam voltar à zona neutra antes de retomar o passeio.

As raquetes sólidas têm cabos próprios e proporções menores: beach com face perfurada e comprimento aproximado de 50 cm; pickleball com borda protetora, face sólida e cerca de 42 cm. A posição do mouse preserva a altura de contato ao trocar de modelo.

Mapeamento conferido nos perfis [Meta Touch Plus](https://github.com/immersive-web/webxr-input-profiles/blob/main/packages/registry/profiles/meta/meta-quest-touch-plus.json) e [Oculus Touch v3](https://github.com/immersive-web/webxr-input-profiles/blob/main/packages/registry/profiles/oculus/oculus-touch-v3.json). Referência de eixos: [gripSpace](https://developer.mozilla.org/en-US/docs/Web/API/XRInputSource/gripSpace).

## Pessoas no clube

Doze NPCs, além do Renato, ocupam entrada, caminhos, segunda quadra de tênis, beach, pickleball e Ilha Bar. Há caminhada com parada quando o jogador se aproxima, acenos, conversa, bebida e aquecimento. A troca de bola na segunda quadra é ambientação, não multiplayer ou oponente da aula. Os corpos bloqueiam o passeio; destinos e portões permanecem acessíveis. As partes dos personagens usam quatro lotes instanciados, com geometria e materiais compartilhados. O cenário não é renderizado em realidade mista.

Verificação desta entrega: botões, analógicos, troca de mão, menu e destinos exercitados em sessão WebXR pelo IWER 2.8.0 da Meta, em um harness local fora do pacote publicado. A fixture representa poses rastreadas; o IWER marca todas as poses sintéticas como `emulatedPosition`. O jogo continua recusando poses inferidas. O menu e a proximidade dos NPCs calculam a posição do headset a partir do frame XR e do rig de locomoção, sem depender da matriz temporária do ArrayCamera. O teste emulador não substitui sentir a pegada e medir desempenho no Quest 3 físico.
