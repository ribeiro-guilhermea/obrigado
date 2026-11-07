# Money's Map · Página de obrigado + agendamento da Reunião de Implementação

Sistema que recebe o comprador depois do checkout da Kiwify, mostra o vídeo de boas-vindas, faz o agendamento do bônus (Reunião de Implementação), avisa o time no Telegram, envia e-mails ao comprador e oferece um painel para o comercial.

- Página pública: `/obrigado` (e o link pessoal `/agendar/...` enviado por e-mail)
- Painel do time: `/admin`
- Aviso da Kiwify (webhook): `/api/webhooks/kiwify`

Tudo roda na Cloudflare, no plano gratuito.

---

## Sumário

1. [Antes de começar](#1-antes-de-começar)
2. [Publicar na Cloudflare](#2-publicar-na-cloudflare)
3. [Cadastrar os segredos](#3-cadastrar-os-segredos)
4. [Primeiro acesso ao painel](#4-primeiro-acesso-ao-painel)
5. [Criar o bot do Telegram](#5-criar-o-bot-do-telegram)
6. [Configurar o e-mail (Resend)](#6-configurar-o-e-mail-resend)
7. [Configurar a Kiwify](#7-configurar-a-kiwify)
8. [Compra de teste: conferir tudo](#8-compra-de-teste-conferir-tudo)
9. [Quando comprar o domínio](#9-quando-comprar-o-domínio)
10. [Custo zero: serviços e limites](#10-custo-zero-serviços-e-limites)
11. [Como o sistema funciona (regras)](#11-como-o-sistema-funciona-regras)
12. [Para quem for mexer no código](#12-para-quem-for-mexer-no-código)

---

## 1. Antes de começar

Você vai precisar de:

- Uma conta no **GitHub** (já existe: é onde este código está).
- Uma conta na **Cloudflare** (gratuita): https://dash.cloudflare.com/sign-up
- Acesso à sua conta da **Kiwify**.
- O aplicativo do **Telegram** no celular.
- Uma conta no **Resend** (gratuita): https://resend.com/signup

> O código está na branch `claude/zen-carson-xyuqx0`. Antes de publicar, junte essa branch na `main`: no GitHub, abra o repositório, clique em **Pull requests** › **New pull request**, escolha `claude/zen-carson-xyuqx0` como origem e `main` como destino, clique em **Create pull request** e depois em **Merge pull request**.

---

## 2. Publicar na Cloudflare

A Cloudflare vai ler o código do GitHub e publicar sozinha. A cada mudança na `main`, ela publica de novo.

1. Entre em https://dash.cloudflare.com.
2. No menu da esquerda, clique em **Compute (Workers)** › **Workers & Pages**.
3. Clique em **Create** (ou **Create application**).
4. Escolha **Import a repository** (Importar um repositório) e clique em **Connect GitHub** / **Get started**.
5. Autorize a Cloudflare a acessar o GitHub. Quando perguntar, permita o acesso ao repositório **obrigado**.
6. Selecione o repositório **obrigado** e clique em **Next** / **Begin setup**.
7. Na tela de configuração:
   - **Project name**: `moneys-map-obrigado`
   - **Production branch**: `main`
   - **Build command**: deixe em branco
   - **Deploy command**: `npx wrangler deploy` (normalmente já vem preenchido)
8. Clique em **Save and Deploy** / **Deploy**.
9. Espere de 1 a 3 minutos. Quando aparecer **Success**, a Cloudflare mostra o endereço do site, algo como:
   `https://moneys-map-obrigado.SEU-USUARIO.workers.dev`

   **Anote esse endereço.** Nas próximas etapas ele aparece como `SEU-ENDERECO`.

> O banco de dados (D1) é criado automaticamente na primeira publicação, e as tabelas são criadas no primeiro acesso. Você não precisa fazer nada.

Teste: abra `SEU-ENDERECO/obrigado` no navegador. A página deve aparecer.

---

## 3. Cadastrar os segredos

Senhas e chaves ficam guardadas como "segredos" na Cloudflare, nunca no código.

1. Em **Workers & Pages**, clique em **moneys-map-obrigado**.
2. Clique na aba **Settings** (Configurações).
3. Na seção **Variables and Secrets**, clique em **Add**.
4. Em **Type**, escolha **Secret** (importante: sempre "Secret", nunca "Text").
5. Preencha **Variable name** e **Value** e clique em **Save** / **Deploy**.
6. Repita para cada linha da tabela abaixo.

| Nome (copie exatamente) | O que colocar | Quando |
|---|---|---|
| `ADMIN_PASSWORD` | Uma senha forte que só você sabe (12+ caracteres). É a senha do primeiro acesso ao painel e também serve para recuperar o acesso do dono. | Agora |
| `KIWIFY_WEBHOOK_TOKEN` | O token que a Kiwify mostra ao criar o webhook (etapa 7). | Etapa 7 |
| `TELEGRAM_BOT_TOKEN` | O token do bot (etapa 5). | Etapa 5 |
| `TELEGRAM_CHAT_ID` | O número do chat do time (etapa 5). | Etapa 5 |
| `RESEND_API_KEY` | A chave do Resend (etapa 6). | Etapa 6 |
| `BREVO_API_KEY` | Só se um dia trocar para o Brevo. | Opcional |

> Você pode cadastrar cada segredo quando chegar na etapa correspondente. Depois de salvar um segredo, ele vale em poucos segundos.

---

## 4. Primeiro acesso ao painel

1. Abra `SEU-ENDERECO/admin`.
2. Em **Seu nome**, digite seu nome (por exemplo, `Guilherme`).
3. Em **Senha**, digite a senha que você cadastrou como `ADMIN_PASSWORD`.
4. Clique em **Entrar**. Você passa a ser o **dono do painel**.
5. Vá em **Ajustes** e:
   - em **Sistema** › **Endereço público do site**, cole `SEU-ENDERECO` (sem barra no final) e clique em **Salvar**;
   - em **Página**, preencha o **ID do vídeo no YouTube** e o **E-mail de suporte**;
   - em **Usuários do painel**, cadastre cada pessoa do comercial (nome + senha). Assim o histórico mostra quem fez cada ação.

> Cada pessoa entra com o próprio nome e senha. O dono pode desativar usuários ou trocar a senha deles em **Ajustes**.

---

## 5. Criar o bot do Telegram

### 5.1 Criar o bot

1. No Telegram, procure por **@BotFather** (tem um selo azul de verificado) e abra a conversa.
2. Envie `/newbot`.
3. Ele pede um nome: envie, por exemplo, `Money's Map Avisos`.
4. Ele pede um usuário terminado em `bot`: envie, por exemplo, `moneysmap_avisos_bot`.
5. Ele responde com um **token** parecido com `7123456789:AAHk...`. Copie e cadastre como `TELEGRAM_BOT_TOKEN` (etapa 3).

### 5.2 Criar o grupo do time e descobrir o `chat_id`

1. No Telegram, crie um **grupo** (ex.: "Comercial Money's Map") com as pessoas do time.
2. Adicione o bot ao grupo (procure pelo usuário dele, ex.: `@moneysmap_avisos_bot`).
3. No grupo, envie um **comando** citando o bot, trocando pelo usuário dele:
   `/start@moneysmap_avisos_bot`
   (Uma mensagem comum como "oi" **não funciona**: por padrão o bot fica em "modo privacidade" e só enxerga comandos e menções a ele.)
4. No navegador, abra este endereço trocando `SEU_TOKEN` pelo token do bot:
   `https://api.telegram.org/botSEU_TOKEN/getUpdates`
5. Procure o trecho `"chat":{"id":-100...`. O número (geralmente negativo, começando com `-100`) é o **chat_id**. Copie com o sinal de menos.
   - Se a página mostrar só `{"ok":true,"result":[]}`: no @BotFather envie `/setprivacy`, escolha o bot e toque em **Disable**. Depois **remova o bot do grupo e adicione de novo**, envie uma mensagem no grupo e recarregue o endereço.
   - Se mostrar `"ok":false`, o token no endereço está incompleto ou errado.
6. Cadastre esse número como `TELEGRAM_CHAT_ID` (etapa 3).
7. No painel, vá em **Ajustes** › **Enviar mensagem de teste no Telegram**. A mensagem deve chegar no grupo.

---

## 6. Configurar o e-mail (Resend)

### Por enquanto, sem domínio próprio

Sem domínio, o Resend **só entrega e-mails para o endereço da sua própria conta do Resend**. Isso serve para testar, mas **os compradores não recebem os e-mails** até você ter um domínio (etapa 9). Enquanto isso:

- o comprador agenda normalmente pela página de obrigado (identificação pelo e-mail da compra);
- o time recebe todos os avisos no Telegram e pode mandar o link pessoal pelo WhatsApp (botão **Copiar link de agendamento** nos detalhes do comprador, no painel);
- as tentativas de e-mail que o Resend recusar aparecem no **Histórico** como "Erro de e-mail". Isso é esperado e não atrapalha o agendamento.

Passos:

1. Crie a conta em https://resend.com/signup (use o e-mail em que você quer receber os testes).
2. No menu, clique em **API Keys** › **Create API Key**.
3. Dê um nome (ex.: `moneys-map`), mantenha a permissão **Sending access** e clique em **Add**.
4. Copie a chave (começa com `re_`) e cadastre como `RESEND_API_KEY` (etapa 3).
5. No painel, em **Ajustes** › **E-mail**, deixe:
   - **Provedor de e-mail**: `resend`
   - **E-mail do remetente**: `onboarding@resend.dev`
   - **Nome do remetente**: `Sterling`

### Alternativa temporária: Brevo (com ressalvas)

O Brevo aceita enviar a qualquer pessoa com um remetente verificado por e-mail comum (ex.: Gmail), mas **a chance de cair no spam é alta**, porque o Gmail não autoriza outros serviços a enviar em nome de `@gmail.com`. Se mesmo assim quiser usar:

1. Crie a conta em https://www.brevo.com, verifique o remetente em **Senders, Domains & Dedicated IPs** e gere uma chave em **SMTP & API** › **API Keys**.
2. Cadastre a chave como `BREVO_API_KEY`.
3. No painel, em **Ajustes** › **E-mail**, troque o provedor para `brevo` e o remetente para o e-mail verificado.

| | Resend + domínio próprio | Brevo + Gmail |
|---|---|---|
| Entrega para qualquer comprador | Sim | Sim |
| Chance de spam | Baixa | Alta |
| Custo | Domínio (~R$ 40/ano) | Zero |
| Limite gratuito | 3.000/mês, 100/dia | 300/dia |

**Recomendação:** Resend agora para testar e, quando comprar o domínio, verificar no Resend (etapa 9).

---

## 7. Configurar a Kiwify

> Os nomes dos menus da Kiwify podem mudar um pouco. Procure pelas palavras indicadas.

### 7.1 Webhook (aviso automático de compra, reembolso e chargeback)

1. Na Kiwify, vá em **Apps** › **Webhooks** › **Criar webhook**.
2. **Nome**: `Agendamento Money's Map`.
3. **URL do webhook**: `SEU-ENDERECO/api/webhooks/kiwify`
   (o endereço exato também aparece no painel, em **Ajustes** › **Endereços para a Kiwify**).
4. **Produto**: selecione o Money's Map.
5. **Eventos/gatilhos**: marque **Compra aprovada**, **Compra reembolsada** e **Chargeback**.
6. A Kiwify mostra um **token**. Copie e cadastre como `KIWIFY_WEBHOOK_TOKEN` (etapa 3).
7. Salve.

### 7.2 ID do produto (para que outros produtos não gerem bônus)

1. Abra o produto Money's Map na Kiwify. O ID aparece no endereço da página do produto (o código longo na barra do navegador) ou nos dados do webhook.
2. Jeito mais fácil: depois da compra de teste (etapa 8), vá no painel em **Histórico** › **Webhooks recebidos**, abra o aviso e copie o valor de `product_id`.
3. No painel, em **Ajustes** › **Kiwify** › **ID do produto Money's Map**, cole o ID e salve.

> Enquanto esse campo estiver vazio, qualquer produto da sua conta gera bônus. Preencha antes de anunciar.

### 7.3 Página de obrigado

1. Nas configurações do produto Money's Map, procure **Página de obrigado** / **Redirecionar após a compra** / **URL personalizada de obrigado**.
2. Cole: `SEU-ENDERECO/obrigado`
3. Salve.

---

## 8. Compra de teste: conferir tudo

A Kiwify não tem ambiente de testes. Use o botão **Testar webhook** da Kiwify (dados fictícios) e, para o teste completo, faça uma compra real com Pix e peça reembolso depois.

**Teste rápido (botão da Kiwify):**

1. No webhook criado, clique em **Testar webhook**.
2. No painel, vá em **Histórico** › **Webhooks recebidos**. Deve aparecer um aviso com o selo **válido**.
   - Se aparecer **assinatura inválida**: o `KIWIFY_WEBHOOK_TOKEN` está diferente do token da Kiwify. Copie de novo.

**Teste completo (compra real):**

| # | Faça | Confira |
|---|---|---|
| 1 | Compre o Money's Map com Pix | A Kiwify redireciona para a página de obrigado |
| 2 | Na página, digite o e-mail usado na compra | Aparece "Estamos confirmando seu pagamento…" e, em segundos, os dias e horários |
| 3 | Veja o Telegram | Chegou "🛒 Nova compra" |
| 4 | Veja o e-mail da sua conta Resend (se comprou com ele) | Chegou "Agende sua Reunião de Implementação" com o link pessoal |
| 5 | Escolha dia, horário, WhatsApp, aceite as regras e confirme | Tela de sucesso com dia e horário (horário de Brasília) |
| 6 | Telegram | Chegou "📅 Novo agendamento" |
| 7 | Painel › Agenda | A reunião aparece na grade. Clique e confira os dados |
| 8 | Abra a página de novo com o mesmo e-mail | Mostra a reunião marcada, sem opção de alterar |
| 9 | Painel › Histórico › Webhooks recebidos | Abra o aviso e **me envie o conteúdo** se algum dado (nome, telefone, data) não apareceu certo, para eu ajustar os nomes dos campos |
| 10 | Peça o reembolso na Kiwify | Telegram recebe "↩️ Reembolso"; a reunião some da agenda e o horário fica livre |

---

## 9. Quando comprar o domínio

Nada no código muda. São três ajustes de configuração.

**a) Apontar o site para o domínio**

1. Compre o domínio (ex.: no registro.br) e adicione-o à Cloudflare: no painel da Cloudflare, **Add a domain**, siga os passos e troque os "servidores DNS" no registro.br pelos que a Cloudflare indicar.
2. Em **Workers & Pages** › **moneys-map-obrigado** › **Settings** › **Domains & Routes** › **Add** › **Custom domain**, digite por exemplo `agenda.seudominio.com.br` e salve.
3. No painel do sistema, **Ajustes** › **Endereço público do site**: troque para `https://agenda.seudominio.com.br`.
4. Na Kiwify, troque a URL do webhook e a página de obrigado para o novo endereço.

**b) E-mail com o domínio (Resend)**

1. No Resend, vá em **Domains** › **Add Domain** e digite o domínio (ex.: `seudominio.com.br`).
2. O Resend mostra alguns registros DNS. Se o domínio está na Cloudflare, use o botão de configuração automática do Resend (se aparecer) ou copie cada registro em **Cloudflare** › seu domínio › **DNS** › **Add record**.
3. Espere o Resend mostrar **Verified**.
4. No painel do sistema, **Ajustes** › **E-mail do remetente**: troque para algo como `contato@seudominio.com.br`.

A partir daí, todos os compradores recebem os e-mails.

---

## 10. Custo zero: serviços e limites

| Serviço | Para quê | Limite gratuito | Uso esperado |
|---|---|---|---|
| Cloudflare Workers (Free) | Site, API, webhook, tarefas | 100.000 requisições/dia; ~10ms de CPU por requisição; 5 tarefas agendadas por conta | Centenas por dia; usa 2 tarefas |
| Cloudflare D1 (Free) | Banco de dados | 5 GB; 5 milhões de linhas lidas/dia; 100 mil escritas/dia | Muito abaixo |
| Cloudflare Workers Builds | Publicação automática do GitHub | Incluso no plano Free (com limite mensal de minutos de build) | Poucos builds por mês |
| Telegram Bot API | Avisos ao time | Gratuito | — |
| Resend (Free) | E-mails ao comprador | 3.000/mês, 100/dia | ~3 a 4 e-mails por compra |
| Brevo (Free, opcional) | Alternativa de e-mail | 300/dia | — |
| GitHub | Código | Gratuito | — |
| Google Fonts / YouTube | Fontes e vídeo | Gratuito | — |
| **Domínio próprio** | Endereço e e-mail profissional | **Pago (~R$ 40/ano), opcional** | — |

> Atenção ao limite do Resend: 100 e-mails/dia equivalem a ~25 compras/dia. Acima disso, os e-mails excedentes falham (o agendamento continua funcionando) e vale migrar para um plano pago ou outro provedor, só trocando a configuração.

---

## 11. Como o sistema funciona (regras)

**Janela do bônus**
- Conta a partir da **data e hora de aprovação do pagamento** informadas pela Kiwify.
- **Dia 1** = primeiro dia de semana (seg a sex) depois do dia da aprovação. O dia da aprovação nunca conta.
- Vale até o fim do **Dia 5**, contando só seg a sex. Feriados contam como dia normal.
- Nenhum horário começa antes de **24 horas** depois da aprovação.
- **Se no Dia 1 nenhum horário respeitar as 24h** (ex.: compra na quinta às 19h), a janela anda um dia útil. Assim o comprador sempre tem 5 dias com horário.

**Grade**
- Seg a sex: 08:00, 09:00, 10:00, 11:00, 13:30, 14:30, 15:30, 16:30, 17:30 e 18:30 (horário de Brasília).
- Reunião de 45 min em bloco de 1 hora. Tudo ajustável em **Ajustes** › **Agenda**.
- Um agendamento por horário, garantido pelo banco de dados: se duas pessoas clicam juntas, só uma consegue; a outra vê "Esse horário acabou de ser reservado, escolha outro".

**Agendamento**
- Uma reunião por compra (cada pedido da Kiwify é um direito separado).
- O comprador não cancela nem remarca pela página.
- Pela página sem link pessoal, a busca pelo e-mail mostra só o primeiro nome e não mostra o WhatsApp (proteção de dados).

**Remarcação (só pelo painel)**
- Só se faltarem 24 horas ou mais para a reunião.
- O novo horário precisa estar dentro da janela original, livre e sem bloqueio.
- O horário antigo é liberado e o histórico registra quem remarcou.

**Expiração, falta e reembolso**
- Janela terminou sem agendamento: status "bônus expirado" (checado a cada 15 min).
- Falta: o time marca "não compareceu" no painel.
- Reembolso/chargeback: bônus cancelado, reunião futura cancelada, horário liberado e aviso no Telegram.

**Avisos automáticos**
- Telegram: nova compra, novo agendamento, remarcação, reembolso/chargeback e resumo diário às 07:30 (seg a sex).
- E-mails: convite para agendar (após a compra), confirmação, lembrete às 18:00 do dia útil anterior à reunião (não envia se o agendamento foi feito depois desse horário) e lembrete de prazo às 09:00 do penúltimo dia da janela (pode ser desligado em **Ajustes**).
- Se o Telegram ou o e-mail falhar, nada é interrompido: o erro aparece no **Histórico**.

**Textos**
- Título, subtítulo, vídeo, valor do bônus, texto de expiração e rodapé: **Ajustes** › **Página**.
- Textos dos e-mails e do Telegram: arquivo `src/notify/messages.ts`.

---

## 12. Para quem for mexer no código

```
src/
  index.ts              entrada do Worker (rotas e tarefas agendadas)
  app.ts                contexto (configuração, relógio, banco)
  lib/schedule.ts       regras da janela e da grade (funções puras)
  lib/time.ts           datas no fuso America/Sao_Paulo
  lib/config.ts         configurações editáveis no painel
  db/schema.ts          estrutura do banco (aplicada automaticamente)
  services/booking.ts   agendar, remarcar, reembolso, expiração
  services/kiwify.ts    webhook da Kiwify
  services/cron.ts      lembretes, expiração, resumo diário
  notify/               Telegram, e-mail (Resend/Brevo) e textos
  routes/public.ts      API da página de obrigado
  routes/admin.ts       API do painel
public/
  assets/tokens.css     cores, fontes e formas (base da futura página de vendas)
  assets/ui.css         componentes compartilhados
  obrigado/             página pública
  admin/                painel
test/                   testes automatizados (Vitest no ambiente real do Worker)
```

Comandos:

```bash
npm install
```

```bash
npm test
```

```bash
npm run dev
```

Para rodar localmente, crie um arquivo `.dev.vars` (não vai para o GitHub) com `ADMIN_PASSWORD=...` e `KIWIFY_WEBHOOK_TOKEN=...`.

**Sobre o payload da Kiwify:** a validação usa o parâmetro `signature` (HMAC-SHA1 do corpo com o token do webhook). Os campos lidos são `order_id`, `order_status`, `webhook_event_type`, `approved_date`, `Customer.full_name/email/mobile` e `Product.product_id`, com alternativas tolerantes em `src/services/kiwify.ts`. Datas sem fuso são lidas como horário de Brasília. Confirme com o payload real em **Histórico** › **Webhooks recebidos** após a primeira compra.

**Logotipo:** para trocar o selo de texto por um SVG, coloque o arquivo em `public/assets/logo.svg` e siga o comentário no topo de `public/obrigado/index.html`.
