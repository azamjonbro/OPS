<template>
  <component
    :is="resolved"
    :size="pixelSize"
    :stroke-width="strokeWidth"
    :aria-hidden="label ? 'false' : 'true'"
    :aria-label="label || undefined"
    :role="label ? 'img' : undefined"
    class="shrink-0"
  />
</template>

<script>
import {
  Archive, ArrowRight, AlertTriangle, BarChart3, Bell, BookOpen, BrainCircuit, Briefcase,
  Building2, Calendar, Check, ChevronLeft, ChevronRight, CircleCheck, Clock, Columns3, Copy,
  ExternalLink, FileText, Folder, FolderOpen, Image, Library, ListTodo, Loader2, LogOut, Mail,
  Menu, MessageSquare, Mic, Monitor, Moon, Package, Pause, Pencil, Phone, Pin, Play, Plus, Reply,
  RefreshCw, Rocket, Save, Search, Send, Settings, ShieldCheck, Sparkles, Square, SquarePen, Sun,
  Tag, Target, Trash2, UploadCloud, User, Users, X, Zap
} from 'lucide-vue-next';

/**
 * Semantic name -> concrete icon.
 *
 * Components reference the *meaning* ("delete", "next-month"), never the library's
 * component name, so swapping icon sets later is a change to this map alone.
 */
const ICONS = {
  // Brand & AI
  logo: Zap,
  zap: Zap,
  ai: Sparkles,
  brain: BrainCircuit,

  // Navigation
  chat: MessageSquare,
  calendar: Calendar,
  projects: Folder,
  'projects-open': FolderOpen,
  board: Columns3,
  tasks: ListTodo,
  admin: Settings,
  menu: Menu,
  back: ChevronLeft,
  prev: ChevronLeft,
  next: ChevronRight,
  'external-link': ExternalLink,

  // Actions
  add: Plus,
  close: X,
  check: Check,
  'check-circle': CircleCheck,
  delete: Trash2,
  edit: SquarePen,
  pencil: Pencil,
  copy: Copy,
  reply: Reply,
  archive: Archive,
  save: Save,
  send: ArrowRight,
  'send-message': Send,
  search: Search,
  refresh: RefreshCw,
  upload: UploadCloud,
  logout: LogOut,
  pin: Pin,

  // Media & files
  mic: Mic,
  play: Play,
  pause: Pause,
  stop: Square,
  file: FileText,
  image: Image,

  // Domain
  product: Package,
  report: BarChart3,
  monitor: Monitor,
  clock: Clock,
  bell: Bell,
  mail: Mail,
  phone: Phone,
  target: Target,
  tag: Tag,
  user: User,
  users: Users,
  shield: ShieldCheck,
  warning: AlertTriangle,
  spinner: Loader2,

  // Knowledge Bank categories
  book: BookOpen,
  library: Library,
  business: BarChart3,
  project: Rocket,
  architecture: Building2,
  sop: Briefcase,

  // Theme
  sun: Sun,
  moon: Moon
};

// One scale for the whole app — no more w-3.5 / w-4 / w-5 chosen ad hoc per button.
const SIZES = { xs: 12, sm: 14, md: 16, lg: 20, xl: 24, '2xl': 32 };

export default {
  name: 'Icon',
  props: {
    name: { type: String, required: true },
    size: { type: String, default: 'md', validator: (v) => v in SIZES },
    strokeWidth: { type: [Number, String], default: 2 },
    /** Set only for standalone icons that carry meaning; decorative icons stay aria-hidden. */
    label: { type: String, default: '' }
  },
  computed: {
    resolved() {
      const icon = ICONS[this.name];
      if (!icon && import.meta.env.DEV) {
        console.warn(`[Icon] noma'lum ikonka: "${this.name}"`);
      }
      return icon || ICONS.warning;
    },
    pixelSize() {
      return SIZES[this.size] || SIZES.md;
    }
  }
};
</script>
