/**
 * Standard API response envelope helpers.
 */
export const apiResponse = {
  /**
   * Formats a successful API response envelope.
   */
  success: (res, data = {}, statusCode = 200, meta = {}) => {
    return res.status(statusCode).json({
      success: true,
      data,
      meta: {
        timestamp: new Date().toISOString(),
        ...meta
      }
    })
  },

  /**
   * Formats an error API response envelope.
   */
  error: (res, message = 'Internal Server Error', statusCode = 500, code = 'INTERNAL_ERROR', details = []) => {
    return res.status(statusCode).json({
      success: false,
      error: {
        code,
        message,
        details
      },
      meta: {
        timestamp: new Date().toISOString()
      }
    })
  }
}

export default apiResponse
