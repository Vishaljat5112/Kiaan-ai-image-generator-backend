import { prisma } from '../../config/database.js'

// Pricing configuration per model and generation type (credit cost)
export const CREDIT_PRICING = {
  MODELS: {
    'flux-2-klein-4b': { name: 'FLUX.2 Klein 4B', type: 'IMAGE', baseCost: 1 },
    'z-image-turbo': { name: 'Z-Image Turbo', type: 'IMAGE', baseCost: 1 },
    'wan-2.1-video-720p': { name: 'Wan 2.1 Video (Cinema 720p)', type: 'VIDEO', baseCost: 25 },
    'wan-2.1-i2v-14b': { name: 'Wan 2.1 I2V 14B Cinema', type: 'VIDEO', baseCost: 20 }
  },
  GENERATION_TYPES: {
    TEXT_TO_IMAGE: 1,
    IMAGE_TO_IMAGE: 1,
    IMAGE_EDITOR: 1,
    TEXT_TO_VIDEO: 25,
    IMAGE_TO_VIDEO: 20
  },
  TOPUP_PACKS: [
    { id: 'topup-100', credits: 100, priceCents: 500, priceFormatted: '$5.00', desc: 'Ideal for small quick edits' },
    { id: 'topup-500', credits: 500, priceCents: 2000, priceFormatted: '$20.00', desc: 'Perfect for standard creative runs', isPopular: true },
    { id: 'topup-2000', credits: 2000, priceCents: 7000, priceFormatted: '$70.00', desc: 'Studio scale for heavy 3D DiT video jobs' }
  ]
}

export class CreditsService {
  /**
   * Get user's current credit balance
   */
  static async getBalance(userId) {
    let wallet = await prisma.creditWallet.findUnique({
      where: { userId }
    })

    if (!wallet) {
      wallet = await prisma.creditWallet.create({
        data: {
          userId,
          balance: 25,
          reservedBalance: 0
        }
      })
    }

    return {
      balance: wallet.balance,
      reservedBalance: wallet.reservedBalance,
      availableBalance: wallet.balance
    }
  }

  /**
   * Calculate required credits for a generation request
   */
  static calculateCost(type, modelId, parameters = {}) {
    if (modelId && CREDIT_PRICING.MODELS[modelId]) {
      return CREDIT_PRICING.MODELS[modelId].baseCost
    }

    if (type && CREDIT_PRICING.GENERATION_TYPES[type]) {
      return CREDIT_PRICING.GENERATION_TYPES[type]
    }

    return 1 // Default 1 credit
  }

  /**
   * Returns credit pricing catalog
   */
  static getPricing() {
    return CREDIT_PRICING
  }

  /**
   * Atomically reserve credits from user wallet for a queued job
   */
  static async reserveCredits(userId, amount, category, description, referenceId, txPrisma = prisma) {
    if (amount <= 0) {
      throw new Error('Credit amount must be greater than zero')
    }

    const wallet = await txPrisma.creditWallet.findUnique({
      where: { userId }
    })

    if (!wallet) {
      const error = new Error('Wallet not found')
      error.statusCode = 404
      error.code = 'WALLET_NOT_FOUND'
      throw error
    }

    if (wallet.balance < amount) {
      const error = new Error(`Insufficient credits. Required: ${amount}, Available: ${wallet.balance}`)
      error.statusCode = 402
      error.code = 'INSUFFICIENT_CREDITS'
      error.details = { required: amount, available: wallet.balance }
      throw error
    }

    // Atomic update: decrement available balance, increment reserved balance
    const updatedWallet = await txPrisma.creditWallet.update({
      where: { id: wallet.id },
      data: {
        balance: { decrement: amount },
        reservedBalance: { increment: amount }
      }
    })

    // Log credit transaction
    await txPrisma.creditTransaction.create({
      data: {
        walletId: wallet.id,
        amount: -amount,
        type: 'DEBIT',
        category,
        description,
        referenceId
      }
    })

    return {
      balance: updatedWallet.balance,
      reservedBalance: updatedWallet.reservedBalance,
      reservedAmount: amount
    }
  }

  /**
   * Atomically refund reserved credits if a job fails or is canceled
   */
  static async refundCredits(userId, amount, category, description, referenceId, txPrisma = prisma) {
    if (amount <= 0) return null

    const wallet = await txPrisma.creditWallet.findUnique({
      where: { userId }
    })

    if (!wallet) return null

    // Decrement reserved, return to available balance
    const updatedWallet = await txPrisma.creditWallet.update({
      where: { id: wallet.id },
      data: {
        balance: { increment: amount },
        reservedBalance: { decrement: Math.min(wallet.reservedBalance, amount) }
      }
    })

    // Log refund transaction
    await txPrisma.creditTransaction.create({
      data: {
        walletId: wallet.id,
        amount: amount,
        type: 'REFUND',
        category,
        description: description || `Refund for failed/canceled job ${referenceId || ''}`,
        referenceId
      }
    })

    return {
      balance: updatedWallet.balance,
      reservedBalance: updatedWallet.reservedBalance,
      refundedAmount: amount
    }
  }

  /**
   * Finalize deduction when a job successfully completes
   */
  static async finalizeDeduction(userId, amount, txPrisma = prisma) {
    if (amount <= 0) return null

    const wallet = await txPrisma.creditWallet.findUnique({
      where: { userId }
    })

    if (!wallet) return null

    const updated = await txPrisma.creditWallet.update({
      where: { id: wallet.id },
      data: {
        reservedBalance: { decrement: Math.min(wallet.reservedBalance, amount) }
      }
    })

    return updated
  }

  /**
   * Get paginated credit transactions for user
   */
  static async getTransactions(userId, { category, type, page = 1, limit = 50 } = {}) {
    const pageNum = Math.max(1, parseInt(page, 10) || 1)
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 50))
    const skip = (pageNum - 1) * limitNum

    const wallet = await prisma.creditWallet.findUnique({
      where: { userId }
    })

    if (!wallet) {
      return {
        transactions: [],
        pagination: { page: 1, limit: limitNum, total: 0, totalPages: 0 }
      }
    }

    const where = {
      walletId: wallet.id
    }

    if (category && category !== 'all') {
      const catUpper = category.toUpperCase()
      if (['IMAGE_GENERATION', 'VIDEO_GENERATION', 'PLAN_ALLOWANCE', 'TOPUP_PACK', 'ADMIN_GRANT', 'REFUND'].includes(catUpper)) {
        where.category = catUpper
      } else if (category === 'image') {
        where.category = 'IMAGE_GENERATION'
      } else if (category === 'video') {
        where.category = 'VIDEO_GENERATION'
      } else if (category === 'topup') {
        where.category = { in: ['TOPUP_PACK', 'PLAN_ALLOWANCE', 'ADMIN_GRANT'] }
      }
    }

    if (type && type !== 'all') {
      where.type = type.toUpperCase()
    }

    const [total, transactions] = await Promise.all([
      prisma.creditTransaction.count({ where }),
      prisma.creditTransaction.findMany({
        where,
        skip,
        take: limitNum,
        orderBy: { createdAt: 'desc' }
      })
    ])

    return {
      transactions: transactions.map((t) => ({
        id: t.id,
        amount: t.amount,
        type: t.type.toLowerCase(),
        category: t.category.toLowerCase().replace('_generation', ''),
        rawCategory: t.category,
        description: t.description,
        referenceId: t.referenceId,
        date: t.createdAt.toISOString(),
        createdAt: t.createdAt.toISOString()
      })),
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum)
      }
    }
  }

  /**
   * Initiates a credit top-up order / invoice
   */
  static async createTopUpOrder(userId, { packId }) {
    const pack = CREDIT_PRICING.TOPUP_PACKS.find((p) => p.id === packId)
    if (!pack) {
      const error = new Error('Invalid top-up pack selected')
      error.statusCode = 400
      error.code = 'INVALID_PACK'
      throw error
    }

    const invoiceNumber = `INV-TOPUP-${Date.now()}-${Math.floor(Math.random() * 1000)}`

    // Create pending invoice record
    const invoice = await prisma.invoice.create({
      data: {
        userId,
        invoiceNumber,
        amount: pack.priceCents / 100,
        status: 'PENDING',
        description: `Credit Top-Up: ${pack.credits} Credits (${pack.priceFormatted})`
      }
    })

    return {
      orderId: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      packId: pack.id,
      credits: pack.credits,
      amount: pack.priceCents / 100,
      currency: 'USD',
      status: 'PENDING',
      message: 'Payment order created. Payment gateways are pending integration in Phase 6.'
    }
  }
}

export default CreditsService
