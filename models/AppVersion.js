import mongoose from 'mongoose';

const appVersionSchema = new mongoose.Schema(
  {
    platform: {
      type: String,
      enum: ['ios', 'android'],
      required: true,
      unique: true,
    },
    currentVersion: {
      type: String,
      required: true,
      // Semantic versioning: major.minor.patch (e.g., "1.0.0")
    },
    minimumVersion: {
      type: String,
      required: true,
      // Minimum version required - forces update if user version is below this
    },
    storeUrl: {
      type: String,
      required: true,
      // App Store or Play Store URL
    },
    releaseNotes: {
      type: String,
      default: '',
      // Optional release notes to show in update popup
    },
    isMaintenanceMode: {
      type: Boolean,
      default: false,
      // If true, show maintenance message instead of app
    },
    maintenanceMessage: {
      type: String,
      default: 'We are currently performing maintenance. Please try again later.',
    },
    forceUpdate: {
      type: Boolean,
      default: false,
      // If true, user must update (can't skip)
    },
  },
  {
    timestamps: true,
  }
);

// Helper method to compare versions
appVersionSchema.statics.compareVersions = function(v1, v2) {
  // Returns: 1 if v1 > v2, -1 if v1 < v2, 0 if equal
  const parts1 = v1.split('.').map(Number);
  const parts2 = v2.split('.').map(Number);
  
  for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
    const p1 = parts1[i] || 0;
    const p2 = parts2[i] || 0;
    
    if (p1 > p2) return 1;
    if (p1 < p2) return -1;
  }
  
  return 0;
};

// Check if update is required
appVersionSchema.statics.checkVersion = async function(platform, userVersion) {
  const config = await this.findOne({ platform });
  
  if (!config) {
    // No config found - allow app to run
    return {
      updateRequired: false,
      forceUpdate: false,
      isMaintenanceMode: false,
    };
  }
  
  // Check maintenance mode first
  if (config.isMaintenanceMode) {
    return {
      updateRequired: false,
      forceUpdate: false,
      isMaintenanceMode: true,
      maintenanceMessage: config.maintenanceMessage,
    };
  }
  
  const compareWithCurrent = this.compareVersions(userVersion, config.currentVersion);
  const compareWithMinimum = this.compareVersions(userVersion, config.minimumVersion);
  
  // User version is below minimum - force update required
  if (compareWithMinimum < 0) {
    return {
      updateRequired: true,
      forceUpdate: true,
      currentVersion: config.currentVersion,
      storeUrl: config.storeUrl,
      releaseNotes: config.releaseNotes,
      isMaintenanceMode: false,
    };
  }
  
  // User version is below current but above minimum - optional update
  if (compareWithCurrent < 0) {
    return {
      updateRequired: true,
      forceUpdate: config.forceUpdate, // Can be overridden by admin
      currentVersion: config.currentVersion,
      storeUrl: config.storeUrl,
      releaseNotes: config.releaseNotes,
      isMaintenanceMode: false,
    };
  }
  
  // User version is up to date
  return {
    updateRequired: false,
    forceUpdate: false,
    isMaintenanceMode: false,
  };
};

const AppVersion = mongoose.model('AppVersion', appVersionSchema);

export default AppVersion;
