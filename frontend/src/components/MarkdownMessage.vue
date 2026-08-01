<template>
  <div ref="host" class="markdown-body" v-html="html"></div>
</template>

<script>
import { marked } from 'marked';

marked.setOptions({ gfm: true, breaks: true });

/**
 * Renders assistant markdown and augments every generated <table> with a toolbar that
 * copies it in a form Excel understands.
 *
 * Excel reads the clipboard's `text/html` flavour and rebuilds real cells from it, so we
 * write the table markup there and a TSV fallback into `text/plain` for plain editors.
 */
function tableToTsv(table) {
  return Array.from(table.rows)
    .map(row => Array.from(row.cells)
      // Tabs/newlines inside a cell would break the TSV grid.
      .map(cell => (cell.innerText || '').replace(/\s+/g, ' ').trim())
      .join('\t'))
    .join('\n');
}

async function copyTable(table) {
  const tsv = tableToTsv(table);
  const html = `<html><body>${table.outerHTML}</body></html>`;

  if (navigator.clipboard && window.ClipboardItem) {
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/html': new Blob([html], { type: 'text/html' }),
          'text/plain': new Blob([tsv], { type: 'text/plain' })
        })
      ]);
      return true;
    } catch (err) {
      // Fall through to the plain-text path (Firefox has no ClipboardItem html support).
    }
  }

  try {
    await navigator.clipboard.writeText(tsv);
    return true;
  } catch (err) {
    return false;
  }
}

export default {
  name: 'MarkdownMessage',
  props: {
    content: { type: String, default: '' }
  },
  computed: {
    html() {
      if (!this.content) return '';
      try {
        return marked.parse(this.content);
      } catch (err) {
        return this.content;
      }
    }
  },
  mounted() {
    this.decorateTables();
  },
  updated() {
    this.decorateTables();
  },
  methods: {
    decorateTables() {
      const host = this.$refs.host;
      if (!host) return;

      host.querySelectorAll('table').forEach((table) => {
        if (table.dataset.decorated) return;
        table.dataset.decorated = '1';

        const wrapper = document.createElement('div');
        wrapper.className = 'md-table-wrap';

        const bar = document.createElement('div');
        bar.className = 'md-table-bar';

        const label = document.createElement('span');
        label.className = 'md-table-label';
        // Subtract the header row.
        label.textContent = `${Math.max(0, table.rows.length - 1)} qator`;

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'md-table-copy';
        btn.textContent = '📋 Jadvalni nusxalash (Excel)';
        btn.addEventListener('click', async () => {
          const ok = await copyTable(table);
          btn.textContent = ok ? '✅ Nusxalandi — Excelga qo\'ying' : '❌ Nusxalab bo\'lmadi';
          setTimeout(() => { btn.textContent = '📋 Jadvalni nusxalash (Excel)'; }, 2200);
        });

        bar.appendChild(label);
        bar.appendChild(btn);

        table.parentNode.insertBefore(wrapper, table);
        wrapper.appendChild(bar);

        const scroller = document.createElement('div');
        scroller.className = 'md-table-scroll';
        scroller.appendChild(table);
        wrapper.appendChild(scroller);
      });
    }
  }
};
</script>

<style>
.md-table-wrap {
  border: 1px solid #262A36;
  border-radius: 0.75rem;
  overflow: hidden;
  margin-bottom: 0.75rem;
  background-color: #101219;
}
.md-table-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  padding: 0.35rem 0.6rem;
  background-color: #171A22;
  border-bottom: 1px solid #262A36;
}
.md-table-label {
  font-size: 0.65rem;
  font-family: monospace;
  color: #8B93A7;
}
.md-table-copy {
  font-size: 0.65rem;
  font-weight: 600;
  color: #A5B4FC;
  background-color: rgba(99, 102, 241, 0.12);
  border: 1px solid rgba(99, 102, 241, 0.3);
  border-radius: 0.5rem;
  padding: 0.2rem 0.55rem;
  cursor: pointer;
  transition: all 0.15s;
  white-space: nowrap;
}
.md-table-copy:hover {
  background-color: rgba(99, 102, 241, 0.28);
  color: #FFFFFF;
}
.md-table-scroll {
  overflow-x: auto;
}
.md-table-scroll table {
  margin-bottom: 0 !important;
}
</style>
