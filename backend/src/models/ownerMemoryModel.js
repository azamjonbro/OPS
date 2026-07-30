const mongoose = require('mongoose');

const ownerMemorySchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true, index: true },
  category: { 
    type: String, 
    enum: ['owner', 'business', 'project', 'preference', 'architecture', 'workflow', 'documentation'], 
    default: 'owner' 
  },
  title: { type: String, required: true },
  content: { type: String, required: true },
  metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  updatedAt: { type: Date, default: Date.now }
}, { timestamps: true });

const OwnerMemory = mongoose.model('OwnerMemory', ownerMemorySchema);

module.exports = OwnerMemory;
