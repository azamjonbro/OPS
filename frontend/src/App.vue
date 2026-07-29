<template>
  <div class="h-screen bg-[#0B0C0E] text-gray-100 font-sans">
    <UserChat v-if="currentView === 'chat'" @switch-view="switchView" />
    <AdminDashboard v-else @switch-view="switchView" />
  </div>
</template>

<script>
import UserChat from './components/UserChat.vue';
import AdminDashboard from './components/AdminDashboard.vue';

export default {
  components: {
    UserChat,
    AdminDashboard
  },
  data() {
    return {
      currentView: 'chat' // 'chat' or 'admin'
    };
  },
  methods: {
    switchView(viewName) {
      this.currentView = viewName;
    }
  }
};
</script>
