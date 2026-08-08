<template>
  <div class="bg-card border border-white/10 rounded-2xl p-6 space-y-4">
    <div class="flex items-center justify-between">
      <div>
        <h2 class="text-base font-semibold text-white">Proxy Pool</h2>
        <p class="text-xs text-gray-400 mt-0.5">
          Ba'zi xizmatlar (OpenAI, Telegram MTProto) serveringiz joylashuvidan bloklanishi mumkin — bu yerga proxy provayderingizdan nusxalab qo'ysangiz, kod avtomatik ishlaydigan birini tanlab ishlatadi. .env tahrirlash yoki qayta restart shart emas.
        </p>
      </div>
    </div>

    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
      <div>
        <label class="block text-xs font-medium text-gray-300 mb-1">Maqsad</label>
        <select v-model="purpose" class="w-full bg-sunken border border-white/10 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500">
          <option value="openai">OpenAI (savdo AI, klassifikatsiya)</option>
          <option value="telegram_mtproto">Telegram MTProto (userbot tarix sync)</option>
        </select>
      </div>
    </div>

    <div>
      <label class="block text-xs font-medium text-gray-300 mb-1">Proxy ro'yxatini shu yerga joylang (provayder dashboardidan xom nusxa — IP, port, login, parol)</label>
      <textarea
        v-model="rawText"
        rows="6"
        placeholder="31.59.20.176&#10;6754&#10;username&#10;password&#10;..."
        class="w-full bg-sunken border border-white/10 rounded-xl p-3 text-xs text-white font-mono focus:outline-none focus:border-indigo-500"
      ></textarea>
    </div>

    <div class="flex items-center gap-2">
      <button @click="importProxies" :disabled="loading || !rawText.trim()" class="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-semibold rounded-xl transition">
        {{ loading ? 'Import qilinmoqda…' : 'Import qilish' }}
      </button>
      <button @click="testAll" :disabled="testing" class="px-4 py-2 bg-white/5 hover:bg-white/10 text-gray-300 text-xs font-medium rounded-xl border border-white/5 transition">
        {{ testing ? 'Tekshirilmoqda…' : "Hammasini qayta tekshirish" }}
      </button>
    </div>

    <p v-if="message" class="text-xs" :class="messageIsError ? 'text-rose-400' : 'text-emerald-400'">{{ message }}</p>

    <div class="overflow-x-auto">
      <table class="w-full text-xs">
        <thead>
          <tr class="text-left text-gray-500 border-b border-white/10">
            <th class="py-2 pr-3">Manzil</th>
            <th class="py-2 pr-3">Label</th>
            <th class="py-2 pr-3">Holat</th>
            <th class="py-2 pr-3">Oxirgi tekshiruv</th>
            <th class="py-2"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="p in proxies" :key="p._id" class="border-b border-white/5">
            <td class="py-2 pr-3 font-mono text-gray-300">{{ p.host }}:{{ p.port }}</td>
            <td class="py-2 pr-3 text-gray-400">{{ p.label }}</td>
            <td class="py-2 pr-3">
              <span :class="['px-2 py-0.5 rounded-full border text-[10px] font-semibold', statusClass(p)]">
                {{ statusLabel(p) }}
              </span>
            </td>
            <td class="py-2 pr-3 text-gray-500">{{ p.lastCheckedAt ? new Date(p.lastCheckedAt).toLocaleString() : '—' }}</td>
            <td class="py-2 text-right">
              <button @click="remove(p._id)" class="text-gray-500 hover:text-rose-400 transition">✕</button>
            </td>
          </tr>
          <tr v-if="!proxies.length">
            <td colspan="5" class="py-4 text-center text-gray-500">Hali proxy qo'shilmagan</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script>
import { adminService } from '../services/adminService';

export default {
  data() {
    return {
      purpose: 'openai',
      rawText: '',
      proxies: [],
      loading: false,
      testing: false,
      message: '',
      messageIsError: false
    };
  },
  mounted() {
    this.fetchProxies();
  },
  beforeUnmount() {
    if (this._pollTimer) clearInterval(this._pollTimer);
  },
  watch: {
    purpose() {
      this.fetchProxies();
    }
  },
  methods: {
    async fetchProxies() {
      try {
        const res = await adminService.getProxies(this.purpose);
        this.proxies = res.proxies || [];
      } catch (e) { /* silent — panel just stays empty */ }
    },
    async importProxies() {
      this.loading = true;
      this.message = '';
      try {
        const res = await adminService.importProxies(this.purpose, this.rawText);
        this.message = `${res.imported} ta proxy import qilindi, fonda tekshirilmoqda… (bir necha daqiqa davom etishi mumkin)`;
        this.messageIsError = false;
        this.rawText = '';
        await this.fetchProxies();
        this.pollWhileTesting();
      } catch (e) {
        this.message = e.response?.data?.error || e.message;
        this.messageIsError = true;
      } finally {
        this.loading = false;
      }
    },
    async testAll() {
      this.testing = true;
      this.message = '';
      try {
        await adminService.testProxies(this.purpose);
        this.message = 'Fonda tekshirilmoqda… (bir necha daqiqa davom etishi mumkin)';
        this.messageIsError = false;
        this.pollWhileTesting();
      } catch (e) {
        this.message = e.response?.data?.error || e.message;
        this.messageIsError = true;
      } finally {
        this.testing = false;
      }
    },
    // Tests run in the background on the server — poll the list every few seconds so
    // ISHLAYDI/ISHLAMAYDI statuses fill in without the admin needing to refresh manually.
    pollWhileTesting() {
      if (this._pollTimer) clearInterval(this._pollTimer);
      let ticks = 0;
      this._pollTimer = setInterval(async () => {
        ticks++;
        await this.fetchProxies();
        const allChecked = this.proxies.every((p) => p.lastCheckOk !== null && p.lastCheckOk !== undefined);
        if (allChecked || ticks > 30) {
          clearInterval(this._pollTimer);
          if (allChecked) {
            const working = this.proxies.filter((p) => p.lastCheckOk).length;
            this.message = `${working}/${this.proxies.length} proxy ishlayapti`;
            this.messageIsError = working === 0;
          }
        }
      }, 5000);
    },
    async remove(id) {
      try {
        await adminService.deleteProxy(id);
        await this.fetchProxies();
      } catch (e) { /* ignore */ }
    },
    statusLabel(p) {
      if (p.lastCheckOk === true) return 'ISHLAYDI';
      if (p.lastCheckOk === false) return 'ISHLAMAYDI';
      return 'TEKSHIRILMAGAN';
    },
    statusClass(p) {
      if (p.lastCheckOk === true) return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30';
      if (p.lastCheckOk === false) return 'bg-rose-500/10 text-rose-400 border-rose-500/30';
      return 'bg-amber-500/10 text-amber-400 border-amber-500/30';
    }
  }
};
</script>
