# Style and Conventions

- **Language**: JavaScript (Node.js).
- **Module System**: CommonJS (`require`/`module.exports`).
- **Database Access**: Use `@supabase/supabase-js` client.
- **Environment Variables**: Use `dotenv` to load `SUPABASE_URL` and `SUPABASE_SECRET_KEY`.
- **File Naming**: Kebab-case for scripts (e.g., `check-meet-ids.js`).
- **Error Handling**: Use `try/catch` blocks and check for Supabase errors in responses.
- **Logging**: Use `console.log` for progress and `console.error` for errors.
