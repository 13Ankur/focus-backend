import jwt from 'jsonwebtoken';
import User from '../models/User.js';

const protect = async (req, res, next) => {
  let token;

  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith('Bearer')
  ) {
    try {
      // Get token from header
      token = req.headers.authorization.split(' ')[1];

      // Verify token
      const decoded = jwt.verify(token, process.env.JWT_SECRET);

      // Get user from token (exclude password)
      req.user = await User.findById(decoded.id);

      if (!req.user) {
        return res.status(401).json({ message: 'User not found' });
      }

      next();
    } catch (error) {
      console.error('Auth middleware error:', error.message);
      return res.status(401).json({ message: 'Not authorized, token failed' });
    }
  }

  if (!token) {
    return res.status(401).json({ message: 'Not authorized, no token' });
  }
};

// Middleware to check if email is verified
const requireEmailVerification = async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ message: 'Not authorized' });
    }

    // Social login users are auto-verified
    if (req.user.provider !== 'email') {
      return next();
    }

    // Check if email is verified for email provider users
    if (!req.user.emailVerified) {
      return res.status(403).json({
        message: 'Please verify your email before accessing this resource',
        emailVerified: false,
        email: req.user.email,
      });
    }

    next();
  } catch (error) {
    console.error('Email verification middleware error:', error.message);
    return res.status(500).json({ message: 'Server error' });
  }
};

export { protect, requireEmailVerification };
export default protect;
