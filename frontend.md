# PROMPT — FRONTEND SaaS DE EXTRAÇÃO DE FATURAS

## 1. Objetivo do projeto

Desenvolva o frontend completo de uma plataforma SaaS moderna para extração de faturas, com identidade visual premium e usando o impecabble, experiência de usuário sofisticada e arquitetura preparada para integração com um backend NestJS já existente.

A aplicação permitirá que usuários:

- Conheçam a plataforma por uma landing page pública.
- Criem uma conta e façam login.
- Visualizem seu dashboard.
- Enviem faturas para extração manual.
- Acompanhem o processamento das requisições.
- Consultem o histórico de extrações.
- Visualizem os dados extraídos.
- Baixem arquivos e resultados em JSON ou CSV.
- Consultem saldo e histórico de créditos.
- Acessem a interface de compra de créditos.
- Gerenciem suas API keys.
- Consultem a documentação da API.
- Gerenciem perfil, configurações e notificações.

**IMPORTANTE: construa somente o frontend.** Não implemente servidor NestJS, banco de dados, Prisma ORM, migrations, filas, workers, gateway de pagamento ou lógica de processamento de faturas.

O backend será responsável por autenticação real, processamento, persistência, pagamentos, autorização, créditos e armazenamento. O frontend deverá consumir essas funcionalidades por meio de uma camada de integração bem definida.

Não crie apenas um protótipo visual. Desenvolva páginas completas, componentes reutilizáveis, navegação funcional, formulários validados, estados de carregamento, tratamento de erros e integração preparada para APIs reais.

---

## 2. Stack tecnológica obrigatória

Utilize:

- TypeScript com strict mode.
- React.
- Vite.
- Tailwind CSS.
- React Router DOM.
- TanStack Query para requisições, cache e sincronização dos dados remotos.
- Zustand somente para estados globais de interface que realmente precisem dele.
- React Hook Form.
- Zod.
- Framer Motion ou Motion para animações.
- Lucide React para ícones.
- Recharts para gráficos.
- shadcn/ui como base opcional para componentes acessíveis, com customização visual completa.
- React Dropzone para upload de arquivos.
- React.lazy e Suspense para lazy loading de páginas.
- Vitest.
- React Testing Library.
- ESLint e Prettier.

Utilize versões estáveis e compatíveis das bibliotecas.

Não adicione bibliotecas desnecessárias. Priorize simplicidade, desempenho, manutenibilidade e consistência visual.

---

## 3. Direção visual

Crie uma interface premium, moderna, tecnológica e sofisticada.

A inspiração deve vir de dashboards SaaS de fintechs, plataformas de dados e ferramentas modernas para desenvolvedores.

### Identidade visual

- Glassmorphism elegante.
- Fundo azul-marinho profundo ou grafite.
- Gradientes sutis em azul, ciano e violeta.
- Cards translúcidos com backdrop blur.
- Bordas finas e semitransparentes.
- Sombras suaves.
- Tipografia Inter ou Geist.
- Ícones minimalistas.
- Gráficos limpos.
- Espaçamento generoso.
- Hierarquia visual bem definida.
- Microinterações refinadas.
- Transições suaves entre páginas.
- Skeleton loaders.
- Feedback visual para ações.
- Estados vazios bem elaborados.
- Layout responsivo para desktop, tablet e celular.

Use glassmorphism de maneira intencional. Não transforme todos os elementos em superfícies excessivamente transparentes, nem utilize gradientes exagerados.

O resultado deve parecer um produto SaaS comercial de alto padrão, não um template genérico.

### Temas

Implemente:

- Tema escuro como padrão.
- Tema claro como alternativa.
- Persistência da preferência de tema no navegador.
- Tokens de design para cores, espaçamento, tipografia, bordas, sombras e animações.

Respeite as preferências de acessibilidade, incluindo `prefers-reduced-motion`, navegação por teclado e contraste adequado.

---

## 4. Estrutura do frontend

Organize o código por funcionalidades e responsabilidades.

Estrutura sugerida:

src/
  app/
    App.tsx
    router.tsx
    providers.tsx
  assets/
  components/
    ui/
    layout/
    navigation/
    feedback/
    charts/
    data-display/
  features/
    auth/
    dashboard/
    extractions/
    history/
    credits/
    payments/
    api-keys/
    api-docs/
    notifications/
    profile/
    settings/
  hooks/
  lib/
    api/
    auth/
    formatting/
    validation/
    utils/
  mocks/
  pages/
    public/
    protected/
  routes/
  stores/
  styles/
  types/
  main.tsx

Ajuste essa estrutura quando necessário, mantendo uma organização clara.

Crie componentes compartilhados para tabelas, filtros, formulários, modais, dropdowns, cards, badges, alertas, skeletons e paginação.

Evite arquivos gigantes, duplicação de código e componentes que misturem muitas responsabilidades.

---

## 5. Landing page pública

A landing page deve apresentar comercialmente o serviço de extração de faturas.

Não exija login para acessar essa página.

### Navbar

Inclua:

- Logo e nome da plataforma.
- Funcionalidades.
- Como funciona.
- API.
- Preços.
- FAQ.
- Botão "Entrar".
- Botão principal "Começar agora".

A navbar deverá possuir transparência e blur, com comportamento refinado durante a rolagem.

No celular, transforme a navegação em um menu responsivo.

### Hero section

Headline:

"Transforme faturas em dados estruturados."

Subtítulo:

"Extraia informações de faturas, acompanhe suas requisições e integre o processamento diretamente aos seus sistemas por meio de uma API."

CTAs:

- "Começar agora".
- "Conhecer a API".

Crie uma composição visual sofisticada com uma demonstração ilustrativa de um documento sendo transformado em dados estruturados.

Mostre um documento à esquerda e uma representação JSON à direita, conectados por uma animação sutil de processamento.

A demonstração deverá ser claramente ilustrativa e não poderá ser confundida com uma extração real.

### Funcionalidades

Apresente:

- Extração automatizada de faturas.
- Conversão para JSON e CSV.
- API REST.
- Histórico de requisições.
- Acompanhamento de status.
- Gestão de créditos.
- Download de resultados.
- Interface para desenvolvedores.

### Como funciona

Crie um fluxo visual em quatro etapas:

1. Crie sua conta.
2. Adicione créditos.
3. Envie suas faturas.
4. Consulte e exporte os resultados.

### Seção de API

Inclua uma prévia de código com syntax highlighting ou uma apresentação estilizada de código.

Apresente exemplos de TypeScript, Python e cURL.

O código exibido deve corresponder ao contrato documentado ou ser identificado como exemplo ilustrativo até a integração real.

### Preços

Crie cards de pacotes de créditos configuráveis.

Cada pacote poderá apresentar:

- Nome.
- Quantidade de créditos.
- Preço.
- Custo unitário.
- Benefícios.
- Botão para comprar.

Não invente preços definitivos. Utilize dados de configuração ou mocks claramente identificados.

### FAQ e footer

Inclua perguntas sobre processamento, formatos, créditos, API, pagamentos e retenção de arquivos.

O footer deverá possuir links para documentação, termos, privacidade, suporte e contato.

---

## 6. Autenticação: interface e integração

Crie as páginas:

- Cadastro.
- Login.
- Recuperação de senha.
- Redefinição de senha.
- Verificação de e-mail.
- Sessão expirada.

### Cadastro

Campos:

- Nome.
- E-mail.
- Senha.
- Confirmação de senha.
- Aceite dos termos e política de privacidade.

### Login

Campos:

- E-mail.
- Senha.
- Opção de visualizar senha.
- Link para recuperação de senha.
- Link para cadastro.

Utilize React Hook Form e Zod para validação.

Implemente estados de carregamento, erros de validação, feedback de sucesso e mensagens de erro vindas da API.

Não implemente autenticação fictícia como se fosse real.

Crie uma camada `AuthService` para integrar os endpoints existentes.

Não invente contratos definitivos para autenticação. Documente os endpoints esperados e adapte-os aos contratos reais quando disponíveis.

O gerenciamento de sessão deverá respeitar a estratégia de autenticação definida pelo backend. Não armazene tokens sensíveis em localStorage por conveniência.

---

## 7. Layout autenticado

Crie um layout de aplicação com:

### Sidebar

- Visão geral.
- Nova extração.
- Histórico.
- Créditos.
- API e integrações.
- Documentação.
- Notificações.
- Perfil.
- Configurações.
- Ajuda e suporte.

### Header

- Título ou breadcrumb da página.
- Busca contextual, quando útil.
- Indicador de notificações.
- Saldo atual de créditos.
- Avatar.
- Menu da conta.

A sidebar deve ser recolhível no desktop e adaptada para dispositivos móveis.

Destaque a rota ativa.

Adicione animações discretas de navegação, sem exageros.

---

## 8. Dashboard

Desenvolva uma página inicial completa após o login.

### Indicadores

- Saldo de créditos.
- Total de requisições.
- Extrações concluídas.
- Extrações em andamento.
- Extrações com falha.
- Consumo de créditos no período.

### Gráficos

- Volume de requisições ao longo do tempo.
- Consumo de créditos.
- Distribuição dos status.

Inclua filtros por período quando aplicável.

### Últimas requisições

Apresente uma tabela compacta com:

- Nome do arquivo.
- Data.
- Status.
- Créditos consumidos.
- Ação para visualizar detalhes.

### Atalhos

- Nova extração.
- Comprar créditos.
- Gerenciar API keys.
- Consultar documentação.

Todos os indicadores deverão ser alimentados pela camada de API. Utilize mocks apenas em modo de desenvolvimento explicitamente habilitado.

---

## 9. Nova extração

Crie uma página com experiência de upload premium.

### Upload

- Drag-and-drop.
- Seleção de arquivos.
- Lista de arquivos selecionados.
- Nome, tamanho e extensão.
- Remoção de arquivos antes do envio.
- Validação de formato e tamanho conforme configuração do backend.
- Indicador de progresso do upload.
- Tratamento de falhas.
- Confirmação antes de iniciar o processamento.

Os formatos e limites aceitos devem ser configuráveis a partir do contrato da API, sem inventar restrições definitivas.

### Antes de enviar

Apresente:

- Quantidade de arquivos.
- Tamanho total.
- Estimativa de créditos, quando disponibilizada pela API.
- Saldo atual.
- Botão para iniciar extração.

Se não houver créditos suficientes, apresente um estado claro com link para a página de compra.

### Durante o processamento

- Exiba o ID da requisição.
- Status atual.
- Animação discreta de processamento.
- Indicador de progresso apenas quando existir informação real.
- Possibilidade de navegar para o histórico sem perder a referência da operação.

### Resultado

Após a conclusão, apresente:

- Status.
- Tempo de processamento, quando disponível.
- Créditos consumidos.
- Resumo dos dados.
- Prévia tabular.
- Visualizador JSON.
- Botão para baixar JSON.
- Botão para baixar CSV.
- Botão para baixar o arquivo original ou processado, conforme a API.

Não apresente percentuais ou etapas de progresso inventados.

---

## 10. Histórico de requisições

Crie uma página dedicada para consultar as extrações realizadas.

### Tabela

Colunas:

- ID.
- Arquivo.
- Data.
- Tipo.
- Status.
- Créditos consumidos.
- Duração.
- Disponibilidade dos arquivos.
- Ações.

### Filtros

- Busca por nome ou ID.
- Status.
- Período.
- Ordenação.
- Paginação.

Os filtros e a paginação devem utilizar parâmetros de API sempre que possível.

### Status

Apresente estados como:

- Pendente.
- Na fila.
- Em processamento.
- Concluída.
- Falha.
- Cancelada, se suportada.

Utilize badges elegantes e consistentes.

### Detalhes

Ao selecionar uma requisição, abra uma página de detalhes ou drawer contendo:

- Informações da requisição.
- Linha do tempo.
- Status.
- Créditos consumidos.
- Erros retornados.
- Dados extraídos.
- JSON formatado.
- Prévia em tabela.
- Links de download.
- Data de expiração dos arquivos.

Quando o prazo de 30 dias estiver próximo, mostre um aviso discreto. Quando o arquivo estiver expirado, desabilite o download e explique o motivo.

O frontend deverá respeitar a disponibilidade informada pelo backend, sem ser responsável por decidir se um arquivo ainda pode ser acessado.

---

## 11. Créditos e pagamentos

Crie uma área de carteira visualmente sofisticada.

### Resumo

- Saldo disponível.
- Créditos consumidos.
- Créditos comprados.
- Histórico de movimentações.

### Compra de créditos

Apresente pacotes configuráveis com:

- Quantidade de créditos.
- Preço.
- Custo unitário.
- Benefícios.
- Botão de compra.

### Checkout

Crie uma interface para escolher entre os métodos de pagamento suportados:

- PIX.
- Cartão de crédito.
- Boleto, se habilitado.

O frontend deverá integrar-se ao gateway por meio do fluxo definido pelo backend, utilizando checkout hospedado ou componentes oficiais do provedor quando aplicável.

Para PIX, apresente QR Code e código de pagamento somente quando fornecidos pela API.

Para cartão, utilize componentes tokenizados ou hospedados pelo provedor, sem armazenar dados completos do cartão.

Crie uma página de acompanhamento do pagamento com estados:

- Aguardando pagamento.
- Processando.
- Confirmado.
- Recusado.
- Expirado.
- Estornado.

O frontend nunca deve creditar saldo por conta própria. Ele apenas apresenta o saldo e o estado confirmados pelo backend.

### Histórico financeiro

Colunas:

- Data.
- Descrição.
- Tipo de movimentação.
- Quantidade de créditos.
- Valor financeiro, quando aplicável.
- Status.
- Referência da transação.

Inclua filtros e paginação.

---

## 12. API e integrações

Crie uma página dedicada para desenvolvedores.

### API keys

Permita:

- Visualizar chaves existentes.
- Criar uma chave.
- Definir nome.
- Copiar a chave no momento da criação.
- Exibir data de criação.
- Exibir última utilização, se disponível.
- Revogar uma chave.
- Consultar status e permissões.

O segredo completo deverá ser exibido somente quando fornecido pelo backend no momento da criação.

Inclua modal de confirmação para revogação e avisos sobre as consequências da operação.

### Documentação

Crie uma interface de documentação com:

- Navegação lateral.
- Autenticação.
- Criação de extração.
- Consulta de status.
- Consulta de resultados.
- Download.
- Códigos de erro.
- Limites de utilização.
- Exemplos em TypeScript, Python e cURL.

Quando possível, consuma a especificação OpenAPI do backend. Caso ela não esteja disponível, crie conteúdo demonstrativo claramente identificado, sem afirmar que endpoints fictícios já existem.

Inclua blocos de código com botão de copiar e boa legibilidade.

---

## 13. Perfil

Crie uma página de perfil com:

- Avatar.
- Nome.
- E-mail.
- Data de cadastro.
- Status de verificação do e-mail.
- Edição de dados pessoais.
- Alteração de senha.
- Encerramento de sessões, se suportado.
- Exportação de dados, se suportada.
- Solicitação de exclusão de conta.

Utilize formulários bem organizados, feedback de salvamento e confirmação para operações sensíveis.

---

## 14. Configurações

Crie uma área com navegação por categorias.

### Aparência

- Tema escuro.
- Tema claro.
- Preferência de idioma.
- Formato de data.

### Extrações

- Formato padrão de saída.
- Preferências de visualização.
- Notificações de processamento.

### Segurança

- Alteração de senha.
- Sessões ativas, quando disponíveis.
- Gerenciamento de API keys.
- Preferências de autenticação, quando suportadas.

### Notificações

- Preferências de e-mail.
- Notificações de extração.
- Avisos de créditos.
- Eventos de segurança.

Persistir no backend as preferências que afetem a conta. Preferências puramente visuais podem ser armazenadas localmente quando apropriado.

Não apresente controles que não possuem implementação como se estivessem funcionando.

---

## 15. Notificações

Crie uma central de notificações.

Tipos:

- Extração concluída.
- Extração com falha.
- Créditos baixos.
- Compra confirmada.
- Pagamento pendente.
- Pagamento recusado.
- Arquivos próximos da expiração.
- Eventos de segurança.

Funcionalidades:

- Lista cronológica.
- Indicador de não lidas.
- Marcar como lida.
- Marcar todas como lidas.
- Filtros.
- Navegação para a entidade relacionada.
- Paginação.
- Preferências de notificação.

Consuma os dados reais da API. Atualizações em tempo real podem utilizar WebSocket, SSE ou polling, conforme o backend oferecer suporte.

---

## 16. Camada de integração com API

Crie uma camada centralizada para toda a comunicação com o backend.

Estrutura sugerida:

src/lib/api/
  client.ts
  endpoints.ts
  errors.ts
  auth.service.ts
  users.service.ts
  extractions.service.ts
  credits.service.ts
  payments.service.ts
  api-keys.service.ts
  notifications.service.ts
  settings.service.ts

Adapte a organização para evitar fragmentação excessiva.

### Requisitos

- Base URL configurada por variável de ambiente.
- Tipagem de requests e responses.
- Tratamento consistente de erros.
- Timeout configurável.
- Cancelamento de requisições quando necessário.
- Suporte a upload multipart.
- Tratamento de sessão expirada.
- Integração com TanStack Query.
- Invalidação de cache após mutações.
- Mensagens de erro adequadas para o usuário.
- Logs de desenvolvimento sem dados sensíveis.

Utilize uma variável como:

`VITE_API_BASE_URL`

Nunca inclua secrets no bundle do frontend.

Não espalhe chamadas fetch ou axios diretamente por todos os componentes.

### Contratos

Antes de implementar os serviços, procure a documentação OpenAPI, os tipos compartilhados ou os contratos fornecidos pelo backend.

Se o backend não estiver acessível, crie interfaces tipadas provisórias e documente os endpoints esperados.

Não considere um contrato provisório como contrato definitivo.

---

## 17. Mocks e modo de desenvolvimento

O frontend deverá conseguir ser desenvolvido e visualizado sem depender continuamente do backend.

Crie um modo de demonstração controlado por variável de ambiente.

Exemplo:

`VITE_USE_MOCKS=true`

Nesse modo, utilize fixtures locais para:

- Dashboard.
- Histórico.
- Resultados de extrações.
- Créditos.
- Pagamentos.
- API keys.
- Notificações.
- Perfil.

Organize os mocks em `src/mocks`.

Sempre deixe claro que os dados são demonstrativos no ambiente de desenvolvimento.

Implemente uma camada de serviços para que seja possível alternar entre mocks e API real sem reescrever os componentes.

Não faça fallback silencioso para mocks quando uma API real falhar. Em modo real, mostre o erro e preserve a integridade dos dados.

Nunca coloque dados fictícios em produção por padrão.

---

## 18. Lazy loading e performance

Implemente:

- Lazy loading de todas as páginas não essenciais à renderização inicial.
- React.lazy e Suspense.
- Code splitting por rota.
- Carregamento sob demanda dos gráficos.
- Carregamento sob demanda do editor JSON.
- Otimização de imagens.
- Componentes reutilizáveis.
- Tabelas paginadas.
- Debounce nas pesquisas.
- Cache com TanStack Query.
- Invalidação de cache.
- Skeleton loaders.
- Redução de renderizações desnecessárias.
- Importações seletivas quando aplicável.

Evite carregar todas as dependências do dashboard na landing page.

Não utilize animações pesadas que prejudiquem a fluidez em dispositivos modestos.

---

## 19. Componentes reutilizáveis

Crie componentes visuais padronizados para:

- AppSidebar.
- AppHeader.
- PageHeader.
- GlassCard.
- StatCard.
- StatusBadge.
- DataTable.
- DataTableFilters.
- Pagination.
- FileDropzone.
- FileList.
- ExtractionProgress.
- JsonViewer.
- ResultPreview.
- CreditBalanceCard.
- CreditPackageCard.
- PaymentStatus.
- NotificationItem.
- EmptyState.
- ErrorState.
- SkeletonLoader.
- ConfirmDialog.
- FormField.
- ThemeToggle.
- CopyButton.
- ToastProvider.

A lista é uma referência. Reutilize somente o que fizer sentido para a aplicação.

Os componentes deverão possuir propriedades tipadas, estilos consistentes e suporte à acessibilidade.

---

## 20. Responsividade

A aplicação deverá funcionar bem em:

- Desktop.
- Notebook.
- Tablet.
- Celular.

No celular:

- Sidebar adaptada para drawer ou navegação compacta.
- Tabelas transformadas em layouts utilizáveis.
- Formulários em uma coluna.
- Cards empilhados.
- Gráficos responsivos.
- Modais adaptados à tela.
- Botões com áreas de toque adequadas.
- Landing page sem overflow horizontal.

Teste os principais breakpoints e estados de interação.

---

## 21. Testes

Utilize Vitest e React Testing Library.

Implemente testes para:

- Navegação entre páginas.
- Formulários de login e cadastro.
- Validação de campos.
- Upload e validação de arquivos.
- Filtros do histórico.
- Paginação.
- Visualização dos resultados.
- Tratamento de erros da API.
- Estados de carregamento.
- Componentes de compra de créditos.
- Preferência de tema.
- Notificações.
- Comportamento responsivo dos componentes principais.

Não teste somente a presença dos elementos. Verifique também o comportamento e os fluxos de interação.

---

## 22. Fases de implementação

### Fase 1 — Auditoria

- Inspecionar o repositório existente.
- Identificar o que já está implementado.
- Verificar documentação e contratos do backend.
- Definir arquitetura de frontend.
- Criar ou atualizar ROADMAP.md.

### Fase 2 — Fundação visual

- Configurar React, Vite e TypeScript.
- Configurar Tailwind CSS.
- Configurar design system.
- Criar componentes compartilhados.
- Implementar roteamento.
- Implementar temas.
- Implementar layout responsivo.

### Fase 3 — Landing page e autenticação

- Landing page.
- Cadastro.
- Login.
- Recuperação de senha.
- Estados de sessão.
- Rotas protegidas.

### Fase 4 — Dashboard e extrações

- Dashboard.
- Upload.
- Acompanhamento de status.
- Histórico.
- Detalhes das requisições.
- Visualização JSON.
- Exportação CSV e downloads.

### Fase 5 — Créditos e pagamentos

- Saldo.
- Pacotes.
- Checkout.
- Status de pagamento.
- Histórico financeiro.

### Fase 6 — API e conta

- API keys.
- Documentação.
- Perfil.
- Configurações.
- Notificações.

### Fase 7 — Integração

- Implementar camada de API.
- Conectar os serviços reais.
- Adaptar os tipos aos contratos existentes.
- Configurar autenticação.
- Configurar cache e atualizações de status.

### Fase 8 — Qualidade

- Executar testes.
- Revisar responsividade.
- Revisar acessibilidade.
- Otimizar bundles.
- Corrigir problemas de navegação.
- Verificar estados vazios e erros.
- Atualizar documentação.

---

## 23. Critérios de aceite

O frontend estará concluído quando:

- A landing page estiver visualmente refinada.
- Todas as páginas estiverem implementadas.
- O layout for responsivo.
- A navegação funcionar corretamente.
- Os formulários possuírem validação.
- O dashboard consumir dados por serviços tipados.
- O upload funcionar com o contrato da API.
- O histórico possuir filtros e paginação.
- Os resultados JSON forem visualizáveis.
- A interface permitir downloads dos arquivos autorizados.
- As páginas de créditos e pagamentos estiverem prontas para integração.
- A área de API keys estiver funcional com os serviços disponíveis.
- Perfil, configurações e notificações estiverem implementados.
- O lazy loading estiver configurado.
- Os estados de loading, erro, vazio e sucesso estiverem cobertos.
- Os mocks estiverem isolados do modo real.
- Os testes principais estiverem passando.
- Não existirem botões sem comportamento ou links quebrados.
- Não existirem dados fictícios apresentados como dados reais.
- O projeto puder ser iniciado localmente com instruções claras.

---

## 24. Instruções finais

Atue como um engenheiro frontend sênior, com foco em arquitetura, UI/UX, TypeScript, acessibilidade, desempenho e integração com APIs.

Primeiro, inspecione o repositório e identifique a estrutura existente. Não sobrescreva arquivos ou reestruture o projeto sem necessidade.

Crie ou atualize o ROADMAP.md antes de iniciar a implementação.

Implemente a aplicação em etapas, executando o projeto e validando visualmente as páginas ao longo do desenvolvimento.

Se houver acesso ao backend, consulte seus contratos e adapte a integração aos endpoints reais. Caso contrário, mantenha uma camada de serviços tipada, mocks isolados e documentação clara das integrações pendentes.

Priorize a landing page e o design system, depois implemente o layout autenticado e as páginas funcionais.

Não implemente o backend. Não crie banco de dados. Não simule pagamentos reais. Não invente endpoints como se existissem.

Ao concluir cada etapa, informe os arquivos criados ou modificados, os testes executados, o que funciona, as integrações pendentes e as próximas etapas.

O resultado deve ser um frontend SaaS premium, consistente, bonito, responsivo, funcional e pronto para se conectar ao backend de extração de faturas.