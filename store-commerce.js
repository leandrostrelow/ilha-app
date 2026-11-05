(function () {
  'use strict';
  const escape = (value) => String(value == null ? '' : value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = value => Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const labels = { CREATED: 'Preparando Pix', PENDING: 'Aguardando pagamento', PAID: 'Pago', CANCELLED: 'Cancelado', REFUNDED: 'Estornado', REVIEW: 'Revisão financeira' };
  const orderItems = o => Array.isArray(o.items) && o.items.length ? o.items : [{ product_name: o.product_name, quantity: o.quantity, unit_price: o.unit_price, total: o.total }];
  const orderTitle = o => orderItems(o).length > 1 ? orderItems(o).length + ' produtos · ' + o.quantity + ' unidades' : o.quantity + 'x ' + o.product_name;
  const itemSummary = o => '<ul class="ilha-store-item-summary">' + orderItems(o).map(item => '<li><span>' + escape(item.quantity + 'x ' + item.product_name) + '</span><strong>' + money(item.total) + '</strong></li>').join('') + '</ul>';
  window.IlhaStore = {
    create(options) {
      let dialog, order, timer, formRequestId, orders = [];
      let filter = 'all';
      const stop = () => { clearTimeout(timer); timer = null; };
      const productLabel = p => [p.name, p.size, p.color].filter(Boolean).join(' · ');
      function show(content) {
        if (!dialog) {
          dialog = document.createElement('dialog');
          dialog.className = 'ilha-store-dialog';
          dialog.setAttribute('aria-label', 'Compra na Ilha Store');
          document.body.append(dialog);
          dialog.addEventListener('close', stop);
        }
        dialog.innerHTML = '<div class="ilha-store-dialog-head"><strong>Ilha Store</strong><button type="button" data-close aria-label="Fechar">Fechar</button></div>' + content;
        dialog.querySelector('[data-close]').onclick = () => dialog.close();
        if (!dialog.open) dialog.showModal();
      }
      function errorMessage(message) {
        const el = dialog && dialog.querySelector('[data-feedback]');
        if (el) el.textContent = message;
        else options.notify(message);
      }
      async function status(silent) {
        if (!order) return;
        try {
          const result = await options.call({ action: 'status', order_id: order.id, provider_check: silent !== true });
          order = result.order;
          if (dialog && dialog.open) paymentView();
          if (!silent) await loadOrders();
        } catch (e) { errorMessage(e.message); }
        if (dialog && dialog.open && order && ['CREATED', 'PENDING'].includes(order.status)) {
          stop(); timer = setTimeout(() => status(true), 15000);
        }
      }
      function paymentView() {
        stop();
        const pending = ['CREATED', 'PENDING'].includes(order.status);
        const paid = order.status === 'PAID';
        const image = pending && order.pix_image && /^[A-Za-z0-9+/=]+$/.test(order.pix_image)
          ? '<img class="ilha-store-qr" alt="QR Code Pix deste pedido" src="data:image/png;base64,' + order.pix_image + '">' : '';
        show('<div class="ilha-store-dialog-body"><span class="ilha-store-badge">' + escape(order.delivered_at ? 'Entregue' : labels[order.status]) + '</span>' +
          '<h2>' + escape(orderTitle(order)) + '</h2><p>' + escape(order.customer_name) + '</p>' + itemSummary(order) + '<strong class="ilha-store-total">Total: ' + money(order.total) + '</strong>' +
          (order.provider_environment === 'SANDBOX' ? '<p class="ilha-store-warning">AMBIENTE DE TESTE — não é uma cobrança real.</p>' : '') +
          (paid ? '<p>Pagamento recebido. ' + (order.delivered_at ? 'Produtos entregues.' : 'Retire seus produtos no clube.') + '</p>' : '') + image +
          (pending && order.pix_payload ? '<label>Pix copia e cola<textarea readonly data-payload>' + escape(order.pix_payload) + '</textarea></label><button type="button" class="primary-btn" data-copy>Copiar Pix</button>' : '') +
          (pending ? '<p>O estoque está reservado. Só entregue após aparecer “Pago”. Fechar esta janela não cancela o pedido.</p><button type="button" class="ghost-btn" data-status>Consultar pagamento</button><button type="button" class="ghost-btn" data-cancel>Cancelar pedido</button>' : '') +
          '<p data-feedback role="status"></p><small>Pedido ' + escape(order.id.slice(0,8)) + ' · Retirada no Ilha Tênis</small></div>');
        const copy = dialog.querySelector('[data-copy]');
        if (copy) copy.onclick = async () => {
          try { await navigator.clipboard.writeText(order.pix_payload); errorMessage('Pix copiado.'); }
          catch { dialog.querySelector('[data-payload]').select(); errorMessage('Selecione e copie o código acima.'); }
        };
        const refresh = dialog.querySelector('[data-status]');
        if (refresh) refresh.onclick = () => status(false);
        const cancel = dialog.querySelector('[data-cancel]');
        if (cancel) cancel.onclick = async () => {
          if (!window.confirm('Cancelar este pedido e o Pix? O estoque só será liberado após confirmação do Asaas.')) return;
          cancel.disabled = true;
          try { order = (await options.call({ action: 'cancel', order_id: order.id })).order; paymentView(); await loadOrders(); await options.refresh(); }
          catch (e) { errorMessage(e.message); cancel.disabled = false; }
        };
        if (pending) timer = setTimeout(() => status(true), 15000);
      }
      function checkout(product, presencial) {
        stop(); order = null; formRequestId = crypto.randomUUID();
        const products = options.products().filter(p => p.active !== false && p.price > 0 && (!p.trackStock || p.stock > 0));
        if (!products.length) return options.notify('Cadastre preço e estoque dos produtos antes de vender.');
        const cart = product && products.some(p => p.id === product.id) ? [{ product_id: product.id, quantity: 1 }] : [];
        show('<form class="ilha-store-dialog-body" data-checkout><h2>' + (presencial ? 'Venda presencial' : 'Comprar com Pix') + '</h2>' +
          '<p>Adicione os produtos e gere um único Pix com o total da venda.</p><fieldset class="ilha-store-cart-fields"><legend>Produtos da venda</legend>' +
          '<label>Produto / tamanho<select name="product">' + products.map(p => '<option value="' + escape(p.id) + '">' + escape(productLabel(p)) + ' — ' + money(p.price) + '</option>').join('') + '</select></label>' +
          '<div class="ilha-store-add-row"><label>Quantidade<input name="quantity" type="number" min="1" max="50" value="1" step="1" required></label><button class="ghost-btn" type="button" data-add-product>+ Adicionar produto</button></div>' +
          '<div class="ilha-store-cart" data-cart aria-label="Itens do pedido"></div></fieldset>' +
          (presencial ? '<label>Comprador<select name="client"><option value="">Venda avulsa (sem cadastro)</option>' + options.clients().map(c => '<option value="' + escape(c.id) + '">' + escape(c.name) + '</option>').join('') + '</select></label><div data-guest><label>Nome do comprador<input name="customer_name" maxlength="120" autocomplete="name" required></label><p>Venda avulsa: informe somente o nome. O Pix será gerado pelo Asaas sem pedir CPF.</p></div>' : '') +
          '<p>Retirada no clube. O preço e o estoque serão conferidos antes de gerar a cobrança.</p><strong class="ilha-store-total" data-total></strong><p data-feedback role="status"></p><button class="primary-btn" type="submit">Gerar Pix e QR Code</button></form>');
        const form = dialog.querySelector('form');
        const selectedProduct = () => products.find(p => p.id === form.elements.product.value);
        const maxQuantity = p => p.trackStock ? Math.min(50, Number(p.stock)) : 50;
        function renderCart() {
          form.querySelector('[data-cart]').innerHTML = cart.length ? cart.map(line => {
            const p = products.find(p => p.id === line.product_id);
            return '<div class="ilha-store-cart-item"><div><strong>' + escape(productLabel(p)) + '</strong><small>' + money(p.price) + ' / unidade</small></div>' +
              '<label>Qtd.<input type="number" min="1" max="' + maxQuantity(p) + '" step="1" value="' + line.quantity + '" required data-cart-quantity="' + escape(p.id) + '" aria-label="Quantidade de ' + escape(productLabel(p)) + '"></label>' +
              '<strong data-subtotal="' + escape(p.id) + '">' + money(p.price * line.quantity) + '</strong><button type="button" class="ghost-btn" data-remove-product="' + escape(p.id) + '" aria-label="Remover ' + escape(productLabel(p)) + '">Remover</button></div>';
          }).join('') : '<p class="ilha-store-cart-empty">Nenhum produto adicionado. Escolha acima e toque em “Adicionar produto”.</p>';
          total();
        }
        const total = () => {
          const units = cart.reduce((n,line) => n + line.quantity,0);
          form.querySelector('[data-total]').textContent = 'Total: ' + money(cart.reduce((n,line) => n + Math.round(products.find(p => p.id === line.product_id).price * 100) * line.quantity,0) / 100);
          form.elements.quantity.max = String(maxQuantity(selectedProduct()));
          form.querySelector('[type=submit]').disabled = !cart.length || units > 50 || cart.some(line => !Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > maxQuantity(products.find(p => p.id === line.product_id)));
          if (presencial) {
            const registeredClient = Boolean(form.elements.client.value);
            form.querySelector('[data-guest]').hidden = registeredClient;
            form.elements.customer_name.disabled = registeredClient;
            form.elements.customer_name.required = !registeredClient;
          }
        };
        form.querySelector('[data-add-product]').onclick = () => {
          const p = selectedProduct(), quantity = Number(form.elements.quantity.value);
          const current = cart.find(line => line.product_id === p.id);
          if (!Number.isInteger(quantity) || quantity < 1 || quantity + (current ? current.quantity : 0) > maxQuantity(p)) return errorMessage('Confira a quantidade e o estoque disponível deste produto.');
          if ((!current && cart.length >= 20) || cart.reduce((n,line) => n + line.quantity,0) + quantity > 50) return errorMessage('Adicione até 20 produtos e 50 unidades no total.');
          if (current) current.quantity += quantity; else cart.push({ product_id: p.id, quantity });
          errorMessage('Produto adicionado.'); renderCart();
        };
        form.addEventListener('click', event => {
          const button = event.target.closest('[data-remove-product]');
          if (!button) return;
          const index = cart.findIndex(line => line.product_id === button.dataset.removeProduct);
          if (index >= 0) cart.splice(index,1);
          renderCart();
        });
        form.addEventListener('input', event => {
          if (event.target.matches('[data-cart-quantity]')) {
            const line = cart.find(line => line.product_id === event.target.dataset.cartQuantity);
            line.quantity = Number(event.target.value);
            const p = products.find(p => p.id === line.product_id);
            form.querySelector('[data-subtotal="' + p.id + '"]').textContent = money(p.price * line.quantity);
          }
          total();
        });
        renderCart();
        form.onsubmit = async event => {
          event.preventDefault();
          const button = form.querySelector('[type=submit]'); if (button.disabled) return;
          button.disabled = true;
          try {
            const body = { action: 'create', request_id: formRequestId, items: cart.map(line => ({ ...line })), source: presencial ? 'PRESENCIAL' : 'APP' };
            if (presencial) Object.assign(body, { client_id: form.elements.client.value || null, customer_name: form.elements.customer_name.value });
            form.querySelectorAll('input,select,button').forEach(el => { el.disabled = true; });
            const result = await options.call(body); order = result.order; paymentView(); await loadOrders(); await options.refresh();
          } catch (e) {
            if (e.orderId) {
              order = { id: e.orderId }; await loadOrders();
              show('<div class="ilha-store-dialog-body"><h2>Pedido reservado</h2><p>' + escape(e.message) + '</p><p>Não crie outro pedido. Consulte este para recuperar o Pix.</p><button class="primary-btn" data-retry>Consultar pedido</button><p data-feedback role="status"></p></div>');
              dialog.querySelector('[data-retry]').onclick = () => status(false);
            } else { errorMessage(e.message); form.querySelectorAll('input,select,button').forEach(el => { el.disabled = false; }); total(); }
          }
        };
      }
      function renderOrders() {
        if (!options.ordersHost) return;
        const list = orders.filter(o => filter === 'all' || (filter === 'pending' ? ['CREATED','PENDING'].includes(o.status) : filter === 'ready' ? o.status === 'PAID' && !o.delivered_at : Boolean(o.delivered_at)));
        options.ordersHost.innerHTML = '<div class="ilha-store-order-head"><h2>' + (options.admin ? 'Pedidos e vendas' : 'Minhas compras') + '</h2><button class="ghost-btn" data-reload>Atualizar</button></div><div class="ilha-store-filters">' +
          [['all','Todos'],['pending','Aguardando Pix'],['ready','Para retirar'],['delivered','Entregues']].map(([key,label]) => '<button type="button" class="ghost-btn" aria-pressed="' + (filter === key) + '" data-filter="' + key + '">' + label + '</button>').join('') + '</div>' +
          (options.admin ? '<p>Recebido (últimos 100 pedidos): <strong>' + money(orders.filter(o => o.status === 'PAID').reduce((n,o) => n + Number(o.total),0)) + '</strong></p>' : '') +
          '<div class="ilha-store-orders">' + (list.map(o => '<article><div><strong>' + escape(orderTitle(o)) + '</strong><p>' + (options.admin ? escape(o.customer_name) + ' · ' : '') + escape(new Date(o.created_at).toLocaleDateString('pt-BR')) + ' · ' + (o.source === 'PRESENCIAL' ? 'Presencial' : 'App') + '</p>' + itemSummary(o) + '<span class="ilha-store-badge">' + escape(o.delivered_at ? 'Entregue' : labels[o.status]) + '</span></div><div><strong>' + money(o.total) + '</strong><div class="ilha-store-actions"><button class="ghost-btn" data-order="' + escape(o.id) + '">Ver pedido / Pix</button>' + (options.admin && o.status === 'PAID' && !o.delivered_at ? '<button class="primary-btn" data-deliver="' + escape(o.id) + '">Registrar entrega</button>' : '') + '</div></div></article>').join('') || '<p>Nenhum pedido neste filtro.</p>') + '</div>';
        options.ordersHost.querySelector('[data-reload]').onclick = loadOrders;
        options.ordersHost.querySelectorAll('[data-filter]').forEach(b => { b.onclick = () => { filter = b.dataset.filter; renderOrders(); }; });
        options.ordersHost.querySelectorAll('[data-order]').forEach(b => { b.onclick = async () => { order = orders.find(o => o.id === b.dataset.order); paymentView(); await status(false); }; });
        options.ordersHost.querySelectorAll('[data-deliver]').forEach(b => { b.onclick = async () => {
          if (!window.confirm('Confirmar que todos os produtos do pedido foram entregues ao comprador?')) return;
          b.disabled = true;
          try { await options.call({ action: 'deliver', order_id: b.dataset.deliver }); await loadOrders(); }
          catch (e) { options.notify(e.message); b.disabled = false; }
        }; });
      }
      async function loadOrders() {
        try { orders = (await options.call({ action: 'list' })).orders || []; renderOrders(); }
        catch (e) { if (options.ordersHost) options.ordersHost.textContent = e.message; }
      }
      return { checkout, loadOrders, close: () => { stop(); if (dialog) dialog.close(); } };
    },
  };
})();
