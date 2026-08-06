/**
 * Simple natural language reminder parser.
 * Extracts task description and duration from user prompts.
 */
function parseReminder(text) {
  const lower = text.toLowerCase();
  if (!lower.includes('remind') && !lower.includes('timer') && !lower.includes('alert')) {
    return null;
  }

  let durationMs = 0;
  let label = '';
  let relativeUsed = false;

  // 1. Check relative durations (e.g. in 5 minutes, in 2 hours, in 3 days, in 1 week)
  const relativeRegex = /(?:in|after|within|with\s+in)\s+(\d+)\s*(sec|second|minute|minut|min|hour|hr|day|week)s?/i;
  const relativeMatch = text.match(relativeRegex);

  if (relativeMatch) {
    relativeUsed = true;
    const amount = parseInt(relativeMatch[1], 10);
    const unit = relativeMatch[2].toLowerCase();

    if (unit.startsWith('sec')) {
      durationMs = amount * 1000;
      label = `${amount} second${amount > 1 ? 's' : ''}`;
    } else if (unit.startsWith('min') || unit.startsWith('minut')) {
      durationMs = amount * 60 * 1000;
      label = `${amount} minute${amount > 1 ? 's' : ''}`;
    } else if (unit.startsWith('hour') || unit.startsWith('hr')) {
      durationMs = amount * 60 * 60 * 1000;
      label = `${amount} hour${amount > 1 ? 's' : ''}`;
    } else if (unit.startsWith('day')) {
      durationMs = amount * 24 * 60 * 60 * 1000;
      label = `${amount} day${amount > 1 ? 's' : ''}`;
    } else if (unit.startsWith('week')) {
      durationMs = amount * 7 * 24 * 60 * 60 * 1000;
      label = `${amount} week${amount > 1 ? 's' : ''}`;
    }
  }

  // 2. Check "tomorrow" relative day
  if (!durationMs && lower.includes('tomorrow')) {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    const atTimeRegex = /at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i;
    const atMatch = text.match(atTimeRegex);
    
    if (atMatch) {
      let hours = parseInt(atMatch[1], 10);
      const minutes = atMatch[2] ? parseInt(atMatch[2], 10) : 0;
      const ampm = atMatch[3] ? atMatch[3].toLowerCase() : null;
      
      if (ampm === 'pm' && hours < 12) hours += 12;
      if (ampm === 'am' && hours === 12) hours = 0;
      
      tomorrow.setHours(hours, minutes, 0, 0);
    }
    
    durationMs = tomorrow.getTime() - Date.now();
    label = `tomorrow at ${tomorrow.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  }

  // 3. Check absolute time today (e.g. at 5 PM, at 15:30)
  if (!durationMs) {
    const atTimeRegex = /at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i;
    const atMatch = text.match(atTimeRegex);
    
    if (atMatch) {
      let hours = parseInt(atMatch[1], 10);
      const minutes = atMatch[2] ? parseInt(atMatch[2], 10) : 0;
      const ampm = atMatch[3] ? atMatch[3].toLowerCase() : null;
      
      if (ampm === 'pm' && hours < 12) hours += 12;
      if (ampm === 'am' && hours === 12) hours = 0;
      
      const targetTime = new Date();
      targetTime.setHours(hours, minutes, 0, 0);
      
      if (targetTime.getTime() <= Date.now()) {
        targetTime.setDate(targetTime.getDate() + 1);
        label = `tomorrow at ${targetTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
      } else {
        label = `today at ${targetTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
      }
      
      durationMs = targetTime.getTime() - Date.now();
    }
  }

  if (durationMs <= 0) return null;

  // Clean task text
  let task = text;
  if (relativeUsed) task = task.replace(relativeRegex, '');
  task = task
    .replace(/tomorrow/i, '')
    .replace(/at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i, '')
    .replace(/remind me/i, '')
    .replace(/to/i, '')
    .replace(/notify/i, '')
    .replace(/in whatsapp/ig, '')
    .trim();

  // Strip leading/trailing fillers and punctuation
  task = task.replace(/^(?:about|to|in|for|that|and)\s+/i, '').trim();
  task = task.replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, "").trim();

  if (!task) {
    task = 'Reminder Alert!';
  }

  return {
    task,
    durationMs,
    label
  };
}

module.exports = { parseReminder };
