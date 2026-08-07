<template>
  <div class="h-screen bg-canvas text-gray-100 font-sans">
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
      currentView: 'chat'
    };
  },
  mounted() {
    this.checkRoute();
    window.addEventListener('popstate', this.checkRoute);
    window.addEventListener('hashchange', this.checkRoute);
  },
  beforeUnmount() {
    window.removeEventListener('popstate', this.checkRoute);
    window.removeEventListener('hashchange', this.checkRoute);
  },
  methods: {
    checkRoute() {
      const path = window.location.pathname;
      const hash = window.location.hash;
      if (path === '/helpadmin' || hash === '#/helpadmin' || path.endsWith('/helpadmin')) {
        this.currentView = 'admin';
      } else {
        this.currentView = 'chat';
      }
    },
    switchView(viewName) {
      this.currentView = viewName;
      if (viewName === 'admin') {
        window.history.pushState({}, '', '/helpadmin');
      } else {
        window.history.pushState({}, '', '/');
      }
    },
    onLoginSuccess(userData) {
      this.isAuthenticated = true;
      localStorage.setItem('jarvis_auth', 'true');
      localStorage.setItem('jarvis_user', JSON.stringify(userData));
      this.checkRoute();
    },
    onLogout() {
      this.isAuthenticated = false;
      localStorage.removeItem('jarvis_auth');
      localStorage.removeItem('jarvis_user');
      window.history.pushState({}, '', '/');
    }
  }
};
</script>
