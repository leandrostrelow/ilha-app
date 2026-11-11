# Ilha VR Games

`/vrgames` é uma aula introdutória em Three.js/WebXR, acessível pelo menu e pelo cartão da página `/games`. No computador, o mouse posiciona a raquete e os botões de mira direcionam a devolução. No Quest, o botão “Entrar em VR” solicita a sessão imersiva, o controle da mão escolhida vira a raquete, o gatilho avança/pausa e o botão de segurar reposiciona o treino. O passeio usa WASD/setas e arrasto para olhar no computador, botões na tela no celular e analógico esquerdo para andar/direito para girar em passos de 30° no Quest. Os destinos no alto da tela e o botão de segurar em VR continuam oferecendo deslocamento imediato. Durante a aula, a locomoção artificial fica desativada.

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
