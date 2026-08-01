# 📡 STORE HADIYA AI EXECUTIVE WORKSPACE — API ENDPOINTS & INTEGRATION SPECIFICATION

Ushbu hujjat loyihadagi barcha Express Backend API endpointlari, Billz 2.0 REST API, Notion v1 API va boshqa integratsiyalarning to'liq ro'yxatini va foydalanish ko'rsatmalarini o'z ichiga oladi.

---

## 🚀 1. EXPRESS BACKEND CORE API ENDPOINTS (Port: 4000)

| Endpoint | Method | Tavsif | Request Body / Query | Response Format |
|---|---|---|---|---|
| `/api/chat/message` | `POST` | AI Executive Chat va Tool Execution | `{ "content": "...", "conversationId": "conv-1", "attachedFile": null }` | `{ "conversationId": "...", "userMessage": "...", "assistantResponse": "...", "executedTools": [] }` |
| `/api/chat/transcribe-audio` | `POST` | OpenAI Whisper Audio STT Transkripsiya | `{ "audioBase64": "data:audio/webm;base64,...", "mimeType": "audio/webm" }` | `{ "success": true, "transcribedText": "..." }` |
| `/api/chat/conversations` | `GET` | Suhbatlar tarixini olish | - | `{ "conversations": [] }` |
| `/api/chat/conversations` | `DELETE` | Barcha suhbatlar tarixini tozalash | - | `{ "success": true }` |
| `/api/chat/conversations/:id` | `DELETE` | Bitta suhbatni o'chirish | - | `{ "success": true }` |
| `/api/calendar/events` | `GET` | Taqvim tadbirlari va eslatmalar | - | `{ "events": [] }` |
| `/api/calendar/events` | `POST` | Yangi taqvim eventini yaratish | `{ "title": "...", "startDate": "YYYY-MM-DD", "startTime": "HH:mm", "priority": "High" }` | `{ "success": true, "event": {} }` |
| `/api/calendar/events/:id` | `PUT` | Eventni tahrirlash | `{ "title": "...", "status": "Completed" }` | `{ "success": true, "event": {} }` |
| `/api/calendar/events/:id` | `DELETE` | Eventni o'chirish | - | `{ "success": true }` |
| `/api/integrations/billz/health` | `GET` | Billz POS API Jonli Ulanish Diagnostikasi | - | `{ "connected": true, "totalProductsCount": 1522, "responseTimeMs": 120 }` |
| `/api/admin/system-status` | `GET` | Admin Panel Tizim Monitoringi | - | `{ "activeConnectors": 7, "totalInvocations": 42, "db": "MongoDB" }` |

---

## 🛒 2. BILLZ 2.0 POS API ENDPOINTS

Base URL: `https://api-admin.billz.ai` / `https://hadiya.billz.io`

### 🔑 Autentifikatsiya (OAuth2 / JWT Login):
- **POST** `https://api-admin.billz.ai/v1/auth/login`
  - **Headers**: `Content-Type: application/json`
  - **Body**: `{ "secret_token": "YOUR_SECRET_KEY" }`
  - **Response**: `{ "data": { "access_token": "...", "refresh_token": "...", "expires_in": 1296000 } }`

### 🛍️ Mahsulotlar & Inventar API:
- **GET** `https://hadiya.billz.io/api/v2/products?limit=100`
  - **Headers**: `Authorization: Bearer <access_token>`
  - **Tavsif**: Store Hadiya va boshqa do'konlarning barcha 1,522 ta mahsuloti, narxi, ombor qoldig'i hamda rasmlari.

### 🏢 Do'konlar va UUIDlar:
- **Store Hadiya Shop UUID**: `ce50a545-c097-4085-936e-319188e72163`
- **Swiss Watch Toshkent UUID**: `6738ff5c-b079-4775-bab7-c4ebe9446467`
- **Swiss Watch Namangan UUID**: `f12d5c26-e7ee-4f95-85fb-c1b89b826d44`

---

## 📝 3. NOTION WORKSPACE API ENDPOINTS

Base URL: `https://api.notion.com/v1`  
Headers: `Authorization: Bearer <NOTION_API_KEY>`, `Notion-Version: 2022-06-28`

| Amal | Endpoint | Method | Request Body / Params |
|---|---|---|---|
| Workspace Qidiruvi | `/v1/search` | `POST` | `{ "query": "..." }` |
| Sahifani O'qish | `/v1/pages/:page_id` | `GET` | - |
| Bloklarni O'qish | `/v1/blocks/:block_id/children` | `GET` | - |
| Yangi Sahifa Yaratish | `/v1/pages` | `POST` | `{ "parent": { "page_id": "..." }, "properties": { "title": [...] } }` |
| Sahifaga Matn Qo'shish | `/v1/blocks/:block_id/children` | `PATCH` | `{ "children": [ { "object": "block", "type": "paragraph", "paragraph": {...} } ] }` |

---

## ✈️ 4. INTEGRATION DISPATCHERS (Telegram, Email, WhatsApp)

- **Telegram Bot Dispatcher**: `TelegramBotService.sendMessage(chatId, text)`
- **Email Service**: `EmailService.sendEmail(to, subject, body)`
- **WhatsApp Service**: `WhatsappService.sendMessage(phone, text)`

---

## 🔧 SOZLAMALAR FAYLI (.env.dev)

```env
BILLZ_TOKEN=your_billz_secret_token_here
BILLZ_BASE_URL=https://hadiya.billz.io
NOTION_API_KEY=your_notion_api_key_here
PORT=4000
MONGO_URI=mongodb://127.0.0.1:27017/ai_workspace
```
