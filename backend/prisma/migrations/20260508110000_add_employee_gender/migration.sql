-- Add employee gender for gender-specific leave rules such as menstrual leave.
ALTER TABLE "employees" ADD COLUMN "gender" TEXT;
