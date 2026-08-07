<template>
  <div v-if="isOpen" class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
    <div class="w-full max-w-md bg-raised border border-white/10 rounded-2xl p-6 shadow-2xl space-y-5">
      <div class="flex items-center justify-between border-b border-white/10 pb-4">
        <div>
          <h3 class="text-lg font-semibold text-white flex items-center gap-2">
            <span>⚙️</span> {{ integration?.name }} Configuration
          </h3>
          <p class="text-xs text-gray-400 mt-0.5">SuperAdmin Credentials & OAuth Settings</p>
        </div>
        <button @click="$emit('close')" class="text-gray-400 hover:text-white transition">✕</button>
      </div>

      <!-- Telegram Fields -->
      <div v-if="integration?.type === 'TELEGRAM'" class="space-y-3">
        <div>
          <label class="block text-xs font-medium text-gray-300 mb-1">Bot Token</label>
          <input v-model="formData.botToken" type="password" placeholder="123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ" class="w-full bg-sunken border border-white/10 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500" />
        </div>
        <div>
          <label class="block text-xs font-medium text-gray-300 mb-1">Webhook URL</label>
          <input v-model="formData.webhookUrl" type="text" placeholder="https://api.yourdomain.com/webhook/telegram" class="w-full bg-sunken border border-white/10 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500" />
        </div>
      </div>

      <!-- Telegram Business Bot Fields -->
      <div v-else-if="integration?.type === 'TELEGRAM_BUSINESS'" class="space-y-3">
        <div>
          <label class="block text-xs font-medium text-gray-300 mb-1">Bot Token (@BotFather)</label>
          <input v-model="formData.botToken" type="password" placeholder="123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ" class="w-full bg-sunken border border-white/10 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500" />
        </div>
        <p class="text-[11px] text-gray-400 leading-relaxed">
          Webhook avtomatik ravishda sozlanadi — boshqa hech narsa kiritish shart emas. Saqlagandan keyin bu botni Telegram ilovasida Sozlamalar → Biznes → Chatbotlar bo'limidan ulang va "Reply to messages" ruxsatini bering.
        </p>
      </div>

      <!-- Billz Fields -->
      <div v-else-if="integration?.type === 'BILLZ'" class="space-y-3">
        <div>
          <label class="block text-xs font-medium text-gray-300 mb-1">Billz API Key</label>
          <input v-model="formData.apiKey" type="password" placeholder="blz_live_key_9921a..." class="w-full bg-sunken border border-white/10 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500" />
        </div>
        <div>
          <label class="block text-xs font-medium text-gray-300 mb-1">API Secret</label>
          <input v-model="formData.secret" type="password" placeholder="••••••••••••••••" class="w-full bg-sunken border border-white/10 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500" />
        </div>
        <div>
          <label class="block text-xs font-medium text-gray-300 mb-1">Store ID</label>
          <input v-model="formData.storeId" type="text" placeholder="STORE-TASHKENT-01" class="w-full bg-sunken border border-white/10 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500" />
        </div>
      </div>

      <!-- Notion Fields -->
      <div v-else-if="integration?.type === 'NOTION'" class="space-y-3">
        <div>
          <label class="block text-xs font-medium text-gray-300 mb-1">Internal Integration Token</label>
          <input v-model="formData.integrationToken" type="password" placeholder="secret_notion_token_..." class="w-full bg-sunken border border-white/10 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500" />
        </div>
        <div>
          <label class="block text-xs font-medium text-gray-300 mb-1">Database ID</label>
          <input v-model="formData.databaseId" type="text" placeholder="b9281a8291..." class="w-full bg-sunken border border-white/10 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500" />
        </div>
      </div>

      <!-- General Generic Fields -->
      <div v-else class="space-y-3">
        <div>
          <label class="block text-xs font-medium text-gray-300 mb-1">API Secret / OAuth Token</label>
          <input v-model="formData.apiToken" type="password" placeholder="Enter API Key / Token" class="w-full bg-sunken border border-white/10 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500" />
        </div>
      </div>

      <div class="flex items-center justify-end gap-3 border-t border-white/10 pt-4">
        <button @click="$emit('close')" class="px-4 py-2 text-xs font-medium text-gray-300 hover:text-white transition">Cancel</button>
        <button @click="save" class="px-4 py-2 text-xs font-medium bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl shadow-lg transition">Save & Enable</button>
      </div>
    </div>
  </div>
</template>

<script>
export default {
  props: {
    isOpen: Boolean,
    integration: Object
  },
  data() {
    return {
      formData: {
        botToken: '',
        webhookUrl: '',
        apiKey: '',
        secret: '',
        storeId: '',
        integrationToken: '',
        databaseId: '',
        apiToken: ''
      }
    };
  },
  methods: {
    save() {
      this.$emit('save', {
        type: this.integration.type,
        credentials: this.formData
      });
    }
  }
};
</script>
