/**
 * 为 bench 组织写入一条 DeepSeek BYOK 凭据（用 AI_CRED_AES_KEY 加密）。
 * 幂等：同 provider 已有有效凭据时不重复插入。
 *
 * 运行：node --import tsx --env-file=.env.local scripts/bench-add-credential.ts
 */
import { createPool } from "../lib/agent-engine/db/pool";
import { encryptKey } from "../lib/crypto/aes_gcm";

const ORG = "00000000-0000-4000-8000-000000000001";
const PROVIDER = "deepseek";

async function main(): Promise<void> {
  const url = process.env.SUPABASE_DB_URL;
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!url) throw new Error("SUPABASE_DB_URL ausente");
  if (!apiKey) throw new Error("DEEPSEEK_API_KEY ausente");

  const pool = createPool(url);
  try {
    const existing = await pool.query(
      `select id from ai_provider_credentials
        where organization_id=$1 and provider=$2 and is_active and validated_at is not null limit 1`,
      [ORG, PROVIDER],
    );
    if (existing.rows.length > 0) {
      console.info(`[credential] ${PROVIDER}: já existe (${existing.rows[0].id}) — nada a fazer`);
      return;
    }

    const secret = encryptKey(apiKey);
    const { rows } = await pool.query(
      `insert into ai_provider_credentials
         (organization_id, provider, label, api_key_encrypted, api_key_iv, api_key_tag,
          api_key_last4, validated_at, is_active)
       values ($1,$2,$3,$4,$5,$6,$7, now(), true)
       returning id`,
      [
        ORG,
        PROVIDER,
        "bench-deepseek",
        secret.ciphertext,
        secret.iv,
        secret.tag,
        secret.last4,
      ],
    );
    console.info(`[credential] ${PROVIDER}: criado ${rows[0].id}`);
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`falhou: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
