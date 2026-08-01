const aiEngine = require('./aiEngine');

async function runSystemTest() {
  console.log('==================================================');
  console.log('🧪 RUNNING AI ENGINE REAL-TIME END-TO-END TEST');
  console.log('==================================================\n');

  console.log('--- TEST 1: User Product Search Inquiry ---');
  const res1 = await aiEngine.processUserMessage('Hadiya do\'konida Rolex soati bormi va narxi qancha?');
  console.log('AI Response 1:\n', res1.responseText);
  console.log('Executed Tools:', res1.executedTools);

  console.log('\n--- TEST 2: User POS Sales Inquiry ---');
  const res2 = await aiEngine.processUserMessage('Bugungi Billz savdosini chiqar');
  console.log('AI Response 2:\n', res2.responseText);
  console.log('Executed Tools:', res2.executedTools);

  console.log('\n--- TEST 3: User Automated Schedule Intent ---');
  const res3 = await aiEngine.processUserMessage('Har kuni soat 19:00 da Billz savdosini telegramga yuborib tur');
  console.log('AI Response 3:\n', res3.responseText);
  console.log('Registered Schedule:', res3.executedTools.find(t => t.tool === 'scheduler_create_automation'));

  console.log('\n==================================================');
  console.log('✅ ALL TESTS EXECUTED SUCCESSFULLY!');
  console.log('==================================================');
}

runSystemTest();
