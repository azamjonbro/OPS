class WhatsappService {
  constructor() {
    this.status = 'READY';
  }

  async sendMessage({ phone, message }) {
    if (!phone || !message) {
      return { success: false, error: 'Phone number and message text are required' };
    }

    try {
      console.log(`📱 WhatsApp Message Sent to [${phone}]: "${message}"`);
      return {
        success: true,
        messageId: `wa-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        phone,
        message,
        sentAt: new Date().toISOString()
      };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }
}

module.exports = new WhatsappService();
