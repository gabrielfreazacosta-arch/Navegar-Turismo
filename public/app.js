(() => {
  'use strict';

  const STORAGE_KEY = 'clientsPanelPassword';
  const PAGE_SIZE = 20;
  const SEARCH_DELAY_MS = 300;
  // ==========================================
  // DICIONÁRIO DE IDIOMAS (ADICIONADO NO INÍCIO)
  // ==========================================
  const translations = {
    pt: {
      title: "Clientes",
      eyebrow: "Área interna",
      newBtn: "Novo cliente",
      logoutBtn: "Sair",
      searchPlaceholder: "Buscar por nome, e-mail, telefone, documento ou cidade",
      thName: "Cliente",
      thEmail: "E-mail",
      thPhone: "Telefone",
      thCity: "Cidade",
      thCountry: "País",
      thCreated: "Cadastro"
    },
    en: {
      title: "Clients",
      eyebrow: "Internal area",
      newBtn: "New client",
      logoutBtn: "Logout",
      searchPlaceholder: "Search by name, email, phone, document or city",
      thName: "Client",
      thEmail: "Email",
      thPhone: "Phone",
      thCity: "City",
      thCountry: "Country",
      thCreated: "Registered"
    },
    es: {
      title: "Clientes",
      eyebrow: "Área interna",
      newBtn: "Nuevo cliente",
      logoutBtn: "Salir",
      searchPlaceholder: "Buscar por nombre, correo, teléfono, documento o ciudad",
      thName: "Cliente",
      thEmail: "Correo electrónico",
      thPhone: "Teléfono",
      thCity: "Ciudad",
      thCountry: "País",
      thCreated: "Registro"
    }
  };

  function changeLanguage(lang) {
    const t = translations[lang];
    if (!t) return;

    // Traduz cabeçalho principal
    const h1 = document.querySelector('h1');
    if (h1) h1.textContent = t.title;

    const eyebrow = document.querySelector('.eyebrow');
    if (eyebrow) eyebrow.textContent = t.eyebrow;

    // Traduz botões da barra superior
    const newBtn = document.getElementById('new-button');
    if (newBtn) newBtn.textContent = t.newBtn;

    const logoutBtn = document.getElementById('logout-button');
    if (logoutBtn) logoutBtn.textContent = t.logoutBtn;

    // Traduz a barra de busca
    const searchInput = document.getElementById('search-input');
    if (searchInput) searchInput.placeholder = t.searchPlaceholder;

    // Traduz os cabeçalhos da tabela
    const ths = document.querySelectorAll('table thead th');
    if (ths.length >= 6) {
      ths[0].textContent = t.thName;
      ths[1].textContent = t.thEmail;
      ths[2].textContent = t.thPhone;
      ths[3].textContent = t.thCity;
      ths[4].textContent = t.thCountry;
      ths[5].textContent = t.thCreated;
    }

    localStorage.setItem('panelLanguage', lang);
  }

  const el = {
    loginView: document.getElementById('login-view'),
    loginForm: document.getElementById('login-form'),
    passwordInput: document.getElementById('password-input'),
    loginError: document.getElementById('login-error'),
    appView: document.getElementById('app-view'),
    logoutButton: document.getElementById('logout-button'),
    totalCount: document.getElementById('total-count'),
    searchInput: document.getElementById('search-input'),
    statusMessage: document.getElementById('status-message'),
    skeleton: document.getElementById('skeleton'),
    tableWrapper: document.getElementById('table-wrapper'),
    clientsBody: document.getElementById('clients-body'),
    emptyState: document.getElementById('empty-state'),
    emptyText: document.getElementById('empty-text'),
    errorState: document.getElementById('error-state'),
    errorText: document.getElementById('error-text'),
    retryButton: document.getElementById('retry-button'),
    pagination: document.getElementById('pagination'),
    prevButton: document.getElementById('prev-button'),
    nextButton: document.getElementById('next-button'),
    pageInfo: document.getElementById('page-info'),
    dialog: document.getElementById('client-dialog'),
    dialogTitle: document.getElementById('dialog-title'),
    dialogDetails: document.getElementById('dialog-details'),
    dialogClose: document.getElementById('dialog-close'),
  };

  const state = {
    page: 1,
    search: '',
    total: 0,
    clients: [],
  };

  let activeController = null;
  let searchTimer = null;

  // Builds the loading placeholders once.
  for (let i = 0; i < 6; i += 1) {
    const row = document.createElement('div');
    row.className = 'skeleton-row';
    el.skeleton.appendChild(row);
  }

  function showView(name) {
    el.skeleton.hidden = name !== 'loading';
    el.tableWrapper.hidden = name !== 'ready';
    el.emptyState.hidden = name !== 'empty';
    el.errorState.hidden = name !== 'error';
    el.pagination.hidden = name !== 'ready';
  }

  function showLogin(message) {
    el.appView.hidden = true;
    el.loginView.hidden = false;
    el.loginError.hidden = !message;
    el.loginError.textContent = message || '';
    el.passwordInput.value = '';
    el.passwordInput.focus();
  }

  function showApp() {
    el.loginView.hidden = true;
    el.appView.hidden = false;
  }

  function formatBirthDate(value) {
    if (!value) return '';

    const [year, month, day] = value.split('-');

    return `${day}/${month}/${year}`;
  }

  function formatCreatedAt(value) {
    return new Intl.DateTimeFormat('pt-BR', {
      dateStyle: 'short',
    }).format(new Date(value));
  }

  function formatCity(client) {
    return [client.city, client.state].filter(Boolean).join(', ');
  }

  function createCell(label, text) {
    const cell = document.createElement('td');

    cell.dataset.label = label;
    cell.textContent = text || '-';

    return cell;
  }

    function renderRows() {
    el.clientsBody.replaceChildren();

    state.clients.forEach((client) => {
      const row = document.createElement('tr');

      const nameCell = document.createElement('td');
      const nameButton = document.createElement('button');
      nameButton.type = 'button';
      nameButton.className = 'name-button';
      nameButton.textContent = client.full_name;
      nameButton.setAttribute('aria-label', `Ver detalhes de ${client.full_name}`);
      nameButton.addEventListener('click', () => openDetails(client));
      nameCell.appendChild(nameButton);

      row.appendChild(nameCell);
      row.appendChild(createCell('E-mail', client.email));
      row.appendChild(createCell('Telefone', client.phone));
      row.appendChild(createCell('Cidade', formatCity(client)));
      row.appendChild(createCell('País', client.country));
      row.appendChild(createCell('Cadastro', formatCreatedAt(client.created_at)));

      // ==========================================
      // ADICIONA O BOTÃO DO "X" PARA EXCLUIR NA LINHA
      // ==========================================
      const actionsCell = document.createElement('td');
      actionsCell.className = 'cell-actions';
      
      const deleteRowButton = document.createElement('button');
      deleteRowButton.type = 'button';
      deleteRowButton.className = 'delete-row-btn';
      deleteRowButton.innerHTML = '&times;'; // Gera o caractere visual do X
      deleteRowButton.setAttribute('aria-label', `Excluir ${client.full_name}`);
      
      deleteRowButton.addEventListener('click', async (e) => {
        e.stopPropagation(); // Impede que o clique abra o modal de detalhes do cliente
        
        const confirmDelete = confirm(`Deseja realmente excluir o cliente "${client.full_name}"?`);
        if (!confirmDelete) return;

        const password = sessionStorage.getItem(STORAGE_KEY);
        try {
          const response = await fetch(`/api/clients/${client.id}`, {
            method: 'DELETE',
            headers: { 'x-access-password': password }
          });

          if (!response.ok) {
            const result = await response.json();
            alert(`Erro ao excluir: ${result.error}`);
            return;
          }

          // Recarrega a listagem atualizada na tela imediatamente
          loadClients();
        } catch (error) {
          console.error('Erro na requisição de exclusão:', error);
          alert('Não foi possível conectar ao servidor.');
        }
      });

      actionsCell.appendChild(deleteRowButton);
      row.appendChild(actionsCell);
      // ==========================================

      el.clientsBody.appendChild(row);
    });
  }


  function render() {
    el.totalCount.textContent = String(state.total);

    if (state.clients.length === 0) {
      el.emptyText.textContent = state.search
        ? `Nenhum resultado para "${state.search}". Tente buscar de outra forma.`
        : 'A tabela de clientes está vazia. Os clientes cadastrados no banco aparecerão aqui.';

      el.statusMessage.textContent = 'Nenhum cliente encontrado.';

      showView('empty');

      return;
    }

    const totalPages = Math.max(
      1,
      Math.ceil(state.total / PAGE_SIZE)
    );

    renderRows();

    el.pageInfo.textContent = `Página ${state.page} de ${totalPages}`;
    el.prevButton.disabled = state.page <= 1;
    el.nextButton.disabled = state.page >= totalPages;
    el.statusMessage.textContent = `${state.total} clientes encontrados.`;

    showView('ready');
  }

  async function loadClients() {
    const password = sessionStorage.getItem(STORAGE_KEY);

    if (!password) {
      showLogin();
      return;
    }

    if (activeController) {
      activeController.abort();
    }

    activeController = new AbortController();

    showApp();
    showView('loading');

    el.statusMessage.textContent = 'Carregando clientes.';

    const params = new URLSearchParams({
      page: String(state.page),
      limit: String(PAGE_SIZE),
      search: state.search,
    });

    try {
      const response = await fetch(`/api/clients?${params}`, {
        headers: {
          'x-access-password': password,
        },
        signal: activeController.signal,
      });

      if (response.status === 401) {
        sessionStorage.removeItem(STORAGE_KEY);
        showLogin('Senha incorreta.');
        return;
      }

      if (response.status === 429) {
        sessionStorage.removeItem(STORAGE_KEY);

        showLogin(
          'Muitas tentativas incorretas. Aguarde 15 minutos e tente novamente.'
        );

        return;
      }

      if (!response.ok) {
        throw new Error(
          'O servidor respondeu com um erro. Tente novamente em instantes.'
        );
      }

      const payload = await response.json();

      state.total = payload.total;
      state.clients = payload.data;

      render();
    } catch (error) {
      if (error.name === 'AbortError') {
        return;
      }

      el.errorText.textContent =
        error instanceof TypeError
          ? 'Sem conexão com o servidor. Verifique se ele está rodando.'
          : error.message;

      el.statusMessage.textContent = 'Erro ao carregar clientes.';

      showView('error');
    }
  }

  function openDetails(client) {
    el.dialogTitle.textContent = client.full_name;
    el.dialogDetails.replaceChildren();

    const fields = [
      ['E-mail', client.email],
      ['Telefone', client.phone],
      ['Documento (CPF ou passaporte)', client.document],
      ['Data de nascimento', formatBirthDate(client.birth_date)],
      ['Cidade', formatCity(client)],
      ['País', client.country],
      ['Observações', client.notes],
      ['Cadastrado em', formatCreatedAt(client.created_at)],
    ];

    fields.forEach(([label, value]) => {
      const wrapper = document.createElement('div');
      const term = document.createElement('dt');
      const description = document.createElement('dd');

      term.textContent = label;
      description.textContent = value || '-';

      wrapper.appendChild(term);
      wrapper.appendChild(description);

      el.dialogDetails.appendChild(wrapper);
    });

    el.dialog.showModal();
  }

  el.loginForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const password = el.passwordInput.value;

    if (!password) {
      showLogin('Digite a senha de acesso.');
      return;
    }

    sessionStorage.setItem(STORAGE_KEY, password);
    state.page = 1;
    loadClients();
  });

  el.logoutButton.addEventListener('click', () => {
    sessionStorage.removeItem(STORAGE_KEY);
    state.clients = [];
    el.searchInput.value = '';
    state.search = '';
    showLogin();
  });

  el.searchInput.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      state.search = el.searchInput.value.trim();
      state.page = 1;
      loadClients();
    }, SEARCH_DELAY_MS);
  });

  el.prevButton.addEventListener('click', () => {
    if (state.page > 1) {
      state.page -= 1;
      loadClients();
      window.scrollTo({ top: 0 });
    }
  });

  el.nextButton.addEventListener('click', () => {
    state.page += 1;
    loadClients();
    window.scrollTo({ top: 0 });
  });

  el.retryButton.addEventListener('click', loadClients);

  el.dialogClose.addEventListener('click', () => {
    el.dialog.close();
  });

  el.dialog.addEventListener('click', (event) => {
    if (event.target === el.dialog) {
      el.dialog.close();
    }
  });
  // ==========================================
  // FUNÇÃO PARA ABRIR O MODAL DE NOVO CLIENTE
  // ==========================================
  const newButton = document.getElementById('new-button');
  const formDialog = document.getElementById('form-dialog');
  const formCancel = document.getElementById('form-cancel');

  if (newButton && formDialog) {
    newButton.addEventListener('click', () => {
      formDialog.showModal(); // Abre o modal na tela
    });
  }

  if (formCancel && formDialog) {
    formCancel.addEventListener('click', () => {
      formDialog.close(); // Fecha se clicar em Cancelar
    });
  }

  // ==========================================
  // ESCUTADOR GLOBAL - FORÇA O FUNCIONAMENTO DO BOTÃO
  // ==========================================
  document.addEventListener('submit', async (event) => {
    // Só executa se o envio vier do nosso formulário de cliente
    if (event.target && event.target.id === 'client-form') {
      event.preventDefault();

      const password = sessionStorage.getItem(STORAGE_KEY);
      if (!password) {
        alert('Sessão expirada. Faça login novamente.');
        showLogin();
        return;
      }

      // Captura os valores de forma segura prevenindo elementos nulos
      const formData = {
        full_name: document.getElementById('input-name')?.value || '',
        email: document.getElementById('input-email')?.value || null,
        phone: document.getElementById('input-phone')?.value || null,
        document: document.getElementById('input-document')?.value || null,
        birth_date: document.getElementById('input-birth')?.value || null,
        city: document.getElementById('input-city')?.value || null,
        state: document.getElementById('input-state')?.value || null,
        country: document.getElementById('input-country')?.value || 'Brasil',
        notes: document.getElementById('input-notes')?.value || null,
      };

      try {
        const response = await fetch('/api/clients', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-access-password': password,
          },
          body: JSON.stringify(formData),
        });

        const result = await response.json();

        if (!response.ok) {
          alert(`Erro ao cadastrar: ${result.error}`);
          return;
        }

        alert('Cliente cadastrado com sucesso!');
        event.target.reset(); // Limpa os campos do formulário na tela

        // Fecha a janela do modal automaticamente
        const formDialog = document.getElementById('form-dialog');
        if (formDialog && typeof formDialog.close === 'function') {
          formDialog.close();
        }

        loadClients(); // Recarrega a tabela com o novo cliente
      } catch (error) {
        console.error('Erro na requisição:', error);
        alert('Não foi possível conectar ao servidor.');
      }
    }
  });

  loadClients();
    // ==========================================
  // CONFIGURAÇÃO DO ESCUTADOR DE IDIOMAS (NO FINAL DO ARQUIVO)
  // ==========================================
  const langSelect = document.getElementById('lang-select');
  if (langSelect) {
    langSelect.addEventListener('change', (e) => {
      changeLanguage(e.target.value);
    });

    // Mantém o idioma que o usuário escolheu antes, ou inicia em português por padrão
    const savedLang = localStorage.getItem('panelLanguage') || 'pt';
    langSelect.value = savedLang;
    changeLanguage(savedLang);
  }

})();
