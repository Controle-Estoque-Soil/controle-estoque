# Controle de Estoque (Monorepo)

Plataforma completa de controle de estoque baseada em itens (materia-prima) + produtos finais com BOM/receita, operacoes transacionais (INBOUND/OUTBOUND), auditoria e custo por snapshot de preco.

## Stack

- Monorepo: npm workspaces
- Backend: Node.js + Fastify + TypeScript
- Banco: PostgreSQL
- ORM: Prisma (migrations versionadas)
- Frontend: Next.js (App Router) + TypeScript
- Validacao: Zod (backend e frontend; pacote compartilhado em `packages/shared`)
- Unit tests: Vitest (API)
- E2E: Playwright (UI real)
- CI/CD: GitHub Actions (CI + release GHCR)
- Containers: Docker / Docker Compose

## Estrutura

- `apps/api` - API Fastify + Prisma
- `apps/web` - Frontend Next.js
- `packages/shared` - schemas/tipos compartilhados (Zod)

## Funcionalidades implementadas

- Auth com email/senha (bcrypt) + JWT
- Roles `ADMIN` / `USER`
- CRUD de itens (com ajuste manual de estoque por ADMIN e auditoria)
- CRUD de produtos
- BOM / Receita por produto (`PUT /products/:id/bom`)
- Operacoes de saida e entrada de produto com:
  - calculo automatico por BOM
  - movimentos de estoque por item
  - custo total e custo unitario por snapshot de preco
  - ordem com linhas e auditoria por usuario
- Auditoria:
  - `GET /movements` com filtros
  - `GET /operations` e `GET /operations/:id`
- UI:
  - Login
  - Dashboard
  - Itens (lista/criar/editar/detalhe+historico)
  - Produtos (lista/criar/editar/BOM)
  - Operacoes (preview + confirmar + ordens)
  - Movimentacoes (filtros)

## Requisitos

- Node.js 20+
- npm 10+
- PostgreSQL (local) **ou** Docker Desktop

## Variaveis de ambiente

### Arquivo raiz (`.env` para docker compose)

Use `.env.example` como base.

Principais variaveis:

- `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_PORT`
- `API_PORT`, `JWT_SECRET`, `BCRYPT_SALT_ROUNDS`, `CORS_ORIGIN`
- `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD`
- `NEXT_PUBLIC_API_URL`

### API (`apps/api/.env`)

Use `apps/api/.env.example` como base.

Obrigatorias para rodar fora do Docker:

- `DATABASE_URL`
- `JWT_SECRET`
- `BCRYPT_SALT_ROUNDS`
- `CORS_ORIGIN`
- `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD` (para seed)

### Web (`apps/web/.env.local`)

Use `apps/web/.env.example` como base.

- `NEXT_PUBLIC_API_URL=http://localhost:3333`

## Rodando localmente (sem Docker)

### 1) Subir banco PostgreSQL

Opcoes:

- Postgres local instalado
- `npm run db:up` (usa Docker Compose apenas para o banco)

### 2) Configurar envs

- Criar `apps/api/.env`
- Criar `apps/web/.env.local`

Exemplo de `DATABASE_URL` local:

- `postgresql://postgres:postgres@localhost:5432/controle_estoque?schema=public`

### 3) Aplicar migrations e seed

- `npm run api:migrate`
- `npm run api:seed`

### 4) Subir API + Web

- `npm run dev`

Ou em terminais separados:

- `npm run dev:api`
- `npm run dev:web`

Acessos:

- Web: `http://localhost:3000`
- API: `http://localhost:3333`
- Healthcheck API: `http://localhost:3333/health`

## Rodando com Docker Compose (stack completa)

### 1) Preparar env

- Copie `.env.example` para `.env`
- Ajuste `JWT_SECRET` e credenciais se necessario

### 2) Subir tudo

- `npm run docker:up`

ou

- `docker compose up --build`

Servicos:

- `postgres`
- `api` (aplica `prisma migrate deploy` no startup)
- `web`

### 3) Seed do admin inicial

Em outro terminal:

- `docker compose exec api npm run prisma:seed`

### 4) Parar

- `npm run docker:down`

## Testes

### Lint + Typecheck

- `npm run lint`
- `npm run typecheck`

### Unit tests (API)

- `npm run test:unit`

### E2E (Playwright)

- `npm run test:e2e`

Observacoes para e2e local:

- O Playwright sobe API + Web automaticamente (`webServer`)
- O `globalSetup` faz reset/migrations/seed do banco de teste
- Por padrao usa:
  - `postgresql://postgres:postgres@127.0.0.1:5432/controle_estoque_test?schema=public`
- Para mudar a porta/host, exporte `E2E_DATABASE_URL`
- Se usar Docker para o banco de teste, garanta o engine ativo (Docker Desktop/daemon)

## CI/CD

### `ci.yml`

Executa em `push` e `pull_request`:

- install (`npm ci`)
- lint
- typecheck
- unit tests
- sobe Postgres service
- migrations da API (test DB)
- install browsers do Playwright
- e2e tests

### `release.yml`

Executa em `push` na `main` e tags `v*`:

- build Docker images (`api` e `web`)
- push para GHCR
- placeholders comentados para deploy AWS (ECS/EC2) e Vercel

## Deploy (preparado)

### Backend + DB (AWS ECS/EC2 + RDS Postgres)

Checklist:

1. Provisionar RDS PostgreSQL
2. Configurar `DATABASE_URL` em segredo/Task Definition
3. Configurar `JWT_SECRET`, `BCRYPT_SALT_ROUNDS`, `CORS_ORIGIN`
4. Publicar imagem da API no GHCR (workflow `release.yml`)
5. Atualizar ECS Service (ou EC2 systemd/docker) para nova tag
6. Garantir `prisma migrate deploy` no startup (ja feito no entrypoint do container)

### Frontend (Vercel)

Checklist:

1. Importar `apps/web` no Vercel (framework Next.js)
2. Configurar `NEXT_PUBLIC_API_URL`
3. Build command (padrao): `npm run build -w @controle/web`
4. Output ja suportado pelo Next
5. Opcional: usar workflow `release.yml` como base para Vercel CLI (passos comentados)

## API principal (resumo)

- `POST /auth/login`
- `POST /auth/register` (bootstrap do 1o usuario / admin)
- `GET /auth/me`
- `GET/POST/PUT/DELETE /items`
- `GET /items/:id/detail`
- `POST /items/:id/adjust-stock` (ADMIN)
- `GET/POST/PUT/DELETE /products`
- `PUT /products/:id/bom`
- `POST /operations/outbound`
- `POST /operations/inbound`
- `POST /operations/outbound/preview`
- `POST /operations/inbound/preview`
- `GET /operations`
- `GET /operations/:id`
- `GET /movements`

## Observacoes de negocio importantes

- Estoque negativo bloqueado por padrao
- Override explicito disponivel apenas para `ADMIN`
- Operacoes INBOUND/OUTBOUND sao transacionais
- Snapshot de preco salvo em `product_order_lines`
- BOM vazia nao pode ser usada em operacoes
- Quantidades decimais tratadas com `Prisma.Decimal`

## Seed / bootstrap do admin

- Seed manual: `npm run api:seed`
- Sem seed: `POST /auth/register` cria o primeiro usuario como `ADMIN`

