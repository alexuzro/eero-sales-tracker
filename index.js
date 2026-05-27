const functions = require('firebase-functions');
const admin = require('firebase-admin');

admin.initializeApp();

/**
 * Scheduled function: Sends weekly push notification reminders
 * Runs every Wednesday at 10:00 AM Eastern Time
 */
exports.sendWeeklyReminder = functions.pubsub
  .schedule('every wednesday 10:00')
  .timeZone('America/New_York')
  .onRun(async (context) => {
    const messages = [
      "Don't forget to log your eero sales this week! 🏆",
      "Hey! Have you sold any eeros this week? Log them now! 📊",
      "Quick reminder: log your eero sales to stay on the leaderboard! 🚀",
      "Time to update your sales! Keep that streak going! 💪",
      "Your team is counting on you — log those eero sales! 🎯"
    ];

    const message = messages[Math.floor(Math.random() * messages.length)];

    // Get all push tokens from the database
    const tokensSnapshot = await admin.database().ref('push_tokens').once('value');
    const tokensData = tokensSnapshot.val();

    if (!tokensData) {
      console.log('No push tokens found');
      return null;
    }

    const tokens = Object.values(tokensData).map(entry => entry.token);
    console.log(`Sending push to ${tokens.length} devices`);

    // Send to all devices
    const payload = {
      notification: {
        title: '📋 eero Sales Reminder',
        body: message
      },
      data: {
        title: '📋 eero Sales Reminder',
        body: message,
        url: './'
      }
    };

    // Send in batches (FCM limit is 500 per batch)
    const batchSize = 500;
    const invalidTokens = [];

    for (let i = 0; i < tokens.length; i += batchSize) {
      const batch = tokens.slice(i, i + batchSize);
      const response = await admin.messaging().sendEachForMulticast({
        tokens: batch,
        notification: payload.notification,
        data: payload.data
      });

      // Track failed tokens for cleanup
      response.responses.forEach((resp, idx) => {
        if (!resp.success) {
          const errorCode = resp.error?.code;
          if (errorCode === 'messaging/invalid-registration-token' ||
              errorCode === 'messaging/registration-token-not-registered') {
            invalidTokens.push(batch[idx]);
          }
        }
      });
    }

    // Clean up invalid tokens
    if (invalidTokens.length > 0) {
      console.log(`Removing ${invalidTokens.length} invalid tokens`);
      const allTokens = Object.entries(tokensData);
      for (const [key, entry] of allTokens) {
        if (invalidTokens.includes(entry.token)) {
          await admin.database().ref(`push_tokens/${key}`).remove();
        }
      }
    }

    console.log('Weekly reminder sent successfully');
    return null;
  });

/**
 * Optional: Send a push when someone completes the monthly challenge
 * Triggers when a new sale is written to the database
 */
exports.checkChallengeOnSale = functions.database
  .ref('/sales/{saleId}')
  .onCreate(async (snapshot, context) => {
    const sale = snapshot.val();
    
    // Monthly challenge goals
    const challenges = {
      "Jan_2026": { goal: 6, reward: "drink of choice (Starbucks, Dunkin Donuts, etc.)" },
      "Feb_2026": { goal: 5, reward: "drink of choice (Starbucks, Dunkin, etc.)" },
      "Mar_2026": { goal: 9, reward: "lunch of choice (up to $15)" },
      "Apr_2026": { goal: 8, reward: "lunch of choice (up to $20)" },
      "May_2026": { goal: 9, reward: "drink of choice (Starbucks, Dunkin, etc.)" },
      "Jun_2026": { goal: 8, reward: "eero Swag bag" },
      "Jul_2026": { goal: 7, reward: "lunch of choice (up to $20)" },
      "Aug_2026": { goal: 10, reward: "drink of choice (Starbucks, Dunkin, etc.)" },
      "Sep_2026": { goal: 9, reward: "lunch of choice (up to $15)" },
      "Oct_2026": { goal: 8, reward: "drink of choice (Starbucks, Dunkin, etc.)" },
      "Nov_2026": { goal: 12, reward: "lunch of choice (up to $25)" },
      "Dec_2026": { goal: 15, reward: "lunch of choice (up to $20)" }
    };

    const challenge = challenges[sale.month];
    if (!challenge) return null;

    // Count this person's sales for the month
    const salesSnapshot = await admin.database().ref('sales')
      .orderByChild('month')
      .equalTo(sale.month)
      .once('value');

    const allSales = salesSnapshot.val();
    if (!allSales) return null;

    const personSales = Object.values(allSales).filter(s => s.name === sale.name);

    // Only notify when they exactly hit the goal (not every sale after)
    if (personSales.length !== challenge.goal) return null;

    // Send notification to all subscribers
    const tokensSnapshot = await admin.database().ref('push_tokens').once('value');
    const tokensData = tokensSnapshot.val();
    if (!tokensData) return null;

    const tokens = Object.values(tokensData).map(entry => entry.token);

    const payload = {
      notification: {
        title: '🏆 Challenge Complete!',
        body: `${sale.name} hit ${challenge.goal} units and wins ${challenge.reward}!`
      },
      data: {
        title: '🏆 Challenge Complete!',
        body: `${sale.name} hit ${challenge.goal} units and wins ${challenge.reward}!`
      }
    };

    await admin.messaging().sendEachForMulticast({
      tokens: tokens,
      notification: payload.notification,
      data: payload.data
    });

    console.log(`Challenge notification sent: ${sale.name} hit ${challenge.goal} units`);
    return null;
  });
