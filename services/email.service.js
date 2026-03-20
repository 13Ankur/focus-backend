import { Resend } from 'resend';

class EmailService {
  constructor() {
    this.resend = null;
    this.isConfigured = false;
    this.initialized = false;
  }

  // Lazy initialization - called on first email send
  ensureInitialized() {
    if (this.initialized) return;

    const apiKey = process.env.RESEND_API_KEY;

    if (!apiKey) {
      console.warn('⚠️  RESEND_API_KEY not configured. Email sending will fail.');
      this.isConfigured = false;
    } else {
      this.resend = new Resend(apiKey);
      this.isConfigured = true;
      console.log('✅ Resend email service initialized');
    }

    this.initialized = true;
  }

  // Generate 6-digit numeric OTP
  generateOTP() {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }

  async sendEmail(to, subject, html, text) {
    // Lazy initialize on first use
    this.ensureInitialized();

    const fromEmail = process.env.EMAIL_FROM || 'noreply@pawsfocus.app';
    const fromName = process.env.EMAIL_FROM_NAME || 'Paws Focus';

    // If not configured, return error
    if (!this.isConfigured || !this.resend) {
      console.error('❌ Email not sent: Resend not configured');
      return { success: false, error: 'Email service not configured' };
    }

    try {
      const { data, error } = await this.resend.emails.send({
        from: `${fromName} <${fromEmail}>`,
        to: [to],
        subject,
        text,
        html,
      });

      if (error) {
        throw error;
      }

      console.log('✅ Email sent successfully to:', to);
      return { success: true, messageId: data?.id || Date.now() };
    } catch (error) {
      console.error('❌ Resend error:', error.message || error);

      // If error is related to API key or permissions, set configured to false
      if (error.name === 'authentication_error' || error.message?.includes('unauthorized')) {
        this.isConfigured = false;
      }

      return { success: false, error: error.message || 'Failed to send email' };
    }
  }

  async sendOTPEmail(user, otp) {
    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Your Verification Code - Paws Focus</title>
        </head>
        <body style="font-family: 'Segoe UI', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f5f5f5;">
          <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 40px 30px; text-align: center; border-radius: 16px 16px 0 0;">
            <h1 style="color: white; margin: 0; font-size: 28px;">🐕 Paws Focus</h1>
            <p style="color: rgba(255,255,255,0.9); margin: 10px 0 0; font-size: 16px;">Email Verification</p>
          </div>
          <div style="background: white; padding: 40px 30px; border-radius: 0 0 16px 16px; box-shadow: 0 4px 20px rgba(0,0,0,0.1);">
            <h2 style="color: #333; margin: 0 0 20px; font-size: 22px; text-align: center;">Your Verification Code</h2>
            <p style="color: #666; text-align: center; margin: 0 0 30px;">Hi ${user.username}, enter this code to verify your email:</p>
            
            <div style="background: linear-gradient(135deg, #f8f9fa 0%, #e9ecef 100%); border-radius: 12px; padding: 30px; text-align: center; margin: 0 0 30px;">
              <div style="font-size: 42px; font-weight: 700; letter-spacing: 12px; color: #667eea; font-family: 'Courier New', monospace;">
                ${otp}
              </div>
            </div>
            
            <p style="color: #999; text-align: center; font-size: 14px; margin: 0 0 20px;">
              ⏱️ This code expires in <strong>10 minutes</strong>
            </p>
            
            <div style="background: #fff8e1; border-left: 4px solid #ffc107; padding: 15px; border-radius: 4px; margin: 0 0 20px;">
              <p style="color: #856404; margin: 0; font-size: 14px;">
                <strong>Security tip:</strong> Never share this code with anyone. Paws Focus will never ask for your code.
              </p>
            </div>
            
            <p style="color: #999; text-align: center; font-size: 13px; margin: 0;">
              If you didn't request this code, you can safely ignore this email.
            </p>
            
            <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
            <p style="color: #999; font-size: 12px; text-align: center; margin: 0;">
              © ${new Date().getFullYear()} Paws Focus. Helping shelter dogs, one focus session at a time.
            </p>
          </div>
        </body>
      </html>
    `;

    const text = `
Your Paws Focus Verification Code

Hi ${user.username},

Your verification code is: ${otp}

This code expires in 10 minutes.

If you didn't request this code, please ignore this email.

© ${new Date().getFullYear()} Paws Focus
    `;

    return await this.sendEmail(
      user.email,
      `${otp} is your Paws Focus verification code`,
      html,
      text
    );
  }

  async sendPasswordResetOTPEmail(user, otp) {
    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Password Reset Code - Paws Focus</title>
        </head>
        <body style="font-family: 'Segoe UI', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f5f5f5;">
          <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 40px 30px; text-align: center; border-radius: 16px 16px 0 0;">
            <h1 style="color: white; margin: 0; font-size: 28px;">🐕 Paws Focus</h1>
            <p style="color: rgba(255,255,255,0.9); margin: 10px 0 0; font-size: 16px;">Password Reset</p>
          </div>
          <div style="background: white; padding: 40px 30px; border-radius: 0 0 16px 16px; box-shadow: 0 4px 20px rgba(0,0,0,0.1);">
            <h2 style="color: #333; margin: 0 0 20px; font-size: 22px; text-align: center;">Reset Your Password</h2>
            <p style="color: #666; text-align: center; margin: 0 0 30px;">Hi ${user.username}, enter this code to reset your password:</p>
            
            <div style="background: linear-gradient(135deg, #f8f9fa 0%, #e9ecef 100%); border-radius: 12px; padding: 30px; text-align: center; margin: 0 0 30px;">
              <div style="font-size: 42px; font-weight: 700; letter-spacing: 12px; color: #667eea; font-family: 'Courier New', monospace;">
                ${otp}
              </div>
            </div>
            
            <p style="color: #999; text-align: center; font-size: 14px; margin: 0 0 20px;">
              ⏱️ This code expires in <strong>10 minutes</strong>
            </p>
            
            <div style="background: #ffebee; border-left: 4px solid #f44336; padding: 15px; border-radius: 4px; margin: 0 0 20px;">
              <p style="color: #c62828; margin: 0; font-size: 14px;">
                <strong>Didn't request this?</strong> Someone may be trying to access your account. You can safely ignore this email.
              </p>
            </div>
            
            <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
            <p style="color: #999; font-size: 12px; text-align: center; margin: 0;">
              © ${new Date().getFullYear()} Paws Focus. Helping shelter dogs, one focus session at a time.
            </p>
          </div>
        </body>
      </html>
    `;

    const text = `
Password Reset Code - Paws Focus

Hi ${user.username},

Your password reset code is: ${otp}

This code expires in 10 minutes.

If you didn't request this code, please ignore this email.

© ${new Date().getFullYear()} Paws Focus
    `;

    return await this.sendEmail(
      user.email,
      `${otp} is your Paws Focus password reset code`,
      html,
      text
    );
  }

  async sendWelcomeEmail(user) {
    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Welcome to Paws Focus!</title>
        </head>
        <body style="font-family: 'Segoe UI', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f5f5f5;">
          <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 40px 30px; text-align: center; border-radius: 16px 16px 0 0;">
            <h1 style="color: white; margin: 0; font-size: 28px;">🐕 Paws Focus</h1>
            <p style="color: rgba(255,255,255,0.9); margin: 10px 0 0; font-size: 16px;">Welcome Aboard!</p>
          </div>
          <div style="background: white; padding: 40px 30px; border-radius: 0 0 16px 16px; box-shadow: 0 4px 20px rgba(0,0,0,0.1);">
            <h2 style="color: #4caf50; margin: 0 0 20px; font-size: 22px; text-align: center;">✅ Email Verified!</h2>
            <p style="color: #666; text-align: center; margin: 0 0 30px;">Hi ${user.username}, you're all set to start your focus journey!</p>
            
            <div style="background: #e8f5e9; border-radius: 12px; padding: 20px; margin: 0 0 30px;">
              <h3 style="color: #2e7d32; margin: 0 0 15px; font-size: 16px;">What's next?</h3>
              <ul style="color: #666; margin: 0; padding-left: 20px;">
                <li style="margin-bottom: 10px;">🎯 Start a focus session to earn kibble</li>
                <li style="margin-bottom: 10px;">🐕 Feed your virtual dog companion</li>
                <li style="margin-bottom: 10px;">📊 Track your focus time and impact</li>
                <li style="margin-bottom: 0;">🏆 Help real shelter dogs get meals!</li>
              </ul>
            </div>
            
            <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
            <p style="color: #999; font-size: 12px; text-align: center; margin: 0;">
              © ${new Date().getFullYear()} Paws Focus. Helping shelter dogs, one focus session at a time.
            </p>
          </div>
        </body>
      </html>
    `;

    const text = `
Welcome to Paws Focus!

Hi ${user.username},

Your email has been verified! You're all set to start your focus journey.

What's next?
- Start a focus session to earn kibble
- Feed your virtual dog companion  
- Track your focus time and impact
- Help real shelter dogs get meals!

© ${new Date().getFullYear()} Paws Focus
    `;

    return await this.sendEmail(
      user.email,
      'Welcome to Paws Focus! 🐕',
      html,
      text
    );
  }
}

export default new EmailService();
