# PROJETO: PLATAFORMA SaaS DE EXTRAÇÃO DE FATURAS

## 1. Objetivo

Desenvolva uma plataforma SaaS completa, moderna, segura, responsiva e preparada para produção para extração e processamento de faturas.

O sistema deverá permitir que clientes criem suas contas, adicionem créditos por meio de pagamentos reais, realizem extrações de faturas manualmente pela interface ou programaticamente por uma API e acompanhem todo o ciclo de vida de suas requisições.

Cada requisição deverá possuir histórico, status, informações de consumo, arquivo original ou processado disponível para download durante 30 dias e dados extraídos exportáveis em JSON e CSV.

O produto deve transmitir confiança, tecnologia, segurança e sofisticação. Não desenvolva somente uma landing page ou um dashboard estático: construa a aplicação funcional, incluindo frontend, backend, banco de dados, autenticação, pagamentos, processamento assíncrono, documentação da API, testes e infraestrutura.

**IMPORTANTE SOBRE O BACKEND EXISTENTE:** o backend de extração já existe. Antes de implementar qualquer funcionalidade, inspecione o código disponível, descubra como funciona o processamento atual e identifique os endpoints, serviços, DTOs, formatos de arquivos e modelos de resposta existentes. Preserve e reutilize o mecanismo de extração. Desenvolva as camadas de autenticação, créditos, pagamentos, histórico, armazenamento e interface necessárias para integrá-lo. Não substitua o processamento existente por uma implementação fictícia.

Caso o backend existente não esteja disponível no ambiente, construa a estrutura de integração com contratos tipados, adaptadores e mocks exclusivamente para desenvolvimento, deixando a integração real claramente identificada.

---

## 2. Stack tecnológica obrigatória

### Frontend

- TypeScript com strict mode.
- React.
- Vite.
- Tailwind CSS.
- React Router para roteamento.
- TanStack Query para gerenciamento de estado remoto, cache e requisições.
- Zustand para estados globais de interface quando necessário.
- React Hook Form e Zod para formulários e validação.
- Framer Motion ou Motion para animações.
- Lucide React para ícones.
- Recharts para gráficos.
- Uma biblioteca de componentes acessíveis, preferencialmente shadcn/ui, customizada para a identidade visual.
- React Dropzone para upload de arquivos.
- Lazy loading de rotas, componentes e recursos visuais.
- Vitest e React Testing Library para testes de frontend.

### Backend

- Node.js com TypeScript.
- NestJS com arquitetura modular.
- Prisma ORM.
- PostgreSQL.
- Redis para filas, cache e coordenação de tarefas, quando apropriado.
- BullMQ para processamento assíncrono.
- Swagger/OpenAPI para documentação dos endpoints.
- JWT com estratégia segura de autenticação e renovação de sessão.
- Passport quando apropriado.
- DTOs validados com class-validator e class-transformer.
- Argon2id ou alternativa segura para armazenamento de senhas.
- Integração com gateway de pagamentos que suporte PIX, cartão e, opcionalmente, boleto.
- Armazenamento de arquivos compatível com S3, com URLs assinadas.
- WebSockets ou Server-Sent Events para atualizações de status em tempo real, com polling como alternativa.
- Jest para testes unitários e de integração.
- Pino ou ferramenta equivalente para logs estruturados.

### Infraestrutura e qualidade

- Docker e Docker Compose.
- PostgreSQL e Redis em ambiente local.
- Variáveis de ambiente validadas.
- Migrations e seeds do Prisma.
- ESLint e Prettier.
- GitHub Actions para CI.
- Testes automatizados.
- Health checks.
- Logs estruturados e rastreabilidade de requisições.
- Configuração para desenvolvimento local e deploy em produção.

Use versões estáveis e compatíveis das bibliotecas. Verifique as APIs atuais das dependências antes de implementar a aplicação.

---

## 3. Direção visual e design system

Crie uma interface premium, contemporânea, sofisticada e consistente.

### Identidade visual

Utilize uma linguagem visual inspirada em produtos SaaS modernos de fintech, processamento de documentos e infraestrutura de APIs.

Características:

- Glassmorphism aplicado com moderação.
- Background predominantemente escuro, em azul-marinho profundo ou grafite.
- Gradientes discretos em azul elétrico, ciano e violeta.
- Superfícies translúcidas com backdrop blur.
- Bordas finas e semitransparentes.
- Sombras suaves e profundidade visual.
- Tipografia moderna, preferencialmente Inter ou Geist.
- Ícones minimalistas.
- Gráficos limpos e legíveis.
- Espaçamento generoso e hierarquia visual bem definida.
- Microinterações em hover, foco, clique, carregamento e transições de página.
- Skeleton loaders e estados de carregamento elegantes.
- Toasts para feedback das ações.
- Animações suaves, sem comprometer a performance.
- Contraste adequado e acessibilidade WCAG AA.

Evite exagerar no blur, excesso de gradientes, elementos decorativos aleatórios, animações contínuas pesadas e excesso de cards. O resultado deve parecer um produto real de alto padrão, não um template genérico gerado por IA.

Crie tokens de design para cores, espaçamento, raios, sombras, tipografia e duração das animações.

Implemente suporte a tema escuro e claro, com o tema escuro como padrão.

A interface deve funcionar perfeitamente em desktop, tablet e celular.

---

## 4. Landing page pública

A landing page será a porta de entrada comercial da plataforma e deverá apresentar o serviço de extração de faturas.

Não exija autenticação para visualizar as páginas públicas.

### 4.1 Navbar

- Logo e nome da plataforma.
- Links para Funcionalidades, Como funciona, API, Preços e FAQ.
- Botão secundário "Entrar".
- Botão principal "Começar agora".
- Menu responsivo para dispositivos móveis.
- Navbar com transparência e blur ao rolar a página.
- Navegação suave entre seções.

### 4.2 Hero section

Desenvolva uma seção inicial visualmente impactante.

Sugestão de headline:

"Transforme faturas em dados estruturados."

Subtítulo:

"Extraia informações de faturas com praticidade, acompanhe suas requisições e integre o processamento diretamente aos seus sistemas por meio de uma API."

CTAs:

- "Começar gratuitamente", caso exista uma política real de créditos gratuitos.
- "Conhecer a API".

Inclua uma demonstração visual interativa de uma fatura sendo processada e transformada em dados estruturados.

A demonstração pode apresentar um documento de exemplo à esquerda, uma animação de processamento e uma prévia JSON à direita.

Utilize gradientes sutis, partículas ou formas abstratas leves e animações de entrada. Respeite prefers-reduced-motion.

Não simule resultados de processamento real como se fossem dados verdadeiros de clientes.

### 4.3 Seção de funcionalidades

Crie cards ou blocos visuais para:

- Extração de faturas.
- Conversão de documentos em JSON e CSV.
- Integração por API REST.
- Histórico de requisições.
- Acompanhamento de status.
- Gestão de créditos e consumo.
- Download de arquivos.
- Segurança e controle de acesso.

### 4.4 Como funciona

Apresente um fluxo visual em três ou quatro etapas:

1. Crie sua conta.
2. Adicione créditos.
3. Envie faturas manualmente ou por API.
4. Acompanhe os resultados e exporte os dados.

### 4.5 Seção para desenvolvedores

Destaque a API REST, exemplos de requisição, documentação interativa e integração com sistemas externos.

Inclua um exemplo de código em TypeScript usando fetch para enviar uma requisição autenticada. O exemplo deve corresponder ao contrato real da API.

### 4.6 Seção de preços

Apresente pacotes de créditos com valores configuráveis no backend.

Cada pacote deve exibir:

- Quantidade de créditos.
- Preço em reais.
- Preço por crédito, quando aplicável.
- Benefícios.
- Botão para comprar.

Não invente preços comerciais definitivos. Utilize dados configuráveis e deixe claro quando os valores exibidos forem apenas demonstrativos.

### 4.7 FAQ

Inclua perguntas sobre:

- Como funciona a extração.
- Como os créditos são consumidos.
- Quais formatos são aceitos.
- Como utilizar a API.
- Quanto tempo os arquivos ficam disponíveis.
- Como funcionam os pagamentos.
- Como são tratados os dados enviados.

As respostas devem corresponder às funcionalidades realmente implementadas.

### 4.8 Footer

Inclua links para:

- Documentação.
- Termos de uso.
- Política de privacidade.
- Política de retenção de arquivos.
- Suporte.
- Contato comercial.

---

## 5. Autenticação e cadastro

Implemente um fluxo completo de autenticação.

### Páginas

- Cadastro.
- Login.
- Recuperação de senha.
- Redefinição de senha.
- Verificação de e-mail.
- Sessão expirada.
- Logout.

### Cadastro

Campos:

- Nome.
- E-mail.
- Senha.
- Confirmação de senha.
- Aceite dos termos de uso e política de privacidade.

Implemente validação no frontend e backend.

### Segurança

- Hash seguro das senhas.
- JWT com estratégia de renovação segura.
- Preferencialmente, refresh token rotativo armazenado em cookie HttpOnly, Secure e SameSite apropriado.
- Proteção contra brute force e abuso de endpoints.
- Revogação de sessões.
- Verificação de e-mail.
- Tokens de recuperação de senha com expiração.
- Rate limiting.
- CORS restritivo.
- Proteção contra CSRF quando aplicável à estratégia de autenticação.
- Não armazenar credenciais sensíveis em localStorage.
- Nunca registrar senhas, tokens ou dados sensíveis em logs.

Crie guardas, decorators e políticas de autorização no NestJS.

---

## 6. Dashboard principal

Após autenticar, o usuário deverá acessar um dashboard moderno e funcional.

### Layout

Sidebar com:

- Visão geral.
- Nova extração.
- Histórico.
- Créditos e pagamentos.
- API e integrações.
- Notificações.
- Perfil.
- Configurações.
- Ajuda e suporte.

No topo:

- Busca, se útil.
- Indicador de notificações não lidas.
- Saldo atual de créditos.
- Avatar e menu da conta.

A sidebar deve ser recolhível no desktop e transformar-se em navegação adaptada para dispositivos móveis.

### Visão geral

Exiba:

- Saldo atual de créditos.
- Total de requisições.
- Requisições concluídas.
- Requisições em processamento.
- Requisições com falha.
- Créditos consumidos no período.
- Últimas requisições.
- Gráfico de utilização por período.
- Atalhos para nova extração, comprar créditos e acessar a documentação da API.

Implemente filtros por período e carregamento dos dados reais do backend.

Cada métrica deverá possuir estado de carregamento, estado vazio e tratamento de erro.

---

## 7. Extração manual de faturas

Crie uma página dedicada para executar extrações pela interface.

### Funcionalidades

- Upload por drag-and-drop.
- Seleção de arquivos pelo explorador.
- Suporte aos formatos realmente aceitos pelo backend.
- Validação de extensão, MIME type e tamanho.
- Exibição dos arquivos selecionados.
- Nome, tamanho e formato dos arquivos.
- Remoção de arquivos antes do envio.
- Barra de progresso quando houver suporte real ao acompanhamento do upload.
- Prévia do arquivo quando possível e seguro.
- Estimativa de consumo, se houver uma regra de cobrança implementada.
- Confirmação do envio e consumo previsto de créditos.
- Botão "Iniciar extração".
- Bloqueio de envio duplicado durante a execução.
- Feedback imediato da requisição.
- Atualização de status em tempo real ou por polling.

O backend deverá validar os arquivos independentemente das validações do frontend.

Se houver suporte a múltiplos arquivos, estabeleça claramente se cada arquivo representa uma requisição independente ou se um lote representa uma única requisição. Não misture os dois modelos sem uma regra explícita.

### Resultado

Após a conclusão, apresente:

- Status final.
- Identificador da requisição.
- Data e hora.
- Tempo de processamento, quando disponível.
- Créditos consumidos.
- Resumo dos dados extraídos.
- Botão para baixar o arquivo original ou processado, conforme a definição do backend.
- Botão para baixar o JSON.
- Botão para baixar o CSV.
- Opção de visualizar os dados extraídos em uma tabela.
- Opção de visualizar o JSON formatado.
- Mensagens de erro claras e acionáveis.

Não considere uma requisição concluída apenas porque o upload foi recebido. Utilize o status retornado pelo serviço de processamento.

---

## 8. Histórico de requisições

Implemente uma página completa de histórico.

### Tabela

Colunas sugeridas:

- ID da requisição.
- Nome do arquivo.
- Data de criação.
- Tipo de processamento.
- Status.
- Créditos consumidos.
- Duração.
- Disponibilidade dos arquivos.
- Ações.

### Status

Utilize estados consistentes, como:

- Pendente.
- Na fila.
- Em processamento.
- Concluída.
- Falha.
- Cancelada, somente se houver suporte real ao cancelamento.

Use badges visuais discretos e diferentes para cada estado.

### Filtros

- Pesquisa por ID ou nome do arquivo.
- Status.
- Período.
- Tipo de requisição.
- Ordenação.
- Paginação no backend.

### Detalhes da requisição

Ao clicar em uma linha, abrir uma página de detalhes ou drawer com:

- Identificação da requisição.
- Arquivo associado.
- Linha do tempo de processamento.
- Status atual e histórico de mudanças.
- Créditos consumidos.
- Erros retornados, quando aplicável.
- JSON extraído.
- Prévia tabular dos dados.
- Download de JSON e CSV.
- Download do arquivo original ou processado, conforme a política definida.
- Data de expiração dos arquivos.
- Identificação da API key utilizada, sem expor seu segredo.

O histórico das requisições deve permanecer consultável após a expiração dos arquivos, enquanto os metadados forem mantidos pela política de retenção.

---

## 9. Créditos e carteira

Implemente um sistema de créditos com consistência financeira.

### Saldo

Exiba:

- Saldo disponível.
- Créditos reservados, se houver.
- Total comprado.
- Total consumido.
- Histórico de movimentações.
- Data e origem de cada movimentação.

### Compra de créditos

Permita:

- Escolher um pacote.
- Selecionar uma quantidade personalizada, se habilitada.
- Visualizar preço, valor final e eventuais taxas aplicáveis.
- Selecionar o meio de pagamento.
- Acompanhar o status do pagamento.
- Consultar comprovantes ou referências de transação, quando fornecidos pelo gateway.

### Pagamentos

Estruture uma integração com um gateway de pagamento que suporte os meios exigidos, preferencialmente PIX e cartão, com boleto opcional.

O gateway deverá ser configurável por ambiente.

Implemente:

- Criação de pedidos de compra.
- Registro de transações.
- Webhooks assinados e verificados.
- Idempotência dos eventos.
- Estados de pagamento.
- Expiração de cobranças.
- Conciliação e tratamento de pagamentos duplicados.
- Tratamento de falhas.
- Registro de estornos e chargebacks.
- Reversão ou ajuste dos créditos conforme uma política consistente.

Nunca credite a conta somente porque o frontend informou que o pagamento foi concluído. A confirmação deve ocorrer pelo backend após validação do evento confiável do gateway.

Nunca armazene dados completos de cartão de crédito. Utilize os componentes tokenizados ou hospedados do provedor de pagamento.

### Livro-razão de créditos

Implemente um ledger de movimentações imutável, com registros para:

- Compra.
- Consumo.
- Reserva.
- Liberação de reserva.
- Estorno.
- Ajuste administrativo justificado.

O saldo deve ser consistente com as movimentações. Implemente transações de banco e mecanismos contra condições de corrida para impedir saldo negativo ou consumo duplicado.

Não permita editar ou apagar movimentações financeiras históricas arbitrariamente.

---

## 10. Motor de cobrança e consumo

Crie uma camada de cobrança desacoplada do mecanismo de extração.

O custo de cada requisição deve ser configurável e estar relacionado às regras reais do produto.

Considere:

- Cobrança por arquivo.
- Cobrança por página, se aplicável.
- Cobrança variável conforme o tipo de processamento, caso exista.
- Reserva de créditos antes de iniciar o processamento.
- Confirmação do consumo após a conclusão conforme a política definida.
- Liberação da reserva quando uma operação não iniciar.
- Política explícita para falhas parciais, falhas do serviço e reprocessamentos.

Implemente a cobrança de forma idempotente, associada ao ID da requisição.

Uma mesma requisição não poderá consumir créditos duas vezes por causa de retries, reconexões, reentrega de mensagens ou processamento concorrente.

Se o custo não puder ser calculado antecipadamente, apresente uma estimativa ou explique a regra antes do envio, quando possível.

Centralize as regras de cobrança no backend. Nunca confie em valores de crédito calculados pelo frontend.

---

## 11. API pública para clientes

O usuário deverá conseguir realizar extrações sem acessar o dashboard.

Implemente uma API REST versionada, por exemplo /api/v1, adaptando os caminhos às convenções já existentes no backend.

### API keys

Crie uma seção "API e integrações" para:

- Criar uma API key.
- Definir um nome para a chave.
- Consultar a data de criação.
- Consultar a última utilização.
- Consultar seu status.
- Revogar uma chave.
- Criar múltiplas chaves, se permitido.
- Exibir permissões e limites.
- Consultar documentação e exemplos.

Exiba o segredo completo somente no momento da criação. Armazene apenas um hash seguro da chave, com identificador público ou prefixo para facilitar a identificação.

Implemente rate limiting, limites de concorrência e limites de consumo por conta.

### Endpoints de referência

Defina contratos equivalentes a:

POST /api/v1/extractions
GET /api/v1/extractions
GET /api/v1/extractions/:id
GET /api/v1/extractions/:id/result
GET /api/v1/extractions/:id/download
GET /api/v1/credits/balance
GET /api/v1/credits/transactions

Os caminhos são propostas e devem ser adaptados ao backend existente.

### Fluxo da API

1. O cliente envia uma requisição autenticada.
2. O backend valida a chave, permissões, limites e saldo.
3. A operação é registrada.
4. Os créditos são reservados conforme a política.
5. O processamento é enfileirado ou executado pelo serviço de extração.
6. O cliente recebe um identificador da requisição.
7. O cliente consulta o status.
8. Quando concluído, o cliente obtém os dados e os arquivos.
9. O consumo é confirmado conforme a regra de cobrança.

Quando apropriado, utilize HTTP 202 Accepted para processamento assíncrono.

Implemente suporte a uma chave de idempotência para evitar requisições duplicadas.

Padronize respostas e erros em JSON, com códigos de erro documentados, request ID e mensagens sem informações internas sensíveis.

### Documentação

Disponibilize documentação interativa via Swagger/OpenAPI e exemplos de integração em TypeScript, Python e cURL.

Inclua autenticação, upload multipart, consulta de status, consulta de resultados, erros, limites e política de retenção.

---

## 12. Armazenamento e retenção de arquivos

Implemente uma política de retenção de 30 dias para os arquivos relacionados às extrações, incluindo os arquivos originais, processados e resultados exportáveis, conforme a política definida para cada artefato.

Armazene os arquivos em storage compatível com S3 ou serviço equivalente. Não armazene arquivos grandes diretamente em colunas do PostgreSQL.

### Requisitos

- Cada artefato deverá possuir data de criação e data de expiração.
- A interface deverá exibir quanto tempo resta até a expiração.
- Os arquivos deverão ser acessados por URLs assinadas de curta duração.
- O backend deverá verificar a propriedade da requisição antes de emitir uma URL de download.
- Um job agendado deverá identificar arquivos expirados e removê-los do armazenamento.
- A remoção deverá ser idempotente e possuir logs de execução.
- Deve haver tratamento de falhas de exclusão e novas tentativas.
- O histórico da requisição deverá continuar disponível após a remoção dos arquivos.
- O usuário deverá ser avisado sobre a expiração e a impossibilidade de download após o prazo.
- Caso existam obrigações legais de retenção ou exclusão, documente a política aplicável.

Não confie somente em um campo de data na interface. A autorização e a expiração devem ser verificadas no backend.

Considere que backups, réplicas, caches e logs podem conter dados residuais. Defina como eles serão tratados para que a política de retenção seja consistente.

---

## 13. Perfil do usuário

Crie uma página de perfil moderna e completa.

### Dados pessoais

- Nome.
- E-mail.
- Avatar opcional.
- Data de cadastro.
- Último acesso.
- Status de verificação de e-mail.

### Ações

- Editar nome.
- Atualizar avatar.
- Alterar e-mail com confirmação.
- Alterar senha.
- Encerrar sessões.
- Consultar sessões ativas, quando implementadas.
- Solicitar exclusão da conta.
- Exportar dados pessoais, quando aplicável.

Exija reautenticação para operações sensíveis.

A exclusão de conta deverá respeitar a política de retenção, obrigações financeiras e requisitos legais, sem apagar indevidamente registros que precisem ser mantidos.

---

## 14. Configurações

Crie uma área de configurações organizada por categorias.

### Preferências gerais

- Tema claro ou escuro.
- Idioma, inicialmente português brasileiro.
- Fuso horário.
- Formato de data.
- Preferências de visualização.

### Preferências de extração

- Formato de saída padrão: JSON ou CSV.
- Preferências de notificação.
- Configurações de processamento que sejam realmente suportadas.
- Comportamento padrão para visualização e download.

### Segurança

- Alteração de senha.
- Sessões ativas.
- Revogação de sessões.
- API keys.
- Preferências de autenticação, incluindo MFA caso implementado.

### Privacidade

- Exportação de dados.
- Exclusão de conta.
- Política de retenção.
- Consentimentos e preferências de comunicação.

As configurações devem ser persistidas no backend quando afetarem o funcionamento da conta.

---

## 15. Notificações

Crie uma central de notificações com aparência premium.

### Tipos

- Extração concluída.
- Extração com falha.
- Créditos baixos.
- Compra confirmada.
- Pagamento pendente.
- Pagamento recusado.
- Arquivos próximos da expiração.
- API key criada ou revogada.
- Eventos de segurança.

### Funcionalidades

- Lista cronológica.
- Indicador de notificações não lidas.
- Marcar como lida.
- Marcar todas como lidas.
- Filtros por categoria.
- Navegação para a requisição ou pagamento relacionado.
- Preferências por tipo de notificação.
- Paginação.

Utilize notificações persistidas no banco de dados. Para eventos importantes, a criação da notificação deve estar desacoplada do processamento principal.

Envie notificações por e-mail somente quando a funcionalidade estiver configurada e o envio for confirmado pelo serviço correspondente.

Não mostre notificações fictícias como se fossem eventos reais.

---

## 16. Banco de dados e Prisma ORM

Projete um schema consistente para PostgreSQL.

Considere, no mínimo, as seguintes entidades:

- User.
- UserProfile ou campos equivalentes no User.
- Session ou RefreshToken.
- VerificationToken.
- PasswordResetToken.
- UserSettings.
- Extraction.
- ExtractionArtifact.
- ExtractionEvent.
- ExtractionResult, quando necessário.
- CreditAccount, se houver necessidade de projeção do saldo.
- CreditTransaction.
- CreditReservation.
- PaymentOrder.
- PaymentTransaction.
- PaymentWebhookEvent.
- ApiKey.
- Notification.
- NotificationPreference.
- AuditLog.

Ajuste a modelagem às necessidades reais do sistema e ao backend existente.

### Regras de modelagem

- Utilize UUID ou outro identificador seguro e consistente.
- Use Decimal ou representação inteira em unidades mínimas para valores monetários.
- Utilize transações do Prisma para operações financeiras críticas.
- Defina índices para consultas frequentes.
- Crie chaves estrangeiras e restrições adequadas.
- Use timestamps consistentes em UTC.
- Utilize enums para estados bem definidos.
- Estabeleça relações explícitas entre usuário, requisição, pagamento, artefato e movimentação de créditos.
- Evite duplicação desnecessária de dados.
- Implemente paginação no banco.
- Garanta isolamento entre usuários em todas as consultas.

Não use somente o frontend para filtrar dados por usuário. Toda consulta deverá ser autorizada no backend.

Documente as decisões de modelagem e a estratégia de consistência do saldo.

---

## 17. Arquitetura do backend NestJS

Organize o backend em módulos coesos, com responsabilidades bem definidas.

Estrutura sugerida:

src/
  auth/
  users/
  profiles/
  settings/
  extractions/
  extraction-engine/
  extraction-artifacts/
  credits/
  billing/
  payments/
  webhooks/
  api-keys/
  notifications/
  storage/
  retention/
  audit/
  health/
  common/
  config/
  prisma/
  app.module.ts
  main.ts

Adapte a estrutura conforme o código existente. Não crie módulos duplicados para funcionalidades já implementadas.

### Serviços principais

- AuthService.
- UsersService.
- ExtractionsService.
- ExtractionEngineAdapter.
- ExtractionQueueService.
- CreditsService.
- CreditLedgerService.
- BillingService.
- PaymentsService.
- StorageService.
- ArtifactRetentionService.
- ApiKeysService.
- NotificationsService.
- AuditService.

Utilize interfaces e injeção de dependências para desacoplar gateway de pagamento, armazenamento e motor de extração.

Não implemente lógica de negócio diretamente nos controllers.

Os controllers devem validar a entrada, aplicar a autenticação e delegar a execução aos serviços apropriados.

Implemente tratamento centralizado de exceções e logs com contexto.

---

## 18. Integração com o backend de extração existente

Esta etapa é prioritária.

Antes de desenvolver, identifique:

- Como o motor recebe arquivos.
- Como a extração é iniciada.
- Quais formatos são aceitos.
- Quais formatos de resultado são produzidos.
- Como os erros são representados.
- Se o processamento é síncrono ou assíncrono.
- Como identificar uma execução.
- Quais são os limites de tamanho e concorrência.
- Se existe uma API interna ou se o serviço é uma biblioteca.
- Como consultar o status e recuperar os resultados.

Crie um adaptador para conectar o motor ao módulo de extrações.

Não acople o restante da plataforma diretamente a detalhes específicos do motor.

Se o motor retornar JSON, valide o resultado e preserve sua estrutura original, salvo se houver um contrato de normalização definido.

O CSV deverá ser produzido de forma consistente a partir dos dados extraídos ou pelo próprio motor, conforme as capacidades existentes.

Se o JSON possuir estruturas aninhadas, arrays ou campos heterogêneos, defina uma estratégia de exportação para CSV e documente como esses dados serão representados.

Se o serviço atual não oferecer consulta de status, implemente o acompanhamento na camada de orquestração, sem inventar informações sobre o progresso interno.

---

## 19. Segurança, privacidade e auditoria

Considere que faturas podem conter informações pessoais, fiscais, bancárias e comerciais.

Implemente:

- Isolamento de dados por usuário.
- Autorização no backend para cada requisição e download.
- Validação rigorosa dos arquivos.
- Limites de tamanho e quantidade.
- Proteção contra path traversal.
- Nomes internos de arquivo gerados pelo sistema.
- Verificação de MIME type e assinatura do arquivo quando aplicável.
- Proteção contra uploads maliciosos.
- Possibilidade de integração com antivírus.
- URLs assinadas com expiração curta.
- Criptografia em trânsito.
- Criptografia em repouso, conforme o storage.
- Gestão segura de secrets.
- Rate limiting por usuário e API key.
- Auditoria de operações sensíveis.
- Redação de dados sensíveis nos logs.
- Política de retenção e descarte.
- Proteção contra enumeração de IDs.
- Controle de permissões para operações administrativas.
- Princípio do menor privilégio.

Observe os princípios aplicáveis da LGPD, incluindo finalidade, necessidade, segurança e transparência. Não declare conformidade legal sem avaliar a implementação e as obrigações aplicáveis.

---

## 20. Performance e lazy loading

A aplicação deverá ser rápida, inclusive em contas com milhares de requisições.

Implemente:

- Lazy loading de páginas com React.lazy e Suspense.
- Divisão de bundles por rota.
- Carregamento sob demanda de gráficos e editores JSON.
- Paginação server-side.
- Filtros e ordenação executados no backend.
- Debounce em pesquisas.
- Cache controlado com TanStack Query.
- Invalidação correta após alterações.
- Cancelamento de requisições quando apropriado.
- Virtualização de tabelas extensas, se necessária.
- Otimização de imagens.
- Skeleton loaders.
- Compressão HTTP.
- Índices de banco de dados.
- Consultas Prisma eficientes.
- Limites de concorrência.
- Processamento assíncrono.
- Backpressure para filas.
- Retry com backoff exponencial para falhas transitórias.
- Idempotência em tarefas e webhooks.

Evite consultas N+1, renderizações desnecessárias e download antecipado de arquivos grandes.

---

## 21. Filas e processamento assíncrono

Utilize BullMQ e Redis quando apropriado para orquestrar tarefas.

Defina filas ou processos separados para:

- Processamento de extrações.
- Geração de artefatos.
- Notificações.
- Retenção e limpeza de arquivos.
- Reconciliação de pagamentos, quando necessária.

Cada tarefa deverá possuir:

- Identificador.
- Estado.
- Tentativas.
- Política de retry.
- Tratamento de falhas definitivas.
- Logs.
- Idempotência.
- Timeout.
- Mecanismo de recuperação.

Evite processar a mesma extração simultaneamente em workers diferentes.

Garanta que falhas no worker não resultem em cobranças duplicadas ou perda do histórico.

---

## 22. Testes obrigatórios

### Frontend

- Cadastro e login.
- Navegação entre páginas.
- Upload.
- Filtros do histórico.
- Visualização dos resultados.
- Exportação.
- Configurações.
- Estados de erro e carregamento.
- Responsividade.

### Backend

- Autenticação e autorização.
- Isolamento entre usuários.
- Criação e consulta de extrações.
- Validação de arquivos.
- Consumo e reserva de créditos.
- Concorrência e idempotência.
- Pagamentos e webhooks.
- API keys.
- Geração de URLs assinadas.
- Expiração de artefatos.
- Notificações.
- Recuperação de falhas no processamento.

### Testes críticos de integração

1. Usuário sem saldo não consegue iniciar uma extração paga.
2. Duas requisições concorrentes não conseguem consumir o mesmo saldo indevidamente.
3. Um webhook de pagamento repetido não duplica créditos.
4. Uma extração com falha segue a política definida de cobrança.
5. Um usuário não consegue consultar ou baixar arquivos de outro usuário.
6. Arquivos expirados não podem ser baixados.
7. O histórico permanece disponível após a expiração dos artefatos.
8. Uma API key revogada não pode iniciar novas requisições.
9. Retries não duplicam extrações ou movimentações financeiras.
10. O sistema recupera o estado de tarefas após falhas de workers.

---

## 23. Estrutura do repositório

Se o projeto estiver vazio, utilize um monorepo organizado.

Sugestão:

apps/
  web/
  api/
  worker/

packages/
  shared/
  config/
  eslint-config/
  tsconfig/

infra/
  docker/
  scripts/

docs/
  architecture.md
  api.md
  billing.md
  security.md
  retention.md
  deployment.md

Crie configurações compartilhadas quando trouxerem benefícios reais.

Não mova ou reestruture arbitrariamente um repositório existente. Se ele já possuir organização estabelecida, mantenha-a e adapte os módulos ao padrão atual.

---

## 24. Docker e ambiente local

Crie um Docker Compose com os serviços necessários:

- Frontend ou servidor de frontend para desenvolvimento.
- API NestJS.
- Worker de processamento.
- PostgreSQL.
- Redis.
- Serviço auxiliar de storage compatível com S3, se necessário para testes locais.

Inclua:

- Dockerfiles adequados.
- Volumes persistentes para desenvolvimento.
- Health checks.
- Dependências de inicialização.
- Variáveis de ambiente de exemplo.
- Migrations.
- Seeds.
- Scripts para desenvolvimento.
- Documentação para execução local.

Nunca inclua credenciais reais no repositório.

O projeto deve funcionar com um procedimento documentado e reproduzível, por exemplo:

1. Configurar o arquivo de ambiente.
2. Iniciar os serviços com Docker Compose.
3. Instalar as dependências.
4. Executar as migrations.
5. Criar os dados de desenvolvimento.
6. Iniciar frontend, API e worker.
7. Executar os testes.

Adapte os comandos ao gerenciador de pacotes escolhido.

---

## 25. Requisitos de experiência do usuário

Todas as páginas devem possuir:

- Loading states.
- Skeletons quando apropriado.
- Empty states com orientação para a próxima ação.
- Error states com mensagens compreensíveis.
- Confirmação para ações destrutivas.
- Feedback visual de sucesso.
- Navegação consistente.
- Breadcrumbs em páginas profundas, quando úteis.
- Formulários acessíveis.
- Foco visível.
- Navegação por teclado.
- Tratamento de sessões expiradas.
- Layout responsivo.

Evite páginas vazias, botões sem funcionalidade, links quebrados, gráficos com dados inventados e formulários que não persistem alterações.

Quando ainda não houver dados, apresente estados vazios elegantes e orientações para começar.

---

## 26. Fases de implementação

Execute o projeto de maneira incremental, sem tentar implementar tudo de uma vez.

### Fase 1 — Auditoria e planejamento

- Inspecionar todo o repositório.
- Identificar o backend de extração existente.
- Mapear as rotas, serviços e contratos atuais.
- Identificar lacunas.
- Definir arquitetura e modelo de dados.
- Criar ROADMAP.md.
- Criar documentos de arquitetura e integração.
- Registrar decisões técnicas.

### Fase 2 — Fundação

- Configurar TypeScript.
- Configurar frontend e backend.
- Configurar Prisma e PostgreSQL.
- Configurar Redis e workers, quando necessário.
- Configurar Docker.
- Configurar variáveis de ambiente.
- Configurar lint, testes e CI.

### Fase 3 — Autenticação e estrutura visual

- Criar design system.
- Implementar landing page.
- Implementar cadastro e login.
- Criar layout autenticado.
- Implementar rotas protegidas.
- Criar perfil e configurações básicas.

### Fase 4 — Extrações

- Integrar o motor existente.
- Criar o fluxo de upload.
- Criar orquestração assíncrona.
- Criar status e histórico.
- Implementar resultados JSON e CSV.
- Implementar armazenamento.
- Implementar downloads e retenção.

### Fase 5 — Créditos e pagamentos

- Implementar carteira.
- Implementar ledger.
- Implementar reservas e consumo.
- Integrar gateway de pagamentos.
- Implementar webhooks.
- Criar histórico financeiro.
- Testar concorrência e idempotência.

### Fase 6 — API pública

- Implementar API keys.
- Implementar endpoints versionados.
- Implementar autenticação por chave.
- Implementar limites e idempotência.
- Publicar documentação Swagger.
- Criar exemplos de integração.

### Fase 7 — Experiência avançada

- Implementar notificações.
- Implementar gráficos.
- Implementar preferências.
- Implementar atualizações de status.
- Refinar animações.
- Otimizar carregamento e responsividade.

### Fase 8 — Testes e produção

- Executar testes automatizados.
- Revisar segurança.
- Validar isolamento de dados.
- Validar pagamentos em sandbox.
- Testar expiração de arquivos.
- Testar falhas de workers.
- Revisar performance.
- Criar documentação de deploy.
- Preparar monitoramento, backups e recuperação.

---

## 27. Critérios de aceite

O sistema será considerado funcional quando:

- A landing page estiver completa, responsiva e visualmente refinada.
- O cliente conseguir criar conta, verificar e-mail e autenticar-se.
- O cliente conseguir visualizar e editar seu perfil.
- O cliente conseguir adicionar créditos por meio de pagamentos confirmados pelo backend.
- O saldo permanecer consistente mesmo com requisições concorrentes.
- O cliente conseguir enviar uma fatura manualmente.
- O sistema integrar o motor de extração existente.
- O cliente conseguir consultar o status da extração.
- O cliente conseguir visualizar o resultado.
- O cliente conseguir baixar JSON, CSV e os demais artefatos permitidos.
- Os arquivos expirarem após 30 dias conforme a política definida.
- O histórico permanecer consultável após a expiração.
- O cliente conseguir criar e revogar API keys.
- O cliente conseguir realizar extrações via API.
- As notificações forem persistidas e consultáveis.
- O histórico financeiro estiver disponível.
- Os testes críticos de segurança e cobrança passarem.
- A aplicação funcionar no ambiente local documentado.
- A documentação da API estiver atualizada.
- Não existirem botões críticos sem implementação ou dados falsos apresentados como reais.

---

## 28. Instruções finais para o agente

Trabalhe como um engenheiro de software sênior, com responsabilidade sobre arquitetura, segurança, experiência do usuário e qualidade de produção.

Antes de escrever código, inspecione o repositório e produza um diagnóstico curto com o que já existe, o que pode ser reutilizado e o que precisa ser criado.

Em seguida, crie ou atualize o ROADMAP.md e comece a implementação pela fundação do projeto.

Não se limite a gerar documentação e um protótipo visual. Implemente os módulos de forma incremental, execute os testes, corrija os problemas encontrados e mantenha o roadmap atualizado.

Não reescreva o motor de extração existente sem necessidade.

Não invente endpoints, formatos, preços, regras de cobrança ou resultados de processamento. Quando houver decisões de negócio ausentes, adote uma solução configurável e documente a premissa.

Priorize integridade financeira, isolamento de dados, rastreabilidade e segurança dos documentos.

Ao finalizar cada fase, informe:

- O que foi implementado.
- Arquivos e módulos criados ou modificados.
- Decisões técnicas relevantes.
- Testes executados e seus resultados.
- Variáveis de ambiente necessárias.
- Pendências e limitações.
- Próximas etapas.

O resultado final deve ser um SaaS de extração de faturas com identidade visual premium, interface moderna com impecabble glassmorphism, frontend TypeScript/Vite, backend NestJS/Prisma, pagamentos, créditos, API pública, histórico, armazenamento temporário e uma arquitetura preparada para evoluir e operar em produção.