ALTER TABLE "employees"
  ADD COLUMN "national_id" TEXT,
  ADD COLUMN "mailing_address" TEXT;

CREATE TABLE "employee_compensation_settings" (
  "id" TEXT NOT NULL,
  "employee_id" TEXT NOT NULL,
  "transport_allowance" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "supervisor_allowance" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "extra_allowance" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "course_allowance" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "seniority_pay" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "bonus" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "salary_adjustment" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "annual_adjustment" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "labor_insurance_deduction" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "health_insurance_deduction" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "pension_self_contribution" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "dependent_insurance" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "salary_advance" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "employee_compensation_settings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "employee_compensation_settings_employee_id_key"
  ON "employee_compensation_settings"("employee_id");

ALTER TABLE "employee_compensation_settings"
  ADD CONSTRAINT "employee_compensation_settings_employee_id_fkey"
  FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "employee_onboarding_documents" (
  "id" TEXT NOT NULL,
  "employee_id" TEXT NOT NULL,
  "doc_type" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "file_name" TEXT,
  "mime_type" TEXT,
  "file_size" INTEGER,
  "file_data_base64" TEXT,
  "uploaded_at" TIMESTAMP(3),
  "verified_at" TIMESTAMP(3),
  "verified_by" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "employee_onboarding_documents_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "employee_onboarding_documents_employee_id_doc_type_key"
  ON "employee_onboarding_documents"("employee_id", "doc_type");

CREATE INDEX "employee_onboarding_documents_employee_id_status_idx"
  ON "employee_onboarding_documents"("employee_id", "status");

ALTER TABLE "employee_onboarding_documents"
  ADD CONSTRAINT "employee_onboarding_documents_employee_id_fkey"
  FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "employee_onboarding_documents"
  ADD CONSTRAINT "employee_onboarding_documents_verified_by_fkey"
  FOREIGN KEY ("verified_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
