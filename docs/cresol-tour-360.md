# Tour 360° da apresentação Cresol

A seção `/cresol/#tour` liga sete pontos do mapa às fotos reais do clube. O visitante pode alternar foto tratada/original, abrir uma vista, girar, aproximar, trocar de ponto e voltar ao mapa. O diálogo mantém o foco e bloqueia a navegação por capítulos enquanto está aberto.

## Origem e atualização

- Foto aérea enviada pelo proprietário em 17/11/2026. Tratamento fotográfico de cor e luz a partir dessa foto; posições dos marcadores são aproximadas. No celular, imagem e marcadores são ampliados juntos para facilitar o toque.
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

## Separação entre tour real e proposta visual

O mapa inicia na foto aérea tratada, com opção para ver a foto original. A ilustração saiu da interface e da lista de arquivos publicados. O tour mostra apenas as sete fotos reais, sem camadas de patrocínio ou comparativo Cresol.

As propostas de aplicação ficam juntas em `#previa-cresol`, dentro do capítulo “Sua marca no Ilha”. Duas montagens estáticas mostram banners predominantemente laranja em tênis e areia/deck. Cada uma abre em um diálogo ampliado, fecha por botão/Escape e devolve o foco à imagem de origem. A marca vem exclusivamente do PNG original `cresol/assets/cresol-original.png`, em branco por CSS, projetado sobre as peças. A edição por IA fornece o cenário com tecido laranja sem letras ou símbolos.

`brand-projection.js` calcula a homografia; `sponsor-placements.js` registra os quatro cantos de cada aplicação nas fotos 1448 × 1086. `sponsor-mockups.js` recalcula a projeção quando a imagem é redimensionada. O diálogo remove seus elementos/observação ao fechar. Não há chamadas a serviços, gravações ou backend.

Validação: correspondência dos quatro cantos, coordenadas e matrizes em tamanhos distintos, transparência do PNG original, ampliação e fechamento dos dois estudos, retorno do foco, layout móvel e navegação 360° sem simulação. Os antigos tecidos/miniatura de simulação 360° e a antiga montagem verde não são mais publicados.

## Novos registros de drone — novembro de 2026

Quatro fotos fornecidas pelo proprietário na pasta `DRONE/NOVEMBRO 2026` entram na apresentação: `DJI_0663.JPG` na abertura, `DJI_0626.JPG` na seção do clube, `DJI_0631.JPG` no cartão de pickleball e `DJI_0647.JPG` no cartão das quadras de areia. Os dois cartões abrem as fotos 360° correspondentes pelo mesmo visualizador do mapa.

As imagens foram exportadas em WebP de 800 e 1600 pixels de largura, com orientação corrigida e sem metadados da câmera. O conteúdo das fotografias permanece original; o enquadramento visível se adapta ao espaço da página. Os JPGs originais permanecem preservados fora do repositório. Carregamento responsivo e lazy loading nos registros abaixo da abertura.

## Tratamento fotográfico, calendário e transições

As quatro fotos de drone agora têm cópias tratadas: iluminação, cor, superfícies das quadras e acabamento das linhas. São imagens ilustrativas de acabamento, identificadas na seção do clube. Os arquivos originais continuam preservados. Exportações responsivas de 800 e 1448 pixels; os cenários dos estudos visuais são versões separadas.

O calendário proposto de 2027 contempla duas etapas do Cincate e duas da Copa Dupla Falta, ambas com datas a confirmar, além dos eventos anteriores.

Nas mudanças de capítulo, duas bolinhas percorrem a tela por cerca de um segundo. A camada não recebe cliques nem foco, tem frequência limitada, para quando a página fica oculta e respeita `prefers-reduced-motion`. Não executa enquanto há diálogo aberto.
