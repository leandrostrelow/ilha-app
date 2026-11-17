# Tour 360° da apresentação Cresol

A seção `/cresol/#tour` liga sete pontos do mapa às fotos reais do clube. O visitante pode alternar mapa ilustrado/foto aérea, abrir uma vista, girar, aproximar, trocar de ponto e voltar ao mapa. O diálogo mantém o foco e bloqueia a navegação por capítulos enquanto está aberto.

## Origem e atualização

- Foto aérea enviada pelo proprietário em 17/11/2026. Ilustração gerada a partir dessa foto; posições dos marcadores são aproximadas. No celular, imagem e marcadores são ampliados juntos para facilitar o toque.
- Fotos INSP 004 a 010 de 17/11/2026, exportadas pelo Insta360 Studio 6.0.8 como fotos panorâmicas 11904 × 5952. São panoramas reais costurados pelo software da câmera, sem reconstrução por IA.
- Ordem: 004 areia, 005 deck/arquibancada, 006 tênis vista 1, 007 tênis vista 2, 008 entre as quadras, 009 caminhos, 010 pickleball. Não implica numeração oficial das quadras.
- Cópias públicas WebP: 4096 × 2048 para celulares e 6144 × 3072 para telas maiores com suporte gráfico. Metadados do original não são incorporados. As imagens só são carregadas ao abrir a vista. As miniaturas são projeções das mesmas fotos.
- Os originais, exportações de alta resolução e prompt do mapa permanecem fora da lista de arquivos públicos. O vídeo INSV fornecido não faz parte deste tour.

## Visualizador

Pannellum 2.5.7, hospedado no próprio site, obtido do pacote oficial `pannellum` no npm. Licença MIT em `cresol/vendor/COPYING`; documentação em <https://pannellum.org/documentation/>. Não há novas chamadas a serviços externos, banco ou permissões de câmera/localização. Não altera CSP.

Para atualizar, troque as imagens do ponto, a miniatura e os dados do link em `cresol/index.html`. Cada ponto tem uma versão 4096 e uma 6144. Mantenha proporção 2:1 e panorama equiretangular, nunca use diretamente o INSP de duas lentes. Liste novos arquivos em `config/site-files.json`.

## Verificação desta entrega

- Sete cenas abriram no navegador, com imagens esféricas, giro, zoom, seleção direta e anterior/próximo.
- Escape/voltar fecha o diálogo, devolve o foco ao marcador e libera a rolagem da página.
- Layout conferido em 1280 × 720, 390 × 844 e 320 × 740; sem overflow horizontal. Marcadores móveis ampliados junto com a foto.
- Tela cheia não foi disponibilizada pelo navegador integrado; a mensagem de alternativa funcionou e o tour continuou utilizável. A visualização já ocupa a tela no celular.
- Console sem erros. `pnpm run verify` passou. Imagens de alta resolução permanecem fora do Git.
