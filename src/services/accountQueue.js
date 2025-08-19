// נשמור מצב לכל חשבון
const states = new Map(); // accountId -> { queue: [], running: false }

// הוספת עבודה לתור של חשבון מסוים
export function enqueueByAccount(accountId, task /* פונקציה async */) {
  let state = states.get(accountId);
  if (!state) {
    state = { queue: [], running: false };
    states.set(accountId, state);
  }

  // מוסיפים משימה לתור
  state.queue.push(task);
  console.log(`📥 Enqueued job for account ${accountId}. Queue size: ${state.queue.length}`);

  // אם אין ריצה כרגע לחשבון הזה – נתחיל להריץ
  if (!state.running) {
    runNext(accountId, state);
  }
}

async function runNext(accountId, state) {
  state.running = true;

  while (state.queue.length > 0) {
    const job = state.queue.shift();
    try {
      console.log(`▶️ Running job for account ${accountId}. Remaining: ${state.queue.length}`);
      await job(); // מריץ משימה בטור
      console.log(`✅ Finished job for account ${accountId}. Remaining: ${state.queue.length}`);
    } catch (err) {
      console.error(`❌ Job failed for account ${accountId}:`, err);
      // גם אם נכשל, נמשיך הלאה למשימה הבאה
    }
  }

  state.running = false;
  states.delete(accountId); // ניקוי זיכרון כשהתור ריק
  console.log(`🏁 Queue finished for account ${accountId}`);
}
