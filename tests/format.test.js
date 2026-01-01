const assert = require('assert');
const { buildRiskBlocks, formatInfractions, getRiskLevel, getRiskLevelEmoji } = require('../lib/riskFormatter');

function runTests() {
  assert.strictEqual(getRiskLevel(50), 'Low');
  assert.strictEqual(getRiskLevel(200), 'Medium');
  assert.strictEqual(getRiskLevel(750), 'Review Required');
  assert.strictEqual(getRiskLevel(1500), 'Fail');

  assert.strictEqual(getRiskLevelEmoji(50), '🟢');
  assert.strictEqual(getRiskLevelEmoji(200), '🟡');
  assert.strictEqual(getRiskLevelEmoji(750), '🟠');
  assert.strictEqual(getRiskLevelEmoji(1500), '🔴');

  const formattedInfractions = formatInfractions([
    { RuleText: 'Rule A', RuleOutput: 'Output A', Points: 10 }
  ]);
  assert.ok(formattedInfractions.includes('Rule A'));

  const sampleData = {
    CompanyName: 'Test Carrier',
    DotNumber: '123456',
    DocketNumber: '654321',
    RiskAssessmentDetails: {
      TotalPoints: 200,
      Authority: {
        TotalPoints: 50,
        Infractions: [{ RuleText: 'Auth Rule', RuleOutput: 'Issue', Points: 25 }]
      },
      Safety: {
        TotalPoints: 150,
        Infractions: []
      }
    },
    IsBlocked: true,
    FreightValidateStatus: 'Review Recommended'
  };

  const { blocks, summaryText } = buildRiskBlocks(sampleData);
  assert.ok(Array.isArray(blocks));
  assert.ok(blocks.length > 0);
  assert.ok(summaryText.includes('Test Carrier'));

  console.log('All format tests passed.');
}

runTests();
