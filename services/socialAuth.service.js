import { OAuth2Client } from 'google-auth-library';
import appleSignin from 'apple-signin-auth';

/**
 * Google Token Verification Service
 */
export class GoogleAuthService {
  constructor() {
    this.client = new OAuth2Client();
    // Include all Google client IDs that may send tokens
    this.clientIds = [
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_IOS_CLIENT_ID,
      process.env.GOOGLE_ANDROID_CLIENT_ID,
      // Fallback to known client IDs if env vars not set
      '1004463918618-ksrbdruue45a5ca8edusqpdhlfn6c768.apps.googleusercontent.com', // Android
      '1004463918618-94eqedp5s5mivv9t0vrc92t4klokl2bo.apps.googleusercontent.com'  // iOS
    ].filter(Boolean);
  }

  /**
   * Verify Google ID token and extract user info
   * @param {string} idToken - The ID token from Google Sign-In
   * @returns {Promise<{email: string, name: string, picture: string, sub: string}>}
   */
  async verifyToken(idToken) {
    try {
      const ticket = await this.client.verifyIdToken({
        idToken,
        audience: this.clientIds
      });

      const payload = ticket.getPayload();

      if (!payload) {
        throw new Error('Invalid token payload');
      }

      return {
        sub: payload.sub, // Google's unique user ID
        email: payload.email,
        emailVerified: payload.email_verified,
        name: payload.name || payload.email.split('@')[0],
        picture: payload.picture,
        givenName: payload.given_name,
        familyName: payload.family_name
      };
    } catch (error) {
      console.error('Google token verification failed:', error.message);
      throw new Error('Invalid Google token');
    }
  }
}

/**
 * Apple Token Verification Service
 */
export class AppleAuthService {
  constructor() {
    this.clientId = process.env.APPLE_CLIENT_ID;
    this.teamId = process.env.APPLE_TEAM_ID;
    this.keyId = process.env.APPLE_KEY_ID;
    this.privateKey = process.env.APPLE_PRIVATE_KEY;
  }

  /**
   * Verify Apple identity token and extract user info
   * @param {string} identityToken - The identity token from Apple Sign-In
   * @param {object} userData - Additional user data (name, email) from first sign-in
   * @returns {Promise<{email: string, name: string, sub: string}>}
   */
  async verifyToken(identityToken, userData = {}) {
    try {
      // Verify the token
      const payload = await appleSignin.verifyIdToken(identityToken, {
        audience: this.clientId,
        ignoreExpiration: false
      });

      if (!payload) {
        throw new Error('Invalid Apple token payload');
      }

      // Apple only provides name on first sign-in, so we use userData if available
      const name = userData.givenName 
        ? `${userData.givenName} ${userData.familyName || ''}`.trim()
        : payload.email?.split('@')[0] || 'Apple User';

      return {
        sub: payload.sub, // Apple's unique user ID
        email: payload.email || userData.email,
        emailVerified: payload.email_verified,
        name,
        isPrivateEmail: payload.is_private_email
      };
    } catch (error) {
      console.error('Apple token verification failed:', error.message);
      throw new Error('Invalid Apple token');
    }
  }

  /**
   * Generate client secret for Apple Sign-In (needed for token exchange)
   * @returns {Promise<string>}
   */
  async generateClientSecret() {
    if (!this.privateKey || !this.keyId || !this.teamId || !this.clientId) {
      throw new Error('Apple Sign-In not configured');
    }

    const clientSecret = appleSignin.getClientSecret({
      clientID: this.clientId,
      teamID: this.teamId,
      privateKey: this.privateKey,
      keyIdentifier: this.keyId,
      expAfter: 15777000 // 6 months
    });

    return clientSecret;
  }
}

// Export singleton instances
export const googleAuthService = new GoogleAuthService();
export const appleAuthService = new AppleAuthService();
