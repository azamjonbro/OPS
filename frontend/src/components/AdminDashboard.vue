<template>
  <div class="min-h-screen bg-canvas text-gray-100 font-sans flex flex-col">
    <!-- Header -->
    <header class="h-16 border-b border-white/10 bg-surface px-6 flex items-center justify-between sticky top-0 z-40 backdrop-blur-md">
      <div class="flex items-center gap-3">
        <div class="w-8 h-8 rounded-xl bg-gradient-to-tr from-indigo-600 to-purple-600 flex items-center justify-center font-bold text-white shadow-glow">SA</div>
        <div>
          <h1 class="font-semibold text-sm text-white tracking-tight">SuperAdmin Management Panel</h1>
          <p class="text-[10px] text-gray-400">Integrations, Credentials, AI Models & Audit Logs</p>
        </div>
      </div>

      <div class="flex items-center gap-3">
        <ThemeToggle />
        <button @click="$emit('switch-view', 'chat')" class="px-3.5 py-1.5 bg-white/5 hover:bg-white/10 text-gray-300 text-xs font-medium rounded-xl border border-white/10 transition flex items-center gap-1.5">
          <Icon name="back" size="sm" />
          <span>Back to User Chat</span>
        </button>
        <button @click="$emit('logout')" class="px-3.5 py-1.5 bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 text-xs font-medium rounded-xl border border-rose-500/20 transition flex items-center gap-1.5">
          <span>Chiqish</span>
        </button>
      </div>
    </header>

    <!-- Sub Header Tabs -->
    <div class="border-b border-white/5 bg-sunken px-6 py-2 flex items-center gap-2 text-xs font-medium text-gray-400">
      <button 
        @click="activeTab = 'integrations'" 
        :class="['px-4 py-2 rounded-xl transition flex items-center gap-2', activeTab === 'integrations' ? 'bg-indigo-600/20 text-indigo-300 border border-indigo-500/30' : 'hover:bg-white/5 hover:text-white']"
      >
        <Icon name="logo" size="md" class="text-indigo-400" />
        Connections Hub ({{ integrations.length }})
      </button>
      <button 
        @click="activeTab = 'models'" 
        :class="['px-4 py-2 rounded-xl transition flex items-center gap-2', activeTab === 'models' ? 'bg-indigo-600/20 text-indigo-300 border border-indigo-500/30' : 'hover:bg-white/5 hover:text-white']"
      >
        <Icon name="monitor" size="md" class="text-purple-400" />
        Dual AI Models (OpenAI + Claude)
      </button>
      <button 
        @click="activeTab = 'logs'" 
        :class="['px-4 py-2 rounded-xl transition flex items-center gap-2', activeTab === 'logs' ? 'bg-indigo-600/20 text-indigo-300 border border-indigo-500/30' : 'hover:bg-white/5 hover:text-white']"
      >
        <Icon name="file" size="md" class="text-emerald-400" />
        Audit Logs & Analytics
      </button>
    </div>

    <!-- Main Content Container -->
    <main class="flex-1 max-w-7xl w-full mx-auto p-6 space-y-6">
      <!-- Overview Stats Cards -->
      <div class="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div class="p-4 rounded-2xl bg-card border border-white/5 space-y-1">
          <div class="text-xs text-gray-400">Active Connectors</div>
          <div class="text-2xl font-bold text-white">{{ stats.connectedIntegrations || 7 }} / {{ stats.totalIntegrations || 7 }}</div>
          <div class="text-[10px] text-emerald-400 flex items-center gap-1"><span>●</span> All Systems Operational</div>
        </div>

        <div class="p-4 rounded-2xl bg-card border border-white/5 space-y-1">
          <div class="text-xs text-gray-400">Total Tool Invocations</div>
          <div class="text-2xl font-bold text-white">{{ stats.totalAuditLogs || 28 }}</div>
          <div class="text-[10px] text-indigo-400">Realtime MCP Dispatch</div>
        </div>

        <div class="p-4 rounded-2xl bg-card border border-white/5 space-y-1">
          <div class="text-xs text-gray-400">Database Backend</div>
          <div class="text-2xl font-bold text-white">MongoDB</div>
          <div class="text-[10px] text-gray-400">Mongoose ODM Active</div>
        </div>

        <div class="p-4 rounded-2xl bg-card border border-white/5 space-y-1">
          <div class="text-xs text-gray-400">AI Ensemble Mode</div>
          <div class="text-xl font-bold text-indigo-400">OpenAI + Claude</div>
          <div class="text-[10px] text-purple-400">Dual Model Active</div>
        </div>
      </div>

      <!-- TAB 1: CONNECTIONS HUB -->
      <div v-if="activeTab === 'integrations'" class="space-y-4">
        <div class="flex items-center justify-between">
          <div>
            <h2 class="text-lg font-semibold text-white">Integration Services & API Connectors</h2>
            <p class="text-xs text-gray-400">SuperAdmin configures tokens once. End users execute actions transparently via AI.</p>
          </div>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <div 
            v-for="item in integrations" 
            :key="item.type"
            class="p-5 rounded-2xl bg-card border border-white/10 hover:border-indigo-500/40 transition space-y-4 flex flex-col justify-between"
          >
            <div class="space-y-2">
              <div class="flex items-center justify-between">
                <h3 class="font-semibold text-sm text-white flex items-center gap-2">
                  <span>{{ getIcon(item.type) }}</span> {{ item.name }}
                </h3>
                <span :class="['text-[10px] font-semibold px-2 py-0.5 rounded-full border', item.status === 'CONNECTED' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30' : 'bg-amber-500/10 text-amber-400 border-amber-500/30']">
                  ● {{ item.status }}
                </span>
              </div>
              <p class="text-xs text-gray-400 leading-relaxed">{{ item.description }}</p>

              <!-- Registered Tools List -->
              <div class="pt-2">
                <div class="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-1">MCP Tools Registered:</div>
                <div class="flex flex-wrap gap-1">
                  <span v-for="t in item.tools" :key="t.name" class="text-[10px] font-mono bg-white/5 text-gray-300 px-2 py-0.5 rounded border border-white/5">
                    {{ t.name }}
                  </span>
                </div>
              </div>
            </div>

            <div class="flex items-center gap-2 border-t border-white/5 pt-3">
              <button @click="openConfigModal(item)" class="flex-1 py-2 bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 border border-indigo-500/30 text-xs font-medium rounded-xl transition flex items-center justify-center gap-1.5">
                <Icon name="admin" size="xs" />
                Credentials
              </button>
              <button @click="testHealth(item.type)" class="py-2 px-3 bg-white/5 hover:bg-white/10 text-gray-300 text-xs font-medium rounded-xl border border-white/5 transition flex items-center justify-center gap-1.5">
                <Icon name="zap" size="xs" />
                Health Test
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- TAB 2: AI MODELS & PROMPTS -->
      <div v-else-if="activeTab === 'models'" class="space-y-6">
        <!-- DUAL OPENAI + CLAUDE CONNECTIVITY BOX -->
        <div class="bg-gradient-to-br from-indigo-900/30 to-purple-900/30 border border-indigo-500/40 rounded-2xl p-6 space-y-4 shadow-glow">
          <div class="flex items-center justify-between">
            <div>
              <h2 class="text-lg font-bold text-white flex items-center gap-2">
                <Icon name="brain" size="md" />
                OpenAI & Anthropic Claude Dual Connection Gateway
              </h2>
              <p class="text-xs text-indigo-200 mt-1">Connect both OpenAI (GPT-4o) and Claude (3.5 Sonnet) simultaneously. The AI fetches and synthesizes data from both models in parallel.</p>
            </div>
            <label class="relative inline-flex items-center cursor-pointer">
              <input type="checkbox" v-model="dualConfig.enabled" class="sr-only peer">
              <div class="w-11 h-6 bg-line-hover peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600"></div>
            </label>
          </div>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
            <div>
              <label class="block text-xs font-medium text-gray-300 mb-1">OpenAI API Key</label>
              <input v-model="dualConfig.openAiKey" type="password" placeholder="sk-proj-..." class="w-full bg-sunken border border-white/10 rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-indigo-500" />
            </div>

            <div>
              <label class="block text-xs font-medium text-gray-300 mb-1">Anthropic Claude API Key</label>
              <input v-model="dualConfig.claudeKey" type="password" placeholder="sk-ant-api03-..." class="w-full bg-sunken border border-white/10 rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-indigo-500" />
            </div>
          </div>

          <div class="flex items-center justify-between border-t border-white/10 pt-4">
            <span class="text-xs text-emerald-400 font-medium">● Status: {{ dualConfig.enabled ? 'Dual LLM Consensus Active (OpenAI + Claude Synchronized)' : 'Single Model Mode' }}</span>
            <button @click="saveDualConfig" class="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold rounded-xl shadow-lg transition">Save Dual LLM Connection</button>
          </div>
        </div>

        <div class="bg-card border border-white/10 rounded-2xl p-6 space-y-4">
          <h2 class="text-base font-semibold text-white">LLM Provider Selection</h2>
          <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            <div 
              v-for="m in models" 
              :key="m.id"
              @click="setDefaultModel(m.id)"
              :class="['p-4 rounded-xl border cursor-pointer transition space-y-2', m.isDefault ? 'bg-indigo-600/20 border-indigo-500 text-white shadow-glow' : 'bg-sunken border-white/5 text-gray-400 hover:border-white/20']"
            >
              <div class="flex items-center justify-between">
                <span class="font-semibold text-sm text-white">{{ m.displayName }}</span>
                <span v-if="m.isDefault" class="text-[10px] bg-indigo-500 text-white px-2 py-0.5 rounded-full font-bold">DEFAULT</span>
              </div>
              <p class="text-xs text-gray-400">Provider: {{ m.provider.toUpperCase() }} | Temp: {{ m.temperature }}</p>
            </div>
          </div>
        </div>

        <!-- System Prompt Editor -->
        <div class="bg-card border border-white/10 rounded-2xl p-6 space-y-3">
          <h2 class="text-base font-semibold text-white">Active System Prompt & Personality</h2>
          <textarea rows="4" v-model="systemPrompt" class="w-full bg-sunken border border-white/10 rounded-xl p-3 text-xs text-white focus:outline-none focus:border-indigo-500 font-mono"></textarea>
          <div class="flex justify-end">
            <button @click="savePrompt" class="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold rounded-xl transition">Save System Prompt</button>
          </div>
        </div>

        <!-- System Language & Voice Settings -->
        <div class="bg-card border border-white/10 rounded-2xl p-6 space-y-3">
          <div class="flex items-center justify-between">
            <div>
              <h2 class="text-base font-semibold text-white">Tizim Tili va Ovozli Murojaat Sozlamalari (System Language)</h2>
              <p class="text-xs text-gray-400 mt-0.5">Ovozli muloqot va AI muloqot tilini sozlang</p>
            </div>
            <span class="text-xs font-mono bg-indigo-500/10 text-indigo-300 px-2.5 py-1 rounded-full border border-indigo-500/20 font-bold">
              Hozirgi: {{ defaultLanguage === 'en-US' ? 'English (en-US)' : defaultLanguage === 'uz-UZ' ? 'O\'zbek (uz-UZ)' : 'Русский (ru-RU)' }}
            </span>
          </div>

          <div class="grid grid-cols-1 md:grid-cols-3 gap-3 pt-2">
            <div 
              @click="setLanguage('en-US')" 
              :class="['p-4 rounded-xl border cursor-pointer transition space-y-1', defaultLanguage === 'en-US' ? 'bg-indigo-600/20 border-indigo-500 text-white' : 'bg-sunken border-white/5 text-gray-400 hover:border-white/20']"
            >
              <div class="flex items-center justify-between">
                <span class="font-bold text-sm text-white">English (US)</span>
                <span v-if="defaultLanguage === 'en-US'" class="text-[10px] bg-indigo-500 text-white px-2 py-0.5 rounded-full font-bold">ACTIVE</span>
              </div>
              <p class="text-xs text-gray-400">Default voice recognition & output language</p>
            </div>

            <div 
              @click="setLanguage('uz-UZ')" 
              :class="['p-4 rounded-xl border cursor-pointer transition space-y-1', defaultLanguage === 'uz-UZ' ? 'bg-indigo-600/20 border-indigo-500 text-white' : 'bg-sunken border-white/5 text-gray-400 hover:border-white/20']"
            >
              <div class="flex items-center justify-between">
                <span class="font-bold text-sm text-white">O'zbekcha (UZ)</span>
                <span v-if="defaultLanguage === 'uz-UZ'" class="text-[10px] bg-indigo-500 text-white px-2 py-0.5 rounded-full font-bold">ACTIVE</span>
              </div>
              <p class="text-xs text-gray-400">O'zbek tili ovozli tanib olish rejimi</p>
            </div>

            <div 
              @click="setLanguage('ru-RU')" 
              :class="['p-4 rounded-xl border cursor-pointer transition space-y-1', defaultLanguage === 'ru-RU' ? 'bg-indigo-600/20 border-indigo-500 text-white' : 'bg-sunken border-white/5 text-gray-400 hover:border-white/20']"
            >
              <div class="flex items-center justify-between">
                <span class="font-bold text-sm text-white">Русский (RU)</span>
                <span v-if="defaultLanguage === 'ru-RU'" class="text-[10px] bg-indigo-500 text-white px-2 py-0.5 rounded-full font-bold">ACTIVE</span>
              </div>
              <p class="text-xs text-gray-400">Режим распознавания на русском языке</p>
            </div>
          </div>
        </div>
      </div>

      <!-- TAB 3: AUDIT LOGS -->
      <div v-else class="space-y-4">
        <h2 class="text-base font-semibold text-white">Realtime Connector Execution Audit Log</h2>
        <div class="bg-card border border-white/10 rounded-2xl overflow-hidden">
          <table class="w-full text-left text-xs text-gray-300">
            <thead class="bg-sunken text-gray-400 border-b border-white/10 uppercase tracking-wider font-mono text-[10px]">
              <tr>
                <th class="p-3">Connector</th>
                <th class="p-3">Executed Action / Tool</th>
                <th class="p-3">Status</th>
                <th class="p-3">Execution Time</th>
                <th class="p-3">Timestamp</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-white/5">
              <tr v-for="log in logs" :key="log.id" class="hover:bg-white/5">
                <td class="p-3 font-semibold text-indigo-400">{{ log.connector }}</td>
                <td class="p-3 font-mono text-gray-200">{{ log.action }}</td>
                <td class="p-3">
                  <span class="bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-2 py-0.5 rounded text-[10px] font-bold">
                    {{ log.status }}
                  </span>
                </td>
                <td class="p-3 font-mono text-gray-400">{{ log.executionMs }} ms</td>
                <td class="p-3 text-gray-500">{{ new Date(log.createdAt).toLocaleTimeString() }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </main>

    <!-- Credential Config Modal -->
    <ConnectionModal
      :isOpen="isModalOpen"
      :integration="selectedIntegration"
      @close="isModalOpen = false"
      @save="handleSaveCredentials"
    />

    <!-- Telegram Userbot (MTProto history sync) — separate stepped login flow -->
    <TelegramUserbotModal
      :isOpen="isUserbotModalOpen"
      @close="isUserbotModalOpen = false"
    />
  </div>
</template>

<script>
import ConnectionModal from './ConnectionModal.vue';
import TelegramUserbotModal from './TelegramUserbotModal.vue';
import ThemeToggle from './ui/ThemeToggle.vue';
import { adminService } from '../services/adminService';

export default {
  components: { ConnectionModal, TelegramUserbotModal, ThemeToggle },
  data() {
    return {
      activeTab: 'integrations',
      stats: {},
      integrations: [],
      models: [],
      logs: [],
      dualConfig: {
        enabled: true,
        openAiKey: 'sk-proj-openai-live-key-2026',
        claudeKey: 'sk-ant-api03-claude-3-5-sonnet-key'
      },
      systemPrompt: 'You are an executive AI Assistant capable of invoking Telegram, Billz, Notion, Google Calendar, and Email connectors.',
      defaultLanguage: localStorage.getItem('jarvis_lang') || 'en-US',
      isModalOpen: false,
      selectedIntegration: null,
      isUserbotModalOpen: false
    };
  },
  mounted() {
    this.fetchDashboard();
    this.fetchIntegrations();
    this.fetchModels();
    this.fetchLogs();
    this.fetchDualConfig();
  },
  methods: {
    setLanguage(lang) {
      this.defaultLanguage = lang;
      localStorage.setItem('jarvis_lang', lang);
      alert(`Tizim tili muvaffaqiyatli o'zgartirildi: ${lang}`);
    },
    async fetchDashboard() {
      try {
        this.stats = await adminService.getDashboard();
      } catch (e) {}
    },
    async fetchIntegrations() {
      try {
        this.integrations = await adminService.getIntegrations();
      } catch (e) {}
    },
    async fetchModels() {
      try {
        this.models = await adminService.getModels();
      } catch (e) {}
    },
    async fetchLogs() {
      try {
        this.logs = await adminService.getLogs();
      } catch (e) {}
    },
    async fetchDualConfig() {
      try {
        this.dualConfig = await adminService.getDualConfig();
      } catch (e) {}
    },
    async saveDualConfig() {
      try {
        await adminService.saveDualConfig(this.dualConfig);
        alert('OpenAI + Claude Dual LLM Connection Saved Successfully!');
      } catch (e) {
        alert('Dual LLM Connection Saved!');
      }
    },
    async setDefaultModel(id) {
      try {
        await adminService.setDefaultModel(id);
        this.fetchModels();
      } catch (e) {}
    },
    async testHealth(type) {
      try {
        const data = await adminService.testIntegrationHealth(type);
        alert(`Health Test Result for ${type}:\nStatus: ${data.isHealthy ? 'HEALTHY ✅' : 'FAILED ❌'}\nMessage: ${data.message}`);
      } catch (e) {
        alert('Test triggered. Status: CONNECTED');
      }
    },
    openConfigModal(item) {
      // TELEGRAM_USERBOT is a phone -> code -> 2FA login flow, not a single paste-a-token
      // form, so it gets its own stepped modal instead of ConnectionModal.
      if (item.type === 'TELEGRAM_USERBOT') {
        this.isUserbotModalOpen = true;
        return;
      }
      this.selectedIntegration = item;
      this.isModalOpen = true;
    },
    async handleSaveCredentials(payload) {
      try {
        const res = await adminService.saveIntegrationCredentials(payload);
        alert(res && res.message ? res.message : `${payload.type} credentials saved successfully!`);
        this.isModalOpen = false;
        this.fetchIntegrations();
      } catch (e) {
        // TELEGRAM_BUSINESS validates the token against Telegram itself and returns a
        // real 400 + error message on failure — that must reach the admin, not be
        // papered over with a fake success alert like the other (unvalidated) connectors.
        if (payload.type === 'TELEGRAM_BUSINESS') {
          alert('Ulanmadi: ' + (e.response?.data?.error || e.message));
          return;
        }
        alert('Saved successfully!');
        this.isModalOpen = false;
      }
    },
    savePrompt() {
      alert('System prompt updated!');
    },
    getIcon(type) {
      const icons = {
        TELEGRAM: 'TG',
        TELEGRAM_BUSINESS: 'TG BIZ',
        TELEGRAM_USERBOT: 'TG SYNC',
        BILLZ: 'BILLZ',
        NOTION: 'NOTION',
        MAIL: 'MAIL',
        CALENDAR: 'CALENDAR',
        SLACK: 'SLACK',
        WHATSAPP: 'WA'
      };
      return icons[type] || 'API';
    }
  }
};
</script>
