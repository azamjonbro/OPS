const notionCrudService = require('./notionCrudService');
const emailService = require('./emailService');
const billzClientService = require('./billzClientService');

class AutomationEngine {
  async executeMeetingAutomationPipeline({ title, startTime, recipientEmail, telegramChannel }) {
    console.log(`⚡ Executing Multi-Step Automation Pipeline for: "${title}"`);
    const steps = [];

    // Step 1: Create Notion Meeting Note
    const notionRes = await notionCrudService.createPage({
      title: `Meeting Note: ${title}`,
      contentBlocks: [`Meeting Scheduled at ${startTime}`, 'Agenda: Weekly Business Review']
    });
    steps.push({ step: 'NOTION_CREATE_NOTE', status: notionRes.success ? 'SUCCESS' : 'FAILED', details: notionRes });

    // Step 2: Send Email Reminder (if email provided)
    if (recipientEmail) {
      const emailRes = await emailService.sendEmail({
        to: recipientEmail,
        subject: `Executive Meeting Scheduled: ${title}`,
        body: `Meeting "${title}" is scheduled for ${startTime}. Agenda notes created in Notion.`
      });
      steps.push({ step: 'EMAIL_REMINDER', status: emailRes.success ? 'SUCCESS' : 'FAILED', details: emailRes });
    }

    return {
      success: true,
      pipeline: 'EXECUTIVE_MEETING_PIPELINE',
      executedAt: new Date().toISOString(),
      steps
    };
  }
}

module.exports = new AutomationEngine();
