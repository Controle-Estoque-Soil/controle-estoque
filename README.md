# Controle de Estoque (Monorepo)

Plataforma de controle de estoque baseada em itens (materia-prima) + produtos finais com BOM/receita, operacoes transacionais (INBOUND/OUTBOUND), auditoria e custo por snapshot de preco.

## Stack

- Monorepo: npm workspaces
- Backend: Node.js + Fastify + TypeScript
- Banco: PostgreSQL + Prisma (migrations versionadas)
- Frontend: Next.js (App Router) + TypeScript
- Validacao compartilhada: Zod (`packages/shared`)
- Testes unitarios: Vitest (API)
- Testes e2e: Playwright (UI real)
- CI/CD: GitHub Actions (`ci.yml`, `release.yml`, `deploy-ec2.yml`)
- Containers: Docker / Docker Compose

## Estrutura

- `apps/api` - API Fastify + Prisma
- `apps/web` - Frontend Next.js
- `packages/shared` - schemas/tipos compartilhados
- `deploy/aws-ec2` - stack de producao para EC2 (API + Postgres + proxy TLS opcional)

## Funcionalidades implementadas

- Auth com email/senha (bcrypt) + JWT (header `Authorization`)
- Roles `ADMIN` / `USER`
- CRUD de itens com historico/auditoria e ajustes manuais (ADMIN)
- CRUD de produtos + BOM
- Operacoes de entrada/saida de produto com:
  - consumo/credito automatico por BOM
  - movimentacoes por item
  - custo total e unitario por snapshot de preco
  - ordem com linhas e auditoria por usuario
- Auditoria:
  - `GET /movements` com filtros
  - `GET /operations` e `GET /operations/:id`
- UI:
  - Login
  - Dashboard
  - Itens (lista/criar/editar/detalhe + historico)
  - Produtos (lista/criar/editar/BOM)
  - Operacoes (preview + confirmar)
  - Movimentacoes / Operacoes

## Requisitos

- Node.js 20+
- npm 10+
- PostgreSQL local ou Docker Desktop

## Variaveis de ambiente

### 1) Raiz (`.env`) - Docker Compose local

Use `.env.example` como base.

Principais variaveis locais:

- `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_PORT`
- `API_PORT`
- `JWT_SECRET`
- `BCRYPT_SALT_ROUNDS`
- `CORS_ORIGIN` (compatibilidade)
- `CORS_ORIGINS` (preferido, CSV)
- `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD`
- `OUTBOUND_OPERATION_EMAIL_ENABLED`
- `OUTBOUND_OPERATION_EMAIL_TO`
- `OUTBOUND_OPERATION_EMAIL_SUBJECT`
- `SMTP_USER`, `SMTP_PASS` (necessarios para envio de email)
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_FROM` (opcionais, com default Gmail)
- `NEXT_PUBLIC_API_URL`

### 2) API (`apps/api/.env`) - rodando fora do Docker

Use `apps/api/.env.example` como base.

Obrigatorias:

- `DATABASE_URL`
- `JWT_SECRET`
- `BCRYPT_SALT_ROUNDS`
- `CORS_ORIGINS` (ou `CORS_ORIGIN`)

Opcionais:

- `TRUST_PROXY`
- `LOG_LEVEL`
- `ENABLE_SECURITY_HEADERS`
- `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD`
- `OUTBOUND_OPERATION_EMAIL_ENABLED`
- `OUTBOUND_OPERATION_EMAIL_TO`
- `OUTBOUND_OPERATION_EMAIL_SUBJECT`
- `SMTP_USER`, `SMTP_PASS` (necessarios para envio de email)
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_FROM` (opcionais, com default Gmail)

### 3) Web (`apps/web/.env.local`) - Next.js

Use `apps/web/.env.example` como base.

- `NEXT_PUBLIC_API_URL=http://localhost:3333`

### 4) Producao EC2 (`deploy/aws-ec2/.env.prod`)

Use `deploy/aws-ec2/.env.prod.example` como base (nao commitar).

Principais variaveis:

- `COMPOSE_PROJECT_NAME=inventory`
- `INVENTORY_API_PORT`
- `INVENTORY_POSTGRES_DB`, `INVENTORY_POSTGRES_USER`, `INVENTORY_POSTGRES_PASSWORD`
- `INVENTORY_DATABASE_URL`
- `INVENTORY_JWT_SECRET`
- `INVENTORY_CORS_ORIGINS`
- `INVENTORY_DOMAIN_API`, `INVENTORY_TLS_EMAIL`
- `INVENTORY_OUTBOUND_OPERATION_EMAIL_ENABLED`
- `INVENTORY_OUTBOUND_OPERATION_EMAIL_TO`
- `INVENTORY_OUTBOUND_OPERATION_EMAIL_SUBJECT`
- `INVENTORY_SMTP_USER`, `INVENTORY_SMTP_PASS` (necessarios para envio de email)
- `INVENTORY_SMTP_HOST`, `INVENTORY_SMTP_PORT`, `INVENTORY_SMTP_SECURE`, `INVENTORY_SMTP_FROM` (opcionais, com default Gmail)

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
- Health API: `http://localhost:3333/health`

## Rodando com Docker Compose (localhost / stack completa)

### 1) Preparar env

- Copie `.env.example` para `.env`
- Ajuste `JWT_SECRET` e credenciais se necessario

### 2) Subir tudo

- `docker compose up --build`

ou:

- `npm run docker:up`

Servicos:

- `postgres`
- `api` (executa `prisma migrate deploy` no startup)
- `web`

### 3) Seed do admin inicial

Em outro terminal:

- `docker compose exec api npm run prisma:seed`

### 4) Parar

- `docker compose down`

## Testes

### Lint + typecheck

- `npm run lint`
- `npm run typecheck`

### Unit tests (API)

- `npm run test:unit`

### E2E (Playwright)

- `npm run test:e2e`

Observacoes para e2e local:

- O Playwright sobe API + Web automaticamente (`webServer`)
- O `globalSetup` faz reset/migrations/seed do banco de teste
- Banco padrao de teste:
  - `postgresql://postgres:postgres@127.0.0.1:5432/controle_estoque_test?schema=public`
- Se voce estiver com containers `api/web` rodando na porta 3000/3333, pare-os antes do e2e:
  - `docker compose stop api web`

## Seguranca e operacao (API)

- CORS com allowlist de multiplas origens (`CORS_ORIGINS`, CSV)
- Compatibilidade com `CORS_ORIGIN` legado (single origin)
- Headers de seguranca via `@fastify/helmet`
- Healthcheck: `GET /health`
- JWT via header `Authorization`
- Logs estruturados (Fastify/Pino)

## CI/CD

### 1) `ci.yml` (PR + push)

Executa:

- `npm ci`
- lint
- typecheck
- unit tests
- Postgres service de teste
- Prisma migrations (test DB)
- Playwright browsers
- e2e tests

### 2) `release.yml` (main + tags `v*`)

Executa:

- build/push das imagens Docker (`api`, `web`) para GHCR
- placeholders comentados para AWS/Vercel alternativos

### 3) `deploy-ec2.yml` (push em `main`)

Deploy real com **build na propria EC2**:

1. SSH na EC2
2. Garantir repo em diretorio dedicado (default `/opt/inventory-app`)
3. `git fetch` + `git reset --hard <sha>`
4. Escrever `deploy/aws-ec2/.env.prod` a partir de GitHub Secrets
5. `docker compose ... build inventory-api` (**build on EC2**)
6. `docker compose ... run --rm inventory-api npm run prisma:migrate:deploy`
7. `docker compose ... up -d inventory-api` (e proxy opcional)
8. Healthcheck `GET /health`

Sem `docker compose down`, para evitar downtime desnecessario e sem impactar outros projetos na mesma EC2.

## Producao recomendada (alvo atual)

- Frontend: Vercel (`apps/web`)
- Backend + Postgres: AWS EC2 via Docker Compose (`deploy/aws-ec2/docker-compose.prod.yml`)
- Proxy/TLS (opcional e recomendado): Caddy (`inventory-proxy`) em profile `proxy`

## Deploy Backend na EC2 (mesma maquina do cloud-monitoring)

### Objetivo de coexistencia (importante)

Esta stack foi preparada para coexistir com o projeto `cloud-monitoring` na mesma EC2:

- nomes de containers dedicados: `inventory-*`
- rede dedicada: `inventory_net`
- volumes dedicados: `inventory_pg_data`, `inventory_caddy_*`
- portas padrao em valores altos (`8087`, `18080`, `18443`) para evitar colisao
- nenhuma rotina usa `docker system prune` ou para containers de outros projetos

### Pre-requisitos na EC2

- Docker Engine + Docker Compose plugin instalados
- Usuario de deploy com permissao para Docker (ex.: grupo `docker`)
- `git` instalado
- Porta da API liberada no Security Group (ex.: `8087`) ou 80/443 se usar proxy
- DNS configurado se for usar dominio/TLS

### Subida manual inicial (EC2)

1. Clonar repo em um diretorio dedicado:
   - `/opt/inventory-app` (recomendado)
2. Criar env de producao:
   - `cp deploy/aws-ec2/.env.prod.example deploy/aws-ec2/.env.prod`
3. Ajustar secrets e dominios no `.env.prod`
4. Subir Postgres + API:
   - `docker compose --env-file deploy/aws-ec2/.env.prod -f deploy/aws-ec2/docker-compose.prod.yml up -d --build`

### Proxy TLS (Caddy) - opcional

Para ativar proxy/TLS (Caddy) no mesmo compose:

- `docker compose --env-file deploy/aws-ec2/.env.prod -f deploy/aws-ec2/docker-compose.prod.yml --profile proxy up -d --build`

Por padrao, o profile `proxy` usa host ports `18080/18443` para nao colidir.

Se 80/443 estiverem livres na EC2 e voce quiser expor direto:

- ajuste `INVENTORY_PROXY_HTTP_PORT=80`
- ajuste `INVENTORY_PROXY_HTTPS_PORT=443`

Se `cloud-monitoring` ja usar 80/443:

- mantenha as portas altas do inventory
- ou integre `api`/`inventory-proxy` no proxy reverso ja existente do `cloud-monitoring`

### Migrations Prisma (producao)

O entrypoint da API ja executa:

- `prisma migrate deploy`

No pipeline, as migrations tambem sao executadas explicitamente antes do `up -d`:

- `docker compose ... run --rm inventory-api npm run prisma:migrate:deploy`

### Backup e restore (Postgres)

Backup (exemplo):

- `docker compose --env-file deploy/aws-ec2/.env.prod -f deploy/aws-ec2/docker-compose.prod.yml exec -T inventory-postgres pg_dump -U inventory -d inventory_prod > inventory-backup.sql`

Restore (cuidado):

- `cat inventory-backup.sql | docker compose --env-file deploy/aws-ec2/.env.prod -f deploy/aws-ec2/docker-compose.prod.yml exec -T inventory-postgres psql -U inventory -d inventory_prod`

## Frontend no Vercel (`apps/web`)

### Configuracao recomendada

- Framework: Next.js
- Root directory: `apps/web` (ou monorepo com build command custom)
- Variavel de ambiente obrigatoria:
  - `NEXT_PUBLIC_API_URL=https://api.seudominio.com`

### Observacoes

- O frontend nao depende de API local para build
- A URL da API e configurada por `NEXT_PUBLIC_API_URL`
- Se usar dominio custom no frontend, inclua esse dominio em `INVENTORY_CORS_ORIGINS` na API

## GitHub Secrets (deploy EC2)

O workflow `deploy-ec2.yml` ja fixa os defaults de email (Gmail + destinatario + assunto). Para email automatico de saida, voce precisa informar somente `PROD_SMTP_USER` e `PROD_SMTP_PASS`.

Minimo recomendado para `deploy-ec2.yml`:

- `AWS_EC2_HOST`
- `AWS_EC2_USER`
- `AWS_EC2_SSH_KEY`
- `AWS_EC2_SSH_PORT` (opcional, default `22`)
- `AWS_EC2_DEPLOY_PATH` (opcional, default `/opt/inventory-app`)
- `PROD_DATABASE_URL`
- `PROD_JWT_SECRET`
- `PROD_CORS_ORIGINS`
- `PROD_POSTGRES_PASSWORD`
- `PROD_DOMAIN_API`
- `PROD_TLS_EMAIL`
- `PROD_SMTP_USER`
- `PROD_SMTP_PASS`

Tambem recomendados:

- `PROD_POSTGRES_DB`
- `PROD_POSTGRES_USER`
- `PROD_API_PORT`
- `PROD_PROXY_HTTP_PORT`
- `PROD_PROXY_HTTPS_PORT`
- `PROD_ENABLE_PROXY_PROFILE`
- `PROD_LOG_LEVEL`
- `PROD_BCRYPT_SALT_ROUNDS`
- `PROD_ENABLE_SECURITY_HEADERS`

## Rollback (simples e reversivel)

### No pipeline (preparado)

O workflow salva no servidor:

- `.previous_deploy_sha`
- `.current_deploy_sha`

### Rollback manual (EC2)

1. Entrar no repo da EC2 (`/opt/inventory-app`)
2. Voltar para o SHA anterior:
   - `git reset --hard $(cat .previous_deploy_sha)`
3. Rebuild/restart da API:
   - `docker compose --env-file deploy/aws-ec2/.env.prod -f deploy/aws-ec2/docker-compose.prod.yml build inventory-api`
   - `docker compose --env-file deploy/aws-ec2/.env.prod -f deploy/aws-ec2/docker-compose.prod.yml up -d inventory-api`
4. Validar:
   - `curl http://127.0.0.1:8087/health`

## API principal (resumo)

- `POST /auth/login`
- `POST /auth/register` (primeiro usuario vira `ADMIN`)
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
- `GET /health`

## Regras de negocio importantes

- Estoque negativo bloqueado por padrao
- Override explicito disponivel para `ADMIN`
- Operacoes INBOUND/OUTBOUND sao transacionais
- Snapshot de preco salvo em `product_order_lines`
- BOM vazia nao pode ser usada em operacoes
- Quantidades decimais tratadas com `Prisma.Decimal`

## Seed / bootstrap do admin

- Local/Docker: `docker compose exec api npm run prisma:seed`
- Fora do Docker: `npm run api:seed`
- Sem seed: `POST /auth/register` cria o primeiro usuario como `ADMIN`
