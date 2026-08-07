const Task = require('../models/Task');

const NOTION_API = 'https://api.notion.com/v1';

function getDbId() {
  return (process.env.NOTION_TASKS_DATABASE_ID || '').trim();
}

function getToken() {
  return (process.env.NOTION_API_KEY || '').trim();
}

function notionHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    'Notion-Version': '2022-06-28',
    'Content-Type': 'application/json'
  };
}

/** Builds the Notion page `properties` object mirroring one Task (Todo/Doing/Done board). */
function buildProperties(task) {
  return {
    Title: { title: [{ text: { content: task.title || 'Untitled' } }] },
    Date: { date: { start: task.dayKey } },
    Priority: { select: { name: task.priority || 'Medium' } },
    Status: { select: { name: task.status || 'Todo' } },
    // Stamped true immediately — this is what stops the row this service itself just
    // created from being picked up again by pollForNewNotionTasks() below.
    Synced: { checkbox: true },
    'App Task ID': { rich_text: [{ text: { content: String(task._id) } }] }
  };
}

/** Mirrors a newly-created Task into Notion. Returns the new page id, or null. */
async function createNotionRowForTask(task) {
  const dbId = getDbId();
  const token = getToken();
  if (!dbId || !token) return null;

  try {
    const res = await fetch(`${NOTION_API}/pages`, {
      method: 'POST',
      headers: notionHeaders(token),
      body: JSON.stringify({ parent: { database_id: dbId }, properties: buildProperties(task) })
    });
    if (!res.ok) {
      console.error('Notion task row create failed:', await res.text());
      return null;
    }
    const data = await res.json();
    return data.id;
  } catch (err) {
    console.error('Notion task row create error:', err.message);
    return null;
  }
}

async function updateNotionRowForTask(task) {
  const token = getToken();
  if (!token || !task.notionPageId) return false;

  try {
    const res = await fetch(`${NOTION_API}/pages/${task.notionPageId}`, {
      method: 'PATCH',
      headers: notionHeaders(token),
      body: JSON.stringify({ properties: buildProperties(task) })
    });
    return res.ok;
  } catch (err) {
    console.error('Notion task row update error:', err.message);
    return false;
  }
}

async function archiveNotionRowForTask(task) {
  const token = getToken();
  if (!token || !task.notionPageId) return false;

  try {
    const res = await fetch(`${NOTION_API}/pages/${task.notionPageId}`, {
      method: 'PATCH',
      headers: notionHeaders(token),
      body: JSON.stringify({ archived: true })
    });
    return res.ok;
  } catch (err) {
    console.error('Notion task row archive error:', err.message);
    return false;
  }
}

function selectValue(prop) {
  return prop && prop.select ? prop.select.name : null;
}

/** Pulls a YYYY-MM-DD day key out of a Notion date property's `start`. */
function parseNotionDayKey(dateProp) {
  const start = dateProp && dateProp.date && dateProp.date.start;
  if (!start) return new Date().toISOString().split('T')[0];
  return start.slice(0, 10);
}

const TASK_STATUSES = ['Todo', 'Doing', 'Done'];
const TASK_PRIORITIES = ['Low', 'Medium', 'High', 'Urgent'];

/**
 * Finds rows added or edited directly in Notion (Synced = false) and mirrors each into a
 * new Task card on the Todo/Doing/Done board. Rows this service creates itself are
 * stamped Synced:true on write, so they never come back through here — no separate
 * loop-prevention bookkeeping needed.
 */
async function pollForNewNotionTasks() {
  const dbId = getDbId();
  const token = getToken();
  if (!dbId || !token) return { synced: 0 };

  try {
    const res = await fetch(`${NOTION_API}/databases/${dbId}/query`, {
      method: 'POST',
      headers: notionHeaders(token),
      body: JSON.stringify({
        filter: { property: 'Synced', checkbox: { equals: false } },
        page_size: 25
      })
    });
    if (!res.ok) {
      console.error('Notion task poll failed:', await res.text());
      return { synced: 0 };
    }

    const data = await res.json();
    const rows = data.results || [];
    let synced = 0;

    for (const row of rows) {
      const props = row.properties || {};
      const titleParts = (props.Title && props.Title.title) || [];
      const title = titleParts.map((t) => t.plain_text).join('').trim() || 'Notion Vazifa';
      const dayKey = parseNotionDayKey(props.Date);
      const status = TASK_STATUSES.includes(selectValue(props.Status)) ? selectValue(props.Status) : 'Todo';
      const priority = TASK_PRIORITIES.includes(selectValue(props.Priority)) ? selectValue(props.Priority) : 'Medium';

      let task;
      try {
        // Append to the bottom of its column, same rule taskController.createTask uses.
        const last = await Task.findOne({ dayKey, status, archived: false }).sort({ order: -1 }).select('order').lean();
        task = await Task.create({
          title,
          description: 'Notion "Calendar Tasks" bazasidan sinxronlandi',
          dayKey,
          status,
          priority,
          completedAt: status === 'Done' ? new Date() : null,
          order: last ? last.order + 1 : 0,
          source: 'Notion Sync',
          notionPageId: row.id
        });
      } catch (err) {
        console.error('Notion → Task create error:', err.message);
        continue;
      }

      await fetch(`${NOTION_API}/pages/${row.id}`, {
        method: 'PATCH',
        headers: notionHeaders(token),
        body: JSON.stringify({
          properties: {
            Synced: { checkbox: true },
            'App Task ID': { rich_text: [{ text: { content: task._id.toString() } }] }
          }
        })
      }).catch(() => {});

      synced++;
    }

    if (synced) console.log(`✅ Notion → To Do: ${synced} ta yangi vazifa sinxronlandi`);
    return { synced };
  } catch (err) {
    console.error('Notion task poll error:', err.message);
    return { synced: 0 };
  }
}

let pollInterval = null;

function startBackgroundSync() {
  if (!getDbId()) {
    console.log("ℹ️ NOTION_TASKS_DATABASE_ID sozlanmagan — Notion ↔ Vazifalar taxtasi sinxronizatsiyasi o'chirilgan.");
    return;
  }

  setTimeout(() => {
    pollForNewNotionTasks().catch((err) => console.error('Initial Notion task poll error:', err.message));
  }, 8000);

  if (pollInterval) clearInterval(pollInterval);
  pollInterval = setInterval(() => {
    pollForNewNotionTasks().catch((err) => console.error('Notion task poll error:', err.message));
  }, 3 * 60 * 1000);

  console.log('⏰ Notion ↔ Vazifalar Taxtasi (To Do/Doing/Done) Sync Scheduled (Every 3 Minutes)');
}

module.exports = {
  createNotionRowForTask,
  updateNotionRowForTask,
  archiveNotionRowForTask,
  pollForNewNotionTasks,
  startBackgroundSync
};
