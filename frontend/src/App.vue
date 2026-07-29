<template>
  <div class="h-screen bg-[#0B0C0E] text-gray-100 font-sans">
    <LoginPage v-if="!isAuthenticated" @login-success="onLoginSuccess" />
    <UserChat v-else-if="currentView === 'chat'" @switch-view="switchView" @logout="onLogout" />
    <AdminDashboard v-else @switch-view="switchView" @logout="onLogout" />
  </div>
</template>

<script>
import UserChat from './components/UserChat.vue';
import AdminDashboard from './components/AdminDashboard.vue';
import LoginPage from './components/LoginPage.vue';

export default {
  components: {
    UserChat,
    AdminDashboard,
    LoginPage
  },
  data() {
    return {
      isAuthenticated: localStorage.getItem('jarvis_auth') === 'true',
      currentView: 'chat' // 'chat' or 'admin'
    };
  },
  methods: {
    switchView(viewName) {
      this.currentView = viewName;
    },
    onLoginSuccess(userData) {
      this.isAuthenticated = true;
      localStorage.setItem('jarvis_auth', 'true');
      localStorage.setItem('jarvis_user', JSON.stringify(userData));
    },
    onLogout() {
      this.isAuthenticated = false;
      localStorage.removeItem('jarvis_auth');
      localStorage.removeItem('jarvis_user');
    }
  }
};
</script>
