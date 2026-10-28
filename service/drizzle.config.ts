import { defineConfig } from "drizzle-kit";
export default defineConfig({
  dialect: "sqlite",
  schema: ["./service/db/schema.ts", "./service/db/reimbursement-schema.ts"],
  out: "./service/migrations",
});
