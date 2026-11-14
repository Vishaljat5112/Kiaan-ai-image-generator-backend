import { app } from '../src/app.js'
import { env } from '../src/config/env.js'
import { prisma } from '../src/config/database.js'
import jwt from 'jsonwebtoken'

async function runAuthTests() {
  console.log('====================================================')
  console.log(' KIAAN STUDIO — BACKEND AUTHENTICATION TEST SUITE')
  console.log('====================================================\n')

  const port = 5002 // Isolated test port
  let server
  let passCount = 0
  let failCount = 0

  const assert = (condition, title, details = '') => {
    if (condition) {
      console.log(`[PASS] ${title}`)
      passCount++
    } else {
      console.error(`[FAIL] ${title} ${details ? '- ' + details : ''}`)
      failCount++
    }
  }

  // Tracking IDs for cleanup
  const createdUserIds = []
  const testTimestamp = Date.now()
  const customerEmail = `test_customer_${testTimestamp}@studio.com`
  const adminEmail = `test_admin_${testTimestamp}@studio.com`
  const bannedEmail = `test_banned_${testTimestamp}@studio.com`
  const rawPassword = 'SecurePassword123!'

  try {
    server = app.listen(port)
    const baseUrl = `http://localhost:${port}/api`

    // Helper request wrapper
    const request = async (path, options = {}) => {
      const res = await fetch(`${baseUrl}${path}`, {
        headers: {
          'Content-Type': 'application/json',
          ...(options.headers || {})
        },
        ...options
      })
      const data = await res.json().catch(() => null)
      return { status: res.status, data, headers: res.headers }
    }

    // -----------------------------------------------------------------
    // 1. Health check & Server baseline
    // -----------------------------------------------------------------
    const health = await request('/health')
    assert(health.status === 200 && health.data.status === 'ok', '1. System Health Endpoint (/api/health)')

    // -----------------------------------------------------------------
    // 2. Validation Errors on Registration (Missing / Invalid input)
    // -----------------------------------------------------------------
    const regInvalid = await request('/v1/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email: 'invalid-email', password: '123', fullName: '' })
    })
    assert(
      regInvalid.status === 400 && regInvalid.data.error.code === 'VALIDATION_ERROR',
      '2. Registration rejects invalid email and weak password with 400'
    )

    // -----------------------------------------------------------------
    // 3. Successful Customer Registration
    // -----------------------------------------------------------------
    const regRes = await request('/v1/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        email: customerEmail,
        password: rawPassword,
        fullName: 'Test Customer'
      })
    })

    assert(regRes.status === 201 && regRes.data.success, '3. Successful customer registration returns 201')
    assert(regRes.data.data.user.email === customerEmail, '3a. Returned user email matches normalized email')
    assert(regRes.data.data.user.role === 'CREATOR', '3b. Registered user role is strictly CREATOR/CUSTOMER')
    assert(!regRes.data.data.user.passwordHash, '3c. Password hash is NOT exposed in response payload')
    assert(regRes.data.data.accessToken && regRes.data.data.refreshToken, '3d. Access & refresh tokens generated')

    const customerUserId = regRes.data.data.user.id
    createdUserIds.push(customerUserId)

    // -----------------------------------------------------------------
    // 4. Database Password Hashing & Wallet Verification
    // -----------------------------------------------------------------
    const dbCustomer = await prisma.user.findUnique({
      where: { id: customerUserId },
      include: { wallet: true }
    })
    assert(
      dbCustomer.passwordHash !== rawPassword && dbCustomer.passwordHash.startsWith('$2'),
      '4. Passwords are securely hashed with bcrypt in MySQL'
    )
    assert(
      dbCustomer.wallet && dbCustomer.wallet.balance === 25,
      '4a. CreditWallet automatically created with initial 25 welcome bonus'
    )

    // -----------------------------------------------------------------
    // 5. Duplicate Email Rejection
    // -----------------------------------------------------------------
    const regDup = await request('/v1/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        email: customerEmail.toUpperCase(), // Testing case-insensitive uniqueness
        password: rawPassword,
        fullName: 'Another Customer'
      })
    })
    assert(
      regDup.status === 409 && regDup.data.error.code === 'EMAIL_ALREADY_EXISTS',
      '5. Duplicate email registration rejected with 409 Conflict'
    )

    // -----------------------------------------------------------------
    // 6. Login Validation (Missing Fields)
    // -----------------------------------------------------------------
    const loginMissing = await request('/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: '' })
    })
    assert(loginMissing.status === 400, '6. Login with missing credentials rejected with 400')

    // -----------------------------------------------------------------
    // 7. Login with Incorrect Password
    // -----------------------------------------------------------------
    const loginBadPass = await request('/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: customerEmail, password: 'WrongPassword999!' })
    })
    assert(
      loginBadPass.status === 401 && loginBadPass.data.error.code === 'INVALID_CREDENTIALS',
      '7. Login with incorrect password rejected with 401'
    )

    // -----------------------------------------------------------------
    // 8. Login with Non-Existent Email
    // -----------------------------------------------------------------
    const loginNoUser = await request('/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'ghost_nonexistent@studio.com', password: rawPassword })
    })
    assert(
      loginNoUser.status === 401 && loginNoUser.data.error.code === 'INVALID_CREDENTIALS',
      '8. Non-existent user login rejected with generic 401 (enumeration guard)'
    )

    // -----------------------------------------------------------------
    // 9. Successful Customer Login
    // -----------------------------------------------------------------
    const loginRes = await request('/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: customerEmail, password: rawPassword })
    })
    assert(loginRes.status === 200 && loginRes.data.success, '9. Successful customer login returns 200')
    const customerToken = loginRes.data.data.accessToken
    let customerRefreshToken = loginRes.data.data.refreshToken

    // -----------------------------------------------------------------
    // 10. Authenticated /me Route
    // -----------------------------------------------------------------
    const meUnauthorized = await request('/v1/auth/me')
    assert(meUnauthorized.status === 401, '10. Accessing /api/v1/auth/me without token returns 401')

    const meAuthorized = await request('/v1/auth/me', {
      headers: { Authorization: `Bearer ${customerToken}` }
    })
    assert(
      meAuthorized.status === 200 && meAuthorized.data.data.user.email === customerEmail,
      '10a. Accessing /api/v1/auth/me with Bearer token returns safe user profile'
    )

    // -----------------------------------------------------------------
    // 11. Role-Based Access Control (Customer Blocked from Admin)
    // -----------------------------------------------------------------
    const adminBlocked = await request('/v1/admin/dashboard', {
      headers: { Authorization: `Bearer ${customerToken}` }
    })
    assert(
      adminBlocked.status === 403 && adminBlocked.data.error.code === 'FORBIDDEN',
      '11. Customer role is blocked from admin routes with 403 Forbidden'
    )

    // -----------------------------------------------------------------
    // 12. Admin Provisioning & Authorization
    // -----------------------------------------------------------------
    const adminPasswordHash = await prisma.user.create({
      data: {
        email: adminEmail,
        fullName: 'Test Administrator',
        passwordHash: dbCustomer.passwordHash, // Reuse valid hash
        role: 'SUPER_ADMIN',
        status: 'ACTIVE'
      }
    })
    createdUserIds.push(adminPasswordHash.id)

    const adminLoginRes = await request('/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: adminEmail, password: rawPassword })
    })
    const adminToken = adminLoginRes.data.data.accessToken

    const adminAllowed = await request('/v1/admin/dashboard', {
      headers: { Authorization: `Bearer ${adminToken}` }
    })
    assert(
      adminAllowed.status === 200 && adminAllowed.data.success,
      '12. Authorized Administrator accesses admin routes with 200 OK'
    )

    // -----------------------------------------------------------------
    // 13. JWT Expiration & Tampering
    // -----------------------------------------------------------------
    const tamperedToken = customerToken.slice(0, -6) + 'abcdef'
    const tamperedRes = await request('/v1/auth/me', {
      headers: { Authorization: `Bearer ${tamperedToken}` }
    })
    assert(
      tamperedRes.status === 401 && tamperedRes.data.error.code === 'INVALID_TOKEN',
      '13. Tampered or forged JWT access token rejected with 401'
    )

    // Expired token test
    const expiredToken = jwt.sign(
      { sub: customerUserId, email: customerEmail, role: 'CREATOR' },
      env.JWT_SECRET,
      { expiresIn: '-1s' }
    )
    const expiredRes = await request('/v1/auth/me', {
      headers: { Authorization: `Bearer ${expiredToken}` }
    })
    assert(
      expiredRes.status === 401 && expiredRes.data.error.code === 'TOKEN_EXPIRED',
      '13a. Expired JWT access token rejected with 401'
    )

    // -----------------------------------------------------------------
    // 14. Refresh Token Rotation
    // -----------------------------------------------------------------
    const refreshRes = await request('/v1/auth/refresh', {
      method: 'POST',
      body: JSON.stringify({ refreshToken: customerRefreshToken })
    })
    assert(
      refreshRes.status === 200 && refreshRes.data.data.accessToken && refreshRes.data.data.refreshToken,
      '14. Refresh token rotation returns new access token and rotated refresh token'
    )
    const newRotatedRefreshToken = refreshRes.data.data.refreshToken

    // -----------------------------------------------------------------
    // 15. Refresh Token Reuse Detection
    // -----------------------------------------------------------------
    const reuseAttempt = await request('/v1/auth/refresh', {
      method: 'POST',
      body: JSON.stringify({ refreshToken: customerRefreshToken }) // Previous token should now be revoked
    })
    assert(
      reuseAttempt.status === 401 && reuseAttempt.data.error.code === 'TOKEN_REUSE_DETECTED',
      '15. Reuse of revoked refresh token triggers reuse detection & revokes all user sessions'
    )

    // -----------------------------------------------------------------
    // 16. Logout & Session Revocation
    // -----------------------------------------------------------------
    // Login fresh session
    const freshLogin = await request('/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: customerEmail, password: rawPassword })
    })
    const logoutToken = freshLogin.data.data.refreshToken

    const logoutRes = await request('/v1/auth/logout', {
      method: 'POST',
      body: JSON.stringify({ refreshToken: logoutToken })
    })
    assert(logoutRes.status === 200, '16. Logout revokes active refresh session and returns 200')

    // Subsequent refresh with logged out token should fail
    const postLogoutRefresh = await request('/v1/auth/refresh', {
      method: 'POST',
      body: JSON.stringify({ refreshToken: logoutToken })
    })
    assert(
      postLogoutRefresh.status === 401,
      '16a. Refreshing with logged out session token fails with 401'
    )

    // -----------------------------------------------------------------
    // 17. Disabled / Banned User Account Access Block
    // -----------------------------------------------------------------
    const bannedUser = await prisma.user.create({
      data: {
        email: bannedEmail,
        fullName: 'Banned User',
        passwordHash: dbCustomer.passwordHash,
        role: 'CREATOR',
        status: 'BANNED'
      }
    })
    createdUserIds.push(bannedUser.id)

    const bannedLogin = await request('/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: bannedEmail, password: rawPassword })
    })
    assert(
      bannedLogin.status === 403 && bannedLogin.data.error.code === 'ACCOUNT_BANNED',
      '17. Banned user is blocked from logging in with 403 Account Banned'
    )

    console.log(`\n====================================================`)
    console.log(` RESULTS: ${passCount} PASSED, ${failCount} FAILED`)
    console.log(`====================================================\n`)
  } catch (error) {
    console.error('Test Suite Fatal Error:', error)
    failCount++
  } finally {
    // Isolated Cleanup: Delete ONLY records created during this test
    console.log('[Cleanup] Cleaning up isolated test users and tokens...')
    if (createdUserIds.length > 0) {
      await prisma.user.deleteMany({
        where: { id: { in: createdUserIds } }
      })
      console.log(`[Cleanup] Deleted ${createdUserIds.length} test accounts.`)
    }
    await prisma.$disconnect()
    if (server) {
      server.close()
    }
  }

  process.exit(failCount > 0 ? 1 : 0)
}

runAuthTests()
