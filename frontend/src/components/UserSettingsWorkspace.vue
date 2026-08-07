<template>
  <div class="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6 max-w-5xl w-full mx-auto">
    <!-- Header Title -->
    <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-white/10 pb-5">
      <div>
        <div class="flex items-center gap-2">
          <div class="w-8 h-8 rounded-xl bg-indigo-500/20 text-indigo-400 border border-indigo-500/30 flex items-center justify-center font-bold">
            ⚙️
          </div>
          <h1 :class="['text-xl sm:text-2xl font-black tracking-tight', isLightTheme ? 'text-slate-900' : 'text-white']">
            Foydalanuvchi Sozlamalari & AI Konfiguratsiyasi
          </h1>
        </div>
        <p :class="['text-xs mt-1 font-medium', isLightTheme ? 'text-slate-600' : 'text-gray-400']">
          Shaxsiy AI yordamchingiz sozlamalari, ovozli modul va integratsiyalarni boshqaring.
        </p>
      </div>

      <!-- Quick Action: Return to Chat -->
      <button 
        @click="$emit('switch-to-chat')"
        class="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded-xl shadow-lg shadow-indigo-600/20 transition flex items-center gap-2 shrink-0 self-start sm:self-auto cursor-pointer"
      >
        <span>💬 AI Chatga Qaytish</span>
      </button>
    </div>

    <!-- Navigation Tabs -->
    <div class="flex items-center gap-2 border-b border-white/5 pb-2 overflow-x-auto">
      <button 
        @click="activeTab = 'profile'"
        :class="['px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-2 whitespace-nowrap cursor-pointer', activeTab === 'profile' ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30' : (isLightTheme ? 'bg-white/80 text-slate-700 hover:bg-white' : 'bg-[#161820] text-gray-300 hover:bg-[#1E202B]')]"
      >
        👤 Profil & AI Xarakteri
      </button>

      <button 
        @click="activeTab = 'models'"
        :class="['px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-2 whitespace-nowrap cursor-pointer', activeTab === 'models' ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30' : (isLightTheme ? 'bg-white/80 text-slate-700 hover:bg-white' : 'bg-[#161820] text-gray-300 hover:bg-[#1E202B]')]"
      >
        🧠 AI Modellar & Tizim
      </button>

      <button 
        @click="activeTab = 'voice'"
        :class="['px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-2 whitespace-nowrap cursor-pointer', activeTab === 'voice' ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30' : (isLightTheme ? 'bg-white/80 text-slate-700 hover:bg-white' : 'bg-[#161820] text-gray-300 hover:bg-[#1E202B]')]"
      >
        🎙️ Ovozli Kirish & Whisper
      </button>

      <button 
        @click="activeTab = 'integrations'"
        :class="['px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-2 whitespace-nowrap cursor-pointer', activeTab === 'integrations' ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30' : (isLightTheme ? 'bg-white/80 text-slate-700 hover:bg-white' : 'bg-[#161820] text-gray-300 hover:bg-[#1E202B]')]"
      >
        🔗 Ulanmalar & Status
      </button>
    </div>

    <!-- TAB 1: USER PROFILE & AI CHARACTER -->
    <div v-if="activeTab === 'profile'" class="space-y-6">
      <div :class="['p-5 sm:p-6 rounded-2xl border transition shadow-lg', isLightTheme ? 'bg-white/90 border-slate-200 shadow-slate-300/40' : 'bg-[#14161C] border-white/10']">
        <h2 :class="['text-base font-extrabold flex items-center gap-2 mb-4', isLightTheme ? 'text-slate-900' : 'text-white']">
          <span>👤</span> Shaxsiy Profil va AI Muloqot Uslubi
        </h2>

        <div class="space-y-4">
          <div>
            <label :class="['block text-xs font-bold mb-1.5', isLightTheme ? 'text-slate-700' : 'text-gray-300']">Egasining Nomi va Lavozimi</label>
            <input 
              v-model="ownerProfile.title" 
              type="text" 
              placeholder="Masalan: Azamjon (Store Hadiya CEO)"
              :class="['w-full px-4 py-2.5 rounded-xl border text-xs font-semibold outline-none transition', isLightTheme ? 'bg-slate-50 border-slate-300 text-slate-900 focus:border-indigo-500' : 'bg-[#1C1E26] border-white/10 text-white focus:border-indigo-500']"
            />
          </div>

          <div>
            <label :class="['block text-xs font-bold mb-1.5', isLightTheme ? 'text-slate-700' : 'text-gray-300']">AI Xarakteri va Muloqot Qoidalari (Prompt Constitution)</label>
            <textarea 
              v-model="ownerProfile.content" 
              rows="4"
              placeholder="AI javob berishda qanday xarakter namoyon etishi kerak..."
              :class="['w-full px-4 py-2.5 rounded-xl border text-xs font-medium outline-none transition leading-relaxed', isLightTheme ? 'bg-slate-50 border-slate-300 text-slate-900 focus:border-indigo-500' : 'bg-[#1C1E26] border-white/10 text-white focus:border-indigo-500']"
            ></textarea>
            <p :class="['text-[11px] mt-1 font-medium', isLightTheme ? 'text-slate-500' : 'text-gray-400']">
              AI har bir so'rovga ushbu qoidalar va xarakter asosida javob qaytaradi.
            </p>
          </div>

          <div class="pt-2 flex justify-end">
            <button 
              @click="saveProfile" 
              :disabled="isSaving"
              class="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-xl shadow-lg shadow-emerald-600/20 transition flex items-center gap-2 cursor-pointer disabled:opacity-50"
            >
              <span>{{ isSaving ? 'Saqlanmoqda...' : '✓ Profil Sozlamalarini Saqlash' }}</span>
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- TAB 2: AI MODELS & SYSTEM PREFERENCES -->
    <div v-if="activeTab === 'models'" class="space-y-6">
      <div :class="['p-5 sm:p-6 rounded-2xl border transition shadow-lg space-y-5', isLightTheme ? 'bg-white/90 border-slate-200 shadow-slate-300/40' : 'bg-[#14161C] border-white/10']">
        <h2 :class="['text-base font-extrabold flex items-center gap-2', isLightTheme ? 'text-slate-900' : 'text-white']">
          <span>🧠</span> AI Neyrotarmoq Modellarini Boshqarish
        </h2>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <!-- GPT-4o Card -->
          <div :class="['p-4 rounded-xl border flex flex-col justify-between space-y-3', isLightTheme ? 'bg-slate-50 border-indigo-200' : 'bg-[#1A1D26] border-indigo-500/30']">
            <div class="space-y-1">
              <div class="flex items-center justify-between">
                <span class="text-xs font-extrabold text-indigo-400">OpenAI GPT-4o</span>
                <span class="px-2 py-0.5 rounded-full text-[9px] font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">FAOL</span>
              </div>
              <p :class="['text-[11px]', isLightTheme ? 'text-slate-600' : 'text-gray-400']">Asosiy matn tahlili, hujjatlar va savdo hisobotlarini shakllantirish modeli.</p>
            </div>
            <div class="text-[10px] font-mono text-gray-400">Latency: ~180 ms</div>
          </div>

          <!-- Claude 3.5 Sonnet Card -->
          <div :class="['p-4 rounded-xl border flex flex-col justify-between space-y-3', isLightTheme ? 'bg-slate-50 border-purple-200' : 'bg-[#1A1D26] border-purple-500/30']">
            <div class="space-y-1">
              <div class="flex items-center justify-between">
                <span class="text-xs font-extrabold text-purple-400">Anthropic Claude 3.5</span>
                <span class="px-2 py-0.5 rounded-full text-[9px] font-bold bg-purple-500/20 text-purple-300 border border-purple-500/30">DUAL ENSEMBLE</span>
              </div>
              <p :class="['text-[11px]', isLightTheme ? 'text-slate-600' : 'text-gray-400']">Mantiqiy tahlil, muloqot xarakteri va konsensus nazoratchisi.</p>
            </div>
            <div class="text-[10px] font-mono text-gray-400">Latency: ~210 ms</div>
          </div>
        </div>

        <div :class="['p-4 rounded-xl border flex items-center justify-between gap-4', isLightTheme ? 'bg-indigo-50/50 border-indigo-200' : 'bg-[#1C1E29] border-white/10']">
          <div>
            <div :class="['text-xs font-bold', isLightTheme ? 'text-indigo-900' : 'text-white']">Dual Ensemble Mode (Ikkita AI Konsensusi)</div>
            <div :class="['text-[11px] mt-0.5', isLightTheme ? 'text-indigo-700' : 'text-gray-400']">GPT-4o va Claude 3.5 bir vaqtda qaror qabul qiladi.</div>
          </div>
          <span class="px-3 py-1 bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 rounded-full text-xs font-bold">YOQILGAN</span>
        </div>
      </div>
    </div>

    <!-- TAB 3: VOICE & WHISPER TRANSCRIPTION -->
    <div v-if="activeTab === 'voice'" class="space-y-6">
      <div :class="['p-5 sm:p-6 rounded-2xl border transition shadow-lg space-y-5', isLightTheme ? 'bg-white/90 border-slate-200 shadow-slate-300/40' : 'bg-[#14161C] border-white/10']">
        <h2 :class="['text-base font-extrabold flex items-center gap-2', isLightTheme ? 'text-slate-900' : 'text-white']">
          <span>🎙️</span> Ovozli Murojaat va Whisper Transkripsiyasi
        </h2>

        <div class="space-y-4">
          <div :class="['p-4 rounded-xl border space-y-2', isLightTheme ? 'bg-slate-50 border-slate-200' : 'bg-[#1C1E26] border-white/10']">
            <div class="flex items-center justify-between">
              <span :class="['text-xs font-bold', isLightTheme ? 'text-slate-800' : 'text-white']">OpenAI Whisper v3 Audio Engine</span>
              <span class="px-2 py-0.5 rounded-full text-[9px] font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">ONLINE</span>
            </div>
            <p :class="['text-[11px]', isLightTheme ? 'text-slate-600' : 'text-gray-400']">
              Audio fayllar Base64 formatida serverga yuboriladi va neyrotarmoq orqali aniq matnga o'giriladi.
            </p>
          </div>

          <div>
            <label :class="['block text-xs font-bold mb-1.5', isLightTheme ? 'text-slate-700' : 'text-gray-300']">Ovoz Aniqlovchi Til (Default Language)</label>
            <select 
              v-model="selectedVoiceLang"
              :class="['w-full px-4 py-2.5 rounded-xl border text-xs font-bold outline-none transition', isLightTheme ? 'bg-slate-50 border-slate-300 text-slate-900' : 'bg-[#1C1E26] border-white/10 text-white']"
            >
              <option value="uz-UZ">O'zbekcha (uz-UZ)</option>
              <option value="en-US">English (en-US)</option>
              <option value="ru-RU">Русский (ru-RU)</option>
            </select>
          </div>
        </div>
      </div>
    </div>

    <!-- TAB 4: INTEGRATIONS STATUS -->
    <div v-if="activeTab === 'integrations'" class="space-y-6">
      <div :class="['p-5 sm:p-6 rounded-2xl border transition shadow-lg space-y-4', isLightTheme ? 'bg-white/90 border-slate-200 shadow-slate-300/40' : 'bg-[#14161C] border-white/10']">
        <h2 :class="['text-base font-extrabold flex items-center gap-2', isLightTheme ? 'text-slate-900' : 'text-white']">
          <span>🔗</span> Ulangan Tizimlar va Ularning Statusi
        </h2>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <!-- Billz POS -->
          <div :class="['p-4 rounded-xl border space-y-2', isLightTheme ? 'bg-slate-50 border-emerald-200' : 'bg-[#1C1E26] border-emerald-500/30']">
            <div class="flex items-center justify-between">
              <span class="text-xs font-extrabold text-emerald-600">Billz POS Retail Sync</span>
              <span class="px-2 py-0.5 rounded-full text-[9px] font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">ULANGAN</span>
            </div>
            <p :class="['text-[11px]', isLightTheme ? 'text-slate-600' : 'text-gray-400']">Do'kon kassa va omborxona qoldiqlari avtomatik sinxronizatsiya qilinadi.</p>
          </div>

          <!-- Notion -->
          <div :class="['p-4 rounded-xl border space-y-2', isLightTheme ? 'bg-slate-50 border-purple-200' : 'bg-[#1C1E26] border-purple-500/30']">
            <div class="flex items-center justify-between">
              <span class="text-xs font-extrabold text-purple-600">Notion Workspace Hub</span>
              <span class="px-2 py-0.5 rounded-full text-[9px] font-bold bg-purple-500/20 text-purple-300 border border-purple-500/30">ULANGAN</span>
            </div>
            <p :class="['text-[11px]', isLightTheme ? 'text-slate-600' : 'text-gray-400']">Loyiha sahifalari va vazifalar bazasiga to'g'ridan-to'g meb kirish.</p>
          </div>

          <!-- Telegram -->
          <div :class="['p-4 rounded-xl border space-y-2', isLightTheme ? 'bg-slate-50 border-sky-200' : 'bg-[#1C1E26] border-sky-500/30']">
            <div class="flex items-center justify-between">
              <span class="text-xs font-extrabold text-sky-600">Telegram Bot Notifications</span>
              <span class="px-2 py-0.5 rounded-full text-[9px] font-bold bg-sky-500/20 text-sky-400 border border-sky-500/30">ULANGAN</span>
            </div>
            <p :class="['text-[11px]', isLightTheme ? 'text-slate-600' : 'text-gray-400']">Kunlik savdo va eslatmalar kanalga avtomatik jo'natiladi.</p>
          </div>

          <!-- Calendar -->
          <div :class="['p-4 rounded-xl border space-y-2', isLightTheme ? 'bg-slate-50 border-amber-200' : 'bg-[#1C1E26] border-amber-500/30']">
            <div class="flex items-center justify-between">
              <span class="text-xs font-extrabold text-amber-600">Google Calendar Sync</span>
              <span class="px-2 py-0.5 rounded-full text-[9px] font-bold bg-amber-500/20 text-amber-500 border border-amber-500/30">ULANGAN</span>
            </div>
            <p :class="['text-[11px]', isLightTheme ? 'text-slate-600' : 'text-gray-400']">Uchrashuv va tadbirlar taqvimga saqlanadi.</p>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import axios from 'axios';
import { API_BASE } from '../services/api';
import themeService from '../services/themeService';

export default {
  name: 'UserSettingsWorkspace',
  data() {
    return {
      activeTab: 'profile',
      isSaving: false,
      isLightTheme: themeService.getTheme() === 'light',
      selectedVoiceLang: 'uz-UZ',
      ownerProfile: {
        title: 'Azamjon (Store Hadiya CEO)',
        content: "Mening xarakterim: Men qisqa, aniq, faktlar va raqamlar bilan gapiradigan insonman. Ortqcha emotsiya va xushomad kerak emas. Biznes qarorlarini darhol taklif qil va muammolarni yechishga yo'naltirilgan bo'l."
      }
    };
  },
  mounted() {
    this.fetchProfile();
    this.unsubscribe = themeService.onThemeChange((t) => {
      this.isLightTheme = t === 'light';
    });
  },
  beforeUnmount() {
    if (this.unsubscribe) this.unsubscribe();
  },
  methods: {
    async fetchProfile() {
      try {
        const res = await axios.get(`${API_BASE}/api/chat/owner/profile`);
        if (res.data && res.data.profile) {
          this.ownerProfile = {
            title: res.data.profile.title || this.ownerProfile.title,
            content: res.data.profile.content || this.ownerProfile.content
          };
        }
      } catch (e) {}
    },
    async saveProfile() {
      this.isSaving = true;
      try {
        await axios.post(`${API_BASE}/api/chat/owner/profile`, this.ownerProfile);
        alert('✓ Profil sozlamalari muvaffaqiyatli saqlandi!');
      } catch (e) {
        alert('Xatolik yuz berdi!');
      } finally {
        this.isSaving = false;
      }
    }
  }
};
</script>
