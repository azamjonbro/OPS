<template>
  <div v-if="isOpen" class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
    <div class="w-full max-w-md bg-raised border border-white/10 rounded-2xl p-6 shadow-2xl space-y-5">
      <div class="flex items-center justify-between border-b border-white/10 pb-4">
        <div>
          <h3 class="text-lg font-semibold text-white flex items-center gap-2">
            <span>📱</span> Telegram Userbot (Tarix Sync)
          </h3>
          <p class="text-xs text-gray-400 mt-0.5">Shaxsiy akkountga ulanib, eski chat tarixini bir martalik sync qiladi</p>
        </div>
        <button @click="close" class="text-gray-400 hover:text-white transition">✕</button>
      </div>

      <p v-if="error" class="text-xs text-rose-400 bg-rose-500/10 border border-rose-500/30 rounded-xl px-3 py-2">{{ error }}</p>

      <!-- Already connected: status + sync trigger -->
      <div v-if="status.connected" class="space-y-4">
        <div class="text-xs text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 rounded-xl px-3 py-2">
          ● Ulangan: {{ status.phone || "noma'lum raqam" }}
        </div>
        <div class="text-xs text-gray-400 space-y-1">
          <p class="text-indigo-300">⏰ Har kuni avtomatik sync qilinadi — bu tugma faqat darhol qo'lda ishga tushirish uchun.</p>
          <p>Oxirgi sync: {{ status.lastSyncAt ? new Date(status.lastSyncAt).toLocaleString() : 'hali sync qilinmagan' }}</p>
          <p v-if="status.lastSyncStats">
            Tekshirilgan chatlar: {{ status.lastSyncStats.dialogsScanned }} · Import qilingan xabarlar: {{ status.lastSyncStats.messagesImported }}
            <span v-if="status.lastSyncStats.errors">· Xatolar: {{ status.lastSyncStats.errors }}</span>
          </p>
          <p v-if="status.lastSyncStats && status.lastSyncStats.autoReplied">
            🤖 Avtomatik javob berilgan javobsiz mijozlar: {{ status.lastSyncStats.autoReplied }}
          </p>
        </div>
        <button
          @click="triggerSync"
          :disabled="status.syncing || syncing"
          class="w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-semibold rounded-xl shadow-lg transition"
        >
          {{ status.syncing || syncing ? 'Sync ishlamoqda…' : "Tarixni sync qilish (oxirgi 90 kun)" }}
        </button>
        <button
          @click="disconnect"
          :disabled="loading"
          class="w-full py-2.5 bg-rose-500/10 hover:bg-rose-500/20 disabled:opacity-50 text-rose-400 text-xs font-semibold rounded-xl border border-rose-500/30 transition"
        >
          {{ loading ? 'Uzilmoqda…' : "Ulanishni uzish (boshqa akkaunt ulash uchun)" }}
        </button>
      </div>

      <!-- Step: phone -->
      <div v-else-if="step === 'phone'" class="space-y-3">
        <div>
          <label class="block text-xs font-medium text-gray-300 mb-1">Telefon raqam</label>
          <input v-model="phone" type="text" placeholder="+998901234567" class="w-full bg-sunken border border-white/10 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500" />
        </div>
        <p class="text-[11px] text-gray-400 leading-relaxed">
          Bu sizning shaxsiy Telegram akkountingiz — kod Telegram ilovangizga keladi. Faqat tarixni o'qish uchun ishlatiladi, xabar yuborish uchun emas.
        </p>
        <button @click="submitPhone" :disabled="loading" class="w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-semibold rounded-xl shadow-lg transition">
          {{ loading ? 'Yuborilmoqda…' : 'Kod yuborish' }}
        </button>
      </div>

      <!-- Step: code -->
      <div v-else-if="step === 'code'" class="space-y-3">
        <div>
          <label class="block text-xs font-medium text-gray-300 mb-1">Telegram'dan kelgan kod</label>
          <input v-model="code" type="text" placeholder="12345" class="w-full bg-sunken border border-white/10 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500" />
        </div>
        <button @click="submitCode" :disabled="loading" class="w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-semibold rounded-xl shadow-lg transition">
          {{ loading ? 'Tekshirilmoqda…' : 'Tasdiqlash' }}
        </button>
      </div>

      <!-- Step: 2FA password -->
      <div v-else-if="step === 'password'" class="space-y-3">
        <div>
          <label class="block text-xs font-medium text-gray-300 mb-1">Ikki bosqichli tasdiqlash (2FA) paroli</label>
          <input v-model="password" type="password" placeholder="••••••••" class="w-full bg-sunken border border-white/10 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500" />
        </div>
        <button @click="submitPassword" :disabled="loading" class="w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-semibold rounded-xl shadow-lg transition">
          {{ loading ? 'Tekshirilmoqda…' : 'Ulanish' }}
        </button>
      </div>

      <div class="flex items-center justify-end border-t border-white/10 pt-4">
        <button @click="close" class="px-4 py-2 text-xs font-medium text-gray-300 hover:text-white transition">Yopish</button>
      </div>
    </div>
  </div>
</template>

<script>
import { adminService } from '../services/adminService';

export default {
  props: {
    isOpen: Boolean
  },
  emits: ['close'],
  data() {
    return {
      step: 'phone',
      phone: '',
      code: '',
      password: '',
      loading: false,
      syncing: false,
      error: '',
      status: { connected: false, configured: false }
    };
  },
  watch: {
    isOpen(val) {
      if (val) this.fetchStatus();
    }
  },
  methods: {
    close() {
      this.$emit('close');
    },
    async fetchStatus() {
      this.error = '';
      try {
        this.status = await adminService.getTelegramUserbotStatus();
      } catch (e) {
        this.error = e.response?.data?.error || e.message;
      }
    },
    async submitPhone() {
      this.loading = true;
      this.error = '';
      try {
        const res = await adminService.telegramUserbotStartLogin(this.phone);
        if (!res.success) throw new Error(res.error);
        this.step = 'code';
      } catch (e) {
        this.error = e.response?.data?.error || e.message;
      } finally {
        this.loading = false;
      }
    },
    async submitCode() {
      this.loading = true;
      this.error = '';
      try {
        const res = await adminService.telegramUserbotSubmitCode(this.code);
        if (!res.success) throw new Error(res.error);
        if (res.status === 'AWAITING_PASSWORD') {
          this.step = 'password';
        } else {
          await this.fetchStatus();
        }
      } catch (e) {
        this.error = e.response?.data?.error || e.message;
      } finally {
        this.loading = false;
      }
    },
    async submitPassword() {
      this.loading = true;
      this.error = '';
      try {
        const res = await adminService.telegramUserbotSubmitPassword(this.password);
        if (!res.success) throw new Error(res.error);
        await this.fetchStatus();
      } catch (e) {
        this.error = e.response?.data?.error || e.message;
      } finally {
        this.loading = false;
      }
    },
    async disconnect() {
      if (!confirm("Telegram akkountini uzmoqchimisiz? Boshqa akkaunt ulash uchun qayta login qilishingiz kerak bo'ladi.")) return;
      this.loading = true;
      this.error = '';
      try {
        const res = await adminService.telegramUserbotLogout();
        if (!res.success) throw new Error(res.error);
        this.step = 'phone';
        this.phone = '';
        this.code = '';
        this.password = '';
        await this.fetchStatus();
      } catch (e) {
        this.error = e.response?.data?.error || e.message;
      } finally {
        this.loading = false;
      }
    },
    async triggerSync() {
      this.syncing = true;
      this.error = '';
      try {
        const res = await adminService.telegramUserbotSyncHistory();
        if (!res.success) throw new Error(res.error);
        // Sync runs async on the backend — poll status a few times to reflect progress.
        setTimeout(this.fetchStatus, 5000);
        setTimeout(this.fetchStatus, 15000);
      } catch (e) {
        this.error = e.response?.data?.error || e.message;
      } finally {
        this.syncing = false;
      }
    }
  }
};
</script>
