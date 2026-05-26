import * as path from "path";
import * as dotenv from "dotenv";
import { Client } from "pg";

dotenv.config({ path: path.join(__dirname, "..", ".env") });

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) { console.error("No DATABASE_URL"); process.exit(1); }
  const parsed = new URL(url);
  const user = decodeURIComponent(parsed.username);
  const password = decodeURIComponent(parsed.password);

  console.log("Parsed values:");
  console.log("  host:", parsed.hostname);
  console.log("  port:", parsed.port);
  console.log("  database:", parsed.pathname.replace(/^\//, ""));
  console.log("  user:", user);
  console.log("  password length:", password.length);
  console.log("  password first/last char:", password[0], "/", password[password.length - 1]);

  const client = new Client({
    host: parsed.hostname,
    port: parseInt(parsed.port || "5432", 10),
    database: parsed.pathname.replace(/^\//, ""),
    user,
    password,
  });
  await client.connect();
  const res = await client.query("SELECT 1 AS ok, current_user, current_database()");
  console.log("Connected:", res.rows[0]);
  await client.end();
}
main().catch(e => { console.error("Failed:", e.message); process.exit(1); });