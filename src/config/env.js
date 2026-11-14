import dotenv from 'dotenv'

// Load environment variables from .env file
dotenv.config()

/**
 * Validates and exposes environment variables.
 * Fails fast on server startup if critical configuration is missing.
 */
function validateEnv() {
  const required = [
    'PORT',
    'DATABASE_URL',
    'FRONTEND_URL',
    'JWT_SECRET',
    'JWT_REFRESH_SECRET'
  ]
  const missing = required.filter((key) => !process.env[key])

  if (missing.length > 0) {
    throw new Error(
      `[Startup Error] Missing required environment variables: ${missing.join(', ')}`
    )
  }

  return {
    NODE_ENV: process.env.NODE_ENV || 'development',
    PORT: parseInt(process.env.PORT || '5001', 10),
    DATABASE_URL: process.env.DATABASE_URL,
    FRONTEND_URL: process.env.FRONTEND_URL || 'http://localhost:5173',
    JWT_SECRET: process.env.JWT_SECRET,
    JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '15m',
    JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET,
    JWT_REFRESH_EXPIRES_IN: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
    isProduction: process.env.NODE_ENV === 'production',
    isDevelopment: process.env.NODE_ENV !== 'production'
  }
}

export const env = validateEnv()
export default env
