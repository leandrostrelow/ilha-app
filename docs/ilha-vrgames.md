# Ilha VR Games

`/vrgames` é uma aula introdutória em Three.js/WebXR, acessível pelo menu e pelo cartão da página `/games`. No computador, o mouse posiciona a raquete e os botões de mira direcionam a devolução. No Quest, o botão “Entrar em VR” solicita a sessão imersiva, o controle da mão escolhida vira a raquete, o gatilho avança/pausa e o botão de segurar reposiciona o treino. A chegada à quadra é por teletransporte, sem caminhada artificial.

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
