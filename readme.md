# Mỹ Miều Quiz — Backend

API Node.js + Express + TypeScript + MongoDB Atlas + Gemini.

## Chạy local

```bash
cp .env.example .env
# Điền MONGO_URI, JWT_SECRET, GEMINI_API_KEY

npm install
npm run dev
```

Server mặc định: `http://localhost:5000`

## Scripts

| Lệnh | Mô tả |
|---|---|
| `npm run dev` | Dev với hot reload (`tsx watch`) |
| `npm run build` | Compile TypeScript → `dist/` |
| `npm start` | Chạy bản build |
| `npm run typecheck` | Kiểm tra type không emit |

## API chính

- `POST /api/auth/register` · `POST /api/auth/login` · `GET /api/auth/me`
- `POST /api/documents/upload` · `GET /api/documents`
- `POST /api/quizzes/generate` · `GET /api/quizzes/:id`
- `POST /api/sessions` · answer / submit / retry-wrong / redo

Nghiệp vụ bám `../promptver1.md` và `../PLAN-QuizPractice.md`.
