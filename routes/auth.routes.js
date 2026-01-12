import express from 'express';
import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';
import User from '../models/User.js';
import VerificationToken from '../models/VerificationToken.js';
import { googleAuthService, appleAuthService } from '../services/socialAuth.service.js';
import emailService from '../services/email.service.js';

const router = express.Router();

// Rate limiters for auth routes
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // 10 attempts per window
  message: { message: 'Too many attempts. Please try again in 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const otpLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 5, // 5 attempts per minute
  message: { message: 'Too many OTP attempts. Please wait a moment.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Generate JWT token
const generateToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET, {
    expiresIn: '7d',
  });
};

// Helper to generate a random password for social login users
const generateRandomPassword = () => {
  return Math.random().toString(36).slice(-8) + Math.random().toString(36).slice(-8);
};

// @route   POST /auth/signup
// @desc    Register a new user and send OTP
// @access  Public
router.post('/signup', authLimiter, async (req, res) => {
  try {
    const { username, email, password } = req.body;

    // Validation
    if (!username || !email || !password) {
      return res.status(400).json({ message: 'Please provide all required fields' });
    }

    if (password.length < 6) {
      return res.status(400).json({ message: 'Password must be at least 6 characters' });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ message: 'Please provide a valid email address' });
    }

    // Check if user already exists
    const existingUser = await User.findOne({
      $or: [{ email: email.toLowerCase() }, { username }],
    });

    if (existingUser) {
      // If user exists but email not verified, allow re-registration with new OTP
      if (existingUser.email === email.toLowerCase() && !existingUser.emailVerified) {
        // Update password and send new OTP
        existingUser.password = password;
        existingUser.username = username;
        await existingUser.save();

        // Generate and send OTP (handle rate limiting)
        try {
          const otp = await VerificationToken.createOTP(existingUser._id, existingUser.email, 'email');
          await emailService.sendOTPEmail(existingUser, otp);
        } catch (otpError) {
          // If rate limited, still allow signup but inform user
          if (otpError.message.includes('Too many requests')) {
            return res.status(429).json({
              message: otpError.message,
              userId: existingUser._id,
              email: existingUser.email,
              requiresVerification: true,
            });
          }
          throw otpError;
        }

        return res.status(200).json({
          message: 'Verification code sent to your email',
          userId: existingUser._id,
          email: existingUser.email,
          requiresVerification: true,
        });
      }

      return res.status(400).json({
        message:
          existingUser.email === email.toLowerCase()
            ? 'Email already registered'
            : 'Username already taken',
      });
    }

    // Create user (email not verified yet)
    const user = await User.create({
      username,
      email: email.toLowerCase(),
      password,
      emailVerified: false,
      provider: 'email',
    });

    // Generate and send OTP
    try {
      const otp = await VerificationToken.createOTP(user._id, user.email, 'email');
      await emailService.sendOTPEmail(user, otp);
    } catch (emailError) {
      console.error('Error sending OTP email:', emailError);
      // Don't fail signup if email fails
    }

    res.status(201).json({
      message: 'Verification code sent to your email',
      userId: user._id,
      email: user.email,
      requiresVerification: true,
    });
  } catch (error) {
    console.error('Signup error:', error.message);
    
    // Handle duplicate key error
    if (error.code === 11000) {
      const field = Object.keys(error.keyPattern)[0];
      return res.status(400).json({
        message: `${field === 'email' ? 'Email' : 'Username'} already exists`,
      });
    }
    
    res.status(500).json({ message: 'Server error during signup' });
  }
});

// @route   POST /auth/verify-otp
// @desc    Verify OTP and complete registration
// @access  Public
router.post('/verify-otp', otpLimiter, async (req, res) => {
  try {
    const { userId, otp } = req.body;

    if (!userId || !otp) {
      return res.status(400).json({ message: 'User ID and OTP are required' });
    }

    // Validate OTP format
    if (!/^\d{6}$/.test(otp)) {
      return res.status(400).json({ message: 'Invalid OTP format. Please enter 6 digits.' });
    }

    // Find user
    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Check if already verified
    if (user.emailVerified) {
      return res.json({
        message: 'Email already verified',
        emailVerified: true,
        _id: user._id,
        username: user.username,
        email: user.email,
        totalKibble: user.totalKibble,
        totalFocusMinutes: user.totalFocusMinutes,
        token: generateToken(user._id),
      });
    }

    // Verify OTP
    const result = await VerificationToken.verifyOTP(userId, otp, 'email');

    if (!result.valid) {
      return res.status(400).json({
        message: result.error,
        expired: result.expired || false,
        maxAttempts: result.maxAttempts || false,
        remainingAttempts: result.remainingAttempts,
      });
    }

    // Mark email as verified
    user.emailVerified = true;
    await user.save();

    // Send welcome email
    try {
      await emailService.sendWelcomeEmail(user);
    } catch (emailError) {
      console.error('Error sending welcome email:', emailError);
    }

    res.json({
      message: 'Email verified successfully!',
      emailVerified: true,
      _id: user._id,
      username: user.username,
      email: user.email,
      totalKibble: user.totalKibble,
      totalFocusMinutes: user.totalFocusMinutes,
      token: generateToken(user._id),
    });
  } catch (error) {
    console.error('OTP verification error:', error.message);
    res.status(500).json({ message: 'Server error during verification' });
  }
});

// @route   POST /auth/resend-otp
// @desc    Resend OTP for email verification
// @access  Public
router.post('/resend-otp', async (req, res) => {
  try {
    const { userId, email } = req.body;

    // Find user by userId or email
    let user;
    if (userId) {
      user = await User.findById(userId);
    } else if (email) {
      user = await User.findOne({ email: email.toLowerCase() });
    }

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Check if already verified
    if (user.emailVerified) {
      return res.json({ 
        message: 'Email is already verified',
        emailVerified: true 
      });
    }

    // Check rate limiting
    const canResendResult = await VerificationToken.canResend(user._id, 'email');
    
    if (!canResendResult.canResend) {
      return res.status(429).json({
        message: `Too many requests. Please wait before requesting a new code.`,
        waitSeconds: canResendResult.waitSeconds,
        resendCount: canResendResult.resendCount,
      });
    }

    // Generate and send new OTP
    try {
      const otp = await VerificationToken.createOTP(user._id, user.email, 'email');
      await emailService.sendOTPEmail(user, otp);
    } catch (error) {
      if (error.message.includes('Too many requests')) {
        return res.status(429).json({ message: error.message });
      }
      throw error;
    }

    res.json({
      message: 'Verification code sent! Please check your email.',
      userId: user._id,
      email: user.email,
      resendCount: canResendResult.resendCount + 1,
    });
  } catch (error) {
    console.error('Resend OTP error:', error.message);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   POST /auth/login
// @desc    Authenticate user and get token
// @access  Public
router.post('/login', authLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: 'Please provide email and password' });
    }

    // Find user by email and include password for comparison
    const user = await User.findOne({ email: email.toLowerCase() }).select('+password');

    if (!user) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    // Check if user is using email provider (has password)
    if (user.provider === 'email' && !user.password) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    // Check password
    const isMatch = await user.comparePassword(password);

    if (!isMatch) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    // Check if email is verified (only for email provider)
    if (user.provider === 'email' && !user.emailVerified) {
      // Generate new OTP and send
      try {
        const otp = await VerificationToken.createOTP(user._id, user.email, 'email');
        await emailService.sendOTPEmail(user, otp);
      } catch (otpError) {
        console.error('Error sending OTP during login:', otpError);
      }

      return res.status(403).json({
        message: 'Please verify your email. A new verification code has been sent.',
        emailVerified: false,
        email: user.email,
        userId: user._id,
        requiresVerification: true,
      });
    }

    res.json({
      _id: user._id,
      username: user.username,
      email: user.email,
      totalKibble: user.totalKibble,
      totalFocusMinutes: user.totalFocusMinutes,
      token: generateToken(user._id),
      emailVerified: user.emailVerified,
    });
  } catch (error) {
    console.error('Login error:', error.message);
    res.status(500).json({ message: 'Server error during login' });
  }
});

// @route   POST /auth/google
// @desc    Authenticate with Google ID token
// @access  Public
router.post('/google', async (req, res) => {
  try {
    const { idToken } = req.body;

    if (!idToken) {
      return res.status(400).json({ message: 'ID token is required' });
    }

    // Verify Google token
    const googleUser = await googleAuthService.verifyToken(idToken);

    if (!googleUser.email) {
      return res.status(400).json({ message: 'Email not provided by Google' });
    }

    // Check if user exists
    let user = await User.findOne({ 
      $or: [
        { email: googleUser.email },
        { googleId: googleUser.sub }
      ]
    });

    let isNewUser = false;

    if (!user) {
      // Create new user
      isNewUser = true;
      
      // Generate unique username
      let username = googleUser.name.replace(/\s+/g, '').toLowerCase();
      const existingUsername = await User.findOne({ username });
      if (existingUsername) {
        username = `${username}${Date.now().toString().slice(-4)}`;
      }

      user = await User.create({
        username,
        email: googleUser.email,
        password: generateRandomPassword(),
        googleId: googleUser.sub,
        avatar: googleUser.picture,
        provider: 'google',
        emailVerified: true, // Google verifies emails
        totalKibble: 50, // Welcome bonus
      });
    } else if (!user.googleId) {
      // Link Google account to existing user
      user.googleId = googleUser.sub;
      user.avatar = user.avatar || googleUser.picture;
      await user.save();
    }

    res.json({
      _id: user._id,
      username: user.username,
      email: user.email,
      totalKibble: user.totalKibble,
      totalFocusMinutes: user.totalFocusMinutes,
      token: generateToken(user._id),
      avatar: user.avatar || googleUser.picture,
      isNewUser,
    });
  } catch (error) {
    console.error('Google auth error:', error.message);
    res.status(401).json({ message: error.message || 'Google authentication failed' });
  }
});

// @route   POST /auth/apple
// @desc    Authenticate with Apple identity token
// @access  Public
router.post('/apple', async (req, res) => {
  try {
    const { identityToken, authorizationCode, user: appleUser, email, givenName, familyName } = req.body;

    if (!identityToken) {
      return res.status(400).json({ message: 'Identity token is required' });
    }

    // Verify Apple token
    const appleData = await appleAuthService.verifyToken(identityToken, {
      email,
      givenName,
      familyName
    });

    // Apple may not provide email after first sign-in (private relay)
    const userEmail = appleData.email || email;

    if (!userEmail && !appleData.sub) {
      return res.status(400).json({ message: 'Unable to identify user from Apple' });
    }

    // Check if user exists
    let user = await User.findOne({ 
      $or: [
        { appleId: appleData.sub },
        ...(userEmail ? [{ email: userEmail }] : [])
      ]
    });

    let isNewUser = false;

    if (!user) {
      // Create new user
      isNewUser = true;
      
      // Generate unique username
      let username = appleData.name.replace(/\s+/g, '').toLowerCase();
      if (!username || username === 'appleuser') {
        username = `user${Date.now().toString().slice(-6)}`;
      }
      
      const existingUsername = await User.findOne({ username });
      if (existingUsername) {
        username = `${username}${Date.now().toString().slice(-4)}`;
      }

      user = await User.create({
        username,
        email: userEmail || `${appleData.sub}@privaterelay.appleid.com`,
        password: generateRandomPassword(),
        appleId: appleData.sub,
        provider: 'apple',
        emailVerified: true, // Apple verifies emails
        totalKibble: 50, // Welcome bonus
      });
    } else if (!user.appleId) {
      // Link Apple account to existing user
      user.appleId = appleData.sub;
      await user.save();
    }

    res.json({
      _id: user._id,
      username: user.username,
      email: user.email,
      totalKibble: user.totalKibble,
      totalFocusMinutes: user.totalFocusMinutes,
      token: generateToken(user._id),
      isNewUser,
    });
  } catch (error) {
    console.error('Apple auth error:', error.message);
    res.status(401).json({ message: error.message || 'Apple authentication failed' });
  }
});

// @route   POST /auth/forgot-password
// @desc    Request password reset OTP
// @access  Public
router.post('/forgot-password', authLimiter, async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ message: 'Email is required' });
    }

    // Find user
    const user = await User.findOne({ email: email.toLowerCase() });

    if (!user) {
      // Don't reveal if user exists for security - but still return success-like response
      return res.json({
        message: 'If an account exists with this email, a verification code has been sent.',
        // Return a fake userId for security (frontend won't know if user exists)
      });
    }

    // Check if user uses email provider
    if (user.provider !== 'email') {
      return res.status(400).json({
        message: 'This account uses social login. Please use Google or Apple to sign in.',
      });
    }

    // Check rate limiting
    const canResendResult = await VerificationToken.canResend(user._id, 'password');
    
    if (!canResendResult.canResend) {
      return res.status(429).json({
        message: `Too many requests. Please wait before requesting a new code.`,
        waitSeconds: canResendResult.waitSeconds,
      });
    }

    // Generate password reset OTP
    try {
      const otp = await VerificationToken.createOTP(user._id, user.email, 'password');
      await emailService.sendPasswordResetOTPEmail(user, otp);
    } catch (error) {
      if (error.message.includes('Too many requests')) {
        return res.status(429).json({ message: error.message });
      }
      throw error;
    }

    res.json({
      message: 'Verification code sent to your email.',
      userId: user._id,
      email: user.email,
    });
  } catch (error) {
    console.error('Forgot password error:', error.stack || error.message || error);
    res.status(500).json({ message: error.message || 'Server error' });
  }
});

// @route   POST /auth/verify-reset-otp
// @desc    Verify password reset OTP
// @access  Public
router.post('/verify-reset-otp', otpLimiter, async (req, res) => {
  try {
    const { userId, otp } = req.body;

    if (!userId || !otp) {
      return res.status(400).json({ message: 'User ID and OTP are required' });
    }

    // Validate OTP format
    if (!/^\d{6}$/.test(otp)) {
      return res.status(400).json({ message: 'Invalid OTP format. Please enter 6 digits.' });
    }

    // Find user
    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Verify OTP (don't delete it yet - we need it for the password reset step)
    const verificationToken = await VerificationToken.findOne({ userId, type: 'password' });
    
    if (!verificationToken) {
      return res.status(400).json({ message: 'No verification code found. Please request a new one.' });
    }

    // Check if expired
    if (verificationToken.expiresAt < new Date()) {
      await VerificationToken.deleteOne({ _id: verificationToken._id });
      return res.status(400).json({ 
        message: 'Verification code has expired. Please request a new one.',
        expired: true 
      });
    }

    // Check if max attempts exceeded
    if (verificationToken.attempts >= verificationToken.maxAttempts) {
      await VerificationToken.deleteOne({ _id: verificationToken._id });
      return res.status(400).json({ 
        message: 'Too many failed attempts. Please request a new code.',
        maxAttempts: true 
      });
    }

    // Check if OTP matches
    if (verificationToken.otp !== otp) {
      verificationToken.attempts += 1;
      await verificationToken.save();
      
      const remainingAttempts = verificationToken.maxAttempts - verificationToken.attempts;
      return res.status(400).json({
        message: `Invalid code. ${remainingAttempts} attempt${remainingAttempts !== 1 ? 's' : ''} remaining.`,
        remainingAttempts
      });
    }

    // OTP is valid - generate a temporary reset token for the next step
    const resetToken = Math.random().toString(36).slice(-16) + Date.now().toString(36);
    verificationToken.resetToken = resetToken;
    verificationToken.resetTokenExpiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes
    await verificationToken.save();

    res.json({
      message: 'OTP verified successfully',
      resetToken,
      userId: user._id,
    });
  } catch (error) {
    console.error('Verify reset OTP error:', error.message);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   POST /auth/reset-password
// @desc    Reset password with reset token
// @access  Public
router.post('/reset-password', authLimiter, async (req, res) => {
  try {
    const { userId, resetToken, password } = req.body;

    if (!userId || !resetToken || !password) {
      return res.status(400).json({ message: 'All fields are required' });
    }

    if (password.length < 6) {
      return res.status(400).json({ message: 'Password must be at least 6 characters' });
    }

    // Find verification token with reset token
    const verificationToken = await VerificationToken.findOne({ 
      userId, 
      type: 'password',
      resetToken 
    });

    if (!verificationToken) {
      return res.status(400).json({ message: 'Invalid or expired reset token' });
    }

    // Check if reset token expired
    if (verificationToken.resetTokenExpiresAt < new Date()) {
      await VerificationToken.deleteOne({ _id: verificationToken._id });
      return res.status(400).json({ message: 'Reset token has expired. Please start over.' });
    }

    // Find user
    const user = await User.findById(userId).select('+password');

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Update password
    user.password = password;
    await user.save();

    // Delete verification token
    await VerificationToken.deleteOne({ _id: verificationToken._id });

    res.json({
      message: 'Password reset successfully! You can now log in with your new password.',
    });
  } catch (error) {
    console.error('Reset password error:', error.message);
    res.status(500).json({ message: 'Server error during password reset' });
  }
});

// Legacy route for backward compatibility - redirect to OTP verification
router.post('/verify-email/:token', async (req, res) => {
  return res.status(400).json({ 
    message: 'This verification method is no longer supported. Please use OTP verification.',
    useOTP: true 
  });
});

// Legacy route for backward compatibility
router.post('/resend-verification', async (req, res) => {
  const { email } = req.body;
  
  // Redirect to resend-otp
  const user = await User.findOne({ email: email?.toLowerCase() });
  if (user) {
    req.body.userId = user._id;
  }
  
  // Forward to resend-otp handler logic
  try {
    if (!user) {
      return res.json({ message: 'If an account exists, a verification code has been sent.' });
    }

    if (user.emailVerified) {
      return res.json({ message: 'Email is already verified', emailVerified: true });
    }

    const canResendResult = await VerificationToken.canResend(user._id, 'email');
    
    if (!canResendResult.canResend) {
      return res.status(429).json({
        message: 'Too many requests. Please wait before requesting a new code.',
        waitSeconds: canResendResult.waitSeconds,
      });
    }

    const otp = await VerificationToken.createOTP(user._id, user.email, 'email');
    await emailService.sendOTPEmail(user, otp);

    res.json({
      message: 'Verification code sent! Please check your email.',
      userId: user._id,
      requiresVerification: true,
    });
  } catch (error) {
    console.error('Resend verification error:', error.message);
    res.status(500).json({ message: 'Server error' });
  }
});

export default router;
