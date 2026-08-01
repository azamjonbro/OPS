const fetch = globalThis.fetch || require('node-fetch');

class NotionCrudService {
  constructor() {
    this.baseUrl = 'https://api.notion.com/v1';
    this.apiVersion = '2022-06-28';
  }

  getToken() {
    return process.env.NOTION_API_KEY || '';
  }

  getHeaders() {
    return {
      'Authorization': `Bearer ${this.getToken()}`,
      'Notion-Version': this.apiVersion,
      'Content-Type': 'application/json'
    };
  }

  // 1. Workspace Search
  async searchWorkspace(query = '', pageSize = 10) {
    const token = this.getToken();
    if (!token) return { success: false, error: 'NOTION_API_KEY is not configured in .env.dev' };

    try {
      const res = await fetch(`${this.baseUrl}/search`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({ query, page_size: pageSize })
      });
      const data = await res.json();
      if (!res.ok) return { success: false, error: data.message || 'Notion search failed' };

      const pages = (data.results || []).map(p => ({
        id: p.id,
        object: p.object,
        title: p.properties?.title?.title?.[0]?.plain_text || p.properties?.Name?.title?.[0]?.plain_text || 'Untitled Page',
        url: p.url,
        createdTime: p.created_time,
        lastEditedTime: p.last_edited_time
      }));

      return { success: true, total: pages.length, pages };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  // 2. Read Page Details
  async readPage(pageId) {
    try {
      const res = await fetch(`${this.baseUrl}/pages/${pageId}`, {
        method: 'GET',
        headers: this.getHeaders()
      });
      const data = await res.json();
      if (!res.ok) return { success: false, error: data.message || 'Read page failed' };
      return { success: true, page: data };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  // 3. Read Page Blocks
  async readBlocks(blockId, pageSize = 50) {
    try {
      const res = await fetch(`${this.baseUrl}/blocks/${blockId}/children?page_size=${pageSize}`, {
        method: 'GET',
        headers: this.getHeaders()
      });
      const data = await res.json();
      if (!res.ok) return { success: false, error: data.message || 'Read blocks failed' };

      const textBlocks = (data.results || []).map(b => {
        const type = b.type;
        if (b[type] && b[type].rich_text) {
          const text = b[type].rich_text.map(t => t.plain_text).join('');
          return { id: b.id, type, text };
        }
        return { id: b.id, type, text: '' };
      });

      return { success: true, blocks: textBlocks, raw: data.results };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  // 4. Create Page
  async createPage({ parentPageId, title, contentBlocks = [] }) {
    try {
      let parentObj = parentPageId ? { page_id: parentPageId } : null;
      if (!parentObj) {
        // Search workspace for any page to serve as parent
        const searchRes = await this.searchWorkspace('SOAT', 5);
        if (searchRes.success && searchRes.pages && searchRes.pages.length > 0) {
          parentObj = { page_id: searchRes.pages[0].id };
        } else {
          // Fallback to any workspace search result
          const searchAll = await this.searchWorkspace('a', 5);
          if (searchAll.success && searchAll.pages && searchAll.pages.length > 0) {
            parentObj = { page_id: searchAll.pages[0].id };
          } else {
            return { success: false, error: 'Parent Page ID required for Notion page creation' };
          }
        }
      }

      const children = contentBlocks.map(text => ({
        object: 'block',
        type: 'paragraph',
        paragraph: {
          rich_text: [{ type: 'text', text: { content: text } }]
        }
      }));

      const res = await fetch(`${this.baseUrl}/pages`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({
          parent: parentObj,
          properties: {
            title: {
              title: [{ text: { content: title } }]
            }
          },
          children
        })
      });
      const data = await res.json();
      if (!res.ok) return { success: false, error: data.message || 'Create page failed' };
      return { success: true, pageId: data.id, url: data.url, title };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  // 5. Append Block
  async appendBlock(blockId, textContent, blockType = 'paragraph') {
    try {
      const res = await fetch(`${this.baseUrl}/blocks/${blockId}/children`, {
        method: 'PATCH',
        headers: this.getHeaders(),
        body: JSON.stringify({
          children: [
            {
              object: 'block',
              type: blockType,
              [blockType]: {
                rich_text: [{ type: 'text', text: { content: Array.isArray(textContent) ? textContent.join('\n') : String(textContent) } }]
              }
            }
          ]
        })
      });
      const data = await res.json();
      if (!res.ok) return { success: false, error: data.message || 'Append block failed' };
      return { success: true, appended: data.results };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  // 6. Delete Page / Archive
  async deletePage(pageId) {
    try {
      const res = await fetch(`${this.baseUrl}/pages/${pageId}`, {
        method: 'PATCH',
        headers: this.getHeaders(),
        body: JSON.stringify({ archived: true })
      });
      const data = await res.json();
      if (!res.ok) return { success: false, error: data.message || 'Delete page failed' };
      return { success: true, archived: true, id: data.id };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }
}

module.exports = new NotionCrudService();
