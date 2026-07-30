/**
 * Intent Classifier Service for Store Hadiya AI Executive Assistant V2
 * Classifies user prompts into actionable intent categories.
 */

class IntentClassifier {
  classify(userMessage = '') {
    const text = userMessage.toLowerCase().trim();

    if (text.includes('savdo') || text.includes('tushum') || text.includes('sales') || text.includes('kassa') || text.includes('hisob')) {
      return 'sales';
    }
    if (text.includes('ombor') || text.includes('mahsulot') || text.includes('inventory') || text.includes('stock') || text.includes('tovar')) {
      return 'inventory';
    }
    if (text.includes('notion') || text.includes('sahifa') || text.includes('dokument') || text.includes('page') || text.includes('doc')) {
      return 'documentation';
    }
    if (text.includes('meeting') || text.includes('uchrashuv') || text.includes('kalendar') || text.includes('calendar') || text.includes('reja')) {
      return 'calendar';
    }
    if (text.includes('telegram') || text.includes('xabar yubor') || text.includes('send message')) {
      return 'automation';
    }
    if (text.includes('loyiha') || text.includes('project') || text.includes('roadmap') || text.includes('swisswatch') || text.includes('hadiya')) {
      return 'project';
    }
    if (text.includes('kod') || text.includes('code') || text.includes('function') || text.includes('api') || text.includes('bug') || text.includes('fix')) {
      return 'coding';
    }
    if (text.includes('mening') || text.includes('kimman') || text.includes('shaxsiy') || text.includes('esla') || text.includes('remember')) {
      return 'personal';
    }

    return 'general_chat';
  }
}

module.exports = new IntentClassifier();
