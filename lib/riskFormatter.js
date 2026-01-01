function normalizePoints(points) {
  if (typeof points !== 'number') {
    return 0;
  }
  return points;
}

function getRiskLevelEmoji(points) {
  const value = normalizePoints(points);
  if (value <= 124) {
    return '🟢';
  }
  if (value <= 249) {
    return '🟡';
  }
  if (value <= 999) {
    return '🟠';
  }
  return '🔴';
}

function getRiskLevel(points) {
  const value = normalizePoints(points);
  if (value <= 124) {
    return 'Low';
  }
  if (value <= 249) {
    return 'Medium';
  }
  if (value <= 999) {
    return 'Review Required';
  }
  return 'Fail';
}

function formatInfractions(infractions) {
  if (!Array.isArray(infractions) || infractions.length === 0) {
    return 'No infractions found.';
  }
  return infractions
    .map(infraction => `- ${infraction.RuleText}: ${infraction.RuleOutput} (${infraction.Points} points)`) 
    .join('\n');
}

function buildRiskBlocks(data) {
  if (!data) {
    throw new Error('Carrier data is required to build Slack blocks.');
  }

  const headerText = `${data.CompanyName || 'N/A'} (DOT: ${data.DotNumber || 'N/A'} / MC: ${data.DocketNumber || 'N/A'})`;
  const totalPoints = normalizePoints(data.RiskAssessmentDetails?.TotalPoints);
  const blocks = [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: 'MyCarrierPortal Risk Assessment',
        emoji: true
      }
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*${headerText}*`
      }
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Overall assessment:* ${getRiskLevelEmoji(totalPoints)} ${getRiskLevel(totalPoints)}`
      }
    },
    {
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: `Total Points: ${totalPoints}`
        }
      ]
    },
    {
      type: 'divider'
    }
  ];

  const categories = ['Authority', 'Insurance', 'Operation', 'Safety', 'Other'];
  categories.forEach(category => {
    const categoryData = data.RiskAssessmentDetails?.[category];
    if (categoryData) {
      const categoryPoints = normalizePoints(categoryData.TotalPoints);
      blocks.push(
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*${category}:* ${getRiskLevelEmoji(categoryPoints)} ${getRiskLevel(categoryPoints)}`
          }
        },
        {
          type: 'context',
          elements: [
            {
              type: 'mrkdwn',
              text: `Risk Level: ${getRiskLevel(categoryPoints)} | Points: ${categoryPoints}\nInfractions:\n${formatInfractions(categoryData.Infractions)}`
            }
          ]
        }
      );
    }
  });

  const mcpData = {
    TotalPoints: (data.IsBlocked ? 1000 : 0) + (data.FreightValidateStatus === 'Review Recommended' ? 1000 : 0),
    Infractions: []
  };

  if (data.IsBlocked) {
    mcpData.Infractions.push({
      Points: 1000,
      RiskLevel: 'Review Required',
      RuleText: 'MyCarrierProtect: Blocked',
      RuleOutput: 'Carrier blocked by 3 or more companies'
    });
  }

  if (data.FreightValidateStatus === 'Review Recommended') {
    mcpData.Infractions.push({
      Points: 1000,
      RiskLevel: 'Review Required',
      RuleText: 'FreightValidate Status',
      RuleOutput: 'Carrier has a FreightValidate Review Recommended status'
    });
  }

  if (mcpData.TotalPoints > 0) {
    blocks.push(
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*MyCarrierProtect:* ${getRiskLevelEmoji(mcpData.TotalPoints)} ${getRiskLevel(mcpData.TotalPoints)}`
        }
      },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `Risk Level: ${getRiskLevel(mcpData.TotalPoints)} | Points: ${mcpData.TotalPoints}\nInfractions:\n${formatInfractions(mcpData.Infractions)}`
          }
        ]
      },
      {
        type: 'divider'
      }
    );
  }

  const summaryText = `Risk assessment for ${data.CompanyName || 'carrier'} (MC ${data.DocketNumber || 'N/A'}). Overall: ${getRiskLevel(totalPoints)}.`;

  return { blocks, summaryText };
}

module.exports = {
  buildRiskBlocks,
  formatInfractions,
  getRiskLevel,
  getRiskLevelEmoji
};
