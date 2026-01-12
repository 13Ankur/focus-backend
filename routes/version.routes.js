import express from 'express';
import AppVersion from '../models/AppVersion.js';
import { protect } from '../middleware/auth.middleware.js';

const router = express.Router();

// @route   GET /version/check
// @desc    Check if app update is required
// @access  Public
router.get('/check', async (req, res) => {
  try {
    const { platform, version } = req.query;

    // Validate required parameters
    if (!platform || !version) {
      return res.status(400).json({
        message: 'Platform and version are required',
        updateRequired: false,
        forceUpdate: false,
      });
    }

    // Validate platform
    if (!['ios', 'android'].includes(platform.toLowerCase())) {
      return res.status(400).json({
        message: 'Invalid platform. Must be ios or android',
        updateRequired: false,
        forceUpdate: false,
      });
    }

    // Validate version format (basic semantic versioning check)
    if (!/^\d+\.\d+(\.\d+)?$/.test(version)) {
      return res.status(400).json({
        message: 'Invalid version format. Use semantic versioning (e.g., 1.0.0)',
        updateRequired: false,
        forceUpdate: false,
      });
    }

    // Check version against database
    const result = await AppVersion.checkVersion(platform.toLowerCase(), version);

    res.json(result);
  } catch (error) {
    console.error('Version check error:', error);
    // On error, allow app to run (fail open)
    res.json({
      updateRequired: false,
      forceUpdate: false,
      isMaintenanceMode: false,
      error: 'Version check failed',
    });
  }
});

// @route   GET /version/config/:platform
// @desc    Get version config for a platform (admin use)
// @access  Protected
router.get('/config/:platform', protect, async (req, res) => {
  try {
    const { platform } = req.params;

    if (!['ios', 'android'].includes(platform.toLowerCase())) {
      return res.status(400).json({ message: 'Invalid platform' });
    }

    const config = await AppVersion.findOne({ platform: platform.toLowerCase() });

    if (!config) {
      return res.status(404).json({ message: 'Version config not found for this platform' });
    }

    res.json(config);
  } catch (error) {
    console.error('Get version config error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   POST /version/config
// @desc    Create or update version config (admin use)
// @access  Protected
router.post('/config', protect, async (req, res) => {
  try {
    const {
      platform,
      currentVersion,
      minimumVersion,
      storeUrl,
      releaseNotes,
      isMaintenanceMode,
      maintenanceMessage,
      forceUpdate,
    } = req.body;

    // Validate required fields
    if (!platform || !currentVersion || !minimumVersion || !storeUrl) {
      return res.status(400).json({
        message: 'Platform, currentVersion, minimumVersion, and storeUrl are required',
      });
    }

    // Validate platform
    if (!['ios', 'android'].includes(platform.toLowerCase())) {
      return res.status(400).json({ message: 'Invalid platform' });
    }

    // Validate versions
    if (!/^\d+\.\d+(\.\d+)?$/.test(currentVersion) || !/^\d+\.\d+(\.\d+)?$/.test(minimumVersion)) {
      return res.status(400).json({ message: 'Invalid version format' });
    }

    // Ensure minimumVersion <= currentVersion
    const comparison = AppVersion.compareVersions(minimumVersion, currentVersion);
    if (comparison > 0) {
      return res.status(400).json({
        message: 'Minimum version cannot be greater than current version',
      });
    }

    // Upsert the config
    const config = await AppVersion.findOneAndUpdate(
      { platform: platform.toLowerCase() },
      {
        platform: platform.toLowerCase(),
        currentVersion,
        minimumVersion,
        storeUrl,
        releaseNotes: releaseNotes || '',
        isMaintenanceMode: isMaintenanceMode || false,
        maintenanceMessage: maintenanceMessage || 'We are currently performing maintenance. Please try again later.',
        forceUpdate: forceUpdate || false,
      },
      { upsert: true, new: true, runValidators: true }
    );

    res.json({
      message: 'Version config updated successfully',
      config,
    });
  } catch (error) {
    console.error('Update version config error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   POST /version/init
// @desc    Initialize default version configs (one-time setup)
// @access  Public (should be protected in production)
router.post('/init', async (req, res) => {
  try {
    // Check if configs already exist
    const existingIos = await AppVersion.findOne({ platform: 'ios' });
    const existingAndroid = await AppVersion.findOne({ platform: 'android' });

    const results = [];

    if (!existingIos) {
      const iosConfig = await AppVersion.create({
        platform: 'ios',
        currentVersion: '1.0.0',
        minimumVersion: '1.0.0',
        storeUrl: 'https://apps.apple.com/app/paws-focus/id123456789',
        releaseNotes: 'Initial release of Paws Focus!',
        isMaintenanceMode: false,
        forceUpdate: false,
      });
      results.push({ platform: 'ios', status: 'created', config: iosConfig });
    } else {
      results.push({ platform: 'ios', status: 'exists', config: existingIos });
    }

    if (!existingAndroid) {
      const androidConfig = await AppVersion.create({
        platform: 'android',
        currentVersion: '1.0.0',
        minimumVersion: '1.0.0',
        storeUrl: 'https://play.google.com/store/apps/details?id=com.focusapp.buddy',
        releaseNotes: 'Initial release of Paws Focus!',
        isMaintenanceMode: false,
        forceUpdate: false,
      });
      results.push({ platform: 'android', status: 'created', config: androidConfig });
    } else {
      results.push({ platform: 'android', status: 'exists', config: existingAndroid });
    }

    res.json({
      message: 'Version configs initialized',
      results,
    });
  } catch (error) {
    console.error('Init version config error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

export default router;
