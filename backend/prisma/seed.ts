import { PrismaClient } from '@prisma/client'
import * as argon2 from 'argon2'

/**
 * Dados iniciais. Idempotente: pode rodar a cada subida do container.
 *  - Pacotes de créditos (tabela comercial).
 *  - Em desenvolvimento: um usuário de teste com o bônus de boas-vindas.
 */
const prisma = new PrismaClient()

const PACKAGES = [
  {
    id: 'pkg-400',
    name: 'Inicial',
    credits: 400,
    priceCents: 4900,
    sortOrder: 1,
    highlighted: false,
    benefits: ['80 a 200 faturas', 'ou 50 a 80 extrações de dados', 'Enel, Corporativo e 2 VIA', 'Acesso à API'],
  },
  {
    id: 'pkg-6000',
    name: 'Profissional',
    credits: 6000,
    priceCents: 59900,
    sortOrder: 2,
    highlighted: true,
    benefits: ['1.200 a 3.000 faturas', 'ou 750 a 1.200 extrações de dados', 'Prioridade na fila', 'Suporte por e-mail'],
  },
  {
    id: 'pkg-12000',
    name: 'Escala',
    credits: 12000,
    priceCents: 99900,
    sortOrder: 3,
    highlighted: false,
    benefits: ['2.400 a 6.000 faturas', 'ou 1.500 a 2.400 extrações de dados', 'Múltiplas API keys', 'Suporte dedicado'],
  },
]

async function main() {
  for (const p of PACKAGES) {
    await prisma.creditPackage.upsert({ where: { id: p.id }, update: p, create: p })
  }

  if (process.env.NODE_ENV !== 'production') {
    const email = 'dev@fatturas.local'
    const bonus = Number(process.env.SIGNUP_BONUS_CREDITS ?? 200)
    const exists = await prisma.user.findUnique({ where: { email } })
    if (!exists) {
      const user = await prisma.user.create({
        data: {
          name: 'Usuário Dev',
          email,
          passwordHash: await argon2.hash('Fatturas123', { type: argon2.argon2id }),
          emailVerifiedAt: new Date(),
          settings: { create: {} },
          creditAccount: { create: { available: bonus } },
          transactions: {
            create: {
              type: 'ADJUSTMENT',
              credits: bonus,
              description: 'Bônus de boas-vindas',
              reference: 'BONUS-CADASTRO',
              idempotencyKey: `signup-bonus:seed-${email}`,
            },
          },
        },
      })
      console.log(`Usuário de desenvolvimento: ${user.email} / Fatturas123`)
    }
  }
  console.log('Seed concluído.')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
