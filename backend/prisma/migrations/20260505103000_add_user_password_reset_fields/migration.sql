ALTER TABLE "users"
ADD COLUMN "must_change_password" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "password_reset_token_hash" TEXT,
ADD COLUMN "password_reset_token_expires_at" TIMESTAMP(3);

CREATE UNIQUE INDEX "users_password_reset_token_hash_key"
ON "users"("password_reset_token_hash");
