import { Pool } from "pg";
import { hashPassword } from "better-auth/crypto";
import { createHash } from "node:crypto";

const databaseUrl =
  process.env.DATABASE_URL ||
  "postgresql://postgres:postgres@localhost:5432/node_banana";
const DEFAULT_WORKSPACE_QUOTA_BYTES = 10 * 1024 * 1024 * 1024;

const seedUsers = [
  {
    id: "seed_user_alice",
    name: "Alice Admin",
    email: "alice@nodebanana.dev",
    password: "Password123!",
    workspace: {
      id: "seed_ws_alice",
      name: "Alice Studio",
      slug: "alice-studio",
    },
  },
  {
    id: "seed_user_bob",
    name: "Bob Builder",
    email: "bob@nodebanana.dev",
    password: "Password123!",
    workspace: {
      id: "seed_ws_bob",
      name: "Bob Studio",
      slug: "bob-studio",
    },
  },
  {
    id: "seed_user_chloe",
    name: "Chloe Creator",
    email: "chloe@nodebanana.dev",
    password: "Password123!",
    workspace: {
      id: "seed_ws_chloe",
      name: "Chloe Studio",
      slug: "chloe-studio",
    },
  },
];

function organizationIdForWorkspace(workspaceId) {
  return `org_${workspaceId}`;
}

function organizationMemberId(workspaceId, userId) {
  return `mbr_${workspaceId}_${userId}`;
}

async function ensureUser(client, seedUser) {
  const existingUserResult = await client.query(
    `SELECT id FROM "user" WHERE email = $1 LIMIT 1`,
    [seedUser.email],
  );

  const userId = existingUserResult.rows[0]?.id || seedUser.id;

  if (existingUserResult.rowCount === 0) {
    await client.query(
      `
        INSERT INTO "user" (
          id,
          name,
          email,
          email_verified,
          created_at,
          updated_at
        )
        VALUES ($1, $2, $3, $4, NOW(), NOW())
      `,
      [userId, seedUser.name, seedUser.email, true],
    );
  } else {
    await client.query(
      `
        UPDATE "user"
        SET
          name = $2,
          email_verified = $3,
          updated_at = NOW()
        WHERE id = $1
      `,
      [userId, seedUser.name, true],
    );
  }

  const passwordHash = await hashPassword(seedUser.password);

  await client.query(
    `
      INSERT INTO account (
        id,
        account_id,
        provider_id,
        user_id,
        password,
        created_at,
        updated_at
      )
      VALUES ($1, $2, 'credential', $2, $3, NOW(), NOW())
      ON CONFLICT (provider_id, account_id)
      DO UPDATE SET
        user_id = EXCLUDED.user_id,
        password = EXCLUDED.password,
        updated_at = NOW()
    `,
    [`acct_${userId}`, userId, passwordHash],
  );

  const workspaceResult = await client.query(
    `
      INSERT INTO workspaces (
        id,
        name,
        slug,
        owner_user_id,
        created_at,
        updated_at,
        deleted_at
      )
      VALUES ($1, $2, $3, $4, NOW(), NOW(), NULL)
      ON CONFLICT (slug)
      DO UPDATE SET
        name = EXCLUDED.name,
        owner_user_id = EXCLUDED.owner_user_id,
        updated_at = NOW(),
        deleted_at = NULL
      RETURNING id
    `,
    [
      seedUser.workspace.id,
      seedUser.workspace.name,
      seedUser.workspace.slug,
      userId,
    ],
  );

  const workspaceId = workspaceResult.rows[0]?.id || seedUser.workspace.id;

  await client.query(
    `
      INSERT INTO workspace_storage_limits (
        workspace_id,
        quota_bytes,
        updated_at
      )
      VALUES ($1, $2, NOW())
      ON CONFLICT (workspace_id)
      DO UPDATE SET
        updated_at = NOW()
    `,
    [workspaceId, DEFAULT_WORKSPACE_QUOTA_BYTES],
  );

  await client.query(
    `
      INSERT INTO workspace_members (
        workspace_id,
        user_id,
        role,
        created_at,
        updated_at
      )
      VALUES ($1, $2, 'owner', NOW(), NOW())
      ON CONFLICT (workspace_id, user_id)
      DO UPDATE SET
        role = 'owner',
        updated_at = NOW()
    `,
    [workspaceId, userId],
  );

  const organizationId = organizationIdForWorkspace(workspaceId);

  await client.query(
    `
      INSERT INTO organization (
        id,
        name,
        slug,
        metadata,
        created_at
      )
      VALUES ($1, $2, $3, $4, NOW())
      ON CONFLICT (id)
      DO UPDATE SET
        name = EXCLUDED.name,
        slug = EXCLUDED.slug,
        metadata = EXCLUDED.metadata
    `,
    [
      organizationId,
      seedUser.workspace.name,
      seedUser.workspace.slug,
      null,
    ],
  );

  await client.query(
    `
      INSERT INTO workspace_settings (
        workspace_id,
        organization_id,
        plan_tier,
        created_at,
        updated_at
      )
      VALUES ($1, $2, 'free', NOW(), NOW())
      ON CONFLICT (workspace_id)
      DO UPDATE SET
        organization_id = EXCLUDED.organization_id,
        updated_at = NOW()
    `,
    [workspaceId, organizationId],
  );

  await client.query(
    `
      INSERT INTO member (
        id,
        organization_id,
        user_id,
        role,
        created_at
      )
      VALUES ($1, $2, $3, 'owner', NOW())
      ON CONFLICT (organization_id, user_id)
      DO UPDATE SET
        role = 'owner'
    `,
    [organizationMemberId(workspaceId, userId), organizationId, userId],
  );

  await client.query(
    `
      INSERT INTO onboarding_sessions (
        id,
        user_id,
        workspace_id,
        status,
        current_step,
        answers,
        content_language,
        revision,
        completed_at,
        created_at,
        updated_at
      )
      VALUES ($1, $2, $3, 'completed_legacy', 'education', '{"schemaVersion":1}'::jsonb, 'ar', 1, NOW(), NOW(), NOW())
      ON CONFLICT (user_id)
      DO UPDATE SET
        workspace_id = EXCLUDED.workspace_id,
        status = EXCLUDED.status,
        current_step = EXCLUDED.current_step,
        answers = EXCLUDED.answers,
        content_language = EXCLUDED.content_language,
        revision = EXCLUDED.revision,
        completed_at = EXCLUDED.completed_at,
        updated_at = NOW()
    `,
    [`onb_seed_${userId}`, userId, workspaceId],
  );

  // Legacy-complete seed users bypass interactive onboarding. Give an empty
  // development Workspace one conservative, accepted Brand baseline so local
  // generation and Brand-revision flows can be exercised without a provider
  // call. Any existing Brand history wins and is never changed by reseeding.
  const seedSourceId = `seed_source_${userId}`;
  const seedProfileId = `seed_brand_${userId}`;
  const seedActivationId = `seed_activation_${userId}`;
  const seedBrandDescription = `${seedUser.workspace.name} is an Arabic-first content studio for MENA teams. It helps brands plan, create, review, and publish useful social content while keeping claims accurate and approvals explicit.`;
  const seedBrandDigest = `sha256:${createHash("sha256").update(seedBrandDescription).digest("hex")}`;
  const seedBrandProfile = {
    schemaVersion: 1,
    contentLanguage: "ar",
    identity: {
      companyName: seedUser.workspace.name,
      coreIdentity: "استوديو محتوى عربي أولاً يساعد فرق منطقة الشرق الأوسط وشمال أفريقيا على التخطيط والإنتاج والمراجعة والنشر بثقة.",
      logoAssetId: null,
    },
    offering: ["تخطيط المحتوى", "إنشاء الصور والفيديو والنصوص", "المراجعة والنشر الاجتماعي"],
    audiences: [{ name: "فرق التسويق في المنطقة", description: "فرق عربية تحتاج إلى إنتاج محتوى متسق وسريع مع ضوابط واضحة للعلامة.", weight: 100 }],
    problems: ["بطء إنتاج المحتوى", "تشتت هوية العلامة بين القنوات", "صعوبة تكييف الأفكار للسوق العربي"],
    benefits: ["سير عمل موحّد", "سياق علامة ثابت", "محتوى مناسب للغة والسوق"],
    differentiators: ["تجربة عربية واتجاه من اليمين إلى اليسار", "ضوابط حقوق وموافقات قابلة للتتبع"],
    mission: "تمكين فرق المنطقة من صناعة محتوى أصيل وفعّال بمسؤولية.",
    positioning: "منصة تشغيل محتوى عربية أولاً للعلامات والفرق التي تنشر عبر قنوات متعددة.",
    ownedSpace: "تشغيل المحتوى العربي المدعوم بالذكاء الاصطناعي من الفكرة إلى النشر.",
    businessModel: "b2b",
    categories: ["saas"],
    voice: {
      descriptors: ["واضح", "عملي", "واثق"],
      do: ["استخدم لغة عربية طبيعية ومباشرة", "اربط كل فكرة بقيمة واضحة للجمهور"],
      doNot: ["لا تختلق نتائج أو أرقاماً", "لا تقلّد محتوى المصدر حرفياً"],
    },
    prohibitedClaims: ["نتائج مضمونة", "أفضل منصة بلا دليل"],
    prohibitedTopics: [],
    competitors: [],
    contentAngles: ["كيف يختصر الفريق وقت التخطيط", "تحويل اتجاه رائج إلى فكرة أصيلة للعلامة", "بناء تقويم محتوى متسق بالعربية"],
    uncertainties: ["استبدل ملف العلامة التجريبي بتفاصيل العلامة الحقيقية قبل استخدامه في الإنتاج."],
    evidence: [{ sourceId: seedSourceId, excerptHash: seedBrandDigest }],
    sourceIds: [seedSourceId],
  };
  const seedActivationArtifact = {
    schemaVersion: 1,
    contentLanguage: "ar",
    kind: "content_brief",
    title: "فكرة محتوى أولى للعلامة التجريبية",
    hook: "ابدأ بمشكلة يومية يعرفها فريق التسويق، ثم وضّح كيف يصبح سير العمل أبسط.",
    body: "أنشئ مسودة قصيرة مرتبطة بقيمة حقيقية، وراجع النبرة والادعاءات قبل النشر.",
    rationale: "اقتراح محافظ مبني على ملف العلامة التجريبي المقبول في بيئة التطوير المحلية.",
    suggestedFormats: ["فيديو عمودي 9:16", "منشور اجتماعي", "عرض شرائح"],
    brandProfileId: seedProfileId,
  };

  await client.query(
    `
      INSERT INTO brand_sources (
        id, workspace_id, revision, kind, submitted_url,
        submitted_description, cleaned_text, content_hash, source_language,
        extracted_bytes, fetched_at, created_by_user_id, created_at
      )
      SELECT $1, $2, 1, 'description', NULL, $3, $3, $4, 'en', $5, NOW(), $6, NOW()
      WHERE NOT EXISTS (
        SELECT 1 FROM brand_profiles WHERE workspace_id = $2
      )
      ON CONFLICT (id) DO NOTHING
    `,
    [seedSourceId, workspaceId, seedBrandDescription, seedBrandDigest, Buffer.byteLength(seedBrandDescription), userId],
  );

  await client.query(
    `
      INSERT INTO brand_profiles (
        id, workspace_id, revision, status, schema_version, profile,
        generated_from_run_id, source_profile_id, accepted_by_user_id,
        accepted_at, created_at
      )
      SELECT $1, $2, 1, 'active', 1, $3::jsonb, NULL, NULL, $4, NOW(), NOW()
      WHERE EXISTS (
        SELECT 1 FROM brand_sources WHERE id = $5 AND workspace_id = $2
      )
        AND NOT EXISTS (
          SELECT 1 FROM brand_profiles WHERE workspace_id = $2
        )
      ON CONFLICT (id) DO NOTHING
    `,
    [seedProfileId, workspaceId, JSON.stringify(seedBrandProfile), userId, seedSourceId],
  );

  await client.query(
    `
      INSERT INTO onboarding_activation_artifacts (
        id, workspace_id, brand_profile_id, schema_version, artifact, created_at
      )
      SELECT $1, $2, $3, 1, $4::jsonb, NOW()
      WHERE EXISTS (
        SELECT 1 FROM brand_profiles
        WHERE id = $3 AND workspace_id = $2 AND status = 'active'
      )
      ON CONFLICT (id) DO NOTHING
    `,
    [seedActivationId, workspaceId, seedProfileId, JSON.stringify(seedActivationArtifact)],
  );

  await client.query(
    `
      INSERT INTO user_preferences (
        user_id,
        interface_locale,
        created_at,
        updated_at
      )
      VALUES ($1, 'ar', NOW(), NOW())
      ON CONFLICT (user_id)
      DO UPDATE SET
        interface_locale = EXCLUDED.interface_locale,
        updated_at = NOW()
    `,
    [userId],
  );

  return {
    userId,
    email: seedUser.email,
    password: seedUser.password,
    workspaceId,
    workspaceSlug: seedUser.workspace.slug,
  };
}

async function main() {
  const pool = new Pool({
    connectionString: databaseUrl,
  });

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const results = [];
    for (const seedUser of seedUsers) {
      const result = await ensureUser(client, seedUser);
      results.push(result);
    }

    await client.query("COMMIT");

    console.log("Database seed complete.");
    console.log("Seeded users:");
    for (const result of results) {
      console.log(
        `- ${result.email} / ${result.password} (workspace: ${result.workspaceSlug})`,
      );
    }
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Database seed failed:", error);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

await main();
