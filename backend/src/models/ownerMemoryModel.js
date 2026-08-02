const mongoose = require('mongoose');

const ownerMemorySchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true, index: true },
  category: { 
    type: String, 
    default: 'knowledge' 
  },
  title: { type: String, required: true },
  description: { type: String, default: '' },
  content: { type: String, required: true },
  tags: [{ type: String }],
  priority: { type: String, default: 'Normal' },
  metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  updatedAt: { type: Date, default: Date.now }
}, { timestamps: true });

const OwnerMemory = mongoose.model('OwnerMemory', ownerMemorySchema);

module.exports = OwnerMemory;
