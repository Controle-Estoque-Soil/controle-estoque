# Deploy Backend na EC2 (AWS)

Este diretório prepara o backend (`apps/api`) + Postgres para rodar na mesma EC2 do projeto `cloud-monitoring`, sem colisões.

## Princípios de coexistência (cloud-monitoring)

- Containers com prefixo `inventory-*`
- Rede Docker dedicada: `inventory_net`
- Volumes dedicados: `inventory_pg_data`, `inventory_caddy_*`
- Portas padrão não usuais (`8087`, `18080`, `18443`) para evitar conflito
- Sem `docker system prune` / sem parar containers de outros projetos

## Arquivos

- `docker-compose.prod.yml`: stack de produção (API + Postgres + proxy Caddy opcional)
- `Caddyfile`: proxy reverso/TLS para `api.seudominio.com`
- `.env.prod.example`: template de variáveis (copiar para `.env.prod`)

## Subida básica (sem proxy TLS, apenas API exposta em porta alta)

1. Copie o env:
   - `cp deploy/aws-ec2/.env.prod.example deploy/aws-ec2/.env.prod`
2. Ajuste credenciais e secrets (`INVENTORY_*`)
3. Suba a stack:
   - `docker compose --env-file deploy/aws-ec2/.env.prod -f deploy/aws-ec2/docker-compose.prod.yml up -d --build`

A API ficará em `http://<EC2_PUBLIC_IP>:8087/health` (ou porta configurada em `INVENTORY_API_PORT`).

## Subida com proxy TLS (Caddy) - perfil opcional

Requisitos:

- DNS de `api.seudominio.com` apontando para a EC2
- Portas públicas liberadas no Security Group (80/443) se for usar proxy direto na EC2
- Se `cloud-monitoring` já usar 80/443, mantenha portas altas e integre no proxy existente

Comando:

- `docker compose --env-file deploy/aws-ec2/.env.prod -f deploy/aws-ec2/docker-compose.prod.yml --profile proxy up -d --build`

## Migrations Prisma

O container da API já executa `prisma migrate deploy` no startup (entrypoint).

Para execução explícita (recomendado no pipeline antes do `up -d`):

- `docker compose --env-file deploy/aws-ec2/.env.prod -f deploy/aws-ec2/docker-compose.prod.yml run --rm inventory-api npm run prisma:migrate:deploy`

## Seed (opcional, bootstrap)

Defina no `.env.prod`:

- `INVENTORY_SEED_ADMIN_EMAIL`
- `INVENTORY_SEED_ADMIN_PASSWORD`

Depois rode:

- `docker compose --env-file deploy/aws-ec2/.env.prod -f deploy/aws-ec2/docker-compose.prod.yml run --rm inventory-api npm run prisma:seed`

## Email automatico (saida confirmada)

Para enviar PDF por email em cada operacao de saida confirmada (produto, produto intermediario e item direto da tela Operacoes), configure no `.env.prod`:

- `INVENTORY_OUTBOUND_OPERATION_EMAIL_ENABLED=true`
- `INVENTORY_OUTBOUND_OPERATION_EMAIL_TO=jose.queiroz@soiltech.com.br`
- `INVENTORY_OUTBOUND_OPERATION_EMAIL_SUBJECT=Saida de Produto Soil Tecnologia`
- `INVENTORY_SMTP_USER`
- `INVENTORY_SMTP_PASS`
- `INVENTORY_SMTP_HOST=smtp.gmail.com` (opcional, default)
- `INVENTORY_SMTP_PORT=587` (opcional, default)
- `INVENTORY_SMTP_SECURE=false` (opcional, default)
- `INVENTORY_SMTP_FROM=<mesmo email do INVENTORY_SMTP_USER>` (opcional)

## Backup / restore (Postgres)

Backup:

- `docker compose --env-file deploy/aws-ec2/.env.prod -f deploy/aws-ec2/docker-compose.prod.yml exec -T inventory-postgres pg_dump -U "$INVENTORY_POSTGRES_USER" -d "$INVENTORY_POSTGRES_DB" > inventory-backup-$(date +%F-%H%M).sql`

Restore (cuidado em produção):

- `cat backup.sql | docker compose --env-file deploy/aws-ec2/.env.prod -f deploy/aws-ec2/docker-compose.prod.yml exec -T inventory-postgres psql -U "$INVENTORY_POSTGRES_USER" -d "$INVENTORY_POSTGRES_DB"`

## Healthcheck

- API: `GET /health`
- Exemplo:
  - `curl http://127.0.0.1:${INVENTORY_API_PORT:-8087}/health`

## Rollback (manual, simples)

- Volte para um commit anterior do repositório na EC2
- Rebuild/restart só da API:
  - `docker compose --env-file deploy/aws-ec2/.env.prod -f deploy/aws-ec2/docker-compose.prod.yml build inventory-api`
  - `docker compose --env-file deploy/aws-ec2/.env.prod -f deploy/aws-ec2/docker-compose.prod.yml up -d inventory-api`

O workflow de deploy automático (GitHub Actions) completa isso no passo seguinte com um fluxo de rollback documentado no README principal.
