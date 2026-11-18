# SuperExpress 2.0 (front-end + back-end juntos)

Supermercado online com um assistente que monta o carrinho a partir de uma lista (texto ou foto):
pergunta o **tipo, a marca e o tamanho** (ex.: leite → integral / desnatado → Italac), **confere o estoque**
e oferece **trocar** por outro produto ou **remover**.

## Como rodar (Windows)
1. Instale o **Node.js 22.13 ou mais novo** (versão LTS) em https://nodejs.org.
2. Instale o **PostgreSQL** (versão 14 ou mais nova) em https://www.postgresql.org/download/windows/ com as opções padrão.
   Guarde a **senha** que você definir para o usuário `postgres` (porta padrão: 5432).
3. Na pasta do projeto, copie o arquivo `.env.example` para `.env` e troque `SUA_SENHA_AQUI` pela senha do passo 2:
   ```
   copy .env.example .env
   notepad .env
   ```
4. Abra um **novo terminal** na pasta do projeto e rode:
   ```
   npm install
   npm start
   ```
5. Abra **http://localhost:8080**. O banco `superexpress`, as tabelas e o catálogo são criados sozinhos na primeira execução.
   Para desligar: `Ctrl + C`.

Se o PostgreSQL não for encontrado ou a senha estiver errada, o servidor explica o problema no terminal e mostra a `DATABASE_URL` usada.

### Trazer os dados da versão antiga (SQLite)
Se você já usava a versão com SQLite (pasta `data/superexpress.db`), copie as contas e os estoques/preços para o PostgreSQL:
```
npm run migrar
```
(pode rodar mais de uma vez: não duplica contas). Os carrinhos antigos não são copiados.

## Feedback
- **Clientes e visitantes:** botão **Feedback** no topo da loja (e no chat) abre a página `feedback.html`: tipo (elogio, sugestão, problema ou dúvida), nota de 1 a 5 estrelas, mensagem e, para visitantes, nome e e-mail opcionais.
- **Clientes logados** acompanham em "Meus feedbacks" o status (Enviado, Em análise, Respondido) e a resposta da equipe.
- **Administrador:** aba **Feedback** no painel, com filtros por status e tipo, nota média, resposta ao cliente, mudança de status e exclusão.
- Proteção contra spam: no máximo 5 feedbacks a cada 10 minutos por pessoa.

## Celular, tablet e computador
O visual se adapta ao tamanho da tela: no computador a vitrine tem até 6 colunas e o carrinho abre como painel lateral; no tablet, 4 colunas, e no celular, 2 colunas, com busca em linha própria, botões de toque maiores, assistente em tela cheia e as tabelas do painel viram cartões.

## Conta de administrador
O administrador tem acesso geral: **repor/ajustar estoque e preço, cadastrar e excluir produtos, e gerenciar contas** (excluir, promover a admin, redefinir senha).

1. Na pasta do projeto, rode (troque pelos seus dados):
   ```
   node criar-admin.js "Seu Nome" seu@email.com suasenha
   ```
   Se o e-mail já tiver conta, ela é promovida a administrador (e a senha é atualizada).
2. Entre em http://localhost:8080 com esse e-mail e senha. Aparece o botão **Painel** no topo da loja (ou acesse `/admin.html`).

**Conta padrão:** na primeira execução, se ainda não existir nenhum administrador, o servidor cria sozinho
`admin@admin` com a senha `123456` (aparece um aviso no terminal e um alerta no painel). **Troque a senha logo no primeiro acesso**
(Perfil → Alterar senha). Para não criar essa conta, inicie com `ADMIN_PADRAO=0` (no PowerShell: `$env:ADMIN_PADRAO="0"; npm start`).

Regras de segurança: ninguém vira admin pelo cadastro normal; só administradores acessam `/api/admin/*`; o sistema não deixa
excluir ou rebaixar o único administrador. Para criar o primeiro admin é preciso ter acesso ao computador onde o servidor roda.

## O que o assistente faz
- **Variações:** "leite" → pergunta o tipo → a marca → leva ao carrinho. Vale para todos os produtos do catálogo.
  Em cada pergunta há "Tanto faz (o mais barato)" e "Pular item".
- **Estoque:** produto esgotado → mostra produtos parecidos para trocar ou remove da lista.
  Quantidade maior que o estoque → "Levar N", "Trocar por outro" ou "Remover".
- **Conferir estoque do carrinho:** botão no chat. Também roda sozinho se o estoque mudar na hora de finalizar.
- **Foto da lista:** OCR no servidor (Tesseract); se falhar, o navegador tenta sozinho.
- Funciona **sem login** (carrinho de visitante). Ao entrar ou cadastrar, o carrinho vai junto para a conta.

## Tamanho, peso e quantidade
- **Tamanho:** `2 pt de macarrão` → o assistente pergunta o tipo, o **tamanho (500g ou 1kg)** e a marca. Se você já disser o tamanho (`macarrão 500g`), ele não pergunta.
- **Produtos por kg** (frutas, legumes, carnes, pão francês): sem peso no pedido, o assistente pergunta **quantos kg** (300 g, 500 g, 1 kg, 1,5 kg, 2 kg, 3 kg) e também aceita digitar `700g` ou `1,5 kg`. Com peso (`2 kg de maçã`), já adiciona direto.
- **Quantidades fracionadas:** itens por kg são vendidos de 100 em 100 g na vitrine (0,900 KG, 1,000 KG...). O estoque desses itens é em kg.
- **Vitrine:** cada card tem "Adicionar ao carrinho", que vira um seletor **− quantidade +** (igual ao carrinho), selo de desconto, coração de favorito e o limite por estoque. Os filtros incluem **Favoritos**.

## Formatos de lista que o assistente entende
Cole a lista como estiver: com marcadores (`* `, `- `, `• `), numeração (`1)`, `2.`), quantidade por extenso (`duas latas de cerveja`),
embalagens (`pt`, `pct`, `un`, `cx`, `lata`, `dz`...) e palavras de ligação (`2 pt de arroz`).
- **Peso/volume viram pacotes:** `5 kg de feijão` → 5 × feijão 1kg; `2 l de leite` → 2 × leite 1L; `1,5 kg` arredonda para cima (2 × 1kg).
- **Dúzia/caixa:** `1 dz de ovos` ou `12 ovos` → 1 caixa com 12.
- Em listas grandes, o botão **"Tanto faz para todos os itens"** escolhe o mais barato (com estoque suficiente) de todos os itens que faltam.
- Catálogo novo: ao atualizar, os produtos que faltam no banco são acrescentados sozinhos (estoque e preços que você editou não mudam).

## Estrutura
- `public/` – telas (loja, login, cadastro, perfil) e `css/app.css`
- `server.js` – servidor, login (senha com scrypt, token assinado) e rotas
- `chat.js` – assistente (fila de perguntas, variações, estoque)
- `matcher.js` – interpretação da lista (normalização, Levenshtein, limiares T1 e Δ)
- `criar-admin.js` – cria/promove a conta de administrador
- `carrinho.js` – carrinho, limite de estoque, finalização do pedido
- `db.js` – banco PostgreSQL (cria o banco e as tabelas sozinho)
- `.env` – configuração local (`DATABASE_URL`, `PORT`); copie de `.env.example`
- `migrar-sqlite.js` – copia os dados da versão antiga (SQLite)
- `produtos.csv` – catálogo

## Catálogo (produtos.csv)
Colunas: `base;variante;marca;tamanho;categoria;preco;precoAntigo;icone;estoque;granel`
Exemplo: `Leite;Integral;Italac;1L;laticinios;5.50;6.10;🥛;20;0`
- `granel=1` para itens vendidos por kg (a quantidade pedida em kg vira unidades).
- Produtos novos do CSV entram sozinhos ao reiniciar (por nome). Para refazer tudo do zero, apague o banco no PostgreSQL (`DROP DATABASE superexpress;`) e inicie de novo.
- Para esgotar um produto nos testes, coloque `0` em `estoque`.

## Calibração (T1 e Δ)
```
$env:T1="0.8"; $env:DELTA="0.1"; npm start
```
Padrões: T1 = 0.75, DELTA = 0.08.

## Observações
- Compras simultâneas são protegidas por transação: se duas pessoas tentarem comprar a última unidade, só uma conclui.
- O primeiro uso do OCR leva alguns segundos.
- Finalizar a compra confere o estoque, baixa as quantidades e esvazia o carrinho (não guarda histórico de pedidos).
