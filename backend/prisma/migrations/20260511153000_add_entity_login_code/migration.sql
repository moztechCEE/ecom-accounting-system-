ALTER TABLE "entities" ADD COLUMN "login_code" TEXT;

UPDATE "entities"
SET "login_code" = '900324'
WHERE "id" = 'tw-entity-001';

WITH numbered_entities AS (
  SELECT
    "id",
    row_number() OVER (ORDER BY "id") AS row_number
  FROM "entities"
  WHERE "login_code" IS NULL
)
UPDATE "entities" AS entity
SET "login_code" = '9' || lpad((324 + numbered_entities.row_number)::text, 5, '0')
FROM numbered_entities
WHERE entity."id" = numbered_entities."id";

ALTER TABLE "entities" ALTER COLUMN "login_code" SET NOT NULL;

CREATE UNIQUE INDEX "entities_login_code_key" ON "entities"("login_code");

INSERT INTO "user_roles" ("user_id", "role_id")
SELECT "users"."id", "roles"."id"
FROM "users"
CROSS JOIN "roles"
WHERE lower("users"."email") IN (
  'moztecheason@gmail.com',
  's7896629@gmail.com',
  'forever200656@gmail.com'
)
AND "roles"."code" IN ('SUPER_ADMIN', 'ADMIN')
ON CONFLICT ("user_id", "role_id") DO NOTHING;
